import {
  EnvironmentId,
  OrchestrationSearchThreadsInput,
  type OrchestrationSearchThreadsResult,
  type OrchestrationThreadSearchMatch,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

export interface EnvironmentThreadSearchMatch extends OrchestrationThreadSearchMatch {
  readonly environmentId: EnvironmentId;
}

export interface ThreadSearchResultsState {
  readonly matches: ReadonlyArray<EnvironmentThreadSearchMatch>;
  readonly isLoading: boolean;
}

const ThreadSearchKey = Schema.Tuple([
  Schema.Array(EnvironmentId),
  OrchestrationSearchThreadsInput.fields.query,
]);
const decodeThreadSearchKey = Schema.decodeUnknownSync(ThreadSearchKey);
const decodeThreadSearchQuery = Schema.decodeUnknownOption(
  OrchestrationSearchThreadsInput.fields.query,
);

export type ThreadSearchQueryIssue = "too-short" | "too-long";

export function inspectThreadSearchQuery(query: string): "ok" | ThreadSearchQueryIssue {
  if (Option.isSome(decodeThreadSearchQuery(query))) {
    return "ok";
  }
  return query.trim().length < 2 ? "too-short" : "too-long";
}

export function resolveThreadSearchRequest(
  environmentIds: ReadonlyArray<EnvironmentId>,
  query: string,
): {
  readonly key: string | null;
  readonly queryIssue: Extract<ThreadSearchQueryIssue, "too-long"> | null;
} {
  const inspection = inspectThreadSearchQuery(query);
  if (inspection === "too-long") {
    return { key: null, queryIssue: "too-long" };
  }
  if (environmentIds.length === 0 || inspection !== "ok") {
    return { key: null, queryIssue: null };
  }
  return { key: makeThreadSearchKey(environmentIds, query.trim()), queryIssue: null };
}

export function makeThreadSearchKey(
  environmentIds: ReadonlyArray<EnvironmentId>,
  query: string,
): string {
  return JSON.stringify([
    [...environmentIds].toSorted((left, right) => left.localeCompare(right)),
    query,
  ]);
}

function parseThreadSearchKey(key: string) {
  return decodeThreadSearchKey(JSON.parse(key));
}

export function threadSearchMatchKey(
  match: Pick<EnvironmentThreadSearchMatch, "environmentId" | "threadId">,
): string {
  return JSON.stringify([match.environmentId, match.threadId]);
}

/**
 * Combines one search query atom per environment. Failed and disconnected
 * environments contribute no content matches, preserving local title search
 * as the compatibility fallback.
 */
export function createThreadSearchResultsAtomFamily<E>(options: {
  readonly getSearchAtom: (
    environmentId: EnvironmentId,
    query: string,
  ) => Atom.Atom<AsyncResult.AsyncResult<OrchestrationSearchThreadsResult, E>>;
  readonly labelPrefix: string;
}) {
  return Atom.family((key: string) =>
    Atom.make((get): ThreadSearchResultsState => {
      const [environmentIds, query] = parseThreadSearchKey(key);
      const matches: EnvironmentThreadSearchMatch[] = [];
      let isLoading = false;

      for (const environmentId of environmentIds) {
        const result = get(options.getSearchAtom(environmentId, query));
        isLoading ||= result.waiting;
        const value = Option.getOrNull(AsyncResult.value(result));
        if (value !== null) {
          matches.push(
            ...value.matches.map((match) => ({
              ...match,
              environmentId,
            })),
          );
        }
      }

      return { matches, isLoading };
    }).pipe(Atom.withLabel(`${options.labelPrefix}:${key}`)),
  );
}
