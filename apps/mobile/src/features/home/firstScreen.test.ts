import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  PHONE_CARDS_PATH,
  isPhoneCardsLandingPath,
  resolveCardsFirstScreenEnabled,
  resolveFirstScreenRoute,
  shouldApplyFirstScreenRoute,
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
      name: "Web",
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
  });

  it("fires once: the stack it produced is not a launch stack", () => {
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
