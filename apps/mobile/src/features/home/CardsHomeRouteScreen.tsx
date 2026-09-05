import type { StaticScreenProps } from "@react-navigation/native";

import { PhoneWebRouteScreen } from "../web/PhoneWebRouteScreen";
import { PHONE_CARDS_PATH } from "./firstScreen";

/**
 * Card stream as a push root. Reuses the WebView in `PhoneWebRouteScreen` with
 * the path pinned to `/phone-cards`. Modal `Web` stays for a single card and
 * the gov deck — native-stack will not make that modal the only route.
 */
export function CardsHomeRouteScreen(
  _props: StaticScreenProps<{ readonly path?: string } | undefined>,
) {
  return <PhoneWebRouteScreen route={{ params: { path: PHONE_CARDS_PATH } }} />;
}
