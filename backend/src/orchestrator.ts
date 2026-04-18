import { randomUUID } from "crypto";
import { generateParticipantContent, generateRecorderCheckpoint, generateRecorderFinal } from "./providers";
import { ChatMessage, DiscussionRole, DiscussionRoom, InsightEntry } from "./types";

function getParticipants(room: DiscussionRoom): DiscussionRole[] {
  return room.roles.filter((role) => role.enabled && role.kind === "participant");
}

function getRecorder(room: DiscussionRoom): DiscussionRole | undefined {
  return room.roles.find((role) => role.enabled && role.kind === "recorder");
}

function appendMessage(room: DiscussionRoom, message: Omit<ChatMessage, "id" | "createdAt">): void {
  room.messages.push({
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...message,
  });
  room.updatedAt = new Date().toISOString();
}

export function addUserMessage(room: DiscussionRoom, content: string): DiscussionRoom {
  const normalized = content.replace(/\r/g, "").trim();
  if (!normalized) {
    throw new Error("User message cannot be empty.");
  }

  room.state.totalTurns += 1;
  room.state.lastActiveRoleId = "user";

  appendMessage(room, {
    roleId: "user",
    roleName: "You",
    kind: "user",
    content: normalized,
    round: room.state.currentRound,
    turn: room.state.totalTurns,
  });

  return room;
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
  room.updatedAt = new Date().toISOString();
  return room;
}

export function startDiscussion(room: DiscussionRoom): DiscussionRoom {
  const participants = getParticipants(room);
  if (participants.length === 0) {
    throw new Error("At least one enabled participant role is required.");
  }

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

  if (room.state.phase === "participants") {
    const speaker = participants[room.state.nextSpeakerIndex];
    const content = await generateParticipantContent(room, speaker);

    room.state.totalTurns += 1;
    room.state.lastActiveRoleId = speaker.id;
    appendMessage(room, {
      roleId: speaker.id,
      roleName: speaker.name,
      kind: "participant",
      content,
      round: room.state.currentRound,
      turn: room.state.totalTurns,
    });

    if (room.state.nextSpeakerIndex < participants.length - 1) {
      room.state.nextSpeakerIndex += 1;
      return room;
    }

    if (recorder && room.checkpointEveryRound) {
      room.state.phase = "recorder";
      return room;
    }

    if (room.state.currentRound >= room.maxRounds) {
      if (recorder) {
        room.state.phase = "final";
        return room;
      }
      return completeWithoutRecorder(room);
    }

    room.state.currentRound += 1;
    room.state.nextSpeakerIndex = 0;
    return room;
  }

  if (room.state.phase === "recorder") {
    if (!recorder) {
      room.state.phase = room.state.currentRound >= room.maxRounds ? "final" : "participants";
      if (room.state.phase === "participants") {
        room.state.currentRound += 1;
        room.state.nextSpeakerIndex = 0;
      }
      return room;
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
      round: room.state.currentRound,
      turn: room.state.totalTurns,
    });

    if (room.state.currentRound >= room.maxRounds) {
      room.state.phase = "final";
      return room;
    }

    room.state.currentRound += 1;
    room.state.nextSpeakerIndex = 0;
    room.state.phase = "participants";
    return room;
  }

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
