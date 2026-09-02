import { useEffect, useRef, useState } from "react";
import { Linking, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import type { PreparedHttpAuthorization } from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";
import { AppText as Text } from "../../components/AppText";
import { useEnvironments } from "../../state/environments";
import { usePreparedConnection } from "../../state/session";

const ORIGIN = "https://phone.kuca.app";
const ERR = "无法打开 phone.kuca.app，请检查网络后重试。";
const SESSION_PROBE =
  '(async()=>{try{const r=await fetch("/api/auth/session",{credentials:"same-origin"});let a=false;try{a=(await r.json()).authenticated===true;}catch{}window.ReactNativeWebView.postMessage(JSON.stringify({authenticated:r.status===401?false:a}));}catch{window.ReactNativeWebView.postMessage("{}");}})();true;';

type Env = { environmentId: EnvironmentId; displayUrl?: string | null };

export function shouldLoadInPhoneWebView(url: string): boolean {
  try {
    return new URL(url).origin === ORIGIN;
  } catch {
    return false;
  }
}

export function resolvePhoneWebPath(path: string | string[] | undefined): string {
  const raw = Array.isArray(path) ? path[0] : path;
  if (typeof raw !== "string" || raw.length === 0) return "/";
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  if (withSlash.startsWith("//") || withSlash.includes("://")) return "/";
  try {
    const url = new URL(withSlash, ORIGIN);
    return url.origin === ORIGIN ? `${url.pathname}${url.search}` : "/";
  } catch {
    return "/";
  }
}

export function phoneCardsPath(threadId: string): string {
  return `/phone-cards/${threadId}`;
}

export function govDeckWebParams() {
  return { path: "/gov/deck/harvest-deck.html" };
}

export function selectPhoneEnvironmentId(environments: readonly Env[]): EnvironmentId | null {
  return (
    environments.find((e) => shouldLoadInPhoneWebView(e.displayUrl ?? ""))?.environmentId ?? null
  );
}

export function decidePhoneWebAction(
  authenticated: boolean | null,
  authorization: PreparedHttpAuthorization | null,
) {
  if (authenticated === true) return "stay";
  return authenticated === false && authorization?._tag === "Bearer" ? "mint" : "error";
}

export function phonePairUrl(credential: string): string {
  return `${ORIGIN}/pair#token=${encodeURIComponent(credential)}`;
}

export function lastAssistantHasReadyCard(items: ReadonlyArray<unknown>): boolean {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (typeof item !== "object" || item === null || !("role" in item)) continue;
    if (item.role !== "assistant") continue;
    const card = "phoneCard" in item ? item.phoneCard : null;
    return typeof card === "object" && card !== null && "status" in card && card.status === "ready";
  }
  return false;
}

async function mintPairingUri(token: string): Promise<string> {
  const response = await fetch(`${ORIGIN}/api/auth/pairing-token`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  const body = (await response.json()) as { credential?: unknown };
  if (!response.ok || typeof body.credential !== "string" || !body.credential)
    throw new Error("mint");
  return phonePairUrl(body.credential);
}

export function PhoneWebRouteScreen({
  route,
}: StaticScreenProps<{ readonly path?: string } | undefined>) {
  const path = resolvePhoneWebPath(route.params?.path);
  const targetUri = `${ORIGIN}${path}`;
  const { environments, isReady } = useEnvironments();
  const prepared = usePreparedConnection(selectPhoneEnvironmentId(environments));
  const auth = prepared._tag === "Some" ? prepared.value.httpAuthorization : null;
  const webRef = useRef<WebView>(null);
  const minted = useRef(false);
  const [uri, setUri] = useState(targetUri);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    minted.current = false;
    setError(null);
    setUri(targetUri);
  }, [targetUri]);
  useEffect(() => {
    if (isReady) webRef.current?.injectJavaScript(SESSION_PROBE);
  }, [auth, isReady]);
  const retry = () => {
    minted.current = false;
    setError(null);
    setUri(targetUri);
  };
  function onMessage(event: { nativeEvent: { data: string } }) {
    let authenticated: boolean | null = null;
    try {
      const value = (JSON.parse(event.nativeEvent.data) as { authenticated?: boolean })
        .authenticated;
      authenticated = typeof value === "boolean" ? value : null;
    } catch {
      authenticated = null;
    }
    const action = decidePhoneWebAction(authenticated, auth);
    if (action === "stay") {
      if (minted.current) setUri(targetUri);
      return;
    }
    if (minted.current) return;
    if (action === "mint" && auth?._tag === "Bearer") {
      minted.current = true;
      void mintPairingUri(auth.token)
        .then(setUri)
        .catch(() => setError(ERR));
      return;
    }
    if (isReady) setError(ERR);
  }
  return (
    <SafeAreaView
      className={error ? "items-center justify-center gap-3 px-6" : undefined}
      style={{ flex: 1 }}
      edges={["bottom"]}
    >
      {error ? (
        <>
          <Text className="text-center text-base text-foreground">{error}</Text>
          <Pressable className="rounded-full bg-primary px-5 py-3" onPress={retry}>
            <Text className="text-sm font-t3-bold text-primary-foreground">重试</Text>
          </Pressable>
        </>
      ) : (
        <WebView
          ref={webRef}
          source={{ uri }}
          originWhitelist={["*"]}
          allowsBackForwardNavigationGestures
          setSupportMultipleWindows={false}
          injectedJavaScript={SESSION_PROBE}
          onMessage={onMessage}
          onError={() => setError(ERR)}
          onShouldStartLoadWithRequest={(request) => {
            if (shouldLoadInPhoneWebView(request.url)) return true;
            void Linking.openURL(request.url);
            return false;
          }}
          style={{ flex: 1 }}
        />
      )}
    </SafeAreaView>
  );
}

export function ViewPhoneCardButton(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: string;
}) {
  const navigation = useNavigation();
  const prepared = usePreparedConnection(props.environmentId);
  const auth = prepared._tag === "Some" ? prepared.value.httpAuthorization : null;
  const token = auth?._tag === "Bearer" ? auth.token : null;
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (token === null) {
      setVisible(false);
      return;
    }
    const threadId = props.threadId;
    let cancelled = false;
    void fetch(`${ORIGIN}/api/phone-cards?threadId=${encodeURIComponent(threadId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as { items?: unknown };
      })
      .then((body) => {
        if (cancelled) return;
        setVisible(lastAssistantHasReadyCard(Array.isArray(body?.items) ? body.items : []));
      })
      .catch(() => {
        if (!cancelled) setVisible(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.threadId, token]);
  if (!visible) return null;
  return (
    <Pressable
      accessibilityLabel="看卡片"
      accessibilityRole="button"
      className="mb-3 mt-1 self-start rounded-full bg-primary px-4 py-2"
      onPress={() => navigation.navigate("Web", { path: phoneCardsPath(props.threadId) })}
    >
      <Text className="text-sm font-t3-bold text-primary-foreground">看卡片</Text>
    </Pressable>
  );
}
