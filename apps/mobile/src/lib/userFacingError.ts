import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as SchemaError from "effect/SchemaError";
import * as SchemaIssue from "effect/SchemaIssue";

const INTERNAL_ERROR_IDENTIFIER = /\b[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+\/[a-z][a-z0-9_.-]*\b/i;

// Guards the nested scan over a decoded error payload against pathological
// depth (a Cause chain or an unexpected self-reference), not against real data.
const MAX_ERROR_SCAN_DEPTH = 8;

export const GENERIC_ACTIONABLE_ERROR =
  "服务请求失败。请检查环境服务后重试；如果问题持续，请在环境设置中重新连接。";

/**
 * Keeps transport and provider identifiers out of the user interface while
 * preserving server-provided explanatory text that a person can act on.
 */
export function presentUserFacingError(message: string | null | undefined): string | null;
export function presentUserFacingError(
  message: string | null | undefined,
  fallback: string,
): string;
export function presentUserFacingError(
  message: string | null | undefined,
  fallback: string | null = null,
): string | null {
  const trimmed = message?.trim();
  if (!trimmed) {
    return fallback;
  }
  return INTERNAL_ERROR_IDENTIFIER.test(trimmed) ? GENERIC_ACTIONABLE_ERROR : trimmed;
}

/**
 * Recovers the sentence a server actually sent from whatever the RPC/atom layer
 * surfaced, so a typed rejection (a `T3RemoteWsRpcError` with a `message`)
 * reaches the UI instead of being flattened to the client fallback.
 *
 * A server reply whose error shape is not in the client's declared union fails
 * to decode into the RPC `Exit` schema; by the time the client sees it the real
 * frame survives only inside the resulting `SchemaError`'s `actual`, so the
 * message is dug back out of there rather than read off the schema text.
 */
export function describeServerError(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }
  if (value === null || typeof value !== "object") {
    return null;
  }
  if (SchemaError.isSchemaError(value)) {
    return firstServerMessage(Option.getOrNull(SchemaIssue.getActual(value.issue)), 0);
  }
  return firstServerMessage(value, 0);
}

/** {@link describeServerError} for an `Effect` `Cause` from a settled command. */
export function describeCauseMessage(cause: Cause.Cause<unknown>): string | null {
  return describeServerError(Cause.squash(cause));
}

function firstServerMessage(value: unknown, depth: number): string | null {
  if (depth >= MAX_ERROR_SCAN_DEPTH || value === null || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const message = record.message;
  if (typeof message === "string" && message.trim()) {
    return message.trim();
  }
  for (const nested of Object.values(record)) {
    const found = firstServerMessage(nested, depth + 1);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

export function isConnectionRetrying(
  phase: EnvironmentConnectionPhase,
  error: string | null,
): boolean {
  return (phase === "connecting" || phase === "reconnecting") && error === null;
}
