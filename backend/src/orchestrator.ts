import { randomUUID } from "crypto";
import { assertDocumentReadyForDiscussion } from "./documents";
import {
  generateParticipantContent,
  generateRecorderCheckpoint,
  generateRecorderFinal,
  type ParticipantReply,
} from "./providers";
import {
  ActiveExchange,
  ChatMessage,
  DiscussionRole,
  DiscussionRoom,
  InsightEntry,
  ParticipantActivityState,
  PendingRequiredReply,
} from "./types";

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
  room.state.nextSpeakerIndex = 0;
}

function createEmptyParticipantActivity(): ParticipantActivityState {
  return {
    lastSpokeTurn: 0,
    lastSpokeRound: 0,
    starvationDebt: 0,
    consecutiveSelections: 0,
    lastReplyTargetRoleId: null,
    directPressureDebt: 0,
    userPressureDebt: 0,
  };
}

function ensureParticipantActivityState(room: DiscussionRoom, participants = getParticipants(room)): void {
  const nextActivity: Record<string, ParticipantActivityState> = {};
  participants.forEach((role) => {
    nextActivity[role.id] = room.state.participantActivity[role.id] ?? createEmptyParticipantActivity();
  });
  room.state.participantActivity = nextActivity;
}

function initializeRoundPendingRoleIds(room: DiscussionRoom, participants = getParticipants(room)): void {
  room.state.roundPendingRoleIds = participants.map((role) => role.id);
  room.state.spokenParticipantRoleIds = [];
}

function ensureRoundSchedulerState(room: DiscussionRoom, participants = getParticipants(room)): void {
  ensureParticipantActivityState(room, participants);

  if (room.state.currentRound <= 0) {
    room.state.currentRound = Math.max(1, room.state.completedRoundCount + 1);
  }

  room.state.roundPendingRoleIds = room.state.roundPendingRoleIds.filter((roleId) =>
    participants.some((role) => role.id === roleId),
  );
  room.state.spokenParticipantRoleIds = room.state.spokenParticipantRoleIds.filter((roleId) =>
    participants.some((role) => role.id === roleId),
  );

  if (room.state.roundPendingRoleIds.length === 0 && room.state.spokenParticipantRoleIds.length === 0) {
    initializeRoundPendingRoleIds(room, participants);
  }
}

function hasCompletedCurrentRound(room: DiscussionRoom): boolean {
  return room.state.roundPendingRoleIds.length === 0 && room.state.currentRound > 0;
}

function maybeStartNextRound(room: DiscussionRoom, participants = getParticipants(room)): void {
  if (!hasCompletedCurrentRound(room)) {
    return;
  }

  room.state.currentRound = room.state.completedRoundCount + 1;
  initializeRoundPendingRoleIds(room, participants);
}

function getNextExchangeSequenceNumber(room: DiscussionRoom): number {
  return room.state.completedExchangeCount + 1;
}

function setActiveExchange(
  room: DiscussionRoom,
  params: Omit<ActiveExchange, "id" | "sequenceNumber">,
): void {
  const sequenceNumber = getNextExchangeSequenceNumber(room);
  room.state.phase = "participants";
  room.state.activeExchange = {
    id: randomUUID(),
    sequenceNumber,
    ...params,
  };
  syncLegacySpeakerState(room);
}

function clearActiveExchange(room: DiscussionRoom): void {
  room.state.activeExchange = null;
  syncLegacySpeakerState(room);
}

function beginTopicStartExchange(room: DiscussionRoom): void {
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
  );
}

function finalizeCompletedExchange(room: DiscussionRoom): number {
  const exchange = room.state.activeExchange;
  if (!exchange) {
    return room.state.completedExchangeCount;
  }

  room.state.completedExchangeCount += 1;
  clearActiveExchange(room);
  return room.state.completedExchangeCount;
}

