import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ExecutionEnvironmentCapabilities } from "./environment.ts";

const decodeCapabilities = Schema.decodeUnknownSync(ExecutionEnvironmentCapabilities);

describe("execution environment mobile capabilities", () => {
  it("fails closed when an older server does not advertise the mobile surface", () => {
    const parsed = decodeCapabilities({ repositoryIdentity: true });

    expect(parsed.mobileClient).toBeUndefined();
  });

  it("decodes independent mobile feature declarations", () => {
    const parsed = decodeCapabilities({
      repositoryIdentity: true,
      mobileClient: {
        workspace: false,
        threadLifecycle: false,
        threadSessionStop: true,
        threadFork: true,
      },
    });

    expect(parsed.mobileClient).toEqual({
      workspace: false,
      threadLifecycle: false,
      threadSessionStop: true,
      threadFork: true,
    });
  });
});
