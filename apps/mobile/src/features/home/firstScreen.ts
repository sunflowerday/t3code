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
 * True when this launch already has an explicit destination: a notification
 * tap, an automation/open-thread URL, or a launcher shortcut. Last-thread
 * restore is not inbound — it just pushes Thread onto Home after launch.
 */
function isInboundLaunchStack(input: {
  readonly inboundLaunchTarget: boolean;
  readonly routeNames: ReadonlyArray<string>;
}): boolean {
  if (input.inboundLaunchTarget) return true;
  // Linking initial state lands on Thread as the only route. A restore always
  // keeps Home underneath because it navigates after the default launch stack.
  return input.routeNames.length === 1 && input.routeNames[0] === "Thread";
}

function isRestoredThreadLaunchStack(routeNames: ReadonlyArray<string>): boolean {
  return (
    routeNames.length === 2 &&
    ((routeNames[0] === "Home" && routeNames[1] === "Thread") ||
      (routeNames[0] === "Web" && routeNames[1] === "Thread"))
  );
}

/**
 * The gate may rewrite a stack nobody asked to open: preferences settled so a
 * stored opt-out cannot be overwritten by the on-default, the route actually
 * asks for cards, and the navigator is still a launch stack. Launch stacks are
 * the bare `initialRouteName` Home, or that Home with an automatic last-thread
 * restore pushed on top (or the same restore arriving after cards already
 * took over). A notification tap, automation link, or shortcut sets
 * `inboundLaunchTarget`; a cold-start thread URL is already `[Thread]` with
 * no Home underneath. Those stay where they landed.
 */
export function shouldApplyFirstScreenRoute(input: {
  readonly route: FirstScreenRoute;
  readonly preferencesLoaded: boolean;
  readonly routeNames: ReadonlyArray<string>;
  readonly index: number;
  readonly inboundLaunchTarget?: boolean;
}): boolean {
  if (!input.preferencesLoaded || input.route.name !== "Web") return false;
  if (
    isInboundLaunchStack({
      inboundLaunchTarget: input.inboundLaunchTarget === true,
      routeNames: input.routeNames,
    })
  ) {
    return false;
  }
  if (input.index === 0 && input.routeNames.length === 1 && input.routeNames[0] === "Home") {
    return true;
  }
  return isRestoredThreadLaunchStack(input.routeNames);
}

/** True for the stream itself, with or without a query string; false for a single card. */
export function isPhoneCardsLandingPath(path: string): boolean {
  return path.split("?")[0] === PHONE_CARDS_PATH;
}
