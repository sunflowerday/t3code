// kuca: paint one ```view card by hosting the Kuca server's card page in a WebView.
//
// The alternative was reimplementing the card renderer in React Native — about 1,500 lines in
// this pinned mirror, permanently diverging from upstream, and re-done every time the desktop
// renderer changes. Hosting the page the desktop already renders costs this file instead, and
// a card looks the same on both by construction.
//
// The page is served by the Kuca server at /view-card/ and receives the block through the URL
// (or postMessage when the block is too long for one). It fetches nothing: the phone only ever
// renders a block it already received over the thread subscription.

import { useCallback, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import type { EnvironmentId } from "@t3tools/contracts";

import { usePreparedConnection } from "../../state/session";

import {
  encodeViewCardSource,
  VIEW_CARD_URL_SOURCE_MAX_CHARS,
  viewCardUri,
} from "./viewCardSegments";

/**
 * What to show before the page reports its real height. Tall enough that a card does not pop
 * into place from nothing, short enough that a wrong guess is not a hole in the transcript.
 */
const INITIAL_HEIGHT = 96;

/** A card taller than the screen would need its own scroll, which the outer list owns. */
const MAX_HEIGHT = 1_200;

function parseHeightMessage(raw: string): number | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as { type?: unknown; height?: unknown };
    if (record.type !== "view-card-height" || typeof record.height !== "number") return null;
    return Number.isFinite(record.height) && record.height > 0 ? record.height : null;
  } catch {
    return null;
  }
}

export function ViewCardBlock(props: {
  readonly environmentId: EnvironmentId;
  readonly code: string;
}) {
  const preparedConnection = usePreparedConnection(props.environmentId);
  const [height, setHeight] = useState(INITIAL_HEIGHT);
  const webViewRef = useRef<WebView>(null);

  const httpBaseUrl =
    preparedConnection._tag === "None" ? null : preparedConnection.value.httpBaseUrl;
  const uri = useMemo(
    () => (httpBaseUrl === null ? null : viewCardUri(httpBaseUrl, props.code)),
    [httpBaseUrl, props.code],
  );
  const needsMessageDelivery =
    encodeViewCardSource(props.code).length > VIEW_CARD_URL_SOURCE_MAX_CHARS;

  const onLoadEnd = useCallback(() => {
    if (!needsMessageDelivery) return;
    webViewRef.current?.postMessage(JSON.stringify({ type: "view-card-source", code: props.code }));
  }, [needsMessageDelivery, props.code]);

  const onMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    const next = parseHeightMessage(event.nativeEvent.data);
    if (next !== null) {
      setHeight(Math.min(next, MAX_HEIGHT));
    }
  }, []);

  // No connection yet means no server to load the page from. Rendering nothing is right: the
  // prose around the card is already on screen, and a spinner that never resolves reads worse
  // than a card that appears when the connection does.
  if (uri === null) return null;

  return (
    <View className="mt-1.5" style={{ height }}>
      <WebView
        ref={webViewRef}
        source={{ uri }}
        style={{ backgroundColor: "transparent", flex: 1 }}
        // The chat list owns the scroll gesture. Without this the card steals vertical drags
        // that started inside it and the transcript feels stuck.
        scrollEnabled={false}
        nestedScrollEnabled={false}
        onMessage={onMessage}
        onLoadEnd={onLoadEnd}
        // Same-origin only: the card page is ours and pulls in nothing else.
        originWhitelist={["http://*", "https://*"]}
        setSupportMultipleWindows={false}
        // A card is a rendering, not a destination. Anything that tries to navigate away is a
        // link inside the block, and that belongs in the system browser, not in this frame.
        onShouldStartLoadWithRequest={(request) => request.url === uri}
        androidLayerType="hardware"
      />
    </View>
  );
}
