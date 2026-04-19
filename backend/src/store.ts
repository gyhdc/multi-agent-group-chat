import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import {
  createBlankRoom,
  createBuiltInProviderPresets,
  createParticipantActivityState,
  createReviewerAdvisorRoom,
  createSummary,
  normalizePreset,
  normalizeRole,
} from "./defaults";
import { createBuiltInRoleTemplatePresets } from "./discussionCatalog";
import {
  ActiveExchange,
  ChatMessage,
  DocumentOutlineNode,
  DocumentSegment,
  DocumentSummary,
  DiscussionRole,
  DiscussionRoom,
  DiscussionState,
  DiscussionSummary,
  InsightEntry,
  ParticipantActivityState,
  PendingRequiredReply,
  ProviderPreset,
  ResearchDirectionPreset,
  RoleTemplateKey,
  RoleTemplatePreset,
  RoomDocumentAsset,
} from "./types";

const dataDir = path.resolve(__dirname, "../../data");
const roomsFile = path.join(dataDir, "rooms.json");
const presetsFile = path.join(dataDir, "provider-presets.json");
const settingsFile = path.join(dataDir, "settings.json");

interface AppSettings {
  lastOpenedRoomId: string | null;
  researchDirections: ResearchDirectionPreset[];
  roleTemplates: RoleTemplatePreset[];
}

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
    requiredReplyRoleId: input.requiredReplyRoleId ?? null,
    requiredReplyRoleName: input.requiredReplyRoleName?.trim() ?? null,
    round: typeof input.round === "number" && Number.isFinite(input.round) ? input.round : 0,
    turn: typeof input.turn === "number" && Number.isFinite(input.turn) ? input.turn : fallbackTurn,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

