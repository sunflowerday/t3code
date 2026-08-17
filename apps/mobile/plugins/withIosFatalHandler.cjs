const { withAppDelegate } = require("expo/config-plugins");

const MARKER = "t3-fatal-handler";
const SNIPPET = `
    // ${MARKER}: keep the process alive and leave the JS message in device logs.
    RCTSetFatalHandler { error in
      NSLog("[t3-fatal] %@", error?.localizedDescription ?? "unknown")
    }
    RCTSetFatalExceptionHandler { exception in
      NSLog("[t3-fatal] %@", exception?.reason ?? String(describing: exception?.name))
    }
`;

function installFatalHandler(contents) {
  if (contents.includes(MARKER)) {
    return contents;
  }

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

  return `${contents.slice(0, brace + 1)}${SNIPPET}${contents.slice(brace + 1)}`;
}

module.exports = function withIosFatalHandler(config) {
  return withAppDelegate(config, (nextConfig) => {
    if (nextConfig.modResults.language !== "swift") {
      throw new Error("The iOS fatal handler plugin requires a Swift AppDelegate.");
    }

    nextConfig.modResults.contents = installFatalHandler(nextConfig.modResults.contents);
    return nextConfig;
  });
};

module.exports.installFatalHandler = installFatalHandler;
