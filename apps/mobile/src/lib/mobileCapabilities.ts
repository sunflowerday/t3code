import type { ExecutionEnvironmentCapabilities } from "@t3tools/contracts";

export type MobileClientCapabilities = {
  readonly workspace: boolean;
  readonly threadLifecycle: boolean;
  readonly threadSessionStop: boolean;
  readonly threadFork: boolean;
};

/**
 * The server owns this declaration: clients fail closed rather than exposing
 * controls that a restricted mobile connection cannot execute.
 */
export function resolveMobileClientCapabilities(
  capabilities: ExecutionEnvironmentCapabilities | null | undefined,
): MobileClientCapabilities {
  return {
    workspace: capabilities?.mobileClient?.workspace === true,
    threadLifecycle: capabilities?.mobileClient?.threadLifecycle === true,
    threadSessionStop: capabilities?.mobileClient?.threadSessionStop === true,
    threadFork: capabilities?.mobileClient?.threadFork === true,
  };
}
