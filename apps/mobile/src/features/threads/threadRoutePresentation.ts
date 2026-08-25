import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";

/** A known connection failure must replace the thread-opening spinner. */
export function shouldShowOpeningThreadLoading(input: {
  readonly connectionError: string | null;
  readonly connectionState: EnvironmentConnectionPhase;
  readonly isLoadingConnections: boolean;
}): boolean {
  return (
    input.isLoadingConnections ||
    ((input.connectionState === "connecting" || input.connectionState === "reconnecting") &&
      input.connectionError === null)
  );
}
