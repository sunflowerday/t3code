const fs = require("node:fs");
const path = require("node:path");

const { withAppDelegate, withDangerousMod } = require("expo/config-plugins");

const MARKER = "t3-fatal-handler";
const RECLAIM_MARKER = "t3-fatal-handler-reclaim";
const HELPER_NAME = "t3InstallNonCrashingFatalHandlers";
const NO_RETHROW_MARKER = "t3-fatal-handler-no-rethrow";

const IOS_THROW =
  "delegate?.throwException(NSException(name: name, reason: reason, userInfo: userInfo))";
const ANDROID_THROW = "delegate.throwException(encounteredErrors[0])";

const HELPERS = `

// ${MARKER}: single native gate. RCTFatal / RCTFatalException must log, persist,
// and return. expo-updates ErrorRecovery replaces these handlers during
// super.application; they are reclaimed immediately after.
func ${HELPER_NAME}() {
    RCTSetFatalHandler { error in
        t3RecordNativeFatal(message: error?.localizedDescription ?? "unknown")
    }
    RCTSetFatalExceptionHandler { exception in
        t3RecordNativeFatal(message: exception?.reason ?? String(describing: exception?.name))
    }
}

func t3RecordNativeFatal(message: String) {
    NSLog("[t3-fatal] %@", message)
    t3WriteLastFatalError(message: message)
    t3PresentFatalAlert(message: message)
}

func t3WriteLastFatalError(message: String) {
    let fileManager = FileManager.default
    guard let documents = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first else {
        return
    }
    let directory = documents.appendingPathComponent("diagnostics", isDirectory: true)
    do {
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let payload: [String: Any] = [
            "message": message,
            "stack": NSNull(),
            "occurredAt": formatter.string(from: Date()),
        ]
        let data = try JSONSerialization.data(withJSONObject: payload)
        try data.write(to: directory.appendingPathComponent("last-fatal-error.json"), options: .atomic)
    } catch {
        NSLog("[t3-fatal] persist failed %@", error.localizedDescription)
    }
}

func t3PresentFatalAlert(message: String) {
    DispatchQueue.main.async {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first
        guard let scene else {
            return
        }
        let root = scene.keyWindow?.rootViewController
            ?? scene.windows.first(where: { $0.isKeyWindow })?.rootViewController
            ?? scene.windows.first?.rootViewController
        guard var presenter = root else {
            return
        }
        while let next = presenter.presentedViewController {
            presenter = next
        }
        if presenter is UIAlertController {
            return
        }
        let alert = UIAlertController(
            title: "Something went wrong",
            message: message,
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "Dismiss", style: .default))
        presenter.present(alert, animated: true)
    }
}

func t3ArmFatalProbeIfRequested() {
    if ProcessInfo.processInfo.arguments.contains("--t3-fatal-probe") {
        let fileManager = FileManager.default
        guard let documents = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first else {
            return
        }
        let directory = documents.appendingPathComponent("diagnostics", isDirectory: true)
        try? fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        fileManager.createFile(
            atPath: directory.appendingPathComponent("fatal-probe").path,
            contents: Data("1".utf8)
        )
    }
}
`;

const OLD_SNIPPET = `    // ${MARKER}: keep the process alive and leave the JS message in device logs.
    RCTSetFatalHandler { error in
      NSLog("[t3-fatal] %@", error?.localizedDescription ?? "unknown")
    }
    RCTSetFatalExceptionHandler { exception in
      NSLog("[t3-fatal] %@", exception?.reason ?? String(describing: exception?.name))
    }
`;

const LAUNCH_CALLS = `    // ${MARKER}
    ${HELPER_NAME}()
    t3ArmFatalProbeIfRequested()
`;

function insertAfterLaunchBrace(contents, snippet) {
  const method = contents.indexOf("didFinishLaunchingWithOptions");
  if (method < 0) {
    throw new Error(
      "withIosFatalHandler: AppDelegate is missing didFinishLaunchingWithOptions; cannot install RCTSetFatalHandler.",
    );
  }

  const brace = contents.indexOf("{", method);
  if (brace < 0) {
    throw new Error("withIosFatalHandler: could not find the didFinishLaunchingWithOptions body.");
  }

  return `${contents.slice(0, brace + 1)}\n${snippet}${contents.slice(brace + 1)}`;
}

