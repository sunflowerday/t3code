import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";

import { mobilePreferencesAtom } from "../../state/preferences";
import { resolveCardsFirstScreenEnabled, resolveFirstScreenRoute } from "./firstScreen";

/**
 * Resolved cards-first state. Consumers must read through this rather than the
 * raw preference, which is undefined until the device has explicitly chosen.
 * `preferencesLoaded` is exposed for the launch gate, which must not act before
 * a stored opt-out has had a chance to arrive.
 */
export function useCardsFirstScreen(): {
  readonly cardsFirstScreenEnabled: boolean;
  readonly preferencesLoaded: boolean;
} {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const preferencesLoaded = AsyncResult.isSuccess(preferencesResult);
  const cardsFirstScreenEnabled = resolveCardsFirstScreenEnabled({
    preference: preferencesLoaded ? preferencesResult.value.cardsFirstScreenEnabled : undefined,
    preferencesLoaded,
  });
  return { cardsFirstScreenEnabled, preferencesLoaded };
}

/** Where the app should open: the card stream, or the thread list. */
export function useFirstScreenRoute(): ReturnType<typeof resolveFirstScreenRoute> {
  const { cardsFirstScreenEnabled } = useCardsFirstScreen();
  return resolveFirstScreenRoute({ cardsFirstScreenEnabled });
}
