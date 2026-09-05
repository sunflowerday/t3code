import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type MessageId,
} from "@t3tools/contracts";
import { buildTemporaryWorktreeBranchName } from "@t3tools/shared/git";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback, useEffect, useRef, useState } from "react";

import { scopedThreadKey } from "../lib/scopedEntities";
import { buildProjectThreadStartTurnInput } from "../lib/projectThreadStartTurn";
import { toUploadChatImageAttachments } from "../lib/composerImages";
import { randomHex } from "../lib/uuid";
import { appAtomRegistry } from "./atom-registry";
import { useProjects, useThreadShells } from "./entities";
import {
  confirmThreadOutboxMessageQueued,
  ensureThreadOutboxLoaded,
  removeThreadOutboxMessage,
  updateThreadOutboxMessage,
} from "./thread-outbox";
import { automationNote } from "../features/automation/automationLink";
import { describeCauseMessage, presentUserFacingError } from "../lib/userFacingError";
import {
  isQueuedThreadCreationSendable,
  isThreadOutboxSessionBusy,
  MISSING_THREAD_OUTBOX_FAILURE_REASON,
  modelSelectionsEqual,
  parkUndeliverableThreadOutboxMessage,
  resolveThreadOutboxDrainEvaluation,
  resolveThreadOutboxFailureAction,
  resolveQueuedThreadSettings,
  threadOutboxRetryDelayMs,
  THREAD_OUTBOX_WAIT_RETRY_DELAY_MS,
  type QueuedThreadCreation,
  type QueuedThreadMessage,
  type ThreadOutboxCommandStage,
  type ThreadOutboxFailureAction,
} from "./thread-outbox-model";
import { environmentThreadShells, threadEnvironment } from "./threads";
import { useAtomCommand } from "./use-atom-command";
import {
  editingQueuedMessageIdsAtom,
  useThreadOutboxMessages,
  useThreadOutboxShellStatuses,
} from "./use-thread-outbox";
import {
  setPendingConnectionError,
  useRemoteConnectionStatus,
} from "./use-remote-environment-registry";

export const dispatchingQueuedMessageIdAtom = Atom.make<MessageId | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:thread-outbox:dispatching-message-id"),
);

/**
 * `delivered`: the turn reached the server and the queue entry was removed.
 * `retry`: a transient failure — keep the entry and re-attempt on backoff.
 * `failed`: the server explicitly rejected the turn — keep the entry parked
 * with its reason so the user can see and act on it; no further auto-retry.
 */
type ThreadOutboxDeliveryOutcome = "delivered" | "retry" | "failed";

function beginDispatchingQueuedMessage(queuedMessageId: MessageId): void {
  appAtomRegistry.set(dispatchingQueuedMessageIdAtom, queuedMessageId);
}

function finishDispatchingQueuedMessage(queuedMessageId: MessageId): void {
  const current = appAtomRegistry.get(dispatchingQueuedMessageIdAtom);
  appAtomRegistry.set(dispatchingQueuedMessageIdAtom, current === queuedMessageId ? null : current);
}

function findThread(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  message: QueuedThreadMessage,
): EnvironmentThreadShell | undefined {
  return threads.find(
    (candidate) =>
      candidate.environmentId === message.environmentId && candidate.id === message.threadId,
  );
}

function findCreationProject(
  projects: ReadonlyArray<EnvironmentProject>,
  message: QueuedThreadMessage,
): EnvironmentProject | undefined {
  return projects.find(
    (candidate) =>
      candidate.environmentId === message.environmentId &&
      candidate.id === message.creation?.projectId,
  );
}

function settingsCommandId(message: QueuedThreadMessage, setting: string): CommandId {
  return CommandId.make(`${message.commandId}:${setting}`);
}

