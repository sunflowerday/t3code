import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  FATAL_PROBE_MESSAGE,
  clearFatalError,
  getLastFatalError,
  installFatalErrorHandler,
  installNewArchFatalListener,
  reportFatalError,
  resetFatalErrorStoreForTests,
  throwIfFatalProbeArmed,
  type ErrorUtilsLike,
  type NewArchExceptionData,
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

describe("new-architecture exception listener", () => {
  it("records a fatal and calls preventDefault so native reportFatal is not reached", () => {
    let listener: ((data: NewArchExceptionData) => void) | undefined;

    installNewArchFatalListener({
      registry: {
        RN$registerExceptionListener: (next) => {
          listener = next;
        },
      },
      persist: () => undefined,
      now: () => new Date("2026-08-18T07:24:00.000Z"),
    });

    let preventDefaultCalls = 0;
    listener?.({
      message: "pipeline boom",
      isFatal: true,
      preventDefault: () => {
        preventDefaultCalls += 1;
      },
    });

    expect(preventDefaultCalls).toBe(1);
    expect(getLastFatalError()).toEqual({
      message: "pipeline boom",
      stack: expect.stringContaining("pipeline boom"),
      occurredAt: "2026-08-18T07:24:00.000Z",
    });
  });

  it("does not swallow a soft exception", () => {
    let listener: ((data: NewArchExceptionData) => void) | undefined;
    installNewArchFatalListener({
      registry: {
        RN$registerExceptionListener: (next) => {
          listener = next;
        },
      },
      persist: () => undefined,
    });

    let preventDefaultCalls = 0;
    listener?.({
      message: "soft",
      isFatal: false,
      preventDefault: () => {
        preventDefaultCalls += 1;
      },
    });

    expect(preventDefaultCalls).toBe(0);
    expect(getLastFatalError()).toBeNull();
  });

  it("empty listener data does not count as a recorded fatal", () => {
    let listener: ((data: NewArchExceptionData) => void) | undefined;
    installNewArchFatalListener({
      registry: {
        RN$registerExceptionListener: (next) => {
          listener = next;
        },
      },
      persist: () => undefined,
    });

    listener?.({});
    expect(getLastFatalError()).toBeNull();
  });
});

describe("fatal probe", () => {
  it("does not throw when the probe file is absent", async () => {
    await expect(throwIfFatalProbeArmed(async () => false)).resolves.toBeUndefined();
  });

  it("schedules the same uncaught exception the Release probe uses", async () => {
    const scheduled: Array<Error> = [];
    const original = globalThis.setTimeout;
    globalThis.setTimeout = ((handler: TimerHandler) => {
      if (typeof handler === "function") {
        try {
          handler();
        } catch (error) {
          scheduled.push(error as Error);
        }
      }
      return 0;
    }) as typeof setTimeout;
    try {
      await throwIfFatalProbeArmed(async () => true);
    } finally {
      globalThis.setTimeout = original;
    }
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.message).toBe(FATAL_PROBE_MESSAGE);
  });
});
