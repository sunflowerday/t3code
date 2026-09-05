// Purpose: Where Kuca is, and — when it cannot be reached — which link of the chain broke.
//
// Kuca micro-patch. Two things used to be wrong here, both found by owner on 2026-09-05
// when the card screen said 「无法打开 phone.kuca.app，请检查网络后重试。」:
//
//   1. The address was a bare constant used in seven places in one screen and hardcoded
//      again in the Kuca repo's start-phone-service.ts. Same address, independent copies.
//   2. The failure text named an internal hostname and blamed his network. The real cause
//      was that Kuca was not running on his Mac: the Cloudflare tunnel was still up with
//      nothing behind it, so every request came back 502. He would have gone looking at
//      his phone's WiFi.
//
// Deliberately NOT built here: probing a list of candidate origins. There is exactly one
// live entry today (Tailscale Serve is unconfigured on that Mac), so a picker over a
// one-element list would be machinery with no fault to remove. `PHONE_ENTRY_ORIGIN` is the
// seam a second entry would go through when one exists.

export const PHONE_ENTRY_ORIGIN = "https://phone.kuca.app";

/** What went wrong between the phone and Kuca, in the order the chain fails. */
export type PhoneEntryFault =
  /** Nothing answered at all: no route to the host, DNS, airplane mode, captive portal. */
  | "unreachable"
  /** The tunnel answered but nothing is behind it — Kuca is not running on the Mac. */
  | "kuca-down"
  /** Kuca answered, but this request did not succeed. */
  | "request-failed"
  /** This phone has no Kuca to talk to yet. Not a network fault at all. */
  | "not-paired";

/**
 * Which link broke, from what the network layer reported.
 *
 * `status` is the HTTP status when there was a response, `null` when the request never got
 * one. The 5xx family that Cloudflare returns for a tunnel with no origin (502, 503, 530)
 * is the signature of "Kuca is not running" — it is the tunnel answering, not Kuca.
 */
export function classifyPhoneEntryFault(status: number | null): PhoneEntryFault {
  if (status === null) return "unreachable";
  if (status === 502 || status === 503 || status === 504 || status === 530) return "kuca-down";
  return "request-failed";
}

/**
 * What to put on screen. Every user-facing reason the phone surface can fail lives in this
 * one function: before this, three unrelated causes (not paired yet, minting the pairing
 * link failed, the WebView could not load) all printed the same 「请检查网络」 line.
 *
 * What to put on screen. Says what he can do about it and never names a hostname: the host
 * is our business, "is the Mac awake with Kuca open" is his.
 */
export function describePhoneEntryFault(fault: PhoneEntryFault): string {
  switch (fault) {
    case "kuca-down":
      return "电脑上的 Kuca 没开着。打开它，这里会自己接上。";
    case "unreachable":
      return "连不上电脑。检查手机网络，或者确认电脑没有休眠。";
    case "request-failed":
      return "Kuca 开着，但这一下没成功。稍等一下再试。";
    case "not-paired":
      return "这台手机还没和电脑上的 Kuca 配对。在电脑上打开 Kuca，扫一次配对链接。";
  }
}

/** True when a URL belongs to Kuca's phone surface and should stay inside the app. */
export function isPhoneEntryOrigin(url: string): boolean {
  try {
    return new URL(url).origin === PHONE_ENTRY_ORIGIN;
  } catch {
    return false;
  }
}

/** A path inside Kuca's phone surface, or `/` when the input tries to leave it. */
export function resolvePhoneEntryPath(path: string | string[] | undefined): string {
  const raw = Array.isArray(path) ? path[0] : path;
  if (typeof raw !== "string" || raw.length === 0) return "/";
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  if (withSlash.startsWith("//") || withSlash.includes("://")) return "/";
  try {
    const url = new URL(withSlash, PHONE_ENTRY_ORIGIN);
    return url.origin === PHONE_ENTRY_ORIGIN ? `${url.pathname}${url.search}` : "/";
  } catch {
    return "/";
  }
}