function shouldEmitCheckpoint(room: DiscussionRoom): boolean {
  return (
    room.checkpointIntervalRounds > 0 &&
    room.state.completedRoundCount > 0 &&
    room.state.completedRoundCount % room.checkpointIntervalRounds === 0 &&
    room.state.completedRoundCount > room.state.lastCheckpointedRoundCount
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
    round: room.state.completedRoundCount > 0 ? room.state.completedRoundCount : room.state.currentRound,
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

type DeliveryMode = "must-reply" | "prefer-reply" | "prefer-broadcast";

type DeliveryPlan = {
  mode: DeliveryMode;
  replyCandidateIds: string[];
  allowedForceReplyRoleIds: string[];
};

function getParticipantActivity(room: DiscussionRoom, roleId: string): ParticipantActivityState {
  const activity = room.state.participantActivity[roleId];
  if (activity) {
    return activity;
  }
  const fallback = createEmptyParticipantActivity();
  room.state.participantActivity[roleId] = fallback;
  return fallback;
}

function getLatestDirectedUserMessageForRole(room: DiscussionRoom, roleId: string, openedAtTurn: number): ChatMessage | null {
  for (let index = room.messages.length - 1; index >= 0; index -= 1) {
    const message = room.messages[index];
    if (message.kind !== "user" || message.turn < openedAtTurn) {
      continue;
    }
    if (message.requiredReplyRoleId === roleId) {
      return message;
    }
    const replyTarget = findMessage(room, message.replyToMessageId);
    if (replyTarget?.roleId === roleId) {
      return message;
    }
  }
  return null;
}

function hasPendingDirectChallenge(room: DiscussionRoom, roleId: string, openedAtTurn: number): boolean {
  const latestDirectChallenge = getLatestDirectChallenge(room, roleId, openedAtTurn);
  return Boolean(latestDirectChallenge && !roleRespondedAfterTurn(room, roleId, latestDirectChallenge.turn));
}

function hasPendingUserEvidence(room: DiscussionRoom, roleId: string, openedAtTurn: number): boolean {
  const latestUser = getLatestUserMessage(room, openedAtTurn);
  if (!latestUser) {
    return false;
  }
  return !roleRespondedAfterTurn(room, roleId, latestUser.turn);
}

function getPrimaryReplyCandidates(room: DiscussionRoom, roleId: string, openedAtTurn: number): ChatMessage[] {
  const exchange = room.state.activeExchange;
  const seen = new Set<string>();
  const result: ChatMessage[] = [];

  function pushCandidate(message: ChatMessage | null): void {
    if (!message || seen.has(message.id)) {
      return;
    }
    seen.add(message.id);
    result.push(message);
  }

  if (exchange?.hardTargetRoleId === roleId && exchange.triggerMessageId) {
    pushCandidate(findMessage(room, exchange.triggerMessageId));
  }

  pushCandidate(getLatestDirectChallenge(room, roleId, openedAtTurn));
  pushCandidate(getLatestDirectedUserMessageForRole(room, roleId, openedAtTurn));

  for (let index = room.messages.length - 1; index >= 0 && result.length < 4; index -= 1) {
    const message = room.messages[index];
    if (message.turn < openedAtTurn || message.kind !== "participant" || message.roleId === roleId) {
      continue;
    }
    pushCandidate(message);
  }

  return result;
}

function buildSpeakerPool(room: DiscussionRoom, participants = getParticipants(room)): DiscussionRole[] {
  const participantById = new Map(participants.map((role) => [role.id, role]));
  const pendingPool = room.state.roundPendingRoleIds
    .map((roleId) => participantById.get(roleId) ?? null)
    .filter((role): role is DiscussionRole => Boolean(role));

  if (pendingPool.length === 0) {
    return [];
  }

  const starvedPool = pendingPool.filter((role) => getParticipantActivity(room, role.id).starvationDebt >= 3);
  return starvedPool.length > 0 ? starvedPool : pendingPool;
}

function chooseScoredSpeaker(room: DiscussionRoom): SpeakerCandidate | null {
  const exchange = room.state.activeExchange;
  const participants = getParticipants(room);
  if (!exchange || participants.length === 0) {
    return null;
  }

  const pool = buildSpeakerPool(room, participants);
  if (pool.length === 0) {
    return null;
  }

  const latestParticipant = getLatestParticipantMessage(room);

  const candidates: SpeakerCandidate[] = pool.map((role) => {
    const activity = getParticipantActivity(room, role.id);
    const turnsSinceLastSpeech = activity.lastSpokeTurn > 0 ? room.state.totalTurns - activity.lastSpokeTurn : room.state.totalTurns + 1;
    const pendingDirectChallenge = hasPendingDirectChallenge(room, role.id, exchange.openedAtTurn);
    const pendingUserEvidence = hasPendingUserEvidence(room, role.id, exchange.openedAtTurn);
    const isHardTarget = exchange.hardTargetRoleId === role.id && !exchange.respondedRoleIds.includes(role.id);

    let score = Math.min(48, turnsSinceLastSpeech * 6);
    score += activity.starvationDebt * 18;
    score += pendingDirectChallenge ? 40 + activity.directPressureDebt * 8 : 0;
    score += pendingUserEvidence ? 30 + activity.userPressureDebt * 6 : 0;
    score += isHardTarget ? 120 : 0;
    score -= latestParticipant?.roleId === role.id ? 90 : 0;
    score -= activity.consecutiveSelections > 1 ? 50 * activity.consecutiveSelections : 0;
    score -= latestParticipant?.roleId === activity.lastReplyTargetRoleId ? 35 : 0;

    const reason = isHardTarget
      ? "mandatory hard target"
      : activity.starvationDebt >= 3
        ? "starvation debt override"
        : pendingDirectChallenge
          ? "unanswered direct challenge"
          : pendingUserEvidence
            ? "pending user evidence"
            : turnsSinceLastSpeech > 4
              ? "long silence debt"
              : "round fairness continuation";

    return { role, score, reason };
  });

  candidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    const leftActivity = getParticipantActivity(room, left.role.id);
    const rightActivity = getParticipantActivity(room, right.role.id);
    if (rightActivity.starvationDebt !== leftActivity.starvationDebt) {
      return rightActivity.starvationDebt - leftActivity.starvationDebt;
    }

    const leftTurnsSinceLastSpeech = leftActivity.lastSpokeTurn > 0 ? room.state.totalTurns - leftActivity.lastSpokeTurn : room.state.totalTurns + 1;
    const rightTurnsSinceLastSpeech =
      rightActivity.lastSpokeTurn > 0 ? room.state.totalTurns - rightActivity.lastSpokeTurn : room.state.totalTurns + 1;
    if (rightTurnsSinceLastSpeech !== leftTurnsSinceLastSpeech) {
      return rightTurnsSinceLastSpeech - leftTurnsSinceLastSpeech;
    }

    return participants.findIndex((role) => role.id === left.role.id) - participants.findIndex((role) => role.id === right.role.id);
  });

  return candidates[0] ?? null;
}

