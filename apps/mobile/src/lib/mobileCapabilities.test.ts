import { describe, expect, it } from "vite-plus/test";

import type { ExecutionEnvironmentCapabilities } from "@t3tools/contracts";

import { resolveMobileClientCapabilities } from "./mobileCapabilities";

describe("mobile client capabilities", () => {
  it("fails closed when the server does not declare a mobile surface", () => {
    expect(resolveMobileClientCapabilities(null)).toEqual({
      workspace: false,
      threadLifecycle: false,
      threadSessionStop: false,
      threadFork: false,
    });
  });

  it("derives chat-only navigation and session actions from server config", () => {
    const capabilities = {
      repositoryIdentity: true,
      mobileClient: {
        workspace: false,
        threadLifecycle: false,
        threadSessionStop: true,
        threadFork: true,
      },
    } as ExecutionEnvironmentCapabilities;

    expect(resolveMobileClientCapabilities(capabilities)).toEqual({
      workspace: false,
      threadLifecycle: false,
      threadSessionStop: true,
      threadFork: true,
    });
  });
});
