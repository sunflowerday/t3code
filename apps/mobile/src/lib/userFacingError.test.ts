import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  describeCauseMessage,
  describeServerError,
  GENERIC_ACTIONABLE_ERROR,
  isConnectionRetrying,
  presentUserFacingError,
} from "./userFacingError";

const SERVER_SENTENCE =
  "Thread 01JHIDDEN cannot accept a message because it is hidden or no longer exists.";

// A W6-style typed rejection the server sends for `thread.turn.start`. Its
// `message` is exactly what the user needs to read.
const rawServerErrorFrame = {
  _tag: "T3RemoteWsRpcError",
  code: "invalid",
  message: SERVER_SENTENCE,
};

/**
 * Reproduces the real failure: the RPC client's declared error union only
 * admits T3's own shapes, so decoding the server's `T3RemoteWsRpcError` frame
 * into the `Exit` schema throws a genuine {@link Schema.SchemaError}. The
 * server's sentence survives only inside the issue's `actual`.
 */
function decodeServerFrameAgainstClientOnlySchema(): unknown {
  const clientOnlyErrorSchema = Schema.Struct({
    _tag: Schema.Literal("ThreadNotFound"),
    detail: Schema.String,
  });
  try {
    Schema.decodeUnknownSync(clientOnlyErrorSchema)(rawServerErrorFrame);
  } catch (error) {
    return error;
  }
  throw new Error("expected the mismatched decode to fail");
}

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

  it("delivers the server's sentence to the UI when the RPC Exit decode fails", () => {
    const decodeFailure = decodeServerFrameAgainstClientOnlySchema();

    // The pre-fix path the App used. It reads the schema-validation text off
    // the thrown error, which never contains the server's sentence — this is
    // exactly what the bug hid from the user.
    const legacyMessage =
      decodeFailure instanceof Error
        ? presentUserFacingError(decodeFailure.message, "The request failed.")
        : "The request failed.";
    expect(legacyMessage).not.toBe(SERVER_SENTENCE);

    // The fix digs the raw frame back out of the SchemaError's `actual`.
    expect(describeServerError(decodeFailure)).toBe(SERVER_SENTENCE);
    expect(presentUserFacingError(describeServerError(decodeFailure), "The request failed.")).toBe(
      SERVER_SENTENCE,
    );
  });

  it("recovers the server's sentence from a settled command Cause", () => {
    const decodeFailure = decodeServerFrameAgainstClientOnlySchema();
    expect(describeCauseMessage(Cause.die(decodeFailure))).toBe(SERVER_SENTENCE);
  });

  it("reads a message off a structured server error or a bare string", () => {
    expect(describeServerError(rawServerErrorFrame)).toBe(SERVER_SENTENCE);
    expect(describeServerError(SERVER_SENTENCE)).toBe(SERVER_SENTENCE);
    expect(describeServerError({ _tag: "NoMessageHere" })).toBe(null);
    expect(describeServerError(undefined)).toBe(null);
  });
});
