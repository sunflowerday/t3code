import { describe, expect, it } from "vite-plus/test";

import { shouldShowOpeningThreadLoading } from "./threadRoutePresentation";

describe("thread route presentation", () => {
  it("keeps an ordinary reconnect in the opening state", () => {
    expect(
      shouldShowOpeningThreadLoading({
        connectionError: null,
        connectionState: "reconnecting",
        isLoadingConnections: false,
      }),
    ).toBe(true);
  });

  it("replaces a known reconnect failure instead of spinning indefinitely", () => {
    expect(
      shouldShowOpeningThreadLoading({
        connectionError: "The environment credential is invalid.",
        connectionState: "reconnecting",
        isLoadingConnections: false,
      }),
    ).toBe(false);
  });
});
