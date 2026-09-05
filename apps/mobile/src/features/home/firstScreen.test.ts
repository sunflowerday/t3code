import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  PHONE_CARDS_PATH,
  buildAfterDispatchGateRecord,
  buildFirstScreenGateRecord,
  buildFirstScreenResetRootState,
  describeFirstScreenDecision,
  isPhoneCardsLandingPath,
  resolveCardsFirstScreenEnabled,
  resolveFirstScreenRoute,
  shouldApplyFirstScreenRoute,
  snapshotNavigationRootState,
  subscribeWhenReady,
} from "./firstScreen";
import {
  hasInboundLaunchTarget,
  markInboundLaunchTarget,
  resetInboundLaunchTarget,
} from "./firstScreenLaunch";

describe("resolveCardsFirstScreenEnabled", () => {
  it("defaults on when the device has never chosen", () => {
    expect(resolveCardsFirstScreenEnabled({ preference: undefined, preferencesLoaded: true })).toBe(
      true,
    );
  });

  it("honors an explicit device opt-out", () => {
    expect(resolveCardsFirstScreenEnabled({ preference: false, preferencesLoaded: true })).toBe(
      false,
    );
    expect(resolveCardsFirstScreenEnabled({ preference: true, preferencesLoaded: true })).toBe(
      true,
    );
  });

  it("holds the default while preferences are still loading", () => {
    expect(
      resolveCardsFirstScreenEnabled({ preference: undefined, preferencesLoaded: false }),
    ).toBe(true);
  });
});

describe("resolveFirstScreenRoute", () => {
  it("opens on the card stream when the preference is on", () => {
    expect(resolveFirstScreenRoute({ cardsFirstScreenEnabled: true })).toEqual({
      name: "CardsHome",
      params: { path: PHONE_CARDS_PATH },
    });
  });

  it("opens on the thread list when the preference is off", () => {
    expect(resolveFirstScreenRoute({ cardsFirstScreenEnabled: false })).toEqual({ name: "Home" });
  });
});

