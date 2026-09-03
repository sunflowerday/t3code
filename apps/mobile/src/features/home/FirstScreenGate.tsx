import { NavigationState } from "@react-navigation/native";
import { useEffect } from "react";

import {
  automationNavigationRef,
  writeFirstScreenGateRecord,
} from "../automation/automationLink";
import {
  buildAfterDispatchGateRecord,
  buildFirstScreenGateRecord,
  buildFirstScreenResetRootState,
  resolveFirstScreenRoute,
  subscribeWhenReady,
} from "./firstScreen";
import { hasInboundLaunchTarget } from "./firstScreenLaunch";
import { useCardsFirstScreen } from "./use-cards-first-screen";

/**
 * Hands the launch stack over to the card stream when the device wants cards
 * first. Mounted from `RootStackLayout`, so it sees every root state change.
 * Reset goes through `automationNavigationRef.resetRoot` — the same container
 * ref `open-web` uses — because `useNavigation()` in a static navigator
 * `layout` is not the root stack's own helpers, and a container `dispatch`
 * without a target never reaches that stack on the first layout effect.
 *
 * A notification tap, automation link, or shortcut marks inbound and is left
 * alone. An automatic last-thread restore just pushes Thread onto Home (or
 * onto CardsHome after cards already took over) without that mark, and is
 * reset back to the card stream — see `shouldApplyFirstScreenRoute`.
 */
export function FirstScreenGate(props: { readonly state: NavigationState }) {
  const { cardsFirstScreenEnabled, preferencesLoaded } = useCardsFirstScreen();

  useEffect(() => {
    const inboundLaunchTarget = hasInboundLaunchTarget();
    const record = buildFirstScreenGateRecord({
      at: new Date().toISOString(),
      cardsFirstScreenEnabled,
      inboundLaunchTarget,
      index: props.state.index,
      preferencesLoaded,
      routeNames: props.state.routes.map((screen) => screen.name),
    });
    writeFirstScreenGateRecord(record);
    if (!record.willDispatch) {
      return;
    }
    const resetState = buildFirstScreenResetRootState(
      resolveFirstScreenRoute({ cardsFirstScreenEnabled }),
    );
    return subscribeWhenReady({
      addListener: (onReady) => automationNavigationRef.addListener("ready", onReady),
      isReady: () => automationNavigationRef.isReady(),
      onReady: () => {
        automationNavigationRef.resetRoot({
          index: resetState.index,
          routes: [...resetState.routes],
        });
        writeFirstScreenGateRecord(
          buildAfterDispatchGateRecord({
            at: new Date().toISOString(),
            cardsFirstScreenEnabled,
            inboundLaunchTarget,
            preferencesLoaded,
            rootState: automationNavigationRef.getRootState(),
          }),
        );
      },
    });
  }, [cardsFirstScreenEnabled, preferencesLoaded, props.state]);

  return null;
}
