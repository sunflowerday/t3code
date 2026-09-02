/**
 * Pure half of the cards-first launch decision: which screen owns the first
 * frame, and when the launch stack is still pristine enough to be swapped. The
 * impure half (reading preferences, driving the navigator) lives in
 * `FirstScreenGate`. No Expo or React Native imports, so it is unit-testable
 * in node — same split as `automationUrl.ts`.
 */

/** Contract with the K3a lane: the web page that renders the card stream. */
export const PHONE_CARDS_PATH = "/phone-cards";

export type FirstScreenRoute =
  | { readonly name: "Web"; readonly params: { readonly path: string } }
  | { readonly name: "Home"; readonly params?: undefined };

/**
 * Undefined means the device has never chosen, which resolves to on — cards
 * first is the default surface. Before preferences settle we hold the default
 * rather than flash the thread list, since nothing paints until they load.
 */
export function resolveCardsFirstScreenEnabled(input: {
  readonly preference: boolean | undefined;
  readonly preferencesLoaded: boolean;
}): boolean {
  if (!input.preferencesLoaded) return true;
  return input.preference ?? true;
}

export function resolveFirstScreenRoute(input: {
  readonly cardsFirstScreenEnabled: boolean;
}): FirstScreenRoute {
  return input.cardsFirstScreenEnabled
    ? { name: "Web", params: { path: PHONE_CARDS_PATH } }
    : { name: "Home" };
}

/**
 * The gate may only rewrite a stack nobody has touched: preferences settled so
 * a stored opt-out cannot be overwritten by the on-default, the route actually
 * asks for cards, and the navigator still sits on the bare `initialRouteName`
 * launch state. A cold-start deep link or notification tap has already pushed
 * or replaced routes, so it fails this check and stays where it landed.
 */
export function shouldApplyFirstScreenRoute(input: {
  readonly route: FirstScreenRoute;
  readonly preferencesLoaded: boolean;
  readonly routeNames: ReadonlyArray<string>;
  readonly index: number;
}): boolean {
  if (!input.preferencesLoaded || input.route.name !== "Web") return false;
  return input.index === 0 && input.routeNames.length === 1 && input.routeNames[0] === "Home";
}

/** True for the stream itself, with or without a query string; false for a single card. */
export function isPhoneCardsLandingPath(path: string): boolean {
  return path.split("?")[0] === PHONE_CARDS_PATH;
}
