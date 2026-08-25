import { describe, expect, it } from "vite-plus/test";

import type { ExecutionEnvironmentCapabilities } from "@t3tools/contracts";

import {
  type MobileClientCapabilities,
  resolveMobileClientCapabilities,
} from "./mobileCapabilities";

const MOBILE_CAPABILITIES: ReadonlyArray<keyof MobileClientCapabilities> = [
  "workspace",
  "threadLifecycle",
  "threadSessionStop",
  "threadFork",
];

describe("mobile client capabilities", () => {
  it("fails closed when the server does not declare a mobile surface", () => {
    expect(resolveMobileClientCapabilities(null)).toEqual({
      workspace: false,
      threadLifecycle: false,
      threadSessionStop: false,
      threadFork: false,
    });
  });

  for (const enabledCapability of MOBILE_CAPABILITIES) {
    it(`maps only the declared ${enabledCapability} capability`, () => {
      const capabilities = {
        repositoryIdentity: true,
        mobileClient: { [enabledCapability]: true },
      } as ExecutionEnvironmentCapabilities;

      expect(resolveMobileClientCapabilities(capabilities)).toEqual({
        workspace: enabledCapability === "workspace",
        threadLifecycle: enabledCapability === "threadLifecycle",
        threadSessionStop: enabledCapability === "threadSessionStop",
        threadFork: enabledCapability === "threadFork",
      });
    });
  }
});
