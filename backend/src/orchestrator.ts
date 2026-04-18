import { randomUUID } from "crypto";
import { assertDocumentReadyForDiscussion } from "./documents";
import { generateParticipantContent, generateRecorderCheckpoint, generateRecorderFinal } from "./providers";
import { ActiveExchange, ChatMessage, DiscussionRole, DiscussionRoom, InsightEntry, PendingRequiredReply } from "./types";

const SPEAKER_SCORE_THRESHOLD = 30;

function getParticipants(room: DiscussionRoom): DiscussionRole[] {
  return room.roles.filter((role) => role.enabled && role.kind === "participant");
}

function getEnabledParticipant(room: DiscussionRoom, roleId: string | null | undefined): DiscussionRole | undefined {
  if (!roleId) {
    return undefined;
  }
  return room.roles.find((role) => role.enabled && role.kind === "participant" && role.id === roleId);
}

function getRecorder(room: DiscussionRoom): DiscussionRole | undefined {
  return room.roles.find((role) => role.enabled && role.kind === "recorder");
}

function findMessage(room: DiscussionRoom, messageId: string | null | undefined): ChatMessage | null {
  if (!messageId) {
    return null;
  }
  return room.messages.find((message) => message.id === messageId) ?? null;
}

function getReplyMetadata(room: DiscussionRoom, replyToMessageId: string | null | undefined): Pick<
  ChatMessage,
  "replyToMessageId" | "replyToRoleName" | "replyToExcerpt"
> {
  const target = findMessage(room, replyToMessageId);
  return {
    replyToMessageId: target?.id ?? null,
    replyToRoleName: target?.roleName ?? null,
    replyToExcerpt: target ? target.content.replace(/\r/g, "").trim().slice(0, 110) : null,
  };
}

function appendMessage(room: DiscussionRoom, message: Omit<ChatMessage, "id" | "createdAt">): ChatMessage {
  const entry: ChatMessage = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...message,
  };
  room.messages.push(entry);
  room.updatedAt = new Date().toISOString();
  return entry;
}

function appendInsight(room: DiscussionRoom, insight: Omit<InsightEntry, "id" | "createdAt">): InsightEntry {
  const entry: InsightEntry = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...insight,
  };
  room.summary.insights.push(entry);
  room.summary.updatedAt = new Date().toISOString();
  room.updatedAt = new Date().toISOString();
  return entry;
}

function syncLegacySpeakerState(room: DiscussionRoom): void {
  room.state.spokenParticipantRoleIds = room.state.activeExchange?.respondedRoleIds.slice() ?? [];
  room.state.nextSpeakerIndex = 0;
}

function setActiveExchange(
  room: DiscussionRoom,
  params: Omit<ActiveExchange, "id">,
  options: { incrementRound?: boolean } = {},
): void {
  if (options.incrementRound) {
    room.state.currentRound = room.state.currentRound > 0 ? room.state.currentRound + 1 : 1;
  } else if (room.state.currentRound <= 0) {
    room.state.currentRound = 1;
  }

  room.state.phase = "participants";
  room.state.activeExchange = {
    id: randomUUID(),
    ...params,
  };
  syncLegacySpeakerState(room);
}

function clearActiveExchange(room: DiscussionRoom): void {
  room.state.activeExchange = null;
  syncLegacySpeakerState(room);
}

function beginTopicStartExchange(room: DiscussionRoom, incrementRound: boolean): void {
  setActiveExchange(
    room,
    {
      reason: "topic-start",
      triggerMessageId: null,
      hardTargetRoleId: null,
      respondedRoleIds: [],
      followUpTurnsRemaining: 0,
      openedAtTurn: room.state.totalTurns,
    },
    { incrementRound },
  );
}

function enqueueRequiredReply(
  room: DiscussionRoom,
  sourceMessageId: string,
  targetRole: DiscussionRole,
  reason: PendingRequiredReply["reason"],
  position: "front" | "back" = "back",
): void {
  const entry: PendingRequiredReply = {
    sourceMessageId,
    targetRoleId: targetRole.id,
    targetRoleName: targetRole.name,
    reason,
    createdAt: new Date().toISOString(),
  };

  const exists = room.state.pendingRequiredReplies.some(
    (candidate) => candidate.sourceMessageId === sourceMessageId && candidate.targetRoleId === targetRole.id,
  );
  if (exists) {
    return;
  }

  if (position === "front") {
    room.state.pendingRequiredReplies.unshift(entry);
  } else {
    room.state.pendingRequiredReplies.push(entry);
  }
}

