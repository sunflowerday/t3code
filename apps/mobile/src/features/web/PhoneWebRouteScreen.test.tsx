import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("react-native", () => ({ Linking: { openURL: vi.fn() }, Pressable: "P", View: "V" }));
vi.mock("react-native-webview", () => ({ WebView: "W" }));
vi.mock("react-native-safe-area-context", () => ({ SafeAreaView: "S" }));
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({ environments: [], isReady: true }),
}));
vi.mock("../../state/session", () => ({ usePreparedConnection: () => ({ _tag: "None" }) }));
vi.mock("../../components/AppText", () => ({ AppText: "T" }));

import {
  decidePhoneWebAction,
  phonePairUrl,
  selectPhoneEnvironmentId,
  shouldLoadInPhoneWebView,
} from "./PhoneWebRouteScreen";

const BEARER = { _tag: "Bearer" as const, token: "t" };
const DPOP = { _tag: "Dpop" as const, accessToken: "x" };

describe("PhoneWebRouteScreen", () => {
  it("stays at / when a session cookie already exists", () => {
    expect(decidePhoneWebAction(true, BEARER)).toBe("stay");
  });

  it("mints a one-time code only for 401 plus a Bearer", () => {
    expect(decidePhoneWebAction(false, BEARER)).toBe("mint");
    expect(decidePhoneWebAction(false, null)).toBe("error");
    expect(decidePhoneWebAction(false, DPOP)).toBe("error");
  });

  it("puts the pairing token in the URL fragment", () => {
    expect(phonePairUrl("one-time")).toBe("https://phone.kuca.app/pair#token=one-time");
    expect(new URL(phonePairUrl("a+b")).hash).toBe("#token=a%2Bb");
  });

  it("surfaces a visible error when there is no Bearer or the network fails", () => {
    expect(decidePhoneWebAction(false, null)).toBe("error");
    expect(decidePhoneWebAction(null, BEARER)).toBe("error");
  });

  it("does not open off-origin URLs inside the WebView", () => {
    expect(shouldLoadInPhoneWebView("https://phone.kuca.app/thread/1")).toBe(true);
    expect(shouldLoadInPhoneWebView("https://example.com/")).toBe(false);
    expect(
      selectPhoneEnvironmentId([
        { environmentId: EnvironmentId.make("first"), displayUrl: "https://other.example/" },
        { environmentId: EnvironmentId.make("phone"), displayUrl: "https://phone.kuca.app/" },
      ]),
    ).toBe(EnvironmentId.make("phone"));
  });
});