function buildDeliveryPlan(room: DiscussionRoom, speaker: DiscussionRole, forcedReply?: PendingRequiredReply | null): DeliveryPlan {
  const exchange = room.state.activeExchange;
  const openedAtTurn = exchange?.openedAtTurn ?? 0;
  const replyCandidates = getPrimaryReplyCandidates(room, speaker.id, openedAtTurn);
  const hardTargetMessage =
    forcedReply?.sourceMessageId ?? (exchange?.hardTargetRoleId === speaker.id ? exchange.triggerMessageId : null);
  const hasMandatoryReply = Boolean(hardTargetMessage);
  const pendingDirectChallenge = hasPendingDirectChallenge(room, speaker.id, openedAtTurn);
  const directedUserMessage = getLatestDirectedUserMessageForRole(room, speaker.id, openedAtTurn);

  const mode: DeliveryMode = hasMandatoryReply || pendingDirectChallenge || Boolean(directedUserMessage)
    ? "must-reply"
    : replyCandidates.length > 0
      ? "prefer-reply"
      : "prefer-broadcast";

  return {
    mode,
    replyCandidateIds: replyCandidates.map((message) => message.id),
    allowedForceReplyRoleIds: room.state.roundPendingRoleIds.filter((roleId) => roleId !== speaker.id),
  };
}

