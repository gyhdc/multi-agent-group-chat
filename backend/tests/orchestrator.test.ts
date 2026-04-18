import assert from "node:assert/strict";
import test from "node:test";
import { createBlankRoom, createProviderConfig, normalizeRole } from "../src/defaults";
import { addUserMessage, startDiscussion, stepDiscussion } from "../src/orchestrator";
import { DiscussionRoom, DiscussionRole, ProviderConfig, RoleTemplateKey } from "../src/types";

function createParticipant(name: string, templateKey: RoleTemplateKey, provider: ProviderConfig): DiscussionRole {
  return normalizeRole({
    name,
    kind: "participant",
    roleTemplateKey: templateKey,
    accentColor: "#49617a",
    providerPresetId: null,
    provider,
    persona: `${name} persona`,
    principles: `${name} principles`,
    goal: `${name} goal`,
    voiceStyle: `${name} voice`,
    enabled: true,
  });
}

function createRecorder(provider: ProviderConfig): DiscussionRole {
  return normalizeRole({
    name: "Recorder",
    kind: "recorder",
    roleTemplateKey: "recorder",
    accentColor: "#5b6475",
    providerPresetId: null,
    provider,
    persona: "Recorder persona",
    principles: "Recorder principles",
    goal: "Recorder goal",
    voiceStyle: "Recorder voice",
    enabled: true,
  });
}

function createRoom(options: {
  participantNames?: Array<{ name: string; templateKey: RoleTemplateKey }>;
  providerType?: ProviderConfig["type"];
  includeRecorder?: boolean;
  checkpointEveryRound?: boolean;
  maxRounds?: number;
} = {}): DiscussionRoom {
  const room = createBlankRoom();
  const providerType = options.providerType ?? "mock";
  const baseProvider = createProviderConfig(providerType);
  const participants = (options.participantNames ?? [
    { name: "Reviewer", templateKey: "reviewer" },
    { name: "Advisor", templateKey: "advisor" },
  ]).map((participant) => createParticipant(participant.name, participant.templateKey, baseProvider));

  room.roles = options.includeRecorder === false ? participants : [...participants, createRecorder(baseProvider)];
  room.checkpointEveryRound = options.checkpointEveryRound ?? true;
  room.maxRounds = options.maxRounds ?? 3;
  return room;
}

