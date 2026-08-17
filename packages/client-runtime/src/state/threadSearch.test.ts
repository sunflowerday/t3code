import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type OrchestrationSearchThreadsResult,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { expect, it } from "vite-plus/test";

import {
  createThreadSearchResultsAtomFamily,
  inspectThreadSearchQuery,
  makeThreadSearchKey,
  resolveThreadSearchRequest,
  threadSearchMatchKey,
} from "./threadSearch.ts";

const envA = EnvironmentId.make("env-a");
const envB = EnvironmentId.make("env-b");

it("creates stable keys regardless of environment order", () => {
  expect(makeThreadSearchKey([envB, envA], "needle")).toBe(
    makeThreadSearchKey([envA, envB], "needle"),
  );
});

it("accepts contract-valid search queries and rejects the 200-character ceiling", () => {
  expect(inspectThreadSearchQuery("ab")).toBe("ok");
  expect(inspectThreadSearchQuery("  needle  ")).toBe("ok");
  expect(inspectThreadSearchQuery("x")).toBe("too-short");
  expect(inspectThreadSearchQuery("x".repeat(200))).toBe("ok");
  expect(inspectThreadSearchQuery("x".repeat(201))).toBe("too-long");
});

it("does not build a search key for over-limit user input", () => {
  expect(resolveThreadSearchRequest([envA], "x".repeat(201))).toEqual({
    key: null,
    queryIssue: "too-long",
  });
  expect(resolveThreadSearchRequest([envA], "needle").key).toBe(
    makeThreadSearchKey([envA], "needle"),
  );
  expect(resolveThreadSearchRequest([], "needle")).toEqual({
    key: null,
    queryIssue: null,
  });
});

it("encodes scoped thread keys without delimiter collisions", () => {
  const first = threadSearchMatchKey({
    environmentId: EnvironmentId.make("env\u0000thread"),
    threadId: ThreadId.make("id"),
  });
  const second = threadSearchMatchKey({
    environmentId: EnvironmentId.make("env"),
    threadId: ThreadId.make("thread\u0000id"),
  });

  expect(first).not.toBe(second);
});

it("still throws when an over-limit query is forced into the atom key", () => {
  const searchAtom = createThreadSearchResultsAtomFamily<Error>({
    getSearchAtom: () => Atom.make(AsyncResult.success({ matches: [] })),
    labelPrefix: "test:thread-search",
  });
  const registry = AtomRegistry.make();

  expect(() =>
    registry.get(searchAtom(JSON.stringify([[envA], "x".repeat(201)]))),
  ).toThrow();

  registry.dispose();
});

it("merges successful environments and silently ignores failures", () => {
  const result: OrchestrationSearchThreadsResult = {
    matches: [
      {
        threadId: ThreadId.make("thread-a"),
        projectId: ProjectId.make("project-a"),
        source: "user",
        snippet: "needle",
        messageCreatedAt: "2026-07-30T00:00:00.000Z",
      },
    ],
  };
  const searchAtom = createThreadSearchResultsAtomFamily<Error>({
    getSearchAtom: (environmentId) =>
      environmentId === envA
        ? Atom.make(AsyncResult.success(result))
        : Atom.make(
            AsyncResult.failure<OrchestrationSearchThreadsResult, Error>(
              Cause.fail(new Error("unsupported rpc")),
            ),
          ),
    labelPrefix: "test:thread-search",
  });
  const registry = AtomRegistry.make();

  const state = registry.get(searchAtom(makeThreadSearchKey([envB, envA], "needle")));
  expect(state).toEqual({
    matches: [{ ...result.matches[0], environmentId: envA }],
    isLoading: false,
  });
  expect(threadSearchMatchKey(state.matches[0]!)).toBe('["env-a","thread-a"]');

  registry.dispose();
});
