import { isTransportConnectionErrorMessage } from "@t3tools/client-runtime/errors";
import type { EnvironmentShellStatus } from "@t3tools/client-runtime/state/shell";
import {
  CommandId,
  EnvironmentId,
  IsoDateTime,
  MessageId,
  ModelSelection,
  ProjectId,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
  type ModelSelection as ModelSelectionType,
  type OrchestrationSessionStatus,
  type ProjectId as ProjectIdType,
  type ProviderInteractionMode as ProviderInteractionModeType,
  type RuntimeMode as RuntimeModeType,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { DraftComposerImageAttachmentSchema } from "../lib/composer-image-schema";
import type { DraftComposerImageAttachment } from "../lib/composerImages";
import { scopedThreadKey } from "../lib/scopedEntities";

const THREAD_OUTBOX_SCHEMA_VERSION = 3;
const THREAD_OUTBOX_MAX_RETRY_DELAY_MS = 16_000;

const QueuedThreadCreationSchema = Schema.Struct({
  projectId: ProjectId,
  // Snapshot of the project's display metadata so a pending task stays
  // presentable in the thread list even when the project shell is not loaded.
  projectTitle: Schema.optional(Schema.String),
  projectCwd: Schema.optional(Schema.String),
  workspaceMode: Schema.Literals(["local", "worktree"]),
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  startFromOrigin: Schema.optional(Schema.Boolean),
});

export const QueuedThreadMessageSchema = Schema.Struct({
  schemaVersion: Schema.Literals([1, 2, THREAD_OUTBOX_SCHEMA_VERSION]),
  environmentId: EnvironmentId,
  threadId: ThreadId,
  messageId: MessageId,
  commandId: CommandId,
  text: Schema.String,
  attachments: Schema.Array(DraftComposerImageAttachmentSchema),
  modelSelection: Schema.optional(ModelSelection),
  runtimeMode: Schema.optional(RuntimeMode),
  interactionMode: Schema.optional(ProviderInteractionMode),
  // Present when the queued item creates a brand-new thread (pending task)
  // instead of appending a turn to an existing one.
  creation: Schema.optional(QueuedThreadCreationSchema),
  // Set when the server explicitly rejected delivery: the message stays queued
  // with this reason so the user can see why and act on it, rather than being
  // silently dropped. Cleared whenever the payload is edited or re-enqueued.
  failureReason: Schema.optional(Schema.String),
  createdAt: IsoDateTime,
});

const decodeStoredQueuedThreadMessage = Schema.decodeUnknownSync(QueuedThreadMessageSchema);
const encodeStoredQueuedThreadMessage = Schema.encodeUnknownSync(QueuedThreadMessageSchema);

export interface QueuedThreadCreation {
  readonly projectId: ProjectIdType;
  readonly projectTitle?: string;
  readonly projectCwd?: string;
  readonly workspaceMode: "local" | "worktree";
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly startFromOrigin?: boolean;
}

export interface QueuedThreadMessage {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly commandId: CommandId;
  readonly text: string;
  readonly attachments: ReadonlyArray<DraftComposerImageAttachment>;
  readonly modelSelection?: ModelSelectionType;
  readonly runtimeMode?: RuntimeModeType;
  readonly interactionMode?: ProviderInteractionModeType;
  readonly creation?: QueuedThreadCreation;
  readonly failureReason?: string;
  readonly createdAt: string;
}

export interface ThreadSettingsSnapshot {
  readonly modelSelection: ModelSelectionType;
  readonly runtimeMode: RuntimeModeType;
  readonly interactionMode: ProviderInteractionModeType;
}

export function resolveQueuedThreadSettings(
  message: QueuedThreadMessage,
  thread: ThreadSettingsSnapshot,
): ThreadSettingsSnapshot {
  return {
    modelSelection: message.modelSelection ?? thread.modelSelection,
    runtimeMode: message.runtimeMode ?? thread.runtimeMode,
    interactionMode: message.interactionMode ?? thread.interactionMode,
  };
}

export function modelSelectionsEqual(left: ModelSelectionType, right: ModelSelectionType): boolean {
  return (
    left.instanceId === right.instanceId &&
    left.model === right.model &&
    JSON.stringify(left.options ?? null) === JSON.stringify(right.options ?? null)
  );
}

export function encodeQueuedThreadMessage(message: QueuedThreadMessage): unknown {
  return encodeStoredQueuedThreadMessage({
    schemaVersion: THREAD_OUTBOX_SCHEMA_VERSION,
    ...message,
  });
}

export function decodeQueuedThreadMessage(value: unknown): QueuedThreadMessage {
  const { schemaVersion: _, ...message } = decodeStoredQueuedThreadMessage(value);
  return message;
}

export function groupQueuedThreadMessages(
  messages: ReadonlyArray<QueuedThreadMessage>,
): Record<string, ReadonlyArray<QueuedThreadMessage>> {
  const deduplicated = new Map<MessageId, QueuedThreadMessage>();
  for (const message of messages) {
    deduplicated.set(message.messageId, message);
  }

  const grouped: Record<string, Array<QueuedThreadMessage>> = {};
  for (const message of deduplicated.values()) {
    const threadKey = scopedThreadKey(message.environmentId, message.threadId);
    (grouped[threadKey] ??= []).push(message);
  }
  for (const queue of Object.values(grouped)) {
    queue.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }
  return grouped;
}

export function flattenQueuedThreadMessages(
  queues: Record<string, ReadonlyArray<QueuedThreadMessage>>,
): ReadonlyArray<QueuedThreadMessage> {
  return Object.values(queues).flat();
}

export function threadOutboxRetryDelayMs(attempt: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attempt - 1), THREAD_OUTBOX_MAX_RETRY_DELAY_MS);
}

