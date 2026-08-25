import type {
  CommandId,
  MessageId,
  OrchestrationThread,
  ThreadForkImportedMessage,
  ThreadId,
} from "@t3tools/contracts";

function isForkableMessage(
  message: OrchestrationThread["messages"][number],
): message is OrchestrationThread["messages"][number] & {
  readonly role: "user" | "assistant";
} {
  return !message.streaming && (message.role === "user" || message.role === "assistant");
}

export function buildThreadForkImportedMessages(input: {
  readonly source: Pick<OrchestrationThread, "messages">;
  readonly nextMessageId: () => MessageId;
}): ReadonlyArray<ThreadForkImportedMessage> {
  return input.source.messages.filter(isForkableMessage).map((message) => ({
    messageId: input.nextMessageId(),
    role: message.role,
    text: message.text,
    ...(message.attachments && message.attachments.length > 0
      ? { attachments: message.attachments }
      : {}),
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  }));
}

export function buildThreadForkInput(input: {
  readonly source: OrchestrationThread;
  readonly commandId: CommandId;
  readonly threadId: ThreadId;
  readonly createdAt: string;
  readonly nextMessageId: () => MessageId;
}) {
  return {
    commandId: input.commandId,
    threadId: input.threadId,
    sourceThreadId: input.source.id,
    projectId: input.source.projectId,
    title: input.source.title,
    modelSelection: input.source.modelSelection,
    runtimeMode: input.source.runtimeMode,
    interactionMode: input.source.interactionMode,
    branch: input.source.branch,
    worktreePath: input.source.worktreePath,
    forkPointMessageId: null,
    importedMessages: buildThreadForkImportedMessages({
      source: input.source,
      nextMessageId: input.nextMessageId,
    }),
    createdAt: input.createdAt,
  };
}