function installFetchSequence(
  responses: Array<{ content: string; replyToMessageId?: string | null; forceReplyRoleId?: string | null }>,
): () => void {
  const originalFetch = globalThis.fetch;
  let callIndex = 0;

  globalThis.fetch = (async () => {
    const response = responses[Math.min(callIndex, responses.length - 1)];
    callIndex += 1;
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("directed user reply keeps the exchange open for another natural follow-up", async () => {
  const room = createRoom({
    participantNames: [
      { name: "Reviewer", templateKey: "reviewer" },
      { name: "Advisor", templateKey: "advisor" },
      { name: "Methodologist", templateKey: "methodologist" },
    ],
    providerType: "custom-http",
    includeRecorder: false,
    checkpointEveryRound: false,
    maxRounds: 4,
  });

  const reviewer = room.roles[0];
  const advisor = room.roles[1];
  const restoreFetch = installFetchSequence([
    { content: "Reviewer opens the discussion.", replyToMessageId: null, forceReplyRoleId: null },
    { content: "Reviewer answers the user directly.", replyToMessageId: null, forceReplyRoleId: null },
    { content: "Advisor follows up after the reviewer reply.", replyToMessageId: null, forceReplyRoleId: null },
  ]);

  try {
    startDiscussion(room);
    await stepDiscussion(room);

    const reviewerOpening = room.messages.at(-1);
    assert.ok(reviewerOpening);
    assert.equal(reviewerOpening.roleId, reviewer.id);

    addUserMessage(room, "New evidence: this benchmark result changes the evaluation.", reviewerOpening.id);
    assert.equal(room.state.activeExchange?.reason, "user-message");
    assert.equal(room.state.activeExchange?.hardTargetRoleId, reviewer.id);
    assert.equal(room.state.pendingRequiredReplies.length, 1);

    await stepDiscussion(room);
    const forcedReply = room.messages.at(-1);
    assert.ok(forcedReply);
    assert.equal(forcedReply.roleId, reviewer.id);
    assert.equal(forcedReply.replyToMessageId, room.messages[1].id);
    assert.equal(room.state.activeExchange?.followUpTurnsRemaining, 1);

    await stepDiscussion(room);
    const followUp = room.messages.at(-1);
    assert.ok(followUp);
    assert.equal(followUp.roleId, advisor.id);
    assert.equal(room.state.activeExchange?.followUpTurnsRemaining, 0);
    assert.equal(room.state.activeExchange?.reason, "user-message");
  } finally {
    restoreFetch();
  }
});

test("non-directed user message opens a fresh exchange and reselects the most suitable speaker", async () => {
  const room = createRoom({
    providerType: "custom-http",
    includeRecorder: false,
    checkpointEveryRound: false,
    maxRounds: 4,
  });
  const reviewer = room.roles[0];
  const advisor = room.roles[1];

  const restoreFetch = installFetchSequence([
    { content: "Reviewer opening point.", replyToMessageId: null, forceReplyRoleId: null },
    { content: "Advisor natural response.", replyToMessageId: null, forceReplyRoleId: null },
    { content: "Reviewer addresses the new user evidence.", replyToMessageId: null, forceReplyRoleId: null },
  ]);

  try {
    startDiscussion(room);
    await stepDiscussion(room);
    await stepDiscussion(room);

    assert.equal(room.messages.filter((message) => message.kind === "participant").length, 2);

    addUserMessage(room, "Additional data changes the risk picture.");
    assert.equal(room.state.activeExchange?.reason, "user-message");
    assert.equal(room.state.pendingRequiredReplies.length, 0);

    await stepDiscussion(room);
    const lastMessage = room.messages.at(-1);
    assert.ok(lastMessage);
    assert.equal(lastMessage.roleId, reviewer.id);
    assert.equal(lastMessage.round, room.state.currentRound);
    assert.notEqual(lastMessage.roleId, advisor.id);
  } finally {
    restoreFetch();
  }
});

test("participant-forced reply opens a new exchange and still allows a third role to continue naturally", async () => {
  const room = createRoom({
    participantNames: [
      { name: "Reviewer", templateKey: "reviewer" },
      { name: "Advisor", templateKey: "advisor" },
      { name: "Methodologist", templateKey: "methodologist" },
    ],
    providerType: "custom-http",
    includeRecorder: false,
    checkpointEveryRound: false,
    maxRounds: 5,
  });
  const reviewer = room.roles[0];
  const advisor = room.roles[1];
  const methodologist = room.roles[2];

  const restoreFetch = installFetchSequence([
    { content: "Reviewer opens.", replyToMessageId: null, forceReplyRoleId: null },
    { content: "Advisor explicitly calls on Methodologist.", replyToMessageId: null, forceReplyRoleId: methodologist.id },
    { content: "Methodologist answers the challenge.", replyToMessageId: null, forceReplyRoleId: reviewer.id },
    { content: "Reviewer naturally follows after the forced reply.", replyToMessageId: null, forceReplyRoleId: null },
  ]);

  try {
    startDiscussion(room);
    await stepDiscussion(room);
    assert.equal(room.messages.at(-1)?.roleId, reviewer.id);

    await stepDiscussion(room);
    const advisorMessage = room.messages.at(-1);
    assert.ok(advisorMessage);
    assert.equal(advisorMessage.roleId, advisor.id);
    assert.equal(advisorMessage.requiredReplyRoleId, methodologist.id);
    assert.equal(room.state.activeExchange?.reason, "participant-forced-reply");
    assert.equal(room.state.activeExchange?.hardTargetRoleId, methodologist.id);

    await stepDiscussion(room);
    const forcedReply = room.messages.at(-1);
    assert.ok(forcedReply);
    assert.equal(forcedReply.roleId, methodologist.id);
    assert.equal(forcedReply.replyToMessageId, advisorMessage.id);
    assert.equal(room.state.activeExchange?.reason, "participant-forced-reply");

    await stepDiscussion(room);
    const nextNaturalSpeaker = room.messages.at(-1);
    assert.ok(nextNaturalSpeaker);
    assert.notEqual(nextNaturalSpeaker.roleId, methodologist.id);
    assert.equal(room.state.activeExchange?.reason, "participant-forced-reply");
  } finally {
    restoreFetch();
  }
});

test("same role does not immediately speak twice when another participant is still a valid candidate", async () => {
  const room = createRoom({
    providerType: "custom-http",
    includeRecorder: false,
    checkpointEveryRound: false,
    maxRounds: 3,
  });
  const reviewer = room.roles[0];
  const advisor = room.roles[1];

  const restoreFetch = installFetchSequence([
    { content: "Reviewer starts.", replyToMessageId: null, forceReplyRoleId: null },
    { content: "Advisor follows instead of reviewer repeating.", replyToMessageId: null, forceReplyRoleId: null },
  ]);

  try {
    startDiscussion(room);
    await stepDiscussion(room);
    assert.equal(room.messages.at(-1)?.roleId, reviewer.id);

    await stepDiscussion(room);
    assert.equal(room.messages.at(-1)?.roleId, advisor.id);
  } finally {
    restoreFetch();
  }
});

test("checkpoint and final happen only after the current exchange naturally settles", async () => {
  const room = createRoom({
    providerType: "custom-http",
    includeRecorder: true,
    checkpointEveryRound: true,
    maxRounds: 1,
  });
  const reviewer = room.roles[0];

  const restoreFetch = installFetchSequence([
    { content: "Reviewer opening point.", replyToMessageId: null, forceReplyRoleId: null },
    { content: "Advisor answer.", replyToMessageId: null, forceReplyRoleId: null },
    { content: "Recorder checkpoint.", replyToMessageId: null, forceReplyRoleId: null },
    { content: "Recorder final.", replyToMessageId: null, forceReplyRoleId: null },
  ]);

  try {
    startDiscussion(room);
    await stepDiscussion(room);
    const reviewerMessage = room.messages.at(-1);
    assert.ok(reviewerMessage);
    assert.equal(reviewerMessage.roleId, reviewer.id);

    addUserMessage(room, "Please address this exact concern.", reviewerMessage.id);
    await stepDiscussion(room);
    await stepDiscussion(room);

    const beforeRecorderMessages = room.messages.filter((message) => message.kind === "recorder").length;
    assert.equal(beforeRecorderMessages, 0);

    await stepDiscussion(room);
    const checkpointMessage = room.messages.at(-1);
    assert.ok(checkpointMessage);
    assert.equal(checkpointMessage.kind, "recorder");

    await stepDiscussion(room);
    const finalMessage = room.messages.at(-1);
    assert.ok(finalMessage);
    assert.equal(finalMessage.kind, "recorder");
    assert.equal(room.state.status, "completed");
  } finally {
    restoreFetch();
  }
});
