export interface FatalErrorRecord {
  readonly message: string;
  readonly stack: string | null;
  readonly occurredAt: string;
}

export interface ErrorUtilsLike {
  readonly getGlobalHandler?: () => ((error: Error, isFatal?: boolean) => void) | undefined;
  readonly setGlobalHandler: (handler: (error: Error, isFatal?: boolean) => void) => void;
}

export interface InstallFatalErrorHandlerOptions {
  readonly errorUtils?: ErrorUtilsLike | null;
  readonly persist?: (record: FatalErrorRecord) => void;
  readonly now?: () => Date;
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

/**
 * Replaces RN's default fatal path. A fatal JS exception is recorded and shown
 * instead of being forwarded to native `reportFatal` / `RCTFatal`.
 */
export function installFatalErrorHandler(
  options: InstallFatalErrorHandlerOptions = {},
): () => void {
  const errorUtils = options.errorUtils === undefined ? getGlobalErrorUtils() : options.errorUtils;
  if (errorUtils == null) {
    return () => undefined;
  }

  const previous = errorUtils.getGlobalHandler?.() ?? undefined;
  const handler = (error: Error, isFatal?: boolean) => {
    try {
      if (isFatal === true) {
        reportFatalError(error, {
          persist: options.persist,
          now: options.now,
        });
        return;
      }
    } catch (cause) {
      console.error("[t3-fatal] handler failed", cause);
    }
    previous?.(error, isFatal);
  };

  errorUtils.setGlobalHandler(handler);
  return () => {
    if (previous !== undefined) {
      errorUtils.setGlobalHandler(previous);
    }
  };
}

export function resetFatalErrorStoreForTests(): void {
  lastFatalError = null;
  listeners.clear();
}