describe("shouldApplyFirstScreenRoute", () => {
  const cards = resolveFirstScreenRoute({ cardsFirstScreenEnabled: true });
  const threads = resolveFirstScreenRoute({ cardsFirstScreenEnabled: false });

  it("takes over the untouched launch stack", () => {
    expect(
      shouldApplyFirstScreenRoute({
        route: cards,
        preferencesLoaded: true,
        routeNames: ["Home"],
        index: 0,
      }),
    ).toBe(true);
  });

  it("waits for preferences so a stored opt-out is never overwritten", () => {
    expect(
      shouldApplyFirstScreenRoute({
        route: cards,
        preferencesLoaded: false,
        routeNames: ["Home"],
        index: 0,
      }),
    ).toBe(false);
  });

  it("leaves the launch stack alone when the preference is off", () => {
    expect(
      shouldApplyFirstScreenRoute({
        route: threads,
        preferencesLoaded: true,
        routeNames: ["Home"],
        index: 0,
      }),
    ).toBe(false);
  });

  it("takes over Home after an automatic last-thread restore pushed Thread", () => {
    expect(
      shouldApplyFirstScreenRoute({
        route: cards,
        preferencesLoaded: true,
        routeNames: ["Home", "Thread"],
        index: 1,
      }),
    ).toBe(true);
  });

  it("reclaims cards when a late restore pushes Thread onto the card stream", () => {
    expect(
      shouldApplyFirstScreenRoute({
        route: cards,
        preferencesLoaded: true,
        routeNames: ["CardsHome", "Thread"],
        index: 1,
      }),
    ).toBe(true);
    expect(
      shouldApplyFirstScreenRoute({
        route: cards,
        preferencesLoaded: true,
        routeNames: ["Web", "Thread"],
        index: 1,
      }),
    ).toBe(true);
  });

  it("never redirects a deep link or notification that already navigated", () => {
    expect(
      shouldApplyFirstScreenRoute({
        inboundLaunchTarget: true,
        route: cards,
        preferencesLoaded: true,
        routeNames: ["Home", "Thread"],
        index: 1,
      }),
    ).toBe(false);
    expect(
      shouldApplyFirstScreenRoute({
        inboundLaunchTarget: true,
        route: cards,
        preferencesLoaded: true,
        routeNames: ["Web", "Thread"],
        index: 1,
      }),
    ).toBe(false);
    expect(
      shouldApplyFirstScreenRoute({
        route: cards,
        preferencesLoaded: true,
        routeNames: ["Thread"],
        index: 0,
      }),
    ).toBe(false);
    expect(
      shouldApplyFirstScreenRoute({
        route: cards,
        preferencesLoaded: true,
        routeNames: ["Web", "Home"],
        index: 1,
      }),
    ).toBe(false);
    expect(
      shouldApplyFirstScreenRoute({
        route: cards,
        preferencesLoaded: true,
        routeNames: ["Web", "Home", "Thread"],
        index: 2,
      }),
    ).toBe(false);
    expect(
      shouldApplyFirstScreenRoute({
        route: cards,
        preferencesLoaded: true,
        routeNames: ["CardsHome", "Home"],
        index: 1,
      }),
    ).toBe(false);
    expect(
      shouldApplyFirstScreenRoute({
        route: cards,
        preferencesLoaded: true,
        routeNames: ["CardsHome", "Home", "Thread"],
        index: 2,
      }),
    ).toBe(false);
  });

  it("fires once: the stack it produced is not a launch stack", () => {
    expect(
      shouldApplyFirstScreenRoute({
        route: cards,
        preferencesLoaded: true,
        routeNames: ["CardsHome"],
        index: 0,
      }),
    ).toBe(false);
    expect(
      shouldApplyFirstScreenRoute({
        route: cards,
        preferencesLoaded: true,
        routeNames: ["Web"],
        index: 0,
      }),
    ).toBe(false);
  });
});

describe("describeFirstScreenDecision", () => {
  const cards = resolveFirstScreenRoute({ cardsFirstScreenEnabled: true });
  const threads = resolveFirstScreenRoute({ cardsFirstScreenEnabled: false });

  it("names every skip the gate can hit on a real device", () => {
    expect(
      describeFirstScreenDecision({
        route: cards,
        preferencesLoaded: false,
        routeNames: ["Home"],
        index: 0,
      }),
    ).toEqual({ decision: "skip", reason: "preferences_not_loaded" });
    expect(
      describeFirstScreenDecision({
        route: threads,
        preferencesLoaded: true,
        routeNames: ["Home"],
        index: 0,
      }),
    ).toEqual({ decision: "skip", reason: "cards_first_disabled" });
    expect(
      describeFirstScreenDecision({
        inboundLaunchTarget: true,
        route: cards,
        preferencesLoaded: true,
        routeNames: ["Home"],
        index: 0,
      }),
    ).toEqual({ decision: "skip", reason: "inbound_launch_target" });
    expect(
      describeFirstScreenDecision({
        route: cards,
        preferencesLoaded: true,
        routeNames: ["Thread"],
        index: 0,
      }),
    ).toEqual({ decision: "skip", reason: "inbound_thread_only_stack" });
    expect(
      describeFirstScreenDecision({
        route: cards,
        preferencesLoaded: true,
        routeNames: ["Web"],
        index: 0,
      }),
    ).toEqual({ decision: "skip", reason: "not_a_launch_stack" });
    expect(
      describeFirstScreenDecision({
        route: cards,
        preferencesLoaded: true,
        routeNames: ["CardsHome"],
        index: 0,
      }),
    ).toEqual({ decision: "skip", reason: "not_a_launch_stack" });
  });

  it("names the two apply shapes", () => {
    expect(
      describeFirstScreenDecision({
        route: cards,
        preferencesLoaded: true,
        routeNames: ["Home"],
        index: 0,
      }),
    ).toEqual({ decision: "apply", reason: "untouched_home" });
    expect(
      describeFirstScreenDecision({
        route: cards,
        preferencesLoaded: true,
        routeNames: ["Home", "Thread"],
        index: 1,
      }),
    ).toEqual({ decision: "apply", reason: "restored_thread" });
    expect(
      describeFirstScreenDecision({
        route: cards,
        preferencesLoaded: true,
        routeNames: ["CardsHome", "Thread"],
        index: 1,
      }),
    ).toEqual({ decision: "apply", reason: "restored_thread" });
  });
});

