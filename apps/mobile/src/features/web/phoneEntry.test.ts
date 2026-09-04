import { describe, expect, it } from "vitest";

import {
  classifyPhoneEntryFault,
  describePhoneEntryFault,
  isPhoneEntryOrigin,
  PHONE_ENTRY_ORIGIN,
  resolvePhoneEntryPath,
} from "./phoneEntry";

describe("which link broke", () => {
  it("reads a tunnel with nothing behind it as Kuca being off", () => {
    // owner 2026-09-05: cloudflared was up, Kuca was not, every request came back 502.
    for (const status of [502, 503, 504, 530]) {
      expect(classifyPhoneEntryFault(status)).toBe("kuca-down");
    }
    expect(describePhoneEntryFault("kuca-down")).toContain("电脑上的 Kuca 没开着");
  });

  it("reads no response at all as not reaching the computer", () => {
    expect(classifyPhoneEntryFault(null)).toBe("unreachable");
    expect(describePhoneEntryFault("unreachable")).toContain("连不上电脑");
  });

  it("keeps an ordinary failure separate from the two above", () => {
    expect(classifyPhoneEntryFault(404)).toBe("request-failed");
    expect(classifyPhoneEntryFault(500)).toBe("request-failed");
  });

  it("never blames his network for a phone that was never paired", () => {
    expect(describePhoneEntryFault("not-paired")).toContain("配对");
    expect(describePhoneEntryFault("not-paired")).not.toContain("网络");
  });

  it("never puts an internal hostname in front of him", () => {
    for (const fault of ["kuca-down", "unreachable", "request-failed", "not-paired"] as const) {
      expect(describePhoneEntryFault(fault)).not.toContain("kuca.app");
    }
  });
});

describe("staying inside Kuca's phone surface", () => {
  it("recognises its own origin", () => {
    expect(isPhoneEntryOrigin(`${PHONE_ENTRY_ORIGIN}/phone-cards`)).toBe(true);
  });

  it("does not follow a link somewhere else", () => {
    expect(isPhoneEntryOrigin("https://example.com/phone-cards")).toBe(false);
    expect(isPhoneEntryOrigin("not a url")).toBe(false);
  });

  it("refuses a path that tries to leave", () => {
    expect(resolvePhoneEntryPath("//evil.example")).toBe("/");
    expect(resolvePhoneEntryPath("https://evil.example/x")).toBe("/");
  });

  it("keeps a normal path and its query", () => {
    expect(resolvePhoneEntryPath("phone-cards")).toBe("/phone-cards");
    expect(resolvePhoneEntryPath("/phone-cards?limit=3")).toBe("/phone-cards?limit=3");
    expect(resolvePhoneEntryPath(undefined)).toBe("/");
  });
});
