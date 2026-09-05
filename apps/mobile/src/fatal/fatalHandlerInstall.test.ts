import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

const require = createRequire(import.meta.url);
const { installFatalHandler } = require("../../plugins/withIosFatalHandler.cjs") as {
  installFatalHandler: (contents: string) => string;
};

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

function readMobileFile(relativePath: string): string {
  return readFileSync(join(mobileRoot, relativePath), "utf8");
}

describe("fatal handler install sites", () => {
  it("installs the JS handler at the app entry", () => {
    const entry = readMobileFile("index.ts");
    expect(entry).toContain("installFatalErrorHandler");
  });

  it("registers a native RCTFatal takeover in the iOS plugin", () => {
    const plugin = readMobileFile("plugins/withIosFatalHandler.cjs");
    expect(plugin).toContain("RCTSetFatalHandler { error in");
    expect(plugin).toContain("RCTSetFatalExceptionHandler { exception in");
    expect(plugin).toMatch(/RCTSetFatalHandler \{ error in\n      NSLog\("\[t3-fatal\] %@"/);
    expect(plugin).toMatch(
      /RCTSetFatalExceptionHandler \{ exception in\n      NSLog\("\[t3-fatal\] %@"/,
    );

    const config = readMobileFile("app.config.ts");
    expect(config).toContain("./plugins/withIosFatalHandler.cjs");
  });

  it("injects the native handlers into a Swift AppDelegate once", () => {
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
    expect(installed).toContain("RCTSetFatalHandler");
    expect(installed).toContain("RCTSetFatalExceptionHandler");
    expect(installed).toContain('NSLog("[t3-fatal]');
    expect(installFatalHandler(installed)).toBe(installed);
  });
});