function reclaimAfterSuper(contents) {
  if (contents.includes(RECLAIM_MARKER)) {
    return contents;
  }

  const original =
    "return super.application(application, didFinishLaunchingWithOptions: launchOptions)";
  if (!contents.includes(original)) {
    throw new Error(
      "withIosFatalHandler: AppDelegate is missing return super.application(...didFinishLaunchingWithOptions); cannot reclaim RCTFatal after expo-updates.",
    );
  }

  return contents.replace(
    original,
    `let launched = super.application(application, didFinishLaunchingWithOptions: launchOptions)
    // ${RECLAIM_MARKER}: ErrorRecovery.startMonitoring() runs inside super and
    // replaces RCTSetFatalHandler. Reclaim so crash() is never scheduled.
    ${HELPER_NAME}()
    return launched`,
  );
}

function appendHelpers(contents) {
  if (contents.includes(`func ${HELPER_NAME}()`)) {
    return contents;
  }
  return `${contents.trimEnd()}\n${HELPERS}\n`;
}

function installFatalHandler(contents) {
  let next = contents;

  if (next.includes(OLD_SNIPPET)) {
    next = next.replace(OLD_SNIPPET, LAUNCH_CALLS);
  } else if (!next.includes(`${HELPER_NAME}()`)) {
    next = insertAfterLaunchBrace(next, LAUNCH_CALLS);
  }

  next = reclaimAfterSuper(next);
  return appendHelpers(next);
}

function neutralizeIosErrorRecoveryCrash(source) {
  if (source.includes(NO_RETHROW_MARKER)) {
    return source;
  }
  if (!source.includes(IOS_THROW)) {
    throw new Error(
      "withIosFatalHandler: expo-updates ErrorRecovery.swift no longer rethrows at the expected site.",
    );
  }
  return source.replace(
    IOS_THROW,
    `// ${NO_RETHROW_MARKER}: previousFatalErrorHandler already recorded.
    // Uncaught JS exceptions must not kill the process.
    NSLog("[t3-fatal] suppressed ErrorRecovery rethrow")`,
  );
}

function neutralizeAndroidErrorRecoveryCrash(source) {
  if (source.includes(NO_RETHROW_MARKER)) {
    return source;
  }
  if (!source.includes(ANDROID_THROW)) {
    throw new Error(
      "withIosFatalHandler: expo-updates ErrorRecoveryHandler.kt no longer throws at the expected site.",
    );
  }
  return source.replace(
    ANDROID_THROW,
    `// ${NO_RETHROW_MARKER}: uncaught JS exceptions must not kill the process.
        logger.error("UpdatesErrorRecovery: suppressed crash", encounteredErrors[0], UpdatesErrorCode.Unknown)`,
  );
}

function applySourcePatch(filePath, transform) {
  const source = fs.readFileSync(filePath, "utf8");
  const next = transform(source);
  if (next !== source) {
    fs.writeFileSync(filePath, next);
  }
}

function withExpoUpdatesErrorRecoveryNeutralized(config) {
  return withDangerousMod(config, [
    "ios",
    (nextConfig) => {
      const projectRoot = nextConfig.modRequest.projectRoot;
      applySourcePatch(
        path.join(projectRoot, "node_modules/expo-updates/ios/EXUpdates/ErrorRecovery.swift"),
        neutralizeIosErrorRecoveryCrash,
      );
      applySourcePatch(
        path.join(
          projectRoot,
          "node_modules/expo-updates/android/src/main/java/expo/modules/updates/errorrecovery/ErrorRecoveryHandler.kt",
        ),
        neutralizeAndroidErrorRecoveryCrash,
      );
      return nextConfig;
    },
  ]);
}

module.exports = function withIosFatalHandler(config) {
  config = withAppDelegate(config, (nextConfig) => {
    if (nextConfig.modResults.language !== "swift") {
      throw new Error("The iOS fatal handler plugin requires a Swift AppDelegate.");
    }

    nextConfig.modResults.contents = installFatalHandler(nextConfig.modResults.contents);
    return nextConfig;
  });
  return withExpoUpdatesErrorRecoveryNeutralized(config);
};

module.exports.installFatalHandler = installFatalHandler;
module.exports.neutralizeIosErrorRecoveryCrash = neutralizeIosErrorRecoveryCrash;
module.exports.neutralizeAndroidErrorRecoveryCrash = neutralizeAndroidErrorRecoveryCrash;
module.exports.IOS_THROW = IOS_THROW;
module.exports.ANDROID_THROW = ANDROID_THROW;
module.exports.NO_RETHROW_MARKER = NO_RETHROW_MARKER;
module.exports.HELPER_NAME = HELPER_NAME;
module.exports.RECLAIM_MARKER = RECLAIM_MARKER;