function shiftNextRequiredReply(room: DiscussionRoom): PendingRequiredReply | null {
  while (room.state.pendingRequiredReplies.length > 0) {
    const candidate = room.state.pendingRequiredReplies.shift() ?? null;
    if (!candidate) {
      continue;
    }
    if (!findMessage(room, candidate.sourceMessageId)) {
      continue;
    }
    if (!getEnabledParticipant(room, candidate.targetRoleId)) {
      continue;
    }
    return candidate;
  }

  return null;
}

function getValidRequiredReplyTarget(
  room: DiscussionRoom,
  sourceRoleId: string,
  requestedRoleId: string | null,
): DiscussionRole | null {
  if (!requestedRoleId || requestedRoleId === sourceRoleId) {
    return null;
  }
  return getEnabledParticipant(room, requestedRoleId) ?? null;
}

function completeWithoutRecorder(room: DiscussionRoom): DiscussionRoom {
  appendInsight(room, {
    kind: "final",
    title: "Final Conclusion",
    content:
      "The discussion ended without a recorder role. Keep the transcript, but add a recorder if you want a cleaner high-signal conclusion.",
    round: room.state.currentRound,
    saved: true,
  });
  room.state.status = "completed";
  room.state.phase = "final";
  clearActiveExchange(room);
  room.updatedAt = new Date().toISOString();
  return room;
}

function roleRespondedAfterTurn(room: DiscussionRoom, roleId: string, turn: number): boolean {
  return room.messages.some((message) => message.kind === "participant" && message.roleId === roleId && message.turn > turn);
}

function getLastParticipantTurn(room: DiscussionRoom, roleId: string): number {
  for (let index = room.messages.length - 1; index >= 0; index -= 1) {
    const message = room.messages[index];
    if (message.kind === "participant" && message.roleId === roleId) {
      return message.turn;
    }
  }
  return 0;
}

function getLatestParticipantMessage(room: DiscussionRoom): ChatMessage | null {
  for (let index = room.messages.length - 1; index >= 0; index -= 1) {
    const message = room.messages[index];
    if (message.kind === "participant") {
      return message;
    }
  }
  return null;
}

function getLatestUserMessage(room: DiscussionRoom, openedAtTurn: number): ChatMessage | null {
  for (let index = room.messages.length - 1; index >= 0; index -= 1) {
    const message = room.messages[index];
    if (message.kind === "user" && message.turn >= openedAtTurn) {
      return message;
    }
  }
  return null;
}

function getLatestDirectChallenge(room: DiscussionRoom, roleId: string, openedAtTurn: number): ChatMessage | null {
  for (let index = room.messages.length - 1; index >= 0; index -= 1) {
    const message = room.messages[index];
    if ((message.kind !== "participant" && message.kind !== "user") || message.roleId === roleId || message.turn < openedAtTurn) {
      continue;
    }
    const target = findMessage(room, message.replyToMessageId);
    if (target?.roleId === roleId) {
      return message;
    }
  }
  return null;
}

type SpeakerCandidate = {
  role: DiscussionRole;
  score: number;
  reason: string;
};

