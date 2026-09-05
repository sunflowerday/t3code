import { describe, expect, it } from "@effect/vitest";
import type { ConnectionCatalogEntry } from "@t3tools/client-runtime/connection";
import type { EnvironmentCatalogState } from "@t3tools/client-runtime/state/connections";
import { createEnvironmentThreadShellAtoms } from "@t3tools/client-runtime/state/threads";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationSessionStatus,
  type OrchestrationShellSnapshot,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

import { createThreadOutboxManager } from "./thread-outbox-manager";
import {
  flattenQueuedThreadMessages,
  MISSING_THREAD_OUTBOX_FAILURE_REASON,
  parkUndeliverableThreadOutboxMessage,
  resolveThreadOutboxDrainEvaluation,
  THREAD_OUTBOX_WAIT_RETRY_DELAY_MS,
  type QueuedThreadMessage,
  type ThreadOutboxDrainEvaluation,
} from "./thread-outbox-model";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const THREAD_ID = ThreadId.make("thread-1");

/**
 * The inputs the drain read on device 2026-09-03 03:35: the server had just
 * been restarted, the app had reconnected (`connectionState: connected`), and
 * the shell was still `synchronizing` over a thread session stuck at
 * `starting`, while the server's projection already said `ready`.
 */
const FROZEN_AFTER_RESTART: Parameters<typeof resolveThreadOutboxDrainEvaluation>[0] = {
  isCreation: false,
  threadExists: true,
  shellStatus: "synchronizing",
  environmentConnected: true,
  threadSessionStatus: "starting",
  connectionState: "connected",
};

function evaluate(
  overrides: Partial<Parameters<typeof resolveThreadOutboxDrainEvaluation>[0]> = {},
): ThreadOutboxDrainEvaluation {
  return resolveThreadOutboxDrainEvaluation({ ...FROZEN_AFTER_RESTART, ...overrides });
}

