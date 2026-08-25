import type { RelayEnvironmentStatusResponse } from "@t3tools/contracts/relay";
import { type EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import { presentUserFacingError } from "../../lib/userFacingError";

export interface AvailableCloudEnvironmentPresentation {
  readonly connectionError: string | null;
  readonly connectionErrorTraceId: string | null;
  readonly connectionState: EnvironmentConnectionPhase;
  readonly statusText: string;
}

export function availableCloudEnvironmentPresentation(input: {
  readonly isStatusPending: boolean;
  readonly status: RelayEnvironmentStatusResponse | null;
  readonly statusError: string | null;
  readonly statusErrorTraceId: string | null;
}): AvailableCloudEnvironmentPresentation {
  if (input.status?.status === "online") {
    return {
      connectionError: null,
      connectionErrorTraceId: null,
      connectionState: "available",
      statusText: "Available · Relay online",
    };
  }

  if (input.status?.status === "offline") {
    const connectionError = presentUserFacingError(input.status.error, "Relay is offline.")!;
    return {
      connectionError,
      connectionErrorTraceId: input.status.traceId ?? null,
      connectionState: "error",
      statusText: connectionError,
    };
  }

  if (input.statusError) {
    const connectionError = presentUserFacingError(
      input.statusError,
      "Could not get relay environment status.",
    )!;
    return {
      connectionError,
      connectionErrorTraceId: input.statusErrorTraceId,
      connectionState: "error",
      statusText: connectionError,
    };
  }

  return {
    connectionError: null,
    connectionErrorTraceId: null,
    connectionState: "available",
    statusText: input.isStatusPending
      ? "Available · Checking relay status..."
      : "Available · Relay status unknown",
  };
}
