import { useEffect, useRef, useState } from "react";
import { Linking, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import type { PreparedHttpAuthorization } from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";
import { AppText as Text } from "../../components/AppText";
import { useEnvironments } from "../../state/environments";
import { usePreparedConnection } from "../../state/session";

const ORIGIN = "https://phone.kuca.app";
const HOME = `${ORIGIN}/`;
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

export function PhoneWebRouteScreen() {
  const { environments, isReady } = useEnvironments();
  const prepared = usePreparedConnection(selectPhoneEnvironmentId(environments));
  const auth = prepared._tag === "Some" ? prepared.value.httpAuthorization : null;
  const webRef = useRef<WebView>(null);
  const minted = useRef(false);
  const [uri, setUri] = useState(HOME);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (isReady) webRef.current?.injectJavaScript(SESSION_PROBE);
  }, [auth, isReady]);
  const retry = () => {
    minted.current = false;
    setError(null);
    setUri(HOME);
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
    if (action === "stay" || minted.current) return;
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
      edges={["top", "bottom"]}
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
