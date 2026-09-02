import { describe, expect, it } from "@effect/vitest";

import { isAutomationUrl, parseAutomationUrl } from "./automationUrl";

describe("automation deep link", () => {
  it("parses action, runId and params", () => {
    const request = parseAutomationUrl(
      "t3code://automation/send?environmentId=kuca%3A%2Fx&threadId=t1&text=hi%20there&runId=r1",
    );
    expect(request).toEqual({
      action: "send",
      runId: "r1",
      params: { environmentId: "kuca:/x", threadId: "t1", text: "hi there", runId: "r1" },
    });
  });

  it("rejects unknown actions and non-automation hosts", () => {
    expect(parseAutomationUrl("t3code://automation/format-disk?runId=1")).toBeNull();
    expect(parseAutomationUrl("t3code://threads/env/thread")).toBeNull();
    expect(parseAutomationUrl("not a url")).toBeNull();
    expect(isAutomationUrl("t3code://threads/env/thread")).toBe(false);
    expect(isAutomationUrl("t3code://automation/report")).toBe(true);
  });

  it("defaults runId when absent", () => {
    const request = parseAutomationUrl("t3code://automation/report");
    expect(request?.action).toBe("report");
    expect(request?.runId).toMatch(/^\d+$/);
  });
});