function normalizeDocumentAsset(input: Partial<RoomDocumentAsset> | null | undefined): RoomDocumentAsset | null {
  if (!input?.id || !input?.fileName || !input?.storedFileName || !input?.mimeType || !input?.fileKind) {
    return null;
  }

  return {
    id: input.id,
    fileName: input.fileName,
    storedFileName: input.storedFileName,
    mimeType: input.mimeType,
    fileKind: input.fileKind,
    sizeBytes: typeof input.sizeBytes === "number" && Number.isFinite(input.sizeBytes) ? input.sizeBytes : 0,
    pageCount:
      typeof input.pageCount === "number" && Number.isFinite(input.pageCount)
        ? input.pageCount
        : input.pageCount === null
          ? null
          : null,
    charCount: typeof input.charCount === "number" && Number.isFinite(input.charCount) ? input.charCount : 0,
    title: input.title?.trim() || input.fileName,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

function normalizeDocumentSegment(input: Partial<DocumentSegment>, fallbackOrder: number): DocumentSegment | null {
  if (!input?.id) {
    return null;
  }

  return {
    id: input.id,
    kind: input.kind ?? "block",
    title: input.title?.trim() || `Segment ${fallbackOrder + 1}`,
    content: input.content?.trim() || "",
    pageStart:
      typeof input.pageStart === "number" && Number.isFinite(input.pageStart)
        ? input.pageStart
        : input.pageStart === null
          ? null
          : null,
    pageEnd:
      typeof input.pageEnd === "number" && Number.isFinite(input.pageEnd)
        ? input.pageEnd
        : input.pageEnd === null
          ? null
          : null,
    level: typeof input.level === "number" && Number.isFinite(input.level) ? input.level : 0,
    parentId: typeof input.parentId === "string" ? input.parentId : null,
    path: Array.isArray(input.path) ? input.path.filter((value): value is string => typeof value === "string") : [],
    order: typeof input.order === "number" && Number.isFinite(input.order) ? input.order : fallbackOrder,
  };
}

function normalizeDocumentOutlineNode(input: Partial<DocumentOutlineNode>): DocumentOutlineNode | null {
  if (!input?.id || !input.segmentId) {
    return null;
  }

  return {
    id: input.id,
    segmentId: input.segmentId,
    title: input.title?.trim() || "Untitled Node",
    kind: input.kind ?? "block",
    children: Array.isArray(input.children)
      ? input.children
          .map((child) => normalizeDocumentOutlineNode(child))
          .filter((child): child is DocumentOutlineNode => Boolean(child))
      : [],
  };
}

function normalizeDocumentSummary(input: Partial<DocumentSummary> | null | undefined): DocumentSummary | null {
  if (!input) {
    return null;
  }

  return {
    title: input.title?.trim() || "",
    abstract: input.abstract?.trim() || "",
    defaultTopic: input.defaultTopic?.trim() || "",
  };
}

function normalizePendingRequiredReply(input: Partial<PendingRequiredReply>): PendingRequiredReply | null {
  const sourceMessageId = input.sourceMessageId?.trim();
  const targetRoleId = input.targetRoleId?.trim();
  const targetRoleName = input.targetRoleName?.trim();

  if (!sourceMessageId || !targetRoleId || !targetRoleName) {
    return null;
  }

  return {
    sourceMessageId,
    targetRoleId,
    targetRoleName,
    reason: input.reason === "participant-direct-request" ? "participant-direct-request" : "user-direct-reply",
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

function normalizeParticipantActivity(input: Partial<ParticipantActivityState> | null | undefined): ParticipantActivityState {
  const fallback = createParticipantActivityState();
  return {
    ...fallback,
    lastSpokeTurn:
      typeof input?.lastSpokeTurn === "number" && Number.isFinite(input.lastSpokeTurn) ? Math.max(0, input.lastSpokeTurn) : fallback.lastSpokeTurn,
    lastSpokeRound:
      typeof input?.lastSpokeRound === "number" && Number.isFinite(input.lastSpokeRound)
        ? Math.max(0, input.lastSpokeRound)
        : fallback.lastSpokeRound,
    starvationDebt:
      typeof input?.starvationDebt === "number" && Number.isFinite(input.starvationDebt)
        ? Math.max(0, Math.floor(input.starvationDebt))
        : fallback.starvationDebt,
    consecutiveSelections:
      typeof input?.consecutiveSelections === "number" && Number.isFinite(input.consecutiveSelections)
        ? Math.max(0, Math.floor(input.consecutiveSelections))
        : fallback.consecutiveSelections,
    lastReplyTargetRoleId: typeof input?.lastReplyTargetRoleId === "string" ? input.lastReplyTargetRoleId : null,
    directPressureDebt:
      typeof input?.directPressureDebt === "number" && Number.isFinite(input.directPressureDebt)
        ? Math.max(0, Math.floor(input.directPressureDebt))
        : fallback.directPressureDebt,
    userPressureDebt:
      typeof input?.userPressureDebt === "number" && Number.isFinite(input.userPressureDebt)
        ? Math.max(0, Math.floor(input.userPressureDebt))
        : fallback.userPressureDebt,
  };
}

function normalizeActiveExchange(input: Partial<ActiveExchange> | null | undefined): ActiveExchange | null {
  if (!input?.id) {
    return null;
  }

  return {
    id: input.id,
    sequenceNumber:
      typeof input.sequenceNumber === "number" && Number.isFinite(input.sequenceNumber) ? Math.max(1, input.sequenceNumber) : 1,
    reason:
      input.reason === "user-message" || input.reason === "participant-forced-reply" ? input.reason : "topic-start",
    triggerMessageId: typeof input.triggerMessageId === "string" ? input.triggerMessageId : null,
    hardTargetRoleId: typeof input.hardTargetRoleId === "string" ? input.hardTargetRoleId : null,
    respondedRoleIds: Array.isArray(input.respondedRoleIds)
      ? input.respondedRoleIds.filter((roleId): roleId is string => typeof roleId === "string" && roleId.trim().length > 0)
      : [],
    followUpTurnsRemaining:
      typeof input.followUpTurnsRemaining === "number" && Number.isFinite(input.followUpTurnsRemaining)
        ? Math.max(0, Math.floor(input.followUpTurnsRemaining))
        : 0,
    openedAtTurn:
      typeof input.openedAtTurn === "number" && Number.isFinite(input.openedAtTurn) ? Math.max(0, input.openedAtTurn) : 0,
  };
}

function normalizeResearchDirection(input: Partial<ResearchDirectionPreset>): ResearchDirectionPreset {
  const now = new Date().toISOString();
  return {
    id: input.id ?? randomUUID(),
    label: input.label?.trim() || "Custom Direction",
    description: input.description?.trim() || "",
    builtIn: false,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };
}

function normalizeRoleTemplatePreset(input: Partial<RoleTemplatePreset>): RoleTemplatePreset {
  const now = new Date().toISOString();
  return {
    id: input.id ?? randomUUID(),
    name: input.name?.trim() || "Custom Role Template",
    kind: input.kind === "recorder" ? "recorder" : "participant",
    persona: input.persona?.trim() || "",
    principles: input.principles?.trim() || "",
    goal: input.goal?.trim() || "",
    voiceStyle: input.voiceStyle?.trim() || "",
    accentColor: input.accentColor?.trim() || "#49617a",
    builtIn: Boolean(input.builtIn),
    createdAt: input.createdAt?.trim() || now,
    updatedAt: now,
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

function normalizeState(input: Partial<DiscussionState> | undefined, fallback: DiscussionState): DiscussionState {
  const activeExchange = normalizeActiveExchange(input?.activeExchange);
  const legacyInput = input as Partial<DiscussionState> | undefined;
  const spokenParticipantRoleIds = Array.isArray(input?.spokenParticipantRoleIds)
    ? input.spokenParticipantRoleIds.filter((roleId): roleId is string => typeof roleId === "string" && roleId.trim().length > 0)
    : fallback.spokenParticipantRoleIds;
  const pendingRequiredReplies = Array.isArray(input?.pendingRequiredReplies)
    ? input.pendingRequiredReplies
        .map((entry) => normalizePendingRequiredReply(entry))
        .filter((entry): entry is PendingRequiredReply => Boolean(entry))
    : fallback.pendingRequiredReplies;
  const roundPendingRoleIds = Array.isArray((input as Partial<DiscussionState> | undefined)?.roundPendingRoleIds)
    ? ((input as Partial<DiscussionState> | undefined)?.roundPendingRoleIds ?? []).filter(
        (roleId): roleId is string => typeof roleId === "string" && roleId.trim().length > 0,
      )
    : fallback.roundPendingRoleIds;
  const participantActivity = input?.participantActivity && typeof input.participantActivity === "object"
    ? Object.fromEntries(
        Object.entries(input.participantActivity).map(([roleId, value]) => [roleId, normalizeParticipantActivity(value)]),
      )
    : fallback.participantActivity;

  return {
    ...fallback,
    ...(input ?? {}),
    currentRound:
      typeof input?.currentRound === "number" && Number.isFinite(input.currentRound)
        ? Math.max(0, input.currentRound)
        : activeExchange?.sequenceNumber ?? fallback.currentRound,
    completedRoundCount:
      typeof input?.completedRoundCount === "number" && Number.isFinite(input.completedRoundCount)
        ? Math.max(0, Math.floor(input.completedRoundCount))
        : typeof legacyInput?.completedExchangeCount === "number" && Number.isFinite(legacyInput.completedExchangeCount)
          ? Math.max(0, Math.floor(legacyInput.completedExchangeCount))
          : fallback.completedRoundCount,
    lastCheckpointedRoundCount:
      typeof input?.lastCheckpointedRoundCount === "number" && Number.isFinite(input.lastCheckpointedRoundCount)
        ? Math.max(0, Math.floor(input.lastCheckpointedRoundCount))
        : typeof legacyInput?.lastCheckpointedExchangeCount === "number" &&
            Number.isFinite(legacyInput.lastCheckpointedExchangeCount)
          ? Math.max(0, Math.floor(legacyInput.lastCheckpointedExchangeCount))
          : fallback.lastCheckpointedRoundCount,
    completedExchangeCount:
      typeof legacyInput?.completedExchangeCount === "number" && Number.isFinite(legacyInput.completedExchangeCount)
        ? Math.max(0, Math.floor(legacyInput.completedExchangeCount))
        : typeof input?.completedRoundCount === "number" && Number.isFinite(input.completedRoundCount)
          ? Math.max(0, Math.floor(input.completedRoundCount))
          : typeof input?.currentRound === "number" && Number.isFinite(input.currentRound) && !activeExchange
            ? Math.max(0, Math.floor(input.currentRound))
            : fallback.completedExchangeCount,
    lastCheckpointedExchangeCount:
      typeof legacyInput?.lastCheckpointedExchangeCount === "number" && Number.isFinite(legacyInput.lastCheckpointedExchangeCount)
        ? Math.max(0, Math.floor(legacyInput.lastCheckpointedExchangeCount))
        : typeof input?.lastCheckpointedRoundCount === "number" && Number.isFinite(input.lastCheckpointedRoundCount)
          ? Math.max(0, Math.floor(input.lastCheckpointedRoundCount))
          : fallback.lastCheckpointedExchangeCount,
    nextSpeakerIndex:
      typeof input?.nextSpeakerIndex === "number" && Number.isFinite(input.nextSpeakerIndex)
        ? input.nextSpeakerIndex
        : fallback.nextSpeakerIndex,
    totalTurns:
      typeof input?.totalTurns === "number" && Number.isFinite(input.totalTurns) ? input.totalTurns : fallback.totalTurns,
    lastActiveRoleId: typeof input?.lastActiveRoleId === "string" ? input.lastActiveRoleId : fallback.lastActiveRoleId,
    spokenParticipantRoleIds,
    roundPendingRoleIds,
    participantActivity,
    pendingRequiredReplies,
    activeExchange,
  };
}

function sanitizeRoleTemplateId(
  role: DiscussionRole,
  validRoleTemplateIds?: ReadonlySet<string>,
): DiscussionRole {
  if (!validRoleTemplateIds || !role.roleTemplateId) {
    return role;
  }
  return validRoleTemplateIds.has(role.roleTemplateId) ? role : { ...role, roleTemplateId: null };
}

function normalizeRoom(input: Partial<DiscussionRoom>, validRoleTemplateIds?: ReadonlySet<string>): DiscussionRoom {
  const base = createBlankRoom();
  const legacyInput = input as Partial<DiscussionRoom> & { checkpointIntervalExchanges?: number };
  const createdAt = input.createdAt ?? base.createdAt;
  const normalizedDocumentAsset = normalizeDocumentAsset(input.documentAsset);
  const normalizedDocumentSegments = Array.isArray(input.documentSegments)
    ? input.documentSegments
        .map((segment, index) => normalizeDocumentSegment(segment, index))
        .filter((segment): segment is DocumentSegment => Boolean(segment))
    : base.documentSegments;
  const normalizedDocumentOutline = Array.isArray(input.documentOutline)
    ? input.documentOutline
        .map((node) => normalizeDocumentOutlineNode(node))
        .filter((node): node is DocumentOutlineNode => Boolean(node))
    : base.documentOutline;
  const normalizedSelectedDocumentSegmentIds = Array.isArray(input.selectedDocumentSegmentIds)
    ? input.selectedDocumentSegmentIds.filter(
        (segmentId): segmentId is string => typeof segmentId === "string" && segmentId.trim().length > 0,
      )
    : base.selectedDocumentSegmentIds;

  const normalizedRoles = Array.isArray(input.roles)
    ? input.roles.map((role) => sanitizeRoleTemplateId(normalizeRole(role as Partial<DiscussionRoom["roles"][number]> & { roleTemplateKey?: RoleTemplateKey | null }), validRoleTemplateIds))
    : base.roles.map((role) => sanitizeRoleTemplateId(role, validRoleTemplateIds));
  const normalizedState = normalizeState(input.state, base.state);
  const enabledParticipantIds = normalizedRoles
    .filter((role) => role.enabled && role.kind === "participant")
    .map((role) => role.id);
  const normalizedParticipantActivity = Object.fromEntries(
    enabledParticipantIds.map((roleId) => [
      roleId,
      normalizeParticipantActivity(normalizedState.participantActivity[roleId]),
    ]),
  );
  const normalizedRoundPendingRoleIds =
    normalizedState.roundPendingRoleIds.length > 0
      ? normalizedState.roundPendingRoleIds.filter((roleId) => enabledParticipantIds.includes(roleId))
      : normalizedState.currentRound > 0
        ? enabledParticipantIds.filter((roleId) => !normalizedState.spokenParticipantRoleIds.includes(roleId))
        : [];

  return {
    ...base,
    ...input,
    id: input.id ?? base.id,
    title: input.title?.trim() || base.title,
    topic: input.topic?.trim() || base.topic,
    objective: input.objective?.trim() || base.objective,
    discussionLanguage: input.discussionLanguage ?? base.discussionLanguage,
    researchDirectionKey: input.researchDirectionKey ?? base.researchDirectionKey,
    researchDirectionLabel: input.researchDirectionLabel?.trim() || base.researchDirectionLabel,
    researchDirectionDescription: input.researchDirectionDescription?.trim() || base.researchDirectionDescription,
    researchDirectionNote: input.researchDirectionNote?.trim() ?? base.researchDirectionNote,
    autoRunDelaySeconds:
      typeof input.autoRunDelaySeconds === "number" && Number.isFinite(input.autoRunDelaySeconds)
        ? Math.max(0.2, Math.min(30, input.autoRunDelaySeconds))
        : base.autoRunDelaySeconds,
    maxRounds:
      typeof input.maxRounds === "number" && Number.isFinite(input.maxRounds)
        ? Math.max(1, Math.min(999, input.maxRounds))
        : base.maxRounds,
    checkpointEveryRound:
      typeof input.checkpointEveryRound === "boolean" ? input.checkpointEveryRound : base.checkpointEveryRound,
    checkpointIntervalRounds:
      typeof legacyInput.checkpointIntervalRounds === "number" && Number.isFinite(legacyInput.checkpointIntervalRounds)
        ? Math.max(0, Math.min(999, Math.floor(legacyInput.checkpointIntervalRounds)))
        : typeof legacyInput.checkpointIntervalExchanges === "number" && Number.isFinite(legacyInput.checkpointIntervalExchanges)
          ? Math.max(0, Math.min(999, Math.floor(legacyInput.checkpointIntervalExchanges)))
        : typeof input.checkpointEveryRound === "boolean"
          ? input.checkpointEveryRound
            ? 1
            : 0
          : base.checkpointIntervalRounds,
    documentAsset: normalizedDocumentAsset,
    documentSegments: normalizedDocumentSegments,
    documentOutline: normalizedDocumentOutline,
    documentSummary: normalizeDocumentSummary(input.documentSummary),
    documentParseStatus:
      input.documentParseStatus === "processing" ||
      input.documentParseStatus === "ready" ||
      input.documentParseStatus === "partial" ||
      input.documentParseStatus === "failed"
        ? input.documentParseStatus
        : base.documentParseStatus,
    documentWarnings: Array.isArray(input.documentWarnings)
      ? input.documentWarnings.filter((warning): warning is string => typeof warning === "string")
      : base.documentWarnings,
    selectedDocumentSegmentIds: normalizedSelectedDocumentSegmentIds,
    documentDiscussionMode:
      input.documentDiscussionMode === "whole-document" || input.documentDiscussionMode === "selected-segments"
        ? input.documentDiscussionMode
        : base.documentDiscussionMode,
    roles: normalizedRoles,
    messages: Array.isArray(input.messages) ? input.messages.map((message, index) => normalizeMessage(message, index + 1)) : [],
    summary: normalizeSummary(input.summary),
    state: {
      ...normalizedState,
      roundPendingRoleIds: normalizedRoundPendingRoleIds,
      participantActivity: normalizedParticipantActivity,
      spokenParticipantRoleIds: normalizedState.spokenParticipantRoleIds.filter((roleId) => enabledParticipantIds.includes(roleId)),
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

async function readSettings(): Promise<AppSettings> {
  const fallback: AppSettings = {
    lastOpenedRoomId: null,
    researchDirections: [],
    roleTemplates: [],
  };
  const parsed = await readJsonFile<Partial<AppSettings>>(settingsFile, fallback);
  return {
    lastOpenedRoomId: typeof parsed.lastOpenedRoomId === "string" ? parsed.lastOpenedRoomId : null,
    researchDirections: Array.isArray(parsed.researchDirections)
      ? parsed.researchDirections.map((item) => normalizeResearchDirection(item))
      : [],
    roleTemplates: Array.isArray(parsed.roleTemplates)
      ? parsed.roleTemplates.map((item) => normalizeRoleTemplatePreset({ ...item, builtIn: false }))
      : [],
  };
}

async function writeSettings(settings: AppSettings): Promise<void> {
  await fs.writeFile(settingsFile, JSON.stringify(settings, null, 2), "utf-8");
}

async function getValidRoleTemplateIds(): Promise<Set<string>> {
  const settings = await readSettings();
  return new Set([
    ...createBuiltInRoleTemplatePresets().map((template) => template.id),
    ...settings.roleTemplates.map((template) => template.id),
  ]);
}

export async function ensureStorage(): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  await ensureFile(roomsFile, "[]");
  await ensureFile(presetsFile, "[]");
  await ensureFile(settingsFile, JSON.stringify({ lastOpenedRoomId: null, researchDirections: [], roleTemplates: [] }, null, 2));

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
  const validRoleTemplateIds = await getValidRoleTemplateIds();
  return Array.isArray(parsed) ? parsed.map((room) => normalizeRoom(room, validRoleTemplateIds)) : [];
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
  const validRoleTemplateIds = await getValidRoleTemplateIds();
  const normalized = normalizeRoom(room, validRoleTemplateIds);
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

export async function listResearchDirections(): Promise<ResearchDirectionPreset[]> {
  const settings = await readSettings();
  return settings.researchDirections;
}

export async function listRoleTemplates(): Promise<RoleTemplatePreset[]> {
  const settings = await readSettings();
  return [...createBuiltInRoleTemplatePresets(), ...settings.roleTemplates];
}

export async function getRoleTemplate(templateId: string): Promise<RoleTemplatePreset | undefined> {
  const templates = await listRoleTemplates();
  return templates.find((template) => template.id === templateId);
}

export async function saveRoleTemplate(template: RoleTemplatePreset): Promise<RoleTemplatePreset> {
  const settings = await readSettings();
  const normalized = normalizeRoleTemplatePreset({ ...template, builtIn: false });
  const index = settings.roleTemplates.findIndex((item) => item.id === normalized.id);

  if (index >= 0) {
    settings.roleTemplates[index] = normalized;
  } else {
    settings.roleTemplates.push(normalized);
  }

  await writeSettings(settings);
  return normalized;
}

export async function deleteRoleTemplate(templateId: string): Promise<boolean> {
  const settings = await readSettings();
  const nextTemplates = settings.roleTemplates.filter((template) => template.id !== templateId);
  if (nextTemplates.length === settings.roleTemplates.length) {
    return false;
  }

  settings.roleTemplates = nextTemplates;
  await writeSettings(settings);
  return true;
}

export async function getResearchDirection(directionId: string): Promise<ResearchDirectionPreset | undefined> {
  const directions = await listResearchDirections();
  return directions.find((direction) => direction.id === directionId);
}

export async function saveResearchDirection(direction: ResearchDirectionPreset): Promise<ResearchDirectionPreset> {
  const settings = await readSettings();
  const normalized = normalizeResearchDirection(direction);
  const index = settings.researchDirections.findIndex((item) => item.id === normalized.id);

  if (index >= 0) {
    settings.researchDirections[index] = normalized;
  } else {
    settings.researchDirections.push(normalized);
  }

  await writeSettings(settings);
  return normalized;
}

export async function deleteResearchDirection(directionId: string): Promise<boolean> {
  const settings = await readSettings();
  const nextDirections = settings.researchDirections.filter((direction) => direction.id !== directionId);
  if (nextDirections.length === settings.researchDirections.length) {
    return false;
  }

  settings.researchDirections = nextDirections;
  await writeSettings(settings);
  return true;
}
