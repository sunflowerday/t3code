export interface FatalErrorRecord {
  readonly message: string;
  readonly stack: string | null;
  readonly occurredAt: string;
}

export interface ErrorUtilsLike {
  readonly getGlobalHandler?: () => ((error: Error, isFatal?: boolean) => void) | undefined;
  readonly setGlobalHandler: (handler: (error: Error, isFatal?: boolean) => void) => void;
}

export interface NewArchExceptionData {
  readonly message?: unknown;
  readonly isFatal?: unknown;
  readonly preventDefault?: () => void;
}

export interface NewArchExceptionRegistry {
  readonly RN$registerExceptionListener?: (listener: (data: NewArchExceptionData) => void) => void;
}

export interface InstallFatalErrorHandlerOptions {
  readonly errorUtils?: ErrorUtilsLike | null;
  readonly persist?: (record: FatalErrorRecord) => void;
  readonly now?: () => Date;
  readonly newArch?: NewArchExceptionRegistry | null;
}

const LAST_FATAL_DIRECTORY = "diagnostics";
const LAST_FATAL_FILE = "last-fatal-error.json";

let lastFatalError: FatalErrorRecord | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function describeError(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    const extra =
      "componentStack" in error
        ? (error as { componentStack?: unknown }).componentStack
        : undefined;
    const componentStack = typeof extra === "string" ? extra : null;
    const stackParts = [error.stack, componentStack].filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    );
    return {
      message: error.message.length > 0 ? error.message : error.name,
      stack: stackParts.length > 0 ? stackParts.join("\n") : null,
    };
  }
  return { message: String(error), stack: null };
}

export function toFatalErrorRecord(error: unknown, occurredAt: Date): FatalErrorRecord {
  const described = describeError(error);
  return {
    message: described.message,
    stack: described.stack,
    occurredAt: occurredAt.toISOString(),
  };
}

export function getLastFatalError(): FatalErrorRecord | null {
  return lastFatalError;
}

export function subscribeFatalError(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearFatalError(): void {
  if (lastFatalError === null) {
    return;
  }
  lastFatalError = null;
  emit();
}

export function reportFatalError(
  error: unknown,
  options?: {
    readonly persist?: (record: FatalErrorRecord) => void;
    readonly now?: () => Date;
  },
): FatalErrorRecord {
  const record = toFatalErrorRecord(error, (options?.now ?? (() => new Date()))());
  lastFatalError = record;
  emit();
  console.error("[t3-fatal]", record.message, record.stack ?? "");
  try {
    (options?.persist ?? persistFatalErrorToDocument)(record);
  } catch (cause) {
    console.error("[t3-fatal] persist failed", cause);
  }
  return record;
}

export async function persistFatalErrorToDocument(record: FatalErrorRecord): Promise<void> {
  try {
    const { Directory, File, Paths } = await import("expo-file-system");
    const directory = new Directory(Paths.document, LAST_FATAL_DIRECTORY);
    directory.create({ idempotent: true, intermediates: true });
    const file = new File(directory, LAST_FATAL_FILE);
    if (!file.exists) {
      file.create({ intermediates: true, overwrite: true });
    }
    file.write(JSON.stringify(record));
  } catch (cause) {
    console.error("[t3-fatal] write failed", cause);
  }
}

function getGlobalErrorUtils(): ErrorUtilsLike | null {
  const candidate = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (candidate == null || typeof candidate.setGlobalHandler !== "function") {
    return null;
  }
  return candidate;
}

function getNewArchRegistry(): NewArchExceptionRegistry {
  return globalThis as NewArchExceptionRegistry;
}

function containFatal(
  error: unknown,
  options: {
    readonly persist?: (record: FatalErrorRecord) => void;
    readonly now?: () => Date;
  },
): void {
  reportFatalError(error, {
    ...(options.persist === undefined ? {} : { persist: options.persist }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}

/**
 * New-architecture runtimes report through `RN$handleException` and never
 * consult `ErrorUtils.setGlobalHandler`. `preventDefault` stops the C++
 * pipeline from calling native `reportFatal` / `RCTFatal`.
 */
export function installNewArchFatalListener(
  options: {
    readonly registry?: NewArchExceptionRegistry | null;
    readonly persist?: (record: FatalErrorRecord) => void;
    readonly now?: () => Date;
  } = {},
): () => void {
  const registry = options.registry === undefined ? getNewArchRegistry() : options.registry;
  const register = registry?.RN$registerExceptionListener;
  if (typeof register !== "function") {
    return () => undefined;
  }

  register((data) => {
    if (data.isFatal !== true) {
      return;
    }
    const message = typeof data.message === "string" && data.message.length > 0 ? data.message : "unknown";
    containFatal(new Error(message), options);
    data.preventDefault?.();
  });

  return () => undefined;
}

export const FATAL_PROBE_MESSAGE = "t3-fatal-probe";
/** Unique to this Release build. `--expect-js` and later install both grep this string. */
export const RELEASE_BUILD_STAMP = "kuca-wire-20260819T070012Z-mobbuild";
const FATAL_PROBE_FILE = "fatal-probe";

export async function throwIfFatalProbeArmed(
  readProbe: () => Promise<boolean> = readFatalProbeFile,
): Promise<void> {
  if (!(await readProbe())) {
    return;
  }
  setTimeout(() => {
    throw new Error(FATAL_PROBE_MESSAGE);
  }, 0);
}

async function readFatalProbeFile(): Promise<boolean> {
  try {
    const { Directory, File, Paths } = await import("expo-file-system");
    const file = new File(new Directory(Paths.document, LAST_FATAL_DIRECTORY), FATAL_PROBE_FILE);
    if (!file.exists) {
      return false;
    }
    file.delete();
    return true;
  } catch (cause) {
    console.error("[t3-fatal] probe read failed", cause);
    return false;
  }
}

/**
 * Replaces RN's default fatal path. A fatal JS exception is recorded and shown
 * instead of being forwarded to native `reportFatal` / `RCTFatal`.
 */
export function installFatalErrorHandler(
  options: InstallFatalErrorHandlerOptions = {},
): () => void {
  console.log("[kuca-build]", RELEASE_BUILD_STAMP);
  const uninstallNewArch = installNewArchFatalListener({
    ...(options.newArch === undefined ? {} : { registry: options.newArch }),
    ...(options.persist === undefined ? {} : { persist: options.persist }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  const errorUtils = options.errorUtils === undefined ? getGlobalErrorUtils() : options.errorUtils;
  if (errorUtils == null) {
    return uninstallNewArch;
  }

  const previous = errorUtils.getGlobalHandler?.() ?? undefined;
  const handler = (error: Error, isFatal?: boolean) => {
    try {
      if (isFatal === true) {
        containFatal(error, options);
        return;
      }
    } catch (cause) {
      console.error("[t3-fatal] handler failed", cause);
    }
    previous?.(error, isFatal);
  };

  errorUtils.setGlobalHandler(handler);
  return () => {
    uninstallNewArch();
    if (previous !== undefined) {
      errorUtils.setGlobalHandler(previous);
    }
  };
}

export function resetFatalErrorStoreForTests(): void {
  lastFatalError = null;
  listeners.clear();
}
