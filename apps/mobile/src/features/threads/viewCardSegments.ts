// kuca: split an assistant message into prose and ```view card blocks.
//
// Kuca's agents answer with a mix of prose and fenced `view` blocks that the desktop chat
// paints as cards (tables, charts, decisions, handoffs). Those fences arrive here untouched —
// the wire projection passes message text through verbatim — so without this split the phone
// shows a wall of raw JSON in a code block where the desktop shows a card.
//
// Pure on purpose: the WebView that paints a card is untestable in a unit run, this is not.

export type ViewMessageSegment =
  | { readonly kind: "text"; readonly content: string }
  | { readonly kind: "card"; readonly content: string };

/**
 * A ```view fence, tolerating the info-string variants a model actually emits (`view`,
 * `view json`, trailing spaces) and any fence length of three or more backticks.
 */
const VIEW_FENCE = /^([ \t]*)(`{3,})[ \t]*view\b[^\n]*\n([\s\S]*?)\n?\1\2[ \t]*$/gm;

/**
 * Split `text` into the pieces the feed renders separately. Prose stays prose (same markdown
 * renderer as before); each card carries the fence body only, which is what the card page
 * expects.
 *
 * A message with no fences returns a single text segment, so the caller's common path is
 * unchanged and an unfenced answer cannot pay for this.
 */
export function splitViewMessageSegments(text: string): readonly ViewMessageSegment[] {
  const segments: ViewMessageSegment[] = [];
  let cursor = 0;

  VIEW_FENCE.lastIndex = 0;
  for (const match of text.matchAll(VIEW_FENCE)) {
    const start = match.index;
    if (start === undefined) continue;
    const body = match[3] ?? "";
    if (body.trim().length === 0) {
      // An empty fence is nothing to paint. Leaving it in the prose keeps whatever the model
      // did emit visible rather than silently dropping part of the answer.
      continue;
    }
    const before = text.slice(cursor, start);
    if (before.trim().length > 0) {
      segments.push({ kind: "text", content: before.trim() });
    }
    segments.push({ kind: "card", content: body });
    cursor = start + match[0].length;
  }

  const rest = text.slice(cursor);
  if (rest.trim().length > 0) {
    segments.push({ kind: "text", content: rest.trim() });
  }
  return segments.length > 0 ? segments : [{ kind: "text", content: text }];
}

/** True when the message has at least one card, i.e. the split is worth rendering. */
export function hasViewCard(segments: readonly ViewMessageSegment[]): boolean {
  return segments.some((segment) => segment.kind === "card");
}

/**
 * base64url, matching what the card page decodes. Encoded rather than passed raw because a
 * block body is arbitrary JSON — quotes, newlines, CJK — and a query string is a bad place for
 * any of that.
 */
export function encodeViewCardSource(code: string): string {
  const bytes = new TextEncoder().encode(code);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/**
 * Beyond this the block goes over postMessage instead of the URL. Well under the shortest
 * platform URL limit anyone documents; a card that big is a table, and one extra round trip
 * costs less than a truncated URL that fails silently.
 */
export const VIEW_CARD_URL_SOURCE_MAX_CHARS = 1_600;

export function viewCardUri(httpBaseUrl: string, code: string): string {
  const base = httpBaseUrl.endsWith("/") ? httpBaseUrl.slice(0, -1) : httpBaseUrl;
  const encoded = encodeViewCardSource(code);
  return encoded.length > VIEW_CARD_URL_SOURCE_MAX_CHARS
    ? `${base}/view-card/viewCard.html`
    : `${base}/view-card/viewCard.html?code=${encoded}`;
}