function chooseScoredSpeaker(room: DiscussionRoom): SpeakerCandidate | null {
  const exchange = room.state.activeExchange;
  if (!exchange) {
    return null;
  }

  const participants = getParticipants(room);
  if (participants.length === 0) {
    return null;
  }

  const silenceRanking = participants
    .map((role) => ({
      roleId: role.id,
      lastTurn: getLastParticipantTurn(room, role.id),
    }))
    .sort((left, right) => left.lastTurn - right.lastTurn);
  const silenceBonus = new Map<string, number>();
  silenceRanking.forEach((entry, index) => {
    silenceBonus.set(entry.roleId, Math.max(0, 20 - index * 5));
  });

  const latestParticipant = getLatestParticipantMessage(room);
  const latestUser = getLatestUserMessage(room, exchange.openedAtTurn);

  const candidates: SpeakerCandidate[] = participants.map((role) => {
    let score = silenceBonus.get(role.id) ?? 0;
    const reasons: string[] = [];
    const responded = exchange.respondedRoleIds.includes(role.id);
    const isHardTarget = exchange.hardTargetRoleId === role.id && !responded;

    if (isHardTarget) {
      score += 100;
      reasons.push("mandatory hard target");
    } else if (!responded) {
      if (exchange.reason === "topic-start") {
        score += 60;
        reasons.push("topic-start opening voice");
      } else if (exchange.reason === "user-message") {
        score += exchange.hardTargetRoleId ? 25 : 50;
        reasons.push(exchange.hardTargetRoleId ? "follow-up after directed user message" : "user evidence is fresh");
      } else {
        score += 20;
        reasons.push("fresh voice after participant escalation");
      }
    }

    const latestDirectChallenge = getLatestDirectChallenge(room, role.id, exchange.openedAtTurn);
    if (latestDirectChallenge && !roleRespondedAfterTurn(room, role.id, latestDirectChallenge.turn)) {
      score += 35;
      reasons.push("unanswered direct challenge");
    }

    if (latestUser && !roleRespondedAfterTurn(room, role.id, latestUser.turn)) {
      score += 25;
      reasons.push("has not addressed latest user evidence");
    }

    if (latestParticipant?.roleId === role.id) {
      score -= 60;
      reasons.push("was the previous participant speaker");
    }

    if (responded && !isHardTarget) {
      const stillUnderChallenge =
        (latestDirectChallenge && !roleRespondedAfterTurn(room, role.id, latestDirectChallenge.turn)) ||
        (latestUser && !roleRespondedAfterTurn(room, role.id, latestUser.turn));
      if (!stillUnderChallenge) {
        score -= 40;
        reasons.push("already responded in this exchange");
      }
    }

    return {
      role,
      score,
      reason: reasons.length > 0 ? reasons[0] : "natural continuation",
    };
  });

  candidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return participants.findIndex((role) => role.id === left.role.id) - participants.findIndex((role) => role.id === right.role.id);
  });

  const best = candidates[0];
  if (!best || best.score < SPEAKER_SCORE_THRESHOLD) {
    return null;
  }
  return best;
}

function updateExchangeAfterParticipantMessage(room: DiscussionRoom, speaker: DiscussionRole, message: ChatMessage): void {
  const exchange = room.state.activeExchange;
  if (!exchange) {
    return;
  }

  if (!exchange.respondedRoleIds.includes(speaker.id)) {
    exchange.respondedRoleIds.push(speaker.id);
  }

  if (exchange.followUpTurnsRemaining > 0 && exchange.hardTargetRoleId && speaker.id !== exchange.hardTargetRoleId) {
    exchange.followUpTurnsRemaining = Math.max(0, exchange.followUpTurnsRemaining - 1);
  }

  exchange.triggerMessageId = exchange.triggerMessageId ?? message.id;
  syncLegacySpeakerState(room);
}

async function emitParticipantMessage(
  room: DiscussionRoom,
  speaker: DiscussionRole,
  options: { forcedReply?: PendingRequiredReply | null; selectionReason: string },
): Promise<DiscussionRoom> {
  const reply = await generateParticipantContent(room, speaker, {
    forcedReply: options.forcedReply ?? null,
    selectionReason: options.selectionReason,
  });
  const forcedTargetMessage = options.forcedReply ? findMessage(room, options.forcedReply.sourceMessageId) : null;
  const replyMeta = forcedTargetMessage
    ? getReplyMetadata(room, options.forcedReply?.sourceMessageId ?? null)
    : getReplyMetadata(room, reply.replyToMessageId);
  const requiredReplyTarget = options.forcedReply ? null : getValidRequiredReplyTarget(room, speaker.id, reply.forceReplyRoleId);

  room.state.totalTurns += 1;
  room.state.lastActiveRoleId = speaker.id;

  const message = appendMessage(room, {
    roleId: speaker.id,
    roleName: speaker.name,
    kind: "participant",
    content: reply.content,
    ...replyMeta,
    requiredReplyRoleId: requiredReplyTarget?.id ?? null,
    requiredReplyRoleName: requiredReplyTarget?.name ?? null,
    round: room.state.currentRound,
    turn: room.state.totalTurns,
  });

  updateExchangeAfterParticipantMessage(room, speaker, message);

  if (requiredReplyTarget) {
    enqueueRequiredReply(room, message.id, requiredReplyTarget, "participant-direct-request", "front");
    setActiveExchange(
      room,
      {
        reason: "participant-forced-reply",
        triggerMessageId: message.id,
        hardTargetRoleId: requiredReplyTarget.id,
        respondedRoleIds: [],
        followUpTurnsRemaining: 0,
        openedAtTurn: message.turn,
      },
      { incrementRound: true },
    );
  }

  return room;
}

