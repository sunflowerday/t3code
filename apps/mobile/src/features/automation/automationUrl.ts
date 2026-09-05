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
  "new-thread",
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

/**
 * Pure: `t3code://automation/send?threadId=…&text=…&runId=…` → request, or null.
 * Hand-parsed: React Native's `URL` lacks hostname/pathname/searchParams, so
 * this must not depend on the WHATWG URL class.
 */
export function parseAutomationUrl(url: string): AutomationRequest | null {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?/i.exec(url);
  if (!match) return null;
  const [, host, rawPath = "", rawQuery = ""] = match;
  if (host !== AUTOMATION_HOST) return null;
  const action = rawPath.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!AUTOMATION_ACTIONS.includes(action as AutomationAction)) return null;
  const params: Record<string, string> = {};
  for (const pair of rawQuery.split("&")) {
    if (pair.length === 0) continue;
    const eq = pair.indexOf("=");
    const key = eq === -1 ? pair : pair.slice(0, eq);
    const value = eq === -1 ? "" : pair.slice(eq + 1);
    try {
      params[decodeURIComponent(key.replace(/\+/g, " "))] = decodeURIComponent(
        value.replace(/\+/g, " "),
      );
    } catch {
      params[key] = value;
    }
  }
  const runId = params.runId ?? `${Date.now()}`;
  return { action: action as AutomationAction, runId, params };
}
