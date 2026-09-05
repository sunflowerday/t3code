import {
  connectionStatusText,
  type EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";

import { presentUserFacingError } from "../../lib/userFacingError";

/** Formats a connection status without exposing transport error identifiers. */
export function presentConnectionStatusText(connection: EnvironmentConnectionPresentation): string {
  return connectionStatusText({
    ...connection,
    error: presentUserFacingError(connection.error),
  });
}
