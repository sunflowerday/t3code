/**
 * Pure half of the Kuca automation micro-patch: URL grammar only, no Expo
 * imports, so it is unit-testable in node. See automationLink.ts.
 */
export const AUTOMATION_HOST = "automation";
export const AUTOMATION_DIRECTORY = "automation";

export const AUTOMATION_ACTIONS = [
  "report",
  "open-thread",
  "open-web",
  "send",
  "interrupt",
] as const;
export type AutomationAction = (typeof AUTOMATION_ACTIONS)[number];

export interface AutomationRequest {
  readonly action: AutomationAction;
  readonly runId: string;
  readonly params: Readonly<Record<string, string>>;
}

export function isAutomationUrl(url: string): boolean {
  return url.includes(`://${AUTOMATION_HOST}/`) || url.endsWith(`://${AUTOMATION_HOST}`);
}

/** Pure: `t3code://automation/send?threadId=…&text=…&runId=…` → request, or null. */
export function parseAutomationUrl(url: string): AutomationRequest | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== AUTOMATION_HOST) return null;
  const action = parsed.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!AUTOMATION_ACTIONS.includes(action as AutomationAction)) return null;
  const params: Record<string, string> = {};
  parsed.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  const runId = params.runId ?? `${Date.now()}`;
  return { action: action as AutomationAction, runId, params };
}
