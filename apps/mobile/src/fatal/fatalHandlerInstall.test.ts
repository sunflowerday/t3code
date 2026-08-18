import * as NodeModule from "node:module";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

const require = NodeModule.createRequire(import.meta.url);
const {
  ANDROID_THROW,
  HELPER_NAME,
  IOS_THROW,
  NO_RETHROW_MARKER,
  RECLAIM_MARKER,
  installFatalHandler,
  neutralizeAndroidErrorRecoveryCrash,
  neutralizeIosErrorRecoveryCrash,
} = require("../../plugins/withIosFatalHandler.cjs") as {
  ANDROID_THROW: string;
  HELPER_NAME: string;
  IOS_THROW: string;
  NO_RETHROW_MARKER: string;
  RECLAIM_MARKER: string;
  installFatalHandler: (contents: string) => string;
  neutralizeAndroidErrorRecoveryCrash: (source: string) => string;
  neutralizeIosErrorRecoveryCrash: (source: string) => string;
};

const mobileRoot = NodePath.join(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "../..");

function readMobileFile(relativePath: string): string {
  return NodeFS.readFileSync(NodePath.join(mobileRoot, relativePath), "utf8");
}

describe("fatal handler install sites", () => {
  it("installs the JS handler at the app entry", () => {
    const entry = readMobileFile("index.ts");
    expect(entry).toContain("installFatalErrorHandler");
    expect(entry).toContain("throwIfFatalProbeArmed");
  });

  it("the vendored expo-updates still has the death sites this patch targets", () => {
    const ios = readMobileFile("node_modules/expo-updates/ios/EXUpdates/ErrorRecovery.swift");
    const android = readMobileFile(
      "node_modules/expo-updates/android/src/main/java/expo/modules/updates/errorrecovery/ErrorRecoveryHandler.kt",
    );
    expect(ios).toContain(IOS_THROW);
    expect(android).toContain(ANDROID_THROW);
    expect(ios).toContain("RCTSetFatalHandler { error in");
    expect(ios).toContain("func crash()");
  });

  it("registers a native RCTFatal takeover in the iOS plugin", () => {
    const plugin = readMobileFile("plugins/withIosFatalHandler.cjs");
    expect(plugin).toContain(HELPER_NAME);
    expect(plugin).toContain("RCTSetFatalHandler");
    expect(plugin).toContain("RCTSetFatalExceptionHandler");
    expect(plugin).toContain(RECLAIM_MARKER);
    expect(plugin).toContain(NO_RETHROW_MARKER);
    expect(plugin).toContain("last-fatal-error.json");
    expect(plugin).toContain("--t3-fatal-probe");

    const config = readMobileFile("app.config.ts");
    expect(config).toContain("./plugins/withIosFatalHandler.cjs");
  });

  it("injects reclaim-after-super so expo-updates cannot keep RCTFatal", () => {
    const source = `
public override func application(
  _ application: UIApplication,
  didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
) -> Bool {
    let delegate = ReactNativeDelegate()
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
}
`;
    const installed = installFatalHandler(source);
    expect(installed).toContain(`${HELPER_NAME}()`);
    expect(installed).toContain(RECLAIM_MARKER);
    expect(installed).toContain("t3WriteLastFatalError");
    expect(installed).toContain("t3PresentFatalAlert");
    expect(installed).not.toContain("@throw");
    expect(installed).not.toContain("exception.raise()");
    expect(installFatalHandler(installed)).toBe(installed);

    const firstCall = installed.indexOf(`${HELPER_NAME}()`);
    const reclaimCall = installed.lastIndexOf(`${HELPER_NAME}()`);
    expect(reclaimCall).toBeGreaterThan(firstCall);
    expect(installed.indexOf("super.application")).toBeGreaterThan(firstCall);
    expect(installed.indexOf("super.application")).toBeLessThan(reclaimCall);
  });

  it("upgrades the old NSLog-only snippet instead of stacking a second copy", () => {
    const source = `
public override func application(
  _ application: UIApplication,
  didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
) -> Bool {
    // t3-fatal-handler: keep the process alive and leave the JS message in device logs.
    RCTSetFatalHandler { error in
      NSLog("[t3-fatal] %@", error?.localizedDescription ?? "unknown")
    }
    RCTSetFatalExceptionHandler { exception in
      NSLog("[t3-fatal] %@", exception?.reason ?? String(describing: exception?.name))
    }

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
}
`;
    const installed = installFatalHandler(source);
    expect(installed).toContain(`${HELPER_NAME}()`);
    expect(installed).toContain(RECLAIM_MARKER);
    expect(installed.match(/RCTSetFatalHandler \{ error in/g)).toHaveLength(1);
  });

  it("neutralizes the iOS ErrorRecovery rethrow — the process-death site", () => {
    const source = `
    userInfo["EXUpdatesLaterEncounteredErrors"] = encounteredErrors
    delegate?.throwException(NSException(name: name, reason: reason, userInfo: userInfo))
  }
`;
    const neutralized = neutralizeIosErrorRecoveryCrash(source);
    expect(neutralized).toContain(NO_RETHROW_MARKER);
    expect(neutralized).not.toContain(IOS_THROW);
    expect(neutralizeIosErrorRecoveryCrash(neutralized)).toBe(neutralized);
  });

  it("neutralizes the Android ErrorRecovery rethrow — same death site", () => {
    const source = `
      Task.CRASH -> {
        logger.error("UpdatesErrorRecovery: could not recover from error, crashing", encounteredErrors[0], UpdatesErrorCode.Unknown)
        delegate.throwException(encounteredErrors[0])
      }
`;
    const neutralized = neutralizeAndroidErrorRecoveryCrash(source);
    expect(neutralized).toContain(NO_RETHROW_MARKER);
    expect(neutralized).not.toContain(ANDROID_THROW);
    expect(neutralizeAndroidErrorRecoveryCrash(neutralized)).toBe(neutralized);
  });

  it("refuses to go green when the death site is missing — empty or drifted source is invalid", () => {
    expect(() => neutralizeIosErrorRecoveryCrash("")).toThrow(/no longer rethrows/);
    expect(() => neutralizeAndroidErrorRecoveryCrash("")).toThrow(/no longer throws/);
  });
});
