// @effect-diagnostics nodeBuiltinImport:off — this test shells out to the
// bash script and checks files on disk; wrapping that in Effect would be
// longer than the script under test.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, it } from "@effect/vitest";

const scriptPath = NodePath.join(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "build-ios-release.sh",
);

function runScript(
  args: ReadonlyArray<string>,
  options?: { readonly cwd?: string },
): {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
} {
  const result = NodeChildProcess.spawnSync("bash", [scriptPath, ...args], {
    encoding: "utf8",
    cwd: options?.cwd,
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

it("freezes the local Release xcodebuild argv", () => {
  const printed = runScript(["--print-command"]);
  assert.equal(printed.status, 0, printed.stderr);
  const line = printed.stdout.trim();
  assert.match(line, /^xcodebuild /);
  assert.match(line, / -scheme Kuca /);
  assert.match(line, / -configuration Release /);
  assert.match(line, / -destination generic\/platform=iOS /);
  assert.match(line, / -derivedDataPath .*\/.cache\/kuca-ios-dd /);
  assert.match(line, / DEVELOPMENT_TEAM=B537AN89U9 /);
  assert.match(line, / CODE_SIGN_STYLE=Automatic /);
  assert.ok(line.endsWith(" build"));
  assert.ok(!line.includes("/tmp/"));
});

it("refuses an empty JS probe and a missing app", () => {
  const empty = runScript(["--expect-js", ""]);
  assert.equal(empty.status, 2);
  assert.match(empty.stderr, /--expect-js needs a non-empty string/);

  const missing = runScript(["--verify-app", "/tmp/kuca-missing-app.app", "--expect-js", "probe"]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /app not found/);
});

it("accepts a probe only when main.jsbundle actually contains it", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "kuca-ios-probe-"));
  const app = NodePath.join(root, "Kuca.app");
  NodeFS.mkdirSync(app);
  NodeFS.writeFileSync(NodePath.join(app, "main.jsbundle"), 'var x="kuca-js-probe-ok";\n');

  const hit = runScript(["--verify-app", app, "--expect-js", "kuca-js-probe-ok"]);
  assert.equal(hit.status, 0, hit.stderr);
  assert.match(hit.stdout, /probe ok/);

  const miss = runScript(["--verify-app", app, "--expect-js", "kuca-js-probe-MISSING"]);
  assert.equal(miss.status, 1);
  assert.match(miss.stderr, /does not contain expected JS/);

  const emptyBundle = NodePath.join(root, "Empty.app");
  NodeFS.mkdirSync(emptyBundle);
  NodeFS.writeFileSync(NodePath.join(emptyBundle, "main.jsbundle"), "");
  const empty = runScript(["--verify-app", emptyBundle, "--expect-js", "kuca-js-probe-ok"]);
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /does not contain expected JS/);
});

it("does not flip Bundle React Native onto incomplete dependency analysis", () => {
  const text = NodeFS.readFileSync(scriptPath, "utf8");
  assert.ok(!text.includes("basedOnDependencyAnalysis"));
  assert.match(text, /stale main\.jsbundle/);
});
