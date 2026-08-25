import { describe, expect, it } from "vite-plus/test";

import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationThread,
} from "@t3tools/contracts";

import { buildThreadForkImportedMessages, buildThreadForkInput } from "./threadFork";

const SOURCE_MESSAGES: OrchestrationThread["messages"] = [
  {
    id: MessageId.make("source-user"),
    role: "user",
    text: "Explain the current approach",
    attachments: [
      {
        type: "image",
        id: "image-1",
        name: "context.png",
        mimeType: "image/png",
        sizeBytes: 128,
      },
    ],
    turnId: null,
    streaming: false,
    createdAt: "2026-08-25T10:00:00.000Z",
    updatedAt: "2026-08-25T10:00:00.000Z",
  },
  {
    id: MessageId.make("source-streaming"),
    role: "assistant",
    text: "Still streaming",
    turnId: null,
    streaming: true,
    createdAt: "2026-08-25T10:01:00.000Z",
    updatedAt: "2026-08-25T10:01:00.000Z",
  },
  {
    id: MessageId.make("source-system"),
    role: "system",
    text: "Internal metadata",
    turnId: null,
    streaming: false,
    createdAt: "2026-08-25T10:02:00.000Z",
    updatedAt: "2026-08-25T10:02:00.000Z",
  },
  {
    id: MessageId.make("source-assistant"),
    role: "assistant",
    text: "The approach is safe.",
    turnId: null,
    streaming: false,
    createdAt: "2026-08-25T10:03:00.000Z",
    updatedAt: "2026-08-25T10:03:00.000Z",
  },
];

const SOURCE_THREAD = {
  id: ThreadId.make("source-thread"),
  projectId: ProjectId.make("project-1"),
  title: "Original conversation",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
  runtimeMode: "approval-required",
  interactionMode: "default",
  branch: "feature/mobile",
  worktreePath: "/worktrees/mobile",
  messages: SOURCE_MESSAGES,
} satisfies Pick<
  OrchestrationThread,
  | "id"
  | "projectId"
  | "title"
  | "modelSelection"
  | "runtimeMode"
  | "interactionMode"
  | "branch"
  | "worktreePath"
  | "messages"
>;

describe("conversation fork transcript", () => {
  it("copies only completed user and assistant messages with new identities", () => {
    let next = 0;

    const imported = buildThreadForkImportedMessages({
      source: SOURCE_THREAD,
      nextMessageId: () => MessageId.make(`fork-message-${++next}`),
    });

    expect(imported).toEqual([
      {
        messageId: "fork-message-1",
        role: "user",
        text: "Explain the current approach",
        attachments: [
          {
            type: "image",
            id: "image-1",
            name: "context.png",
            mimeType: "image/png",
            sizeBytes: 128,
          },
        ],
        createdAt: "2026-08-25T10:00:00.000Z",
        updatedAt: "2026-08-25T10:00:00.000Z",
      },
      {
        messageId: "fork-message-2",
        role: "assistant",
        text: "The approach is safe.",
        createdAt: "2026-08-25T10:03:00.000Z",
        updatedAt: "2026-08-25T10:03:00.000Z",
      },
    ]);
  });

  it("builds a dispatchable fork command from the selected conversation", () => {
    let next = 0;

    expect(
      buildThreadForkInput({
        source: SOURCE_THREAD,
        commandId: CommandId.make("fork-command"),
        threadId: ThreadId.make("fork-thread"),
        createdAt: "2026-08-25T10:04:00.000Z",
        nextMessageId: () => MessageId.make(`fork-message-${++next}`),
      }),
    ).toMatchObject({
      commandId: "fork-command",
      threadId: "fork-thread",
      sourceThreadId: "source-thread",
      projectId: "project-1",
      title: "Original conversation",
      modelSelection: { instanceId: "codex", model: "gpt-5.6" },
      runtimeMode: "approval-required",
      interactionMode: "default",
      branch: "feature/mobile",
      worktreePath: "/worktrees/mobile",
      forkPointMessageId: null,
      createdAt: "2026-08-25T10:04:00.000Z",
      importedMessages: [
        {
          messageId: "fork-message-1",
          role: "user",
          text: "Explain the current approach",
        },
        {
          messageId: "fork-message-2",
          role: "assistant",
          text: "The approach is safe.",
        },
      ],
    });
  });
});