function finishCurrentExchange(room: DiscussionRoom): void {
  clearActiveExchange(room);
}

export function addUserMessage(room: DiscussionRoom, content: string, replyToMessageId?: string | null): DiscussionRoom {
  const normalized = content.replace(/\r/g, "").trim();
  if (!normalized) {
    throw new Error("User message cannot be empty.");
  }

  const replyTarget = findMessage(room, replyToMessageId);
  const requiredReplyTarget =
    replyTarget?.kind === "participant" ? getEnabledParticipant(room, replyTarget.roleId) ?? null : null;
  const replyMeta = getReplyMetadata(room, replyToMessageId);

  if (room.state.status === "running") {
    room.state.pendingRequiredReplies = [];
    setActiveExchange(
      room,
      {
        reason: "user-message",
        triggerMessageId: null,
        hardTargetRoleId: requiredReplyTarget?.id ?? null,
        respondedRoleIds: [],
        followUpTurnsRemaining: requiredReplyTarget ? 1 : 0,
        openedAtTurn: room.state.totalTurns + 1,
      },
      { incrementRound: true },
    );
  }

  room.state.totalTurns += 1;
  room.state.lastActiveRoleId = "user";

  const userMessage = appendMessage(room, {
    roleId: "user",
    roleName: "You",
    kind: "user",
    content: normalized,
    ...replyMeta,
    requiredReplyRoleId: requiredReplyTarget?.id ?? null,
    requiredReplyRoleName: requiredReplyTarget?.name ?? null,
    round: room.state.status === "running" ? room.state.currentRound : 0,
    turn: room.state.totalTurns,
  });

  if (room.state.activeExchange) {
    room.state.activeExchange.triggerMessageId = userMessage.id;
    room.state.activeExchange.hardTargetRoleId = requiredReplyTarget?.id ?? null;
    room.state.activeExchange.openedAtTurn = userMessage.turn;
    syncLegacySpeakerState(room);
  }

  if (requiredReplyTarget) {
    enqueueRequiredReply(room, userMessage.id, requiredReplyTarget, "user-direct-reply", "front");
  }

  return room;
}

export function startDiscussion(room: DiscussionRoom): DiscussionRoom {
  const participants = getParticipants(room);
  if (participants.length === 0) {
    throw new Error("At least one enabled participant role is required.");
  }
  assertDocumentReadyForDiscussion(room);

  room.messages = [];
  room.summary = {
    insights: [],
    updatedAt: null,
  };
  room.state = {
    status: "running",
    phase: "participants",
    currentRound: 1,
    nextSpeakerIndex: 0,
    totalTurns: 0,
    lastActiveRoleId: null,
    spokenParticipantRoleIds: [],
    pendingRequiredReplies: [],
    activeExchange: {
      id: randomUUID(),
      reason: "topic-start",
      triggerMessageId: null,
      hardTargetRoleId: null,
      respondedRoleIds: [],
      followUpTurnsRemaining: 0,
      openedAtTurn: 0,
    },
  };
  room.updatedAt = new Date().toISOString();
  return room;
}

export function stopDiscussion(room: DiscussionRoom): DiscussionRoom {
  if (room.state.status === "running") {
    room.state.status = "stopped";
    room.updatedAt = new Date().toISOString();
  }
  return room;
}

export function toggleInsightSaved(room: DiscussionRoom, insightId: string): DiscussionRoom {
  const target = room.summary.insights.find((insight) => insight.id === insightId);
  if (!target) {
    throw new Error("Insight not found.");
  }
  target.saved = !target.saved;
  room.summary.updatedAt = new Date().toISOString();
  room.updatedAt = new Date().toISOString();
  return room;
}

