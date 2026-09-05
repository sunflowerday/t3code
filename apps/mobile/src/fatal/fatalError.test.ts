import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  clearFatalError,
  getLastFatalError,
  installFatalErrorHandler,
  reportFatalError,
  resetFatalErrorStoreForTests,
  type ErrorUtilsLike,
} from "./fatalError";

class MockErrorUtils implements ErrorUtilsLike {
  handler: ((error: Error, isFatal?: boolean) => void) | undefined;
  readonly previousCalls: Array<{ readonly error: Error; readonly isFatal?: boolean }> = [];

  constructor(previous?: (error: Error, isFatal?: boolean) => void) {
    this.handler = previous;
  }

  getGlobalHandler = () => this.handler;

  setGlobalHandler = (handler: (error: Error, isFatal?: boolean) => void) => {
    this.handler = handler;
  };

  previous = (error: Error, isFatal?: boolean) => {
    this.previousCalls.push({ error, isFatal });
  };
}

afterEach(() => {
  resetFatalErrorStoreForTests();
});

describe("fatal error handler", () => {
  it("records a fatal error and does not rethrow", () => {
    const persisted: Array<string> = [];
    const errorUtils = new MockErrorUtils();
    const uninstall = installFatalErrorHandler({
      errorUtils,
      persist: (record) => {
        persisted.push(record.message);
      },
      now: () => new Date("2026-08-17T10:42:00.000Z"),
    });

    expect(() => {
      errorUtils.handler?.(new Error("probe boom"), true);
    }).not.toThrow();

    expect(getLastFatalError()).toEqual({
      message: "probe boom",
      stack: expect.stringContaining("probe boom"),
      occurredAt: "2026-08-17T10:42:00.000Z",
    });
    expect(persisted).toEqual(["probe boom"]);
    expect(errorUtils.previousCalls).toEqual([]);
    uninstall();
  });

  it("forwards soft errors to the previous handler", () => {
    const errorUtils = new MockErrorUtils();
    const previous = errorUtils.previous;
    errorUtils.handler = previous;
    installFatalErrorHandler({
      errorUtils,
      persist: () => undefined,
    });

    const soft = new Error("soft");
    errorUtils.handler?.(soft, false);

    expect(getLastFatalError()).toBeNull();
    expect(errorUtils.previousCalls).toEqual([{ error: soft, isFatal: false }]);
  });

  it("clearing the record hides it", () => {
    reportFatalError(new Error("shown"), {
      persist: () => undefined,
      now: () => new Date("2026-08-17T10:42:00.000Z"),
    });
    expect(getLastFatalError()?.message).toBe("shown");
    clearFatalError();
    expect(getLastFatalError()).toBeNull();
  });
});

describe("default RN fatal path vs takeover", () => {
  function defaultRnFatal(error: Error): never {
    throw error;
  }

  it("before takeover a fatal exception escapes", () => {
    expect(() => defaultRnFatal(new Error("probe boom"))).toThrow("probe boom");
    expect(getLastFatalError()).toBeNull();
  });

  it("after takeover the same exception is visible and contained", () => {
    const errorUtils = new MockErrorUtils(defaultRnFatal);
    installFatalErrorHandler({
      errorUtils,
      persist: () => undefined,
    });
    expect(() => errorUtils.handler?.(new Error("probe boom"), true)).not.toThrow();
    expect(getLastFatalError()?.message).toBe("probe boom");
  });
});
