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

export type FirstScreenDecisionReason =
  | "untouched_home"
  | "restored_thread"
  | "preferences_not_loaded"
  | "cards_first_disabled"
  | "inbound_launch_target"
  | "inbound_thread_only_stack"
  | "not_a_launch_stack";

export type FirstScreenDecision = {
  readonly decision: "apply" | "skip";
  readonly reason: FirstScreenDecisionReason;
};

/**
 * Device-pullable snapshot of one FirstScreenGate effect run. Shape is the
 * contract the host greps for in `Documents/automation/gate-*.json`.
 */
export type FirstScreenGateRecord = {
  readonly at: string;
  readonly routeNames: ReadonlyArray<string>;
  readonly index: number;
  readonly focusedRouteName: string | null;
  readonly preferencesLoaded: boolean;
  readonly cardsFirstScreenEnabled: boolean;
  readonly inboundLaunchTarget: boolean;
  readonly decision: "apply" | "skip";
  readonly reason: FirstScreenDecisionReason;
  readonly willDispatch: boolean;
};

function isRestoredThreadLaunchStack(routeNames: ReadonlyArray<string>): boolean {
  return (
    routeNames.length === 2 &&
    ((routeNames[0] === "Home" && routeNames[1] === "Thread") ||
      (routeNames[0] === "Web" && routeNames[1] === "Thread"))
  );
}

/**
 * Same inputs as `shouldApplyFirstScreenRoute`, with a reason the device log
 * can print. Order matches the boolean: preferences and the cards target
 * first, then inbound marks, then the launch-stack shapes.
 */
export function describeFirstScreenDecision(input: {
  readonly route: FirstScreenRoute;
  readonly preferencesLoaded: boolean;
  readonly routeNames: ReadonlyArray<string>;
  readonly index: number;
  readonly inboundLaunchTarget?: boolean;
}): FirstScreenDecision {
  if (!input.preferencesLoaded) {
    return { decision: "skip", reason: "preferences_not_loaded" };
  }
  if (input.route.name !== "Web") {
    return { decision: "skip", reason: "cards_first_disabled" };
  }
  if (input.inboundLaunchTarget === true) {
    return { decision: "skip", reason: "inbound_launch_target" };
  }
  // Linking initial state lands on Thread as the only route. A restore always
  // keeps Home underneath because it navigates after the default launch stack.
  if (input.routeNames.length === 1 && input.routeNames[0] === "Thread") {
    return { decision: "skip", reason: "inbound_thread_only_stack" };
  }
  if (input.index === 0 && input.routeNames.length === 1 && input.routeNames[0] === "Home") {
    return { decision: "apply", reason: "untouched_home" };
  }
  if (isRestoredThreadLaunchStack(input.routeNames)) {
    return { decision: "apply", reason: "restored_thread" };
  }
  return { decision: "skip", reason: "not_a_launch_stack" };
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
  return describeFirstScreenDecision(input).decision === "apply";
}

export function buildFirstScreenGateRecord(input: {
  readonly at: string;
  readonly routeNames: ReadonlyArray<string>;
  readonly index: number;
  readonly preferencesLoaded: boolean;
  readonly cardsFirstScreenEnabled: boolean;
  readonly inboundLaunchTarget: boolean;
}): FirstScreenGateRecord {
  const route = resolveFirstScreenRoute({
    cardsFirstScreenEnabled: input.cardsFirstScreenEnabled,
  });
  const described = describeFirstScreenDecision({
    inboundLaunchTarget: input.inboundLaunchTarget,
    index: input.index,
    preferencesLoaded: input.preferencesLoaded,
    route,
    routeNames: input.routeNames,
  });
  return {
    at: input.at,
    cardsFirstScreenEnabled: input.cardsFirstScreenEnabled,
    decision: described.decision,
    focusedRouteName: input.routeNames[input.index] ?? null,
    inboundLaunchTarget: input.inboundLaunchTarget,
    index: input.index,
    preferencesLoaded: input.preferencesLoaded,
    reason: described.reason,
    routeNames: input.routeNames,
    willDispatch: described.decision === "apply",
  };
}

/** True for the stream itself, with or without a query string; false for a single card. */
export function isPhoneCardsLandingPath(path: string): boolean {
  return path.split("?")[0] === PHONE_CARDS_PATH;
}
