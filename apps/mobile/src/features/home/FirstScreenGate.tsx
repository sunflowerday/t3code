import { CommonActions, NavigationState, useNavigation } from "@react-navigation/native";
import { useEffect } from "react";

import { writeFirstScreenGateRecord } from "../automation/automationLink";
import { buildFirstScreenGateRecord, resolveFirstScreenRoute } from "./firstScreen";
import { hasInboundLaunchTarget } from "./firstScreenLaunch";
import { useCardsFirstScreen } from "./use-cards-first-screen";

/**
 * Hands the launch stack over to the card stream when the device wants cards
 * first. Mounted from `RootStackLayout`, so it sees every root state change.
 * Reset target is `CardsHome`, a regular (non-modal) screen. Resetting the
 * root to modal `Web` is a no-op on the native stack: a real-device dispatch
 * left JS focused on Home. Single-card and gov-deck pages still use `Web`.
 *
 * A notification tap, automation link, or shortcut marks inbound and is left
 * alone. An automatic last-thread restore just pushes Thread onto Home (or
 * onto CardsHome after cards already took over) without that mark, and is
 * reset back to the card stream — see `shouldApplyFirstScreenRoute`.
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