describe("buildFirstScreenGateRecord", () => {
  it("is the host-pullable shape: routeNames and decision always present", () => {
    const record = buildFirstScreenGateRecord({
      at: "2026-09-03T07:15:00.000Z",
      cardsFirstScreenEnabled: true,
      inboundLaunchTarget: false,
      index: 0,
      preferencesLoaded: true,
      routeNames: ["Home"],
    });
    expect(record.routeNames).toEqual(["Home"]);
    expect(record.decision).toBe("apply");
    expect(record.reason).toBe("untouched_home");
    expect(record.willDispatch).toBe(true);
    expect(record.focusedRouteName).toBe("Home");
    expect(record.at).toBe("2026-09-03T07:15:00.000Z");
  });

  it("records a skip without claiming a dispatch", () => {
    const record = buildFirstScreenGateRecord({
      at: "2026-09-03T07:15:00.000Z",
      cardsFirstScreenEnabled: true,
      inboundLaunchTarget: true,
      index: 0,
      preferencesLoaded: true,
      routeNames: ["Home"],
    });
    expect(record.decision).toBe("skip");
    expect(record.reason).toBe("inbound_launch_target");
    expect(record.willDispatch).toBe(false);
  });
});

describe("isPhoneCardsLandingPath", () => {
  it("matches the stream, query string included", () => {
    expect(isPhoneCardsLandingPath("/phone-cards")).toBe(true);
    expect(isPhoneCardsLandingPath("/phone-cards?environmentId=1")).toBe(true);
  });

  it("does not match a single card or another phone page", () => {
    expect(isPhoneCardsLandingPath("/phone-cards/thread-1")).toBe(false);
    expect(isPhoneCardsLandingPath("/gov/deck/harvest-deck.html")).toBe(false);
    expect(isPhoneCardsLandingPath("/")).toBe(false);
  });
});

describe("inbound launch target", () => {
  afterEach(() => {
    resetInboundLaunchTarget();
  });

  it("starts unset and is sticky once marked", () => {
    expect(hasInboundLaunchTarget()).toBe(false);
    markInboundLaunchTarget();
    expect(hasInboundLaunchTarget()).toBe(true);
    markInboundLaunchTarget();
    expect(hasInboundLaunchTarget()).toBe(true);
  });
});

describe("buildFirstScreenResetRootState", () => {
  it("resets the container root to CardsHome with the stream path", () => {
    expect(
      buildFirstScreenResetRootState(resolveFirstScreenRoute({ cardsFirstScreenEnabled: true })),
    ).toEqual({
      index: 0,
      routes: [{ name: "CardsHome", params: { path: PHONE_CARDS_PATH } }],
    });
  });

  it("resets the container root to Home when cards-first is off", () => {
    expect(
      buildFirstScreenResetRootState(resolveFirstScreenRoute({ cardsFirstScreenEnabled: false })),
    ).toEqual({
      index: 0,
      routes: [{ name: "Home" }],
    });
  });
});

