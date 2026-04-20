export type ProviderType = "mock" | "openai-compatible" | "anthropic-compatible" | "custom-http" | "codex-cli";
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type DiscussionLanguage = "zh-CN" | "en-US";
export type ResearchDirectionKey = string;
export type DocumentFileKind = "pdf" | "docx" | "txt" | "md";
export type DocumentParseStatus = "idle" | "processing" | "ready" | "partial" | "failed";
export type DocumentDiscussionMode = "whole-document" | "selected-segments";
export type DocumentSegmentKind = "document" | "section" | "page" | "block" | "table";
export type RoleTemplateKey =
  | "reviewer"
  | "advisor"
  | "methodologist"
  | "domain-expert"
  | "experimentalist"
  | "statistician"
  | "industry-skeptic"
  | "recorder";
export type DiscussionRoleKind = "participant" | "recorder";

export interface ProviderConfig {
  type: ProviderType;
  model: string;
  endpoint: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  command: string;
  launcherArgs: string;
  workingDirectory: string;
  timeoutMs: number;
  sandboxMode: CodexSandboxMode;
  skipGitRepoCheck: boolean;
}

export interface ProviderPreset {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  provider: ProviderConfig;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchDirectionPreset {
  id: string;
  label: string;
  description: string;
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RoleTemplatePreset {
  id: string;
  name: string;
  kind: DiscussionRoleKind;
  persona: string;
  principles: string;
  goal: string;
  voiceStyle: string;
  accentColor: string;
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RoomDocumentAsset {
  id: string;
  fileName: string;
  storedFileName: string;
  mimeType: string;
  fileKind: DocumentFileKind;
  sizeBytes: number;
  pageCount: number | null;
  charCount: number;
  title: string;
  createdAt: string;
}

export interface DocumentSegment {
  id: string;
  kind: DocumentSegmentKind;
  title: string;
  content: string;
  pageStart: number | null;
  pageEnd: number | null;
  level: number;
  parentId: string | null;
  path: string[];
  order: number;
}

export interface DocumentOutlineNode {
  id: string;
  segmentId: string;
  title: string;
  kind: DocumentSegmentKind;
  children: DocumentOutlineNode[];
}

export interface DocumentSummary {
  title: string;
  abstract: string;
  defaultTopic: string;
}

export interface DocumentParseResult {
  asset: RoomDocumentAsset;
  segments: DocumentSegment[];
  outline: DocumentOutlineNode[];
  summary: DocumentSummary;
  warnings: string[];
  status: DocumentParseStatus;
  discussionMode: DocumentDiscussionMode;
  defaultSelectedSegmentIds: string[];
}

export type RoomStatus = "idle" | "running" | "stopped" | "completed";
export type DiscussionPhase = "participants" | "recorder" | "final";
export type MessageKind = "participant" | "recorder" | "user" | "system";
export type InsightKind = "checkpoint" | "final";
export type RequiredReplyReason = "user-direct-reply" | "participant-direct-request";
export type ActiveExchangeReason = "topic-start" | "user-message" | "participant-forced-reply";

export interface ParticipantActivityState {
  lastSpokeTurn: number;
  lastSpokeRound: number;
  starvationDebt: number;
  consecutiveSelections: number;
  lastReplyTargetRoleId: string | null;
  directPressureDebt: number;
  userPressureDebt: number;
}

export interface DiscussionRole {
  id: string;
  name: string;
  kind: DiscussionRoleKind;
  roleTemplateId: string | null;
  persona: string;
  principles: string;
  voiceStyle: string;
  goal: string;
  accentColor: string;
  enabled: boolean;
  providerPresetId: string | null;
  provider: ProviderConfig;
}

export interface ChatMessage {
  id: string;
  roleId: string;
  roleName: string;
  kind: MessageKind;
  content: string;
  replyToMessageId?: string | null;
  replyToRoleName?: string | null;
  replyToExcerpt?: string | null;
  requiredReplyRoleId?: string | null;
  requiredReplyRoleName?: string | null;
  round: number;
  turn: number;
  createdAt: string;
}

export interface PendingRequiredReply {
  sourceMessageId: string;
  targetRoleId: string;
  targetRoleName: string;
  reason: RequiredReplyReason;
  createdAt: string;
}

export interface ActiveExchange {
  id: string;
  sequenceNumber: number;
  reason: ActiveExchangeReason;
  triggerMessageId: string | null;
  hardTargetRoleId: string | null;
  respondedRoleIds: string[];
  followUpTurnsRemaining: number;
  openedAtTurn: number;
}

export interface InsightEntry {
  id: string;
  kind: InsightKind;
  title: string;
  content: string;
  round: number;
  saved: boolean;
  createdAt: string;
}

export interface DiscussionSummary {
  insights: InsightEntry[];
  updatedAt: string | null;
}

export interface DiscussionState {
  status: RoomStatus;
  phase: DiscussionPhase;
  currentRound: number;
  completedRoundCount: number;
  lastCheckpointedRoundCount: number;
  completedExchangeCount: number;
  lastCheckpointedExchangeCount: number;
  nextSpeakerIndex: number;
  totalTurns: number;
  lastActiveRoleId: string | null;
  spokenParticipantRoleIds: string[];
  roundPendingRoleIds: string[];
  participantActivity: Record<string, ParticipantActivityState>;
  pendingRequiredReplies: PendingRequiredReply[];
  activeExchange: ActiveExchange | null;
}

export interface DiscussionRoom {
  id: string;
  title: string;
  topic: string;
  objective: string;
  discussionLanguage: DiscussionLanguage;
  researchDirectionKey: ResearchDirectionKey;
  researchDirectionLabel: string;
  researchDirectionDescription: string;
  researchDirectionNote: string;
  autoRunDelaySeconds: number;
  maxRounds: number;
  checkpointEveryRound: boolean;
  checkpointIntervalRounds: number;
  documentAsset: RoomDocumentAsset | null;
  documentSegments: DocumentSegment[];
  documentOutline: DocumentOutlineNode[];
  documentSummary: DocumentSummary | null;
  documentParseStatus: DocumentParseStatus;
  documentWarnings: string[];
  selectedDocumentSegmentIds: string[];
  documentDiscussionMode: DocumentDiscussionMode;
  roles: DiscussionRole[];
  messages: ChatMessage[];
  summary: DiscussionSummary;
  state: DiscussionState;
  createdAt: string;
  updatedAt: string;
}
