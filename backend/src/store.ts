import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import {
  createBlankRoom,
  createBuiltInProviderPresets,
  createReviewerAdvisorRoom,
  createSummary,
  normalizePreset,
  normalizeRole,
} from "./defaults";
import { ChatMessage, DiscussionRoom, DiscussionSummary, InsightEntry, ProviderPreset } from "./types";

const dataDir = path.resolve(__dirname, "../../data");
const roomsFile = path.join(dataDir, "rooms.json");
const presetsFile = path.join(dataDir, "provider-presets.json");
const settingsFile = path.join(dataDir, "settings.json");

async function ensureFile(filePath: string, initialContent: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, initialContent, "utf-8");
  }
}

function normalizeInsight(input: Partial<InsightEntry>, fallbackKind: InsightEntry["kind"], fallbackTitle: string, fallbackRound: number): InsightEntry {
  return {
    id: input.id ?? randomUUID(),
    kind: input.kind ?? fallbackKind,
    title: input.title?.trim() || fallbackTitle,
    content: input.content?.trim() || "",
    round:
      typeof input.round === "number" && Number.isFinite(input.round)
        ? input.round
        : fallbackRound,
    saved: Boolean(input.saved),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

function normalizeMessage(input: Partial<ChatMessage>, fallbackTurn: number): ChatMessage {
  return {
    id: input.id ?? randomUUID(),
    roleId: input.roleId ?? "system",
    roleName: input.roleName?.trim() || "Unknown",
    kind: input.kind ?? "system",
    content: input.content?.trim() || "",
    replyToMessageId: input.replyToMessageId ?? null,
    replyToRoleName: input.replyToRoleName?.trim() ?? null,
    replyToExcerpt: input.replyToExcerpt?.trim() ?? null,
    round: typeof input.round === "number" && Number.isFinite(input.round) ? input.round : 0,
    turn: typeof input.turn === "number" && Number.isFinite(input.turn) ? input.turn : fallbackTurn,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

function normalizeSummary(input: unknown): DiscussionSummary {
  const fallback = createSummary();
  const raw = (input ?? {}) as {
    insights?: Partial<InsightEntry>[];
    checkpoints?: string[];
    final?: string;
    updatedAt?: string | null;
  };

  const insights: InsightEntry[] = [];

  if (Array.isArray(raw.insights)) {
    raw.insights.forEach((item, index) => {
      insights.push(
        normalizeInsight(item, item.kind ?? "checkpoint", item.title ?? `Insight ${index + 1}`, item.round ?? index + 1),
      );
    });
  } else {
    if (Array.isArray(raw.checkpoints)) {
      raw.checkpoints.forEach((content, index) => {
        if (!content?.trim()) {
          return;
        }
        insights.push(
          normalizeInsight(
            {
              kind: "checkpoint",
              title: `Round ${index + 1} Notes`,
              content,
              round: index + 1,
            },
            "checkpoint",
            `Round ${index + 1} Notes`,
            index + 1,
          ),
        );
      });
    }

    if (typeof raw.final === "string" && raw.final.trim()) {
      insights.push(
        normalizeInsight(
          {
            kind: "final",
            title: "Final Conclusion",
            content: raw.final,
            round: insights.length > 0 ? insights[insights.length - 1].round : 0,
            saved: true,
          },
          "final",
          "Final Conclusion",
          0,
        ),
      );
    }
  }

  return {
    insights,
    updatedAt: raw.updatedAt ?? fallback.updatedAt,
  };
}

function normalizeRoom(input: Partial<DiscussionRoom>): DiscussionRoom {
  const base = createBlankRoom();
  const createdAt = input.createdAt ?? base.createdAt;
  return {
    ...base,
    ...input,
    id: input.id ?? base.id,
    title: input.title?.trim() || base.title,
    topic: input.topic?.trim() || base.topic,
    objective: input.objective?.trim() || base.objective,
    discussionLanguage: input.discussionLanguage ?? base.discussionLanguage,
    researchDirectionKey: input.researchDirectionKey ?? base.researchDirectionKey,
    researchDirectionNote: input.researchDirectionNote?.trim() ?? base.researchDirectionNote,
    autoRunDelaySeconds:
      typeof input.autoRunDelaySeconds === "number" && Number.isFinite(input.autoRunDelaySeconds)
        ? Math.max(0.2, Math.min(30, input.autoRunDelaySeconds))
        : base.autoRunDelaySeconds,
    maxRounds:
      typeof input.maxRounds === "number" && Number.isFinite(input.maxRounds)
        ? Math.max(1, Math.min(12, input.maxRounds))
        : base.maxRounds,
    checkpointEveryRound:
      typeof input.checkpointEveryRound === "boolean" ? input.checkpointEveryRound : base.checkpointEveryRound,
    roles: Array.isArray(input.roles) ? input.roles.map((role) => normalizeRole(role)) : base.roles,
    messages: Array.isArray(input.messages) ? input.messages.map((message, index) => normalizeMessage(message, index + 1)) : [],
    summary: normalizeSummary(input.summary),
    state: {
      ...base.state,
      ...(input.state ?? {}),
    },
    createdAt,
    updatedAt: input.updatedAt ?? createdAt,
  };
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function ensureStorage(): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  await ensureFile(roomsFile, "[]");
  await ensureFile(presetsFile, "[]");
  await ensureFile(settingsFile, JSON.stringify({ lastOpenedRoomId: null }, null, 2));

  const existingRooms = await listRooms();
  if (existingRooms.length === 0) {
    await writeRooms([createReviewerAdvisorRoom(), createBlankRoom()]);
  }

  const existingPresets = await listProviderPresets();
  if (existingPresets.length === 0) {
    await writeProviderPresets(createBuiltInProviderPresets());
  }
}

export async function readRooms(): Promise<DiscussionRoom[]> {
  const parsed = await readJsonFile<Partial<DiscussionRoom>[]>(roomsFile, []);
  return Array.isArray(parsed) ? parsed.map((room) => normalizeRoom(room)) : [];
}

export async function writeRooms(rooms: DiscussionRoom[]): Promise<void> {
  await fs.writeFile(roomsFile, JSON.stringify(rooms, null, 2), "utf-8");
}

export async function listRooms(): Promise<DiscussionRoom[]> {
  return readRooms();
}

export async function getRoom(roomId: string): Promise<DiscussionRoom | undefined> {
  const rooms = await readRooms();
  return rooms.find((room) => room.id === roomId);
}

export async function saveRoom(room: DiscussionRoom): Promise<DiscussionRoom> {
  const rooms = await readRooms();
  const normalized = normalizeRoom(room);
  const index = rooms.findIndex((item) => item.id === normalized.id);

  if (index >= 0) {
    rooms[index] = normalized;
  } else {
    rooms.push(normalized);
  }

  await writeRooms(rooms);
  return normalized;
}

export async function deleteRoom(roomId: string): Promise<boolean> {
  const rooms = await readRooms();
  const nextRooms = rooms.filter((room) => room.id !== roomId);

  if (nextRooms.length === rooms.length) {
    return false;
  }

  await writeRooms(nextRooms);
  return true;
}

export async function readProviderPresets(): Promise<ProviderPreset[]> {
  const parsed = await readJsonFile<Partial<ProviderPreset>[]>(presetsFile, []);
  return Array.isArray(parsed) ? parsed.map((preset) => normalizePreset(preset)) : [];
}

export async function writeProviderPresets(presets: ProviderPreset[]): Promise<void> {
  await fs.writeFile(presetsFile, JSON.stringify(presets, null, 2), "utf-8");
}

export async function listProviderPresets(): Promise<ProviderPreset[]> {
  return readProviderPresets();
}

export async function getProviderPreset(presetId: string): Promise<ProviderPreset | undefined> {
  const presets = await readProviderPresets();
  return presets.find((preset) => preset.id === presetId);
}

export async function saveProviderPreset(preset: ProviderPreset): Promise<ProviderPreset> {
  const presets = await readProviderPresets();
  const normalized = normalizePreset(preset);
  const index = presets.findIndex((item) => item.id === normalized.id);

  if (index >= 0) {
    presets[index] = normalized;
  } else {
    presets.push(normalized);
  }

  await writeProviderPresets(presets);
  return normalized;
}

export async function deleteProviderPreset(presetId: string): Promise<boolean> {
  const presets = await readProviderPresets();
  const target = presets.find((preset) => preset.id === presetId);
  if (!target || target.builtIn) {
    return false;
  }

  const nextPresets = presets.filter((preset) => preset.id !== presetId);
  await writeProviderPresets(nextPresets);
  return true;
}