export type ThreadOutboxDeliveryAction = "wait" | "remove" | "send" | "fail";

/**
 * Shown when a queued turn's thread is no longer in this environment's shell.
 * The message is kept, not dropped: it is the user's own text, and a queue
 * entry that disappears without a word looks exactly like one that was sent.
 */
export const MISSING_THREAD_OUTBOX_FAILURE_REASON =
  "这条消息发不出去：它所在的对话在电脑上已经没有了。把文字复制到另一个对话再发，或者在这里删掉它。";

export function resolveThreadOutboxDeliveryAction(input: {
  readonly isCreation: boolean;
  readonly threadExists: boolean;
  readonly shellStatus: EnvironmentShellStatus;
  readonly environmentConnected: boolean;
  readonly threadBusy: boolean;
}): ThreadOutboxDeliveryAction {
  if (input.isCreation) {
    // A pending task creates its thread on delivery. If the thread already
    // exists the creation command went through and only cleanup remains.
    if (input.threadExists) {
      return "remove";
    }
    // Wait for the shell to be live before sending: until the thread list has
    // synchronized, a previously delivered creation whose cleanup failed would
    // look missing and get re-issued, duplicating the thread.
    return input.environmentConnected && input.shellStatus === "live" ? "send" : "wait";
  }
  if (!input.threadExists) {
    // A live shell that does not list the thread means this turn has nowhere to
    // go. Park it with a reason rather than deleting it: a thread can also be
    // absent from the shell because the imported-thread dedupe dropped it, and
    // in every case the user must be told instead of watching the message
    // vanish as if it had been sent.
    return input.shellStatus === "live" ? "fail" : "wait";
  }
  return input.environmentConnected && !input.threadBusy ? "send" : "wait";
}

/**
 * A `wait` is the one delivery decision with no follow-up of its own, and the
 * states it waits on are read from a subscription that can park without
 * surfacing an error (a shell stream whose resubscribe lost its transport
 * stays `synchronizing` over a stale snapshot until the app is relaunched).
 * Re-checking at this interval keeps a queued message from lying in the outbox
 * forever when the transition it waited for never reaches this client.
 */
export const THREAD_OUTBOX_WAIT_RETRY_DELAY_MS = 15_000;

export type ThreadOutboxSessionStatus = OrchestrationSessionStatus;

