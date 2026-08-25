import { describe, expect, it } from "vite-plus/test";

import { MessageId, type OrchestrationThread } from "@t3tools/contracts";

import { buildThreadForkImportedMessages } from "./threadFork";

const SOURCE_MESSAGES: OrchestrationThread["messages"] = [
  {
    id: MessageId.make("source-user"),
    role: "user",
    text: "Explain the current approach",
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

describe("conversation fork transcript", () => {
  it("copies only completed user and assistant messages with new identities", () => {
    let next = 0;

    const imported = buildThreadForkImportedMessages({
      source: { messages: SOURCE_MESSAGES },
      nextMessageId: () => MessageId.make(`fork-message-${++next}`),
    });

    expect(imported).toEqual([
      {
        messageId: "fork-message-1",
        role: "user",
        text: "Explain the current approach",
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
});