export function useThreadOutboxDrain(): void {
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const setThreadRuntimeMode = useAtomCommand(threadEnvironment.setRuntimeMode, {
    reportFailure: false,
  });
  const setThreadInteractionMode = useAtomCommand(threadEnvironment.setInteractionMode, {
    reportFailure: false,
  });
  const dispatchingQueuedMessageId = useAtomValue(dispatchingQueuedMessageIdAtom);
  const editingQueuedMessageIds = useAtomValue(editingQueuedMessageIdsAtom);
  const queuedMessagesByThreadKey = useThreadOutboxMessages();
  const shellStatuses = useThreadOutboxShellStatuses();
  const threads = useThreadShells();
  const projects = useProjects();
  const { connectedEnvironments } = useRemoteConnectionStatus();
  const [retryTick, setRetryTick] = useState(0);
  const retryAttemptRef = useRef(new Map<MessageId, number>());
  const retryNotBeforeRef = useRef(new Map<MessageId, number>());
  const retryTimersRef = useRef(new Map<MessageId, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    ensureThreadOutboxLoaded();
    return () => {
      for (const timer of retryTimersRef.current.values()) {
        clearTimeout(timer);
      }
      retryTimersRef.current.clear();
    };
  }, []);

  const makeDeliveryHelpers = useCallback((queuedMessage: QueuedThreadMessage) => {
    const reportFailure = (
      commandResult: AtomCommandResult<unknown, unknown>,
      stage: ThreadOutboxCommandStage,
    ): ThreadOutboxFailureAction | "success" => {
      if (!AsyncResult.isFailure(commandResult)) {
        return "success";
      }
      const error = Cause.squash(commandResult.cause);
      const action = resolveThreadOutboxFailureAction({
        stage,
        error,
        interrupted: Cause.hasInterruptsOnly(commandResult.cause),
      });
      automationNote("outbox-failure", {
        environmentId: queuedMessage.environmentId,
        threadId: queuedMessage.threadId,
        messageId: queuedMessage.messageId,
        stage,
        action,
        cause: String(error),
        pretty: Cause.pretty(commandResult.cause).slice(0, 2000),
      });
      console.warn("[thread-outbox] queued message delivery failed", {
        environmentId: queuedMessage.environmentId,
        threadId: queuedMessage.threadId,
        messageId: queuedMessage.messageId,
        stage,
        cause: commandResult.cause,
        action,
      });
      if (action === "fail") {
        // Park the rejected turn instead of discarding it: keep it queued with
        // the server's own sentence and surface that sentence, so the message
        // neither vanishes silently nor hammers the server on repeat backoff.
        const reason = presentUserFacingError(
          describeCauseMessage(commandResult.cause),
          "The environment rejected this message.",
        );
        void updateThreadOutboxMessage({ ...queuedMessage, failureReason: reason });
        setPendingConnectionError(reason);
      }
      return action;
    };
    const completeDelivery = async (
      deliveryResult: AtomCommandResult<unknown, unknown>,
    ): Promise<ThreadOutboxDeliveryOutcome> => {
      const action = reportFailure(deliveryResult, "start-turn");
      if (action === "retry") {
        return "retry";
      }
      if (action === "fail") {
        return "failed";
      }

      try {
        await removeThreadOutboxMessage(queuedMessage);
        return "delivered";
      } catch (error) {
        console.warn("[thread-outbox] failed to remove delivered queued message", {
          environmentId: queuedMessage.environmentId,
          threadId: queuedMessage.threadId,
          messageId: queuedMessage.messageId,
          error,
        });
        return "retry";
      }
    };
    return { reportFailure, completeDelivery };
  }, []);

  // A `wait` is the one delivery decision that produces no follow-up: a failed
  // send gets a backoff timer, a wait got nothing, so any state transition the
  // atom store never learns about left the message queued until relaunch. Arm a
  // single re-evaluation pass instead, and let the drain deps short-circuit it
  // whenever shell, thread or connection state does move.
  const armWaitReEvaluation = useCallback((queuedMessageId: MessageId, delayMs: number | null) => {
    if (delayMs === null || retryTimersRef.current.has(queuedMessageId)) {
      return;
    }
    const timer = setTimeout(() => {
      retryTimersRef.current.delete(queuedMessageId);
      setRetryTick((current) => current + 1);
    }, delayMs);
    retryTimersRef.current.set(queuedMessageId, timer);
  }, []);

  const sendQueuedMessage = useCallback(
    async (
      queuedMessage: QueuedThreadMessage,
      thread: EnvironmentThreadShell,
    ): Promise<ThreadOutboxDeliveryOutcome> => {
      const settings = resolveQueuedThreadSettings(queuedMessage, thread);
      const { reportFailure, completeDelivery } = makeDeliveryHelpers(queuedMessage);

      if (!modelSelectionsEqual(settings.modelSelection, thread.modelSelection)) {
        const updateResult = await updateThreadMetadata({
          environmentId: queuedMessage.environmentId,
          input: {
            commandId: settingsCommandId(queuedMessage, "model-selection"),
            threadId: queuedMessage.threadId,
            modelSelection: settings.modelSelection,
          },
        });
        if (AsyncResult.isFailure(updateResult)) {
          const action = reportFailure(updateResult, "settings-sync");
          return action === "fail" ? "failed" : "retry";
        }
      }

      if (settings.runtimeMode !== thread.runtimeMode) {
        const runtimeResult = await setThreadRuntimeMode({
          environmentId: queuedMessage.environmentId,
          input: {
            commandId: settingsCommandId(queuedMessage, "runtime-mode"),
            threadId: queuedMessage.threadId,
            runtimeMode: settings.runtimeMode,
            createdAt: queuedMessage.createdAt,
          },
        });
        if (AsyncResult.isFailure(runtimeResult)) {
          const action = reportFailure(runtimeResult, "settings-sync");
          return action === "fail" ? "failed" : "retry";
        }
      }

      if (settings.interactionMode !== thread.interactionMode) {
        const interactionResult = await setThreadInteractionMode({
          environmentId: queuedMessage.environmentId,
          input: {
            commandId: settingsCommandId(queuedMessage, "interaction-mode"),
            threadId: queuedMessage.threadId,
            interactionMode: settings.interactionMode,
            createdAt: queuedMessage.createdAt,
          },
        });
        if (AsyncResult.isFailure(interactionResult)) {
          const action = reportFailure(interactionResult, "settings-sync");
          return action === "fail" ? "failed" : "retry";
        }
      }

      const deliveryResult = await startTurn({
        environmentId: queuedMessage.environmentId,
        input: {
          commandId: queuedMessage.commandId,
          threadId: queuedMessage.threadId,
          message: {
            messageId: queuedMessage.messageId,
            role: "user",
            text: queuedMessage.text,
            attachments: toUploadChatImageAttachments(queuedMessage.attachments),
          },
          modelSelection: settings.modelSelection,
          runtimeMode: settings.runtimeMode,
          interactionMode: settings.interactionMode,
          createdAt: queuedMessage.createdAt,
        },
      });
      return completeDelivery(deliveryResult);
    },
    [
      makeDeliveryHelpers,
      setThreadInteractionMode,
      setThreadRuntimeMode,
      startTurn,
      updateThreadMetadata,
    ],
  );

  const sendQueuedCreation = useCallback(
    async (
      queuedMessage: QueuedThreadMessage,
      creation: QueuedThreadCreation,
      projectCwd: string,
    ): Promise<ThreadOutboxDeliveryOutcome> => {
      const modelSelection = queuedMessage.modelSelection;
      if (modelSelection === undefined) {
        return "retry";
      }
      const { completeDelivery } = makeDeliveryHelpers(queuedMessage);
      const deliveryResult = await startTurn({
        environmentId: queuedMessage.environmentId,
        input: buildProjectThreadStartTurnInput({
          projectId: creation.projectId,
          projectCwd,
          threadId: queuedMessage.threadId,
          commandId: queuedMessage.commandId,
          messageId: queuedMessage.messageId,
          createdAt: queuedMessage.createdAt,
          text: queuedMessage.text.trim(),
          attachments: queuedMessage.attachments,
          modelSelection,
          runtimeMode: queuedMessage.runtimeMode ?? DEFAULT_RUNTIME_MODE,
          interactionMode: queuedMessage.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
          workspaceMode: creation.workspaceMode,
          branch: creation.branch,
          worktreePath: creation.worktreePath,
          startFromOrigin: creation.startFromOrigin ?? false,
          worktreeBranchName: buildTemporaryWorktreeBranchName(randomHex),
        }),
      });
      return completeDelivery(deliveryResult);
    },
    [makeDeliveryHelpers, startTurn],
  );

  useEffect(() => {
    if (dispatchingQueuedMessageId !== null) {
      return;
    }

    for (const [threadKey, queuedMessages] of Object.entries(queuedMessagesByThreadKey)) {
      const nextQueuedMessage = queuedMessages[0];
      if (!nextQueuedMessage) {
        continue;
      }
      if (editingQueuedMessageIds[nextQueuedMessage.messageId]) {
        continue;
      }
      if (nextQueuedMessage.failureReason !== undefined) {
        // The server rejected this turn and its reason is on screen; stay parked
        // so we neither discard the user's message nor re-hammer a rejection.
        // Editing or deleting the entry re-arms it.
        continue;
      }
      if ((retryNotBeforeRef.current.get(nextQueuedMessage.messageId) ?? 0) > Date.now()) {
        continue;
      }

      const thread = findThread(threads, nextQueuedMessage);
      if (thread && scopedThreadKey(thread.environmentId, thread.id) !== threadKey) {
        continue;
      }

      const creation = nextQueuedMessage.creation;
      const environment = connectedEnvironments.find(
        (candidate) => candidate.environmentId === nextQueuedMessage.environmentId,
      );
      const shellStatus = shellStatuses.get(nextQueuedMessage.environmentId) ?? "empty";
      const evaluation = resolveThreadOutboxDrainEvaluation({
        isCreation: creation !== undefined,
        threadExists: thread !== undefined,
        shellStatus,
        environmentConnected: environment?.connectionState === "connected",
        threadSessionStatus: thread?.session?.status ?? null,
        connectionState: environment?.connectionState ?? null,
      });
      const { deliveryAction } = evaluation;
      automationNote("outbox-delivery", {
        threadId: nextQueuedMessage.threadId,
        messageId: nextQueuedMessage.messageId,
        ...evaluation.report,
      });
      if (deliveryAction === "wait") {
        // Nothing here schedules itself by changing a dep: re-evaluate on the
        // next shell/thread/connection change *and* on the armed fallback tick,
        // so a state transition this client never learns about cannot strand
        // the message until the app is relaunched.
        armWaitReEvaluation(nextQueuedMessage.messageId, evaluation.waitRetryDelayMs);
        continue;
      }
      // The live project shell is preferred for the workspace path, with the
      // snapshot taken at enqueue time as the fallback so a task never dies
      // just because its project shell is not loaded.
      const creationProjectCwd =
        creation !== undefined
          ? (findCreationProject(projects, nextQueuedMessage)?.workspaceRoot ??
            creation.projectCwd ??
            null)
          : null;
      // An incomplete pending task (e.g. worktree mode without a branch) stays
      // queued until the user finishes it in the editor.
      if (deliveryAction === "send" && creation !== undefined) {
        if (!isQueuedThreadCreationSendable(nextQueuedMessage)) {
          continue;
        }
        if (creationProjectCwd === null && shellStatus !== "live") {
          continue;
        }
      }

      beginDispatchingQueuedMessage(nextQueuedMessage.messageId);
      const removeQueuedMessage = (warning: string): Promise<ThreadOutboxDeliveryOutcome> =>
        removeThreadOutboxMessage(nextQueuedMessage).then(
          () => "delivered" as const,
          (error) => {
            console.warn(warning, {
              environmentId: nextQueuedMessage.environmentId,
              threadId: nextQueuedMessage.threadId,
              messageId: nextQueuedMessage.messageId,
              error,
            });
            return "retry" as const;
          },
        );
      const parkQueuedMessage = (reason: string): Promise<ThreadOutboxDeliveryOutcome> =>
        parkUndeliverableThreadOutboxMessage(nextQueuedMessage, reason, {
          update: updateThreadOutboxMessage,
          surfaceError: setPendingConnectionError,
        }).then(
          () => "failed" as const,
          (error) => {
            // The reason is already on screen; only the durable note failed, so
            // the message stays queued and the next pass re-parks it.
            console.warn("[thread-outbox] failed to record why a message was not delivered", {
              environmentId: nextQueuedMessage.environmentId,
              threadId: nextQueuedMessage.threadId,
              messageId: nextQueuedMessage.messageId,
              error,
            });
            return "failed" as const;
          },
        );
      // Enqueues publish optimistically before their durable write settles.
      // Confirm the write landed (and the message wasn't rolled back) before
      // sending, so a failed write can never chase an already-delivered turn.
      const delivery = confirmThreadOutboxMessageQueued(nextQueuedMessage).then(
        async (queued): Promise<ThreadOutboxDeliveryOutcome> => {
          if (!queued) {
            // Rolled back by a failed write; nothing to deliver or retry.
            return "delivered";
          }
          // The guards evaluated before the confirmation await are stale by now:
          // the thread may have gone busy, or the user may have opened this
          // message in the editor. Defer to the next drain pass (returning
          // "delivered" skips the failure/backoff path) rather than sending a
          // payload the user is editing or racing an active turn.
          if (appAtomRegistry.get(editingQueuedMessageIdsAtom)[nextQueuedMessage.messageId]) {
            return "delivered";
          }
          const freshThread = findThread(
            appAtomRegistry.get(environmentThreadShells.threadShellsAtom),
            nextQueuedMessage,
          );
          if (
            deliveryAction === "send" &&
            creation === undefined &&
            isThreadOutboxSessionBusy(freshThread?.session?.status)
          ) {
            // Deferred, not delivered: the turn that blocked us may already be
            // over by the time the store notices, so keep a wake-up armed.
            // finishDispatching then retriggers this effect; if the session is
            // still starting/running the wait branch arms the same fallback.
            armWaitReEvaluation(nextQueuedMessage.messageId, THREAD_OUTBOX_WAIT_RETRY_DELAY_MS);
            return "delivered";
          }
          return deliveryAction === "fail"
            ? parkQueuedMessage(MISSING_THREAD_OUTBOX_FAILURE_REASON)
            : deliveryAction === "remove"
              ? // Only reachable for a creation whose thread already exists: the
                // creation command went through and this entry is leftover.
                removeQueuedMessage(
                  "[thread-outbox] failed to remove an already-created pending task",
                )
              : creation !== undefined
                ? creationProjectCwd !== null
                  ? sendQueuedCreation(nextQueuedMessage, creation, creationProjectCwd)
                  : removeQueuedMessage(
                      "[thread-outbox] dropped pending task for a missing project",
                    )
                : thread !== undefined
                  ? sendQueuedMessage(nextQueuedMessage, thread)
                  : Promise.resolve<ThreadOutboxDeliveryOutcome>("retry");
        },
      );
      void delivery
        .then((outcome) => {
          // A parked rejection and a successful delivery both clear retry state;
          // only a transient "retry" reschedules a backoff attempt.
          if (outcome !== "retry") {
            retryAttemptRef.current.delete(nextQueuedMessage.messageId);
            retryNotBeforeRef.current.delete(nextQueuedMessage.messageId);
            const pendingTimer = retryTimersRef.current.get(nextQueuedMessage.messageId);
            if (pendingTimer !== undefined) {
              clearTimeout(pendingTimer);
              retryTimersRef.current.delete(nextQueuedMessage.messageId);
            }
            return;
          }

          const retryAttempt = (retryAttemptRef.current.get(nextQueuedMessage.messageId) ?? 0) + 1;
          retryAttemptRef.current.set(nextQueuedMessage.messageId, retryAttempt);
          const retryDelayMs = threadOutboxRetryDelayMs(retryAttempt);
          retryNotBeforeRef.current.set(nextQueuedMessage.messageId, Date.now() + retryDelayMs);
          const pendingTimer = retryTimersRef.current.get(nextQueuedMessage.messageId);
          if (pendingTimer !== undefined) {
            clearTimeout(pendingTimer);
          }
          const retryTimer = setTimeout(() => {
            retryTimersRef.current.delete(nextQueuedMessage.messageId);
            setRetryTick((current) => current + 1);
          }, retryDelayMs);
          retryTimersRef.current.set(nextQueuedMessage.messageId, retryTimer);
        })
        .finally(() => {
          finishDispatchingQueuedMessage(nextQueuedMessage.messageId);
        });
      return;
    }
  }, [
    armWaitReEvaluation,
    connectedEnvironments,
    dispatchingQueuedMessageId,
    editingQueuedMessageIds,
    projects,
    queuedMessagesByThreadKey,
    retryTick,
    sendQueuedCreation,
    sendQueuedMessage,
    // threads + shellStatuses are how a `wait` gets re-evaluated the moment the
    // thread session or the environment shell moves; retryTick is the armed
    // fallback for transitions that never reach this client at all.
    shellStatuses,
    threads,
  ]);
}