export async function stepDiscussion(room: DiscussionRoom): Promise<DiscussionRoom> {
  if (room.state.status !== "running") {
    throw new Error("The discussion is not currently running.");
  }

  const participants = getParticipants(room);
  const recorder = getRecorder(room);

  if (participants.length === 0) {
    throw new Error("At least one enabled participant role is required.");
  }

  let guard = 0;
  while (guard < 8) {
    guard += 1;

    if (room.state.phase === "participants") {
      if (!room.state.activeExchange) {
        beginTopicStartExchange(room, room.state.currentRound > 0);
      }

      const forcedReply = shiftNextRequiredReply(room);
      if (forcedReply) {
        if (
          !room.state.activeExchange ||
          room.state.activeExchange.triggerMessageId !== forcedReply.sourceMessageId ||
          room.state.activeExchange.hardTargetRoleId !== forcedReply.targetRoleId
        ) {
          setActiveExchange(
            room,
            {
              reason: forcedReply.reason === "user-direct-reply" ? "user-message" : "participant-forced-reply",
              triggerMessageId: forcedReply.sourceMessageId,
              hardTargetRoleId: forcedReply.targetRoleId,
              respondedRoleIds: [],
              followUpTurnsRemaining: forcedReply.reason === "user-direct-reply" ? 1 : 0,
              openedAtTurn: room.state.totalTurns,
            },
            { incrementRound: room.state.activeExchange !== null },
          );
        }

        const targetRole = getEnabledParticipant(room, forcedReply.targetRoleId);
        if (!targetRole) {
          continue;
        }
        await emitParticipantMessage(room, targetRole, {
          forcedReply,
          selectionReason: "You are the mandatory reply target in the current exchange.",
        });
        return room;
      }

      const candidate = chooseScoredSpeaker(room);
      if (candidate) {
        await emitParticipantMessage(room, candidate.role, {
          selectionReason: candidate.reason,
        });
        return room;
      }

      finishCurrentExchange(room);

      if (recorder && room.checkpointEveryRound) {
        room.state.phase = "recorder";
        continue;
      }

      if (room.state.currentRound >= room.maxRounds) {
        room.state.phase = "final";
        continue;
      }

      beginTopicStartExchange(room, true);
      continue;
    }

    if (room.state.phase === "recorder") {
      if (!recorder) {
        if (room.state.currentRound >= room.maxRounds) {
          room.state.phase = "final";
          continue;
        }
        room.state.phase = "participants";
        beginTopicStartExchange(room, true);
        continue;
      }

      const note = await generateRecorderCheckpoint(room, recorder);
      room.state.totalTurns += 1;
      room.state.lastActiveRoleId = recorder.id;

      const insight = appendInsight(room, {
        kind: "checkpoint",
        title: `Round ${room.state.currentRound} Notes`,
        content: note,
        round: room.state.currentRound,
        saved: false,
      });

      appendMessage(room, {
        roleId: recorder.id,
        roleName: recorder.name,
        kind: "recorder",
        content: insight.content,
        replyToMessageId: null,
        replyToRoleName: null,
        replyToExcerpt: null,
        requiredReplyRoleId: null,
        requiredReplyRoleName: null,
        round: room.state.currentRound,
        turn: room.state.totalTurns,
      });

      if (room.state.currentRound >= room.maxRounds) {
        room.state.phase = "final";
      } else {
        room.state.phase = "participants";
        beginTopicStartExchange(room, true);
      }
      return room;
    }

    if (room.state.phase === "final") {
      if (recorder) {
        const finalNote = await generateRecorderFinal(room, recorder);
        room.state.totalTurns += 1;
        room.state.lastActiveRoleId = recorder.id;

        const insight = appendInsight(room, {
          kind: "final",
          title: "Final Conclusion",
          content: finalNote,
          round: room.state.currentRound,
          saved: true,
        });

        appendMessage(room, {
          roleId: recorder.id,
          roleName: recorder.name,
          kind: "recorder",
          content: insight.content,
          replyToMessageId: null,
          replyToRoleName: null,
          replyToExcerpt: null,
          requiredReplyRoleId: null,
          requiredReplyRoleName: null,
          round: room.state.currentRound,
          turn: room.state.totalTurns,
        });
      } else {
        return completeWithoutRecorder(room);
      }

      room.state.status = "completed";
      room.updatedAt = new Date().toISOString();
      return room;
    }
  }

  throw new Error("Discussion scheduling entered an unexpected loop.");
}

export async function runDiscussion(room: DiscussionRoom, limit = 200): Promise<DiscussionRoom> {
  let guard = 0;
  while (room.state.status === "running" && guard < limit) {
    await stepDiscussion(room);
    guard += 1;
  }

  if (guard >= limit && room.state.status === "running") {
    throw new Error("Discussion exceeded the safety step limit and was stopped.");
  }

  return room;
}
