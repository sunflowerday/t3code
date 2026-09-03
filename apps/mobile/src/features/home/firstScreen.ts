/**
 * Pure half of the cards-first launch decision: which screen owns the first
 * frame, and when the launch stack is still pristine enough to be swapped. The
 * impure half (reading preferences, driving the navigator) lives in
 * `FirstScreenGate`. No Expo or React Native imports, so it is unit-testable
 * in node — same split as `automationUrl.ts`.
 */

/** Contract with the K3a lane: the web page that renders the card stream. */
export const PHONE_CARDS_PATH = "/phone-cards";

/** Regular (non-modal) root for the card stream. Distinct from modal `Web`. */
export const CARDS_HOME_ROUTE_NAME = "CardsHome";

export type FirstScreenRoute =
  | { readonly name: "CardsHome"; readonly params: { readonly path: string } }
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
    ? { name: CARDS_HOME_ROUTE_NAME, params: { path: PHONE_CARDS_PATH } }
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

/** Follow-up written after the container ref actually runs resetRoot. */
export type FirstScreenGateRecordReason = FirstScreenDecisionReason | "after_dispatch";

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
  readonly reason: FirstScreenGateRecordReason;
  readonly willDispatch: boolean;
};

export type FirstScreenResetRootState = {
  readonly index: 0;
  readonly routes: ReadonlyArray<
    | { readonly name: "CardsHome"; readonly params: { readonly path: string } }
    | { readonly name: "Home" }
  >;
};

export type NavigationRootSnapshot = {
  readonly routeNames: ReadonlyArray<string>;
  readonly index: number;
};

function isRestoredThreadLaunchStack(routeNames: ReadonlyArray<string>): boolean {
  return (
    routeNames.length === 2 &&
    routeNames[1] === "Thread" &&
    (routeNames[0] === "Home" ||
      routeNames[0] === "Web" ||
      routeNames[0] === CARDS_HOME_ROUTE_NAME)
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
  if (input.route.name !== CARDS_HOME_ROUTE_NAME) {
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
 * took over as `CardsHome`). A notification tap, automation link, or shortcut
 * sets `inboundLaunchTarget`; a cold-start thread URL is already `[Thread]`
 * with no Home underneath. Those stay where they landed.
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

/**
 * Payload for `navigationRef.resetRoot`. Chosen over `dispatch(CommonActions.reset)`
 * because the container's dispatch sends the action to the focused navigator
 * with no `target`; resetRoot sets `target` to the root navigator key.
 */
export function buildFirstScreenResetRootState(route: FirstScreenRoute): FirstScreenResetRootState {
  return {
    index: 0,
    routes: route.params === undefined ? [{ name: route.name }] : [{ name: route.name, params: route.params }],
  };
}

/**
 * Live stack from `getRootState()`, not the navigator's registered `routeNames`.
 * Missing state is empty + index -1 so a failed reset cannot look like a measurement.
 */
export function snapshotNavigationRootState(
  state:
    | {
        readonly index?: number;
        readonly routeNames?: ReadonlyArray<string>;
        readonly routes?: ReadonlyArray<{ readonly name: string }>;
      }
    | undefined,
): NavigationRootSnapshot {
  if (state?.routes == null) {
    return { index: -1, routeNames: [] };
  }
  return {
    index: state.index ?? 0,
    routeNames: state.routes.map((route) => route.name),
  };
}

export function buildAfterDispatchGateRecord(input: {
  readonly at: string;
  readonly cardsFirstScreenEnabled: boolean;
  readonly inboundLaunchTarget: boolean;
  readonly preferencesLoaded: boolean;
  readonly rootState:
    | {
        readonly index?: number;
        readonly routeNames?: ReadonlyArray<string>;
        readonly routes?: ReadonlyArray<{ readonly name: string }>;
      }
    | undefined;
}): FirstScreenGateRecord {
  const snapshot = snapshotNavigationRootState(input.rootState);
  return {
    at: input.at,
    cardsFirstScreenEnabled: input.cardsFirstScreenEnabled,
    decision: "apply",
    focusedRouteName: snapshot.routeNames[snapshot.index] ?? null,
    inboundLaunchTarget: input.inboundLaunchTarget,
    index: snapshot.index,
    preferencesLoaded: input.preferencesLoaded,
    reason: "after_dispatch",
    routeNames: snapshot.routeNames,
    willDispatch: false,
  };
}

/**
 * Run `onReady` now if the container can handle actions, otherwise wait for
 * its `ready` event. The first layout effect of a child of the navigator runs
 * before the parent registers focus listeners, so a sync `isReady()` check
 * would drop the reset.
 */
export function subscribeWhenReady(input: {
  readonly isReady: () => boolean;
  readonly addListener: (onReady: () => void) => () => void;
  readonly onReady: () => void;
}): () => void {
  let settled = false;
  let unsubscribe = () => {};

  const run = () => {
    if (settled) {
      return;
    }
    settled = true;
    unsubscribe();
    input.onReady();
  };

  if (input.isReady()) {
    run();
    return () => {};
  }

  unsubscribe = input.addListener(run);
  if (settled) {
    unsubscribe();
    return () => {};
  }
  if (input.isReady()) {
    run();
    return () => {};
  }

  return () => {
    settled = true;
    unsubscribe();
  };
}