function correctParticipantReply(
  room: DiscussionRoom,
  speaker: DiscussionRole,
  reply: ParticipantReply,
  plan: DeliveryPlan,
): ParticipantReply {
  const allowedReplyIds = new Set(plan.replyCandidateIds);
  const preferredReplyMessageId = plan.replyCandidateIds[0] ?? null;
  const replyTargetIsValid = reply.replyToMessageId ? allowedReplyIds.has(reply.replyToMessageId) : false;

  let nextReplyToMessageId = reply.replyToMessageId;
  if (plan.mode === "must-reply") {
    nextReplyToMessageId = preferredReplyMessageId;
  } else if (plan.mode === "prefer-reply") {
    nextReplyToMessageId = replyTargetIsValid ? reply.replyToMessageId : preferredReplyMessageId;
  } else if (reply.replyToMessageId && !replyTargetIsValid) {
    nextReplyToMessageId = null;
  }

  const replyMeta = getReplyMetadata(room, nextReplyToMessageId);
  const latestParticipant = getLatestParticipantMessage(room);
  const speakerActivity = getParticipantActivity(room, speaker.id);
  const allowedForceReplyIds = new Set(plan.allowedForceReplyRoleIds);

  let nextForceReplyRoleId = reply.forceReplyRoleId;
  if (!nextForceReplyRoleId || !allowedForceReplyIds.has(nextForceReplyRoleId)) {
    nextForceReplyRoleId = null;
  } else if (
    latestParticipant?.roleId === nextForceReplyRoleId &&
    speakerActivity.lastReplyTargetRoleId === nextForceReplyRoleId &&
    !hasPendingDirectChallenge(room, nextForceReplyRoleId, room.state.activeExchange?.openedAtTurn ?? 0) &&
    !hasPendingUserEvidence(room, nextForceReplyRoleId, room.state.activeExchange?.openedAtTurn ?? 0)
  ) {
    nextForceReplyRoleId = null;
  }

  return {
    ...reply,
    ...replyMeta,
    forceReplyRoleId: nextForceReplyRoleId,
  };
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

function updateParticipantActivityAfterMessage(
  room: DiscussionRoom,
  speaker: DiscussionRole,
  message: ChatMessage,
  previousParticipantRoleId: string | null,
  participants = getParticipants(room),
): void {
  const latestUser = getLatestUserMessage(room, room.state.activeExchange?.openedAtTurn ?? 0);

  participants.forEach((role) => {
    const activity = getParticipantActivity(room, role.id);

    if (role.id === speaker.id) {
      activity.lastSpokeTurn = message.turn;
      activity.lastSpokeRound = message.round;
      activity.starvationDebt = 0;
      activity.directPressureDebt = 0;
      activity.userPressureDebt = 0;
      activity.lastReplyTargetRoleId = message.replyToMessageId ? findMessage(room, message.replyToMessageId)?.roleId ?? null : null;
      activity.consecutiveSelections =
        previousParticipantRoleId === speaker.id ? Math.max(1, activity.consecutiveSelections + 1) : 1;
      return;
    }

    activity.consecutiveSelections = 0;

    if (room.state.roundPendingRoleIds.includes(role.id)) {
      activity.starvationDebt += 1;
    }

    const directChallenge = getLatestDirectChallenge(room, role.id, room.state.activeExchange?.openedAtTurn ?? 0);
    if (directChallenge && !roleRespondedAfterTurn(room, role.id, directChallenge.turn)) {
      activity.directPressureDebt += 1;
    } else {
      activity.directPressureDebt = 0;
    }

    if (latestUser && !roleRespondedAfterTurn(room, role.id, latestUser.turn)) {
      activity.userPressureDebt += 1;
    } else {
      activity.userPressureDebt = 0;
    }
  });
}

async function emitParticipantMessage(
  room: DiscussionRoom,
  speaker: DiscussionRole,
  options: { forcedReply?: PendingRequiredReply | null; selectionReason: string },
): Promise<DiscussionRoom> {
  const participants = getParticipants(room);
  ensureRoundSchedulerState(room, participants);
  maybeStartNextRound(room, participants);
  const previousParticipantRoleId = getLatestParticipantMessage(room)?.roleId ?? null;

  const deliveryPlan = buildDeliveryPlan(room, speaker, options.forcedReply ?? null);
  const rawReply = await generateParticipantContent(room, speaker, {
    forcedReply: options.forcedReply ?? null,
    selectionReason: options.selectionReason,
    deliveryMode: deliveryPlan.mode,
    orderedReplyCandidateIds: deliveryPlan.replyCandidateIds,
    allowedForceReplyRoleIds: deliveryPlan.allowedForceReplyRoleIds,
  });
  const reply = correctParticipantReply(room, speaker, rawReply, deliveryPlan);
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
  room.state.roundPendingRoleIds = room.state.roundPendingRoleIds.filter((roleId) => roleId !== speaker.id);
  if (!room.state.spokenParticipantRoleIds.includes(speaker.id)) {
    room.state.spokenParticipantRoleIds.push(speaker.id);
  }
  updateParticipantActivityAfterMessage(room, speaker, message, previousParticipantRoleId, participants);

  if (room.state.roundPendingRoleIds.length === 0) {
    room.state.completedRoundCount = Math.max(room.state.completedRoundCount, room.state.currentRound);
  }

  if (requiredReplyTarget) {
    enqueueRequiredReply(room, message.id, requiredReplyTarget, "participant-direct-request", "front");
    if (room.state.roundPendingRoleIds.includes(requiredReplyTarget.id)) {
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
      );
    }
  }

  return room;
}

function finishCurrentExchange(room: DiscussionRoom): void {
  finalizeCompletedExchange(room);
}

async function emitRecorderCheckpoint(room: DiscussionRoom, recorder: DiscussionRole): Promise<void> {
  const note = await generateRecorderCheckpoint(room, recorder);
  room.state.totalTurns += 1;
  room.state.lastActiveRoleId = recorder.id;

  const insight = appendInsight(room, {
    kind: "checkpoint",
    title: `Round ${room.state.completedRoundCount} Notes`,
    content: note,
    round: room.state.completedRoundCount,
    saved: false,
  });
  room.state.lastCheckpointedRoundCount = room.state.completedRoundCount;
  room.state.lastCheckpointedExchangeCount = room.state.completedExchangeCount;

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
    round: room.state.completedRoundCount,
    turn: room.state.totalTurns,
  });
}

