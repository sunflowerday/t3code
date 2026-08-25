import { describe, expect, it } from "vite-plus/test";

import { hasConfirmedEnvironmentFailure } from "./environmentAvailability";
import type { WorkspaceState } from "./workspaceModel";

function workspaceState(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    isLoadingConnections: false,
    hasConnections: true,
    hasLoadedShellSnapshot: false,
    hasPendingShellSnapshot: false,
    hasReadyEnvironment: false,
    hasConnectingEnvironment: true,
    connectingEnvironments: [],
    connectionState: "reconnecting",
    connectionError: null,
    shellSnapshotError: null,
    latestCachedSnapshotReceivedAt: null,
    networkStatus: "online",
    ...overrides,
  };
}

describe("confirmed environment failure", () => {
  it("does not keep a known reconnect failure in a loading state", () => {
    expect(
      hasConfirmedEnvironmentFailure(
        workspaceState({ connectionError: "The environment credential is invalid." }),
      ),
    ).toBe(true);
  });

  it("keeps a reconnect without an error as an in-progress load", () => {
    expect(hasConfirmedEnvironmentFailure(workspaceState())).toBe(false);
  });

  it("keeps cached content available even after a connection failure", () => {
    expect(
      hasConfirmedEnvironmentFailure(
        workspaceState({
          connectionError: "The environment credential is invalid.",
          hasLoadedShellSnapshot: true,
        }),
      ),
    ).toBe(false);
  });
});