describe("snapshotNavigationRootState", () => {
  it("reads the live stack from routes, not the registered routeNames table", () => {
    expect(
      snapshotNavigationRootState({
        index: 0,
        routeNames: ["Home", "CardsHome", "Thread"],
        routes: [{ name: "CardsHome" }],
      }),
    ).toEqual({ routeNames: ["CardsHome"], index: 0 });
  });

  it("marks a missing root as empty so a failed reset is not a fake 100%", () => {
    expect(snapshotNavigationRootState(undefined)).toEqual({ routeNames: [], index: -1 });
  });
});

describe("buildAfterDispatchGateRecord", () => {
  it("is the host-pullable follow-up: reason after_dispatch, willDispatch false", () => {
    const record = buildAfterDispatchGateRecord({
      at: "2026-09-03T07:52:00.000Z",
      cardsFirstScreenEnabled: true,
      inboundLaunchTarget: false,
      preferencesLoaded: true,
      rootState: {
        index: 0,
        routes: [{ name: "CardsHome" }],
      },
    });
    expect(record.reason).toBe("after_dispatch");
    expect(record.decision).toBe("apply");
    expect(record.willDispatch).toBe(false);
    expect(record.routeNames).toEqual(["CardsHome"]);
    expect(record.index).toBe(0);
    expect(record.focusedRouteName).toBe("CardsHome");
    expect(record.at).toBe("2026-09-03T07:52:00.000Z");
  });

  it("records an empty stack when getRootState had nothing", () => {
    const record = buildAfterDispatchGateRecord({
      at: "2026-09-03T07:52:00.000Z",
      cardsFirstScreenEnabled: true,
      inboundLaunchTarget: false,
      preferencesLoaded: true,
      rootState: undefined,
    });
    expect(record.reason).toBe("after_dispatch");
    expect(record.routeNames).toEqual([]);
    expect(record.index).toBe(-1);
    expect(record.focusedRouteName).toBe(null);
    expect(record.willDispatch).toBe(false);
  });
});

describe("subscribeWhenReady", () => {
  it("runs onReady now when the container is already ready", () => {
    const calls: string[] = [];
    const unsubscribe = subscribeWhenReady({
      addListener: () => {
        calls.push("listen");
        return () => {
          calls.push("unlisten");
        };
      },
      isReady: () => true,
      onReady: () => {
        calls.push("ready");
      },
    });
    expect(calls).toEqual(["ready"]);
    unsubscribe();
    expect(calls).toEqual(["ready"]);
  });

  it("waits for the ready event and does not drop the callback", () => {
    const calls: string[] = [];
    let listener: (() => void) | undefined;
    const unsubscribe = subscribeWhenReady({
      addListener: (onReady) => {
        listener = onReady;
        return () => {
          calls.push("unlisten");
          listener = undefined;
        };
      },
      isReady: () => false,
      onReady: () => {
        calls.push("ready");
      },
    });
    expect(calls).toEqual([]);
    listener?.();
    expect(calls).toEqual(["unlisten", "ready"]);
    listener?.();
    expect(calls).toEqual(["unlisten", "ready"]);
    unsubscribe();
  });

  it("runs onReady once if the container becomes ready between the check and the listener", () => {
    const calls: string[] = [];
    let ready = false;
    subscribeWhenReady({
      addListener: (onReady) => {
        ready = true;
        onReady();
        return () => {
          calls.push("unlisten");
        };
      },
      isReady: () => ready,
      onReady: () => {
        calls.push("ready");
      },
    });
    expect(calls.filter((call) => call === "ready")).toEqual(["ready"]);
    expect(calls).toContain("unlisten");
  });

  it("does not run onReady after unsubscribe", () => {
    const calls: string[] = [];
    let listener: (() => void) | undefined;
    const unsubscribe = subscribeWhenReady({
      addListener: (onReady) => {
        listener = onReady;
        return () => {
          calls.push("unlisten");
        };
      },
      isReady: () => false,
      onReady: () => {
        calls.push("ready");
      },
    });
    unsubscribe();
    listener?.();
    expect(calls).toEqual(["unlisten"]);
  });
});