async function emitRecorderFinal(room: DiscussionRoom, recorder: DiscussionRole): Promise<void> {
  const finalNote = await generateRecorderFinal(room, recorder);
  room.state.totalTurns += 1;
  room.state.lastActiveRoleId = recorder.id;

  const insight = appendInsight(room, {
    kind: "final",
    title: "Final Conclusion",
    content: finalNote,
    round: room.state.completedRoundCount > 0 ? room.state.completedRoundCount : room.state.currentRound,
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
    round: room.state.completedRoundCount > 0 ? room.state.completedRoundCount : room.state.currentRound,
    turn: room.state.totalTurns,
  });
}

function prepareStopFinalization(room: DiscussionRoom): void {
  room.state.pendingRequiredReplies = [];
  room.state.roundPendingRoleIds = [];
  room.state.spokenParticipantRoleIds = [];
  clearActiveExchange(room);
  room.state.phase = "final";
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
    completedRoundCount: 0,
    lastCheckpointedRoundCount: 0,
    completedExchangeCount: 0,
    lastCheckpointedExchangeCount: 0,
    nextSpeakerIndex: 0,
    totalTurns: 0,
    lastActiveRoleId: null,
    spokenParticipantRoleIds: [],
    roundPendingRoleIds: participants.map((role) => role.id),
    participantActivity: Object.fromEntries(
      participants.map((role) => [role.id, createEmptyParticipantActivity()]),
    ),
    pendingRequiredReplies: [],
    activeExchange: {
      id: randomUUID(),
      sequenceNumber: 1,
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

export async function stopAndFinalizeDiscussion(room: DiscussionRoom): Promise<DiscussionRoom> {
  if (room.state.status === "completed") {
    return room;
  }

  if (room.state.status !== "running" && room.state.status !== "stopped") {
    return room;
  }

  const recorder = getRecorder(room);
  prepareStopFinalization(room);

  if (recorder) {
    await emitRecorderFinal(room, recorder);
    room.state.status = "completed";
    room.updatedAt = new Date().toISOString();
    return room;
  }

  return completeWithoutRecorder(room);
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
      ensureRoundSchedulerState(room, participants);
      maybeStartNextRound(room, participants);

      if (!room.state.activeExchange) {
        beginTopicStartExchange(room);
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

        if (hasCompletedCurrentRound(room)) {
          finishCurrentExchange(room);
        }

        if (room.state.completedRoundCount >= room.maxRounds) {
          room.state.phase = "final";
        }

        if (recorder && shouldEmitCheckpoint(room)) {
          await emitRecorderCheckpoint(room, recorder);
          if (room.state.completedRoundCount >= room.maxRounds) {
            prepareStopFinalization(room);
          }
        }
        return room;
      }

      const candidate = chooseScoredSpeaker(room);
      if (candidate) {
        await emitParticipantMessage(room, candidate.role, {
          selectionReason: candidate.reason,
        });

        if (hasCompletedCurrentRound(room)) {
          finishCurrentExchange(room);
        }

        if (room.state.completedRoundCount >= room.maxRounds) {
          room.state.phase = "final";
        }

        if (recorder && shouldEmitCheckpoint(room)) {
          await emitRecorderCheckpoint(room, recorder);
          if (room.state.completedRoundCount >= room.maxRounds) {
            prepareStopFinalization(room);
          }
        }
        return room;
      }

      finishCurrentExchange(room);

      if (recorder && shouldEmitCheckpoint(room)) {
        room.state.phase = "recorder";
        continue;
      }

      if (room.state.completedRoundCount >= room.maxRounds) {
        room.state.phase = "final";
        continue;
      }

      beginTopicStartExchange(room);
      continue;
    }

    if (room.state.phase === "recorder") {
      if (!recorder) {
        if (room.state.completedRoundCount >= room.maxRounds) {
          room.state.phase = "final";
          continue;
        }
        room.state.phase = "participants";
        beginTopicStartExchange(room);
        continue;
      }

      await emitRecorderCheckpoint(room, recorder);

      if (room.state.completedRoundCount >= room.maxRounds) {
        room.state.phase = "final";
      } else {
        room.state.phase = "participants";
        beginTopicStartExchange(room);
      }
      return room;
    }

    if (room.state.phase === "final") {
      if (recorder) {
        await emitRecorderFinal(room, recorder);
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
