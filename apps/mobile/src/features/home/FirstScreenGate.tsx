import { CommonActions, NavigationState, useNavigation } from "@react-navigation/native";
import { useEffect } from "react";

import { writeFirstScreenGateRecord } from "../automation/automationLink";
import { buildFirstScreenGateRecord, resolveFirstScreenRoute } from "./firstScreen";
import { hasInboundLaunchTarget } from "./firstScreenLaunch";
import { useCardsFirstScreen } from "./use-cards-first-screen";

/**
 * Hands the launch stack over to the card stream when the device wants cards
 * first. Mounted from `RootStackLayout`, so it sees every root state change.
 * Reset, not replace: Web is registered as a fullScreenModal, and replacing
 * the root with a modal screen does not reliably become the focused route.
 * Reset makes Web the only screen, which the native stack treats as a push.
 *
 * A notification tap, automation link, or shortcut marks inbound and is left
 * alone. An automatic last-thread restore just pushes Thread onto Home (or
 * onto Web after cards already took over) without that mark, and is reset
 * back to the card stream — see `shouldApplyFirstScreenRoute`.
 */
export function FirstScreenGate(props: { readonly state: NavigationState }) {
  const navigation = useNavigation();
  const { cardsFirstScreenEnabled, preferencesLoaded } = useCardsFirstScreen();

  useEffect(() => {
    const record = buildFirstScreenGateRecord({
      at: new Date().toISOString(),
      cardsFirstScreenEnabled,
      inboundLaunchTarget: hasInboundLaunchTarget(),
      index: props.state.index,
      preferencesLoaded,
      routeNames: props.state.routes.map((screen) => screen.name),
    });
    writeFirstScreenGateRecord(record);
    if (!record.willDispatch) {
      return;
    }
    const route = resolveFirstScreenRoute({ cardsFirstScreenEnabled });
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: route.name, params: route.params }],
      }),
    );
  }, [cardsFirstScreenEnabled, navigation, preferencesLoaded, props.state]);

  return null;
}
