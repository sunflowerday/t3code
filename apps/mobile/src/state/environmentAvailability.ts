import type { WorkspaceState } from "./workspaceModel";

/**
 * A retrying transport can coexist with a usable cached snapshot. Without one,
 * a concrete connection error is terminal for the initial environment load and
 * must not be rendered as a loading state.
 */
export function hasConfirmedEnvironmentFailure(state: WorkspaceState): boolean {
  return (
    !state.hasLoadedShellSnapshot &&
    (state.connectionError !== null ||
      state.connectionState === "available" ||
      state.connectionState === "offline" ||
      state.connectionState === "error")
  );
}
