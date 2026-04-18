export type ProviderType = "mock" | "openai-compatible" | "custom-http" | "codex-cli";
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type DiscussionRoleKind = "participant" | "recorder";
export type RoomStatus = "idle" | "running" | "stopped" | "completed";
export type DiscussionPhase = "participants" | "recorder" | "final";
export type MessageKind = "participant" | "recorder" | "user" | "system";
export type InsightKind = "checkpoint" | "final";

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

export interface DiscussionRole {
  id: string;
  name: string;
  kind: DiscussionRoleKind;
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
  round: number;
  turn: number;
  createdAt: string;
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
  nextSpeakerIndex: number;
  totalTurns: number;
  lastActiveRoleId: string | null;
}

export interface DiscussionRoom {
  id: string;
  title: string;
  topic: string;
  objective: string;
  maxRounds: number;
  checkpointEveryRound: boolean;
  roles: DiscussionRole[];
  messages: ChatMessage[];
  summary: DiscussionSummary;
  state: DiscussionState;
  createdAt: string;
  updatedAt: string;
}
