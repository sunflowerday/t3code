import { describe, expect, it } from "vite-plus/test";

import {
  GENERIC_ACTIONABLE_ERROR,
  isConnectionRetrying,
  presentUserFacingError,
} from "./userFacingError";

describe("user-facing error presentation", () => {
  it("replaces provider error identifiers with an actionable message", () => {
    expect(presentUserFacingError("synara.engine/engine.request_failed")).toBe(
      GENERIC_ACTIONABLE_ERROR,
    );
  });

  it("preserves readable server errors and applies a fallback only when needed", () => {
    expect(presentUserFacingError("The environment credential is invalid.")).toBe(
      "The environment credential is invalid.",
    );
    expect(presentUserFacingError(null, "Could not load the environment.")).toBe(
      "Could not load the environment.",
    );
  });

  it("stops treating a known connection failure as an in-progress retry", () => {
    expect(isConnectionRetrying("reconnecting", null)).toBe(true);
    expect(isConnectionRetrying("reconnecting", "Connection timed out.")).toBe(false);
    expect(isConnectionRetrying("error", "Connection timed out.")).toBe(false);
  });
});
