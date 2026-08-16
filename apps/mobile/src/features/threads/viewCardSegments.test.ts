// kuca: tests for the prose/card split.
import { describe, expect, it } from "vite-plus/test";

import {
  encodeViewCardSource,
  hasViewCard,
  splitViewMessageSegments,
  VIEW_CARD_URL_SOURCE_MAX_CHARS,
  viewCardUri,
} from "./viewCardSegments";

// A real answer shape from the owner's database: one card between two paragraphs of prose.
const REAL_BLOCK = `{"type":"table","title":"拟执行的内部授权","data":{"columns":["账号"],"rows":[{"cells":["a@b.com"]}]}}`;
const REAL_MESSAGE = ["这周三条线都清了。", "```view", REAL_BLOCK, "```", "", "关键风险：…"].join(
  "\n",
);

describe("splitViewMessageSegments", () => {
  it("keeps prose either side of a card and hands the card its fence body only", () => {
    expect(splitViewMessageSegments(REAL_MESSAGE)).toEqual([
      { kind: "text", content: "这周三条线都清了。" },
      { kind: "card", content: REAL_BLOCK },
      { kind: "text", content: "关键风险：…" },
    ]);
  });

  // The common case is an answer with no card at all. It must come back as one text segment so
  // the feed's existing path is byte-for-byte what it was.
  it("returns the message unchanged when there is no card", () => {
    expect(splitViewMessageSegments("just prose")).toEqual([
      { kind: "text", content: "just prose" },
    ]);
    expect(hasViewCard(splitViewMessageSegments("just prose"))).toBe(false);
  });

  it("leaves other fenced languages alone", () => {
    const message = 'before\n```json\n{"a":1}\n```\nafter';
    expect(splitViewMessageSegments(message)).toEqual([{ kind: "text", content: message }]);
  });

  it("reads the info-string and fence-length variants models actually emit", () => {
    for (const opener of ["```view", "```view json", "```view   ", "````view"]) {
      const closer = opener.startsWith("````") ? "````" : "```";
      const segments = splitViewMessageSegments(`${opener}\n${REAL_BLOCK}\n${closer}`);
      expect(segments, opener).toEqual([{ kind: "card", content: REAL_BLOCK }]);
    }
  });

  it("splits several cards in one answer", () => {
    const message = `a\n\`\`\`view\n{"x":1}\n\`\`\`\nb\n\`\`\`view\n{"x":2}\n\`\`\`\nc`;
    expect(splitViewMessageSegments(message).map((s) => s.kind)).toEqual([
      "text",
      "card",
      "text",
      "card",
      "text",
    ]);
  });

  // Mid-stream the closing fence has not arrived yet. Painting a half card would flash broken
  // JSON on every token, so an unterminated fence stays prose until it closes.
  it("treats an unterminated fence as prose", () => {
    const streaming = '```view\n{"type":"tab';
    expect(splitViewMessageSegments(streaming)).toEqual([{ kind: "text", content: streaming }]);
  });

  // Dropping an empty fence entirely would delete part of the answer.
  it("keeps an empty fence visible as prose rather than dropping it", () => {
    const message = "before\n```view\n\n```\nafter";
    expect(splitViewMessageSegments(message)).toEqual([{ kind: "text", content: message }]);
  });
});

describe("encodeViewCardSource", () => {
  it("survives CJK, which a naive btoa() of the string would throw on", () => {
    expect(() => encodeViewCardSource(REAL_BLOCK)).not.toThrow();
    const decoded = new TextDecoder().decode(
      Uint8Array.from(
        atob(encodeViewCardSource(REAL_BLOCK).replaceAll("-", "+").replaceAll("_", "/")),
        (c) => c.charCodeAt(0),
      ),
    );
    expect(decoded).toBe(REAL_BLOCK);
  });

  it("emits base64url with no padding, which is URL-safe unescaped", () => {
    const encoded = encodeViewCardSource(REAL_BLOCK);
    expect(encoded).not.toMatch(/[+/=]/);
  });
});

describe("viewCardUri", () => {
  it("points at the page the server serves, without doubling the slash", () => {
    expect(viewCardUri("https://host", "{}")).toContain(
      "https://host/view-card/viewCard.html?code=",
    );
    expect(viewCardUri("https://host/", "{}")).toContain(
      "https://host/view-card/viewCard.html?code=",
    );
  });

  // A URL past the limit would be truncated by something downstream and fail silently; the
  // block goes over postMessage instead, so the URL carries no code at all.
  it("omits the query for a block too large to put in a URL", () => {
    const huge = "x".repeat(VIEW_CARD_URL_SOURCE_MAX_CHARS * 2);
    expect(viewCardUri("https://host", huge)).toBe("https://host/view-card/viewCard.html");
  });
});
