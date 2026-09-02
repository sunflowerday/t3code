import { NavigationState, StackActions, useNavigation } from "@react-navigation/native";
import { useEffect } from "react";

import { resolveFirstScreenRoute, shouldApplyFirstScreenRoute } from "./firstScreen";
import { useCardsFirstScreen } from "./use-cards-first-screen";

/**
 * Hands the launch stack over to the card stream when the device wants cards
 * first. Mounted from `RootStackLayout`, so it sees every root state change and
 * swaps the pristine `[Home]` launch state before anything paints: nothing is
 * visible until preferences settle, and the splash screen hides on that same
 * signal. A deep link or notification that already navigated leaves a stack
 * this gate refuses to touch — see `shouldApplyFirstScreenRoute`.
 */
export function FirstScreenGate(props: { readonly state: NavigationState }) {
  const navigation = useNavigation();
  const { cardsFirstScreenEnabled, preferencesLoaded } = useCardsFirstScreen();

  useEffect(() => {
    const route = resolveFirstScreenRoute({ cardsFirstScreenEnabled });
    if (
      !shouldApplyFirstScreenRoute({
        index: props.state.index,
        preferencesLoaded,
        route,
        routeNames: props.state.routes.map((screen) => screen.name),
      })
    ) {
      return;
    }
    navigation.dispatch(StackActions.replace(route.name, route.params));
  }, [cardsFirstScreenEnabled, navigation, preferencesLoaded, props.state]);

  return null;
}