function shellSnapshot(
  sessionStatus: OrchestrationSessionStatus | null,
): OrchestrationShellSnapshot {
  const thread: OrchestrationThreadShell = {
    id: THREAD_ID,
    projectId: ProjectId.make("project-1"),
    title: "Restart repro",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-09-03T03:35:00.000Z",
    updatedAt: "2026-09-03T03:35:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session:
      sessionStatus === null
        ? null
        : {
            threadId: THREAD_ID,
            status: sessionStatus,
            providerName: "codex",
            runtimeMode: DEFAULT_RUNTIME_MODE,
            activeTurnId: null,
            lastError: null,
            updatedAt: "2026-09-03T03:35:00.000Z",
          },
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
  return {
    snapshotSequence: 1,
    projects: [],
    threads: [thread],
    updatedAt: "2026-09-03T03:35:00.000Z",
  };
}

describe("thread outbox drain re-evaluation", () => {
  it("arms a bounded re-evaluation for a message the pass decided to wait on", () => {
    const evaluation = evaluate();

    expect(evaluation.deliveryAction).toBe("wait");
    // Without this the message only moves again if an unrelated atom happens
    // to change, which is what stranded it for three minutes on device.
    expect(evaluation.waitRetryDelayMs).toBe(THREAD_OUTBOX_WAIT_RETRY_DELAY_MS);
  });

  it("still arms a re-evaluation while a real turn keeps the thread busy", () => {
    const evaluation = evaluate({ shellStatus: "live", threadSessionStatus: "running" });

    expect(evaluation.deliveryAction).toBe("wait");
    expect(evaluation.waitRetryDelayMs).toBe(THREAD_OUTBOX_WAIT_RETRY_DELAY_MS);
  });

  it("reports the inputs that blocked delivery", () => {
    expect(evaluate().report).toEqual({
      deliveryAction: "wait",
      isCreation: false,
      threadExists: true,
      shellStatus: "synchronizing",
      connectionState: "connected",
      threadSessionStatus: "starting",
    });
  });

  it("sends on the first pass where the shell is live and the session is ready", () => {
    const settled = evaluate({ shellStatus: "live", threadSessionStatus: "ready" });

    expect(settled.deliveryAction).toBe("send");
    expect(settled.waitRetryDelayMs).toBeNull();
  });

  it("waits for a thread that is not in the loaded shell list until the shell is live", () => {
    const missing = evaluate({ threadExists: false });

    expect(missing.deliveryAction).toBe("wait");
    expect(missing.waitRetryDelayMs).toBe(THREAD_OUTBOX_WAIT_RETRY_DELAY_MS);
    // A live shell plus a missing thread is a real failure, not a stall — and
    // not a removal either: see the outbox test below for what happens to the
    // message itself.
    expect(evaluate({ threadExists: false, shellStatus: "live" }).deliveryAction).toBe("fail");
  });
});

describe("thread outbox drain for a thread the shell no longer lists", () => {
  const message: QueuedThreadMessage = {
    environmentId: ENVIRONMENT_ID,
    threadId: THREAD_ID,
    messageId: MessageId.make("message-1"),
    commandId: CommandId.make("command-1"),
    text: "把刚才那段改回去",
    attachments: [],
    createdAt: "2026-09-05T09:00:00.000Z",
  };

  /**
   * The user's own text must survive a thread that is gone. Before this, the
   * drain removed the entry and reported it as delivered, so the message left
   * the queue exactly the way a sent one does and nothing reached the screen.
   */
  it("leaves the message queued with a reason on screen instead of deleting it", async () => {
    const registry = AtomRegistry.make();
    const persisted = new Map<MessageId, QueuedThreadMessage>();
    const manager = createThreadOutboxManager({
      registry,
      storage: {
        load: async () => [],
        write: async (written) => {
          persisted.set(written.messageId, written);
        },
        remove: async (removed) => {
          persisted.delete(removed.messageId);
        },
      },
    });
    const queuedMessages = (): ReadonlyArray<QueuedThreadMessage> =>
      flattenQueuedThreadMessages(registry.get(manager.queuedMessagesByThreadKeyAtom));

    await manager.enqueue(message);
    expect(queuedMessages()).toHaveLength(1);

    // Run the same dispatch the drain runs, driven by the same decision: only a
    // `fail` parks, and any decision that goes back to removing empties the
    // queue the assertions below read.
    const { deliveryAction } = evaluate({ threadExists: false, shellStatus: "live" });
    const surfaced: string[] = [];
    if (deliveryAction === "fail") {
      await parkUndeliverableThreadOutboxMessage(message, MISSING_THREAD_OUTBOX_FAILURE_REASON, {
        update: (parked) => manager.update(parked),
        surfaceError: (reason) => {
          surfaced.push(reason);
        },
      });
    } else if (deliveryAction === "remove") {
      await manager.remove(message);
    }

    const queued = queuedMessages();
    expect(queued).toHaveLength(1);
    expect(queued[0]?.text).toBe(message.text);
    expect(queued[0]?.failureReason).toBe(MISSING_THREAD_OUTBOX_FAILURE_REASON);
    // Survives a relaunch: the reason is in the durable copy too.
    expect(persisted.get(message.messageId)?.failureReason).toBe(
      MISSING_THREAD_OUTBOX_FAILURE_REASON,
    );
    // And the user is told, rather than watching the message disappear.
    expect(surfaced).toEqual([MISSING_THREAD_OUTBOX_FAILURE_REASON]);
    registry.dispose();
  });

  it("says what happened and what to do without naming anything internal", () => {
    expect(MISSING_THREAD_OUTBOX_FAILURE_REASON).not.toMatch(
      /threadExists|shellStatus|outbox|thread|shell/i,
    );
    expect(MISSING_THREAD_OUTBOX_FAILURE_REASON.length).toBeGreaterThan(0);
  });
});

describe("thread outbox drain store inputs", () => {
  it("re-evaluates from changed thread shells when a session status moves in the store", () => {
    const registry = AtomRegistry.make();
    const snapshotAtom = Atom.make<OrchestrationShellSnapshot | null>(shellSnapshot("starting"));
    // The thread shell atoms only read `entries.keys()`; the entry itself is
    // never touched, so a placeholder stands in for the catalog row.
    const catalogAtom = Atom.make<EnvironmentCatalogState>({
      isReady: true,
      entries: new Map<EnvironmentId, ConnectionCatalogEntry>([
        [ENVIRONMENT_ID, null as unknown as ConnectionCatalogEntry],
      ]),
    });
    const threadShells = createEnvironmentThreadShellAtoms({
      catalogValueAtom: catalogAtom,
      snapshotAtom: () => snapshotAtom,
    });

    const before = registry.get(threadShells.threadShellsAtom);
    expect(before[0]?.session?.status).toBe("starting");
    expect(evaluate({ threadSessionStatus: "starting" }).deliveryAction).toBe("wait");

    registry.set(snapshotAtom, shellSnapshot("ready"));

    const after = registry.get(threadShells.threadShellsAtom);
    expect(after[0]?.session?.status).toBe("ready");
    // Identity, not just content: the drain hook depends on this array, so a
    // new reference is what makes its effect run again without a relaunch.
    expect(after).not.toBe(before);
    expect(evaluate({ shellStatus: "live", threadSessionStatus: "ready" }).deliveryAction).toBe(
      "send",
    );
  });
});
