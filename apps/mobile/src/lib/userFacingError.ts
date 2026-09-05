import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";

const INTERNAL_ERROR_IDENTIFIER = /\b[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+\/[a-z][a-z0-9_.-]*\b/i;

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

export function isConnectionRetrying(
  phase: EnvironmentConnectionPhase,
  error: string | null,
): boolean {
  return (phase === "connecting" || phase === "reconnecting") && error === null;
}