export interface ThreadOutboxDrainEvaluation {
  readonly deliveryAction: ThreadOutboxDeliveryAction;
  /** Set only for `wait`: re-run the drain for this message after this delay. */
  readonly waitRetryDelayMs: number | null;
  readonly report: {
    readonly deliveryAction: ThreadOutboxDeliveryAction;
    readonly isCreation: boolean;
    readonly threadExists: boolean;
    readonly shellStatus: EnvironmentShellStatus;
    readonly connectionState: string | null;
    readonly threadSessionStatus: ThreadOutboxSessionStatus | null;
  };
}

export function isThreadOutboxSessionBusy(
  status: ThreadOutboxSessionStatus | null | undefined,
): boolean {
  return status === "running" || status === "starting";
}

export function resolveThreadOutboxDrainEvaluation(input: {
  readonly isCreation: boolean;
  readonly threadExists: boolean;
  readonly shellStatus: EnvironmentShellStatus;
  readonly environmentConnected: boolean;
  readonly threadSessionStatus: ThreadOutboxSessionStatus | null;
  readonly connectionState: string | null;
}): ThreadOutboxDrainEvaluation {
  const threadBusy = isThreadOutboxSessionBusy(input.threadSessionStatus);
  const deliveryAction = resolveThreadOutboxDeliveryAction({
    isCreation: input.isCreation,
    threadExists: input.threadExists,
    shellStatus: input.shellStatus,
    environmentConnected: input.environmentConnected,
    threadBusy,
  });
  return {
    deliveryAction,
    waitRetryDelayMs: deliveryAction === "wait" ? THREAD_OUTBOX_WAIT_RETRY_DELAY_MS : null,
    report: {
      deliveryAction,
      isCreation: input.isCreation,
      threadExists: input.threadExists,
      shellStatus: input.shellStatus,
      connectionState: input.connectionState,
      threadSessionStatus: input.threadSessionStatus,
    },
  };
}

/**
 * A queued creation can only be dispatched once its payload would pass server
 * validation; incomplete payloads stay pending until the user edits them.
 */
export function isQueuedThreadCreationSendable(message: QueuedThreadMessage): boolean {
  if (!message.creation) {
    return false;
  }
  if (message.text.trim().length === 0 || message.modelSelection === undefined) {
    return false;
  }
  return message.creation.workspaceMode !== "worktree" || Boolean(message.creation.branch);
}

function errorMessage(error: unknown): string | null {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    return typeof error.message === "string" ? error.message : null;
  }
  return typeof error === "string" ? error : null;
}

export function shouldRetryThreadOutboxDelivery(error: unknown): boolean {
  if (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "ConnectionTransientError"
  ) {
    return true;
  }
  return isTransportConnectionErrorMessage(errorMessage(error));
}

export type ThreadOutboxCommandStage = "settings-sync" | "start-turn";
/**
 * `retry` keeps the message queued and re-attempts it on backoff (a transient
 * transport blip); `fail` keeps it queued but stops auto-retrying and records
 * the server's rejection so the user can see and act on it. A server-explicit
 * rejection must never discard the message — the user's turn would vanish.
 */
export type ThreadOutboxFailureAction = "retry" | "fail";

export function resolveThreadOutboxFailureAction(input: {
  readonly stage: ThreadOutboxCommandStage;
  readonly error: unknown;
  readonly interrupted: boolean;
}): ThreadOutboxFailureAction {
  if (
    input.stage === "settings-sync" ||
    input.interrupted ||
    shouldRetryThreadOutboxDelivery(input.error)
  ) {
    return "retry";
  }
  return "fail";
}

/**
 * Keep an undeliverable turn in the outbox and put its reason on screen.
 *
 * The two effects are passed in rather than imported: the drain hook lives in a
 * module that pulls in React Native, so this is the seam where the behaviour
 * can be run against a real outbox store in a test.
 */
export async function parkUndeliverableThreadOutboxMessage(
  message: QueuedThreadMessage,
  reason: string,
  effects: {
    readonly update: (message: QueuedThreadMessage) => Promise<unknown>;
    readonly surfaceError: (reason: string) => void;
  },
): Promise<void> {
  effects.surfaceError(reason);
  await effects.update({ ...message, failureReason: reason });
}
