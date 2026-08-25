import { describe, expect, it } from "vite-plus/test";

import { GENERIC_ACTIONABLE_ERROR } from "../../lib/userFacingError";
import { presentConnectionStatusText } from "./connectionStatusPresentation";

describe("connection status presentation", () => {
  it("replaces an internal connection error identifier before rendering it", () => {
    expect(
      presentConnectionStatusText({
        phase: "error",
        error: "synara.engine/engine.request_failed",
        traceId: null,
      }),
    ).toBe(`Connection failed. Reason: ${GENERIC_ACTIONABLE_ERROR}`);
  });

  it("preserves explanatory server text", () => {
    expect(
      presentConnectionStatusText({
        phase: "error",
        error: "The environment credential is invalid.",
        traceId: null,
      }),
    ).toBe("Connection failed. Reason: The environment credential is invalid.");
  });
});
