import { randomUUID } from "crypto";
import { getResearchProfile, inferRoleTemplateKey } from "./discussionCatalog";
import {
  DiscussionRole,
  DiscussionRoleKind,
  DiscussionLanguage,
  DiscussionRoom,
  DiscussionSummary,
  ProviderConfig,
  ProviderPreset,
  ResearchDirectionKey,
} from "./types";

export const PRESET_IDS = {
  mock: "preset-mock-demo",
  openaiCompatible: "preset-openai-compatible",
  customHttp: "preset-custom-http",
  codexCli: "preset-codex-cli",
} as const;

const nowIso = (): string => new Date().toISOString();
const defaultDiscussionLanguage: DiscussionLanguage = "zh-CN";
const defaultResearchDirection: ResearchDirectionKey = "general";
const defaultAutoRunDelaySeconds = 2;

export const createProviderConfig = (type: ProviderConfig["type"] = "mock"): ProviderConfig => ({
  type,
  model:
    type === "mock"
      ? "mock-discussion-v2"
      : type === "codex-cli"
        ? "gpt-5-codex"
        : "",
  endpoint: "",
  apiKey: "",
  temperature: 0.7,
  maxTokens: 320,
  command: type === "codex-cli" ? "codex" : "",
  launcherArgs: "",
  workingDirectory: "",
  timeoutMs: type === "codex-cli" ? 240000 : 120000,
  sandboxMode: "read-only",
  skipGitRepoCheck: true,
});

export const normalizeProvider = (input: Partial<ProviderConfig> | undefined): ProviderConfig => {
  const type = input?.type ?? "mock";
  return {
    ...createProviderConfig(type),
    ...input,
    type,
    model: input?.model ?? createProviderConfig(type).model,
    endpoint: input?.endpoint ?? "",
    apiKey: input?.apiKey ?? "",
    command: input?.command ?? createProviderConfig(type).command,
    launcherArgs: input?.launcherArgs ?? "",
    workingDirectory: input?.workingDirectory ?? "",
    timeoutMs:
      typeof input?.timeoutMs === "number" && Number.isFinite(input.timeoutMs)
        ? Math.max(10000, input.timeoutMs)
        : createProviderConfig(type).timeoutMs,
    temperature:
      typeof input?.temperature === "number" && Number.isFinite(input.temperature)
        ? input.temperature
        : createProviderConfig(type).temperature,
    maxTokens:
      typeof input?.maxTokens === "number" && Number.isFinite(input.maxTokens)
        ? input.maxTokens
        : createProviderConfig(type).maxTokens,
    sandboxMode: input?.sandboxMode ?? "read-only",
    skipGitRepoCheck: typeof input?.skipGitRepoCheck === "boolean" ? input.skipGitRepoCheck : true,
  };
};

export const createBuiltInProviderPresets = (): ProviderPreset[] => {
  const now = nowIso();

  return [
    {
      id: PRESET_IDS.mock,
      name: "Mock Demo",
      description: "Offline deterministic provider for demos and smoke tests.",
      builtIn: true,
      provider: createProviderConfig("mock"),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: PRESET_IDS.openaiCompatible,
      name: "OpenAI-Compatible API",
      description: "Any /v1/chat/completions style API endpoint.",
      builtIn: true,
      provider: {
        ...createProviderConfig("openai-compatible"),
        endpoint: "http://localhost:11434/v1",
        model: "gpt-4.1-mini",
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: PRESET_IDS.customHttp,
      name: "Custom HTTP Agent",
      description: "Call your own local agent bridge via POST JSON.",
      builtIn: true,
      provider: {
        ...createProviderConfig("custom-http"),
        endpoint: "http://127.0.0.1:8000/chat",
      },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: PRESET_IDS.codexCli,
      name: "Local Codex CLI",
      description: "Run Codex locally with `codex exec`. If Windows alias fails, switch command to `npx` and launcher args to `-y @openai/codex`.",
      builtIn: true,
      provider: {
        ...createProviderConfig("codex-cli"),
        command: "codex",
      },
      createdAt: now,
      updatedAt: now,
    },
  ];
};

export const normalizePreset = (input: Partial<ProviderPreset>): ProviderPreset => {
  const now = nowIso();
  return {
    id: input.id ?? randomUUID(),
    name: input.name?.trim() || "Untitled Preset",
    description: input.description?.trim() || "",
    builtIn: Boolean(input.builtIn),
    provider: normalizeProvider(input.provider),
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };
};

const createRole = (input: Partial<DiscussionRole> & Pick<DiscussionRole, "name" | "kind">): DiscussionRole => ({
  id: input.id ?? randomUUID(),
  name: input.name.trim(),
  kind: input.kind,
  roleTemplateKey: input.roleTemplateKey ?? inferRoleTemplateKey(input.name, input.kind),
  persona: input.persona?.trim() || "",
  principles: input.principles?.trim() || "",
  voiceStyle: input.voiceStyle?.trim() || "",
  goal: input.goal?.trim() || "",
  accentColor: input.accentColor ?? "#49617a",
  enabled: input.enabled ?? true,
  providerPresetId: input.providerPresetId ?? PRESET_IDS.mock,
  provider: normalizeProvider(input.provider),
});

export const normalizeRole = (input: Partial<DiscussionRole>): DiscussionRole =>
  createRole({
    name: input.name?.trim() || "Untitled Role",
    kind: (input.kind as DiscussionRoleKind) === "recorder" ? "recorder" : "participant",
    roleTemplateKey:
      input.roleTemplateKey ??
      inferRoleTemplateKey(
        input.name?.trim() || "Untitled Role",
        (input.kind as DiscussionRoleKind) === "recorder" ? "recorder" : "participant",
      ),
    providerPresetId: input.providerPresetId ?? null,
    ...input,
  });

export const createSummary = (): DiscussionSummary => ({
  insights: [],
  updatedAt: null,
});

export const createBlankRoom = (): DiscussionRoom => {
  const now = nowIso();
  const researchProfile = getResearchProfile(defaultResearchDirection);
  return {
    id: randomUUID(),
    title: "New Discussion Room",
    topic: "State the problem, idea, paper topic, or product direction to discuss.",
    objective: "Use focused, short group-chat turns to challenge, improve, and sharpen the decision until a recorder can produce a useful conclusion.",
    discussionLanguage: defaultDiscussionLanguage,
    researchDirectionKey: defaultResearchDirection,
    researchDirectionLabel: researchProfile.label,
    researchDirectionDescription: researchProfile.scholarFraming,
    researchDirectionNote: "",
    autoRunDelaySeconds: defaultAutoRunDelaySeconds,
    maxRounds: 4,
    checkpointEveryRound: true,
    checkpointIntervalRounds: 1,
    documentAsset: null,
    documentSegments: [],
    documentOutline: [],
    documentSummary: null,
    documentParseStatus: "idle",
    documentWarnings: [],
    selectedDocumentSegmentIds: [],
    documentDiscussionMode: "selected-segments",
    roles: [
      createRole({
        name: "Reviewer",
        kind: "participant",
        roleTemplateKey: "reviewer",
        accentColor: "#8b3d3d",
        providerPresetId: PRESET_IDS.mock,
        provider: createProviderConfig("mock"),
        persona: "A demanding reviewer who grants acceptance only when the proposal is genuinely sharp and evidence-backed.",
        principles: "Attack novelty inflation, scope drift, weak evidence, and any claim that would not survive peer review.",
        voiceStyle: "Short, cold, explicit, and professionally skeptical.",
        goal: "Reject weak or underspecified work unless it becomes defensible under serious scrutiny.",
      }),
      createRole({
        name: "Advisor",
        kind: "participant",
        roleTemplateKey: "advisor",
        accentColor: "#2e6f95",
        providerPresetId: PRESET_IDS.mock,
        provider: createProviderConfig("mock"),
        persona: "An experienced advisor who rescues rough ideas by cutting scope and structuring a credible validation path.",
        principles: "Acknowledge real flaws, then repair them with scope cuts, measurable claims, and realistic evaluation steps.",
        voiceStyle: "Compact, strategic, and solution-driven.",
        goal: "Transform the proposal until a serious reviewer could accept it conditionally.",
      }),
      createRole({
        name: "Recorder",
        kind: "recorder",
        roleTemplateKey: "recorder",
        accentColor: "#5b6475",
        providerPresetId: PRESET_IDS.mock,
        provider: createProviderConfig("mock"),
        persona: "A neutral analyst who tracks decisive objections, strongest repairs, evidence shifts, and the current verdict.",
        principles: "Record only what materially changes the eventual decision.",
        voiceStyle: "Tight notes with real insight.",
        goal: "Produce high-signal checkpoint notes and a final conclusion worth keeping.",
      }),
    ],
    messages: [],
    summary: createSummary(),
    state: {
      status: "idle",
      phase: "participants",
      currentRound: 0,
      completedRoundCount: 0,
      lastCheckpointedRoundCount: 0,
      completedExchangeCount: 0,
      lastCheckpointedExchangeCount: 0,
      nextSpeakerIndex: 0,
      totalTurns: 0,
      lastActiveRoleId: null,
      spokenParticipantRoleIds: [],
      pendingRequiredReplies: [],
      activeExchange: null,
    },
    createdAt: now,
    updatedAt: now,
  };
};

export const createReviewerAdvisorRoom = (): DiscussionRoom => {
  const room = createBlankRoom();
  room.title = "Reviewer vs Advisor";
  room.topic =
    "Research idea: use a multi-role discussion system to let a reviewer attack a proposal and an advisor iteratively repair it until the scope, contribution, and validation plan become defensible.";
  room.objective =
    "The reviewer should resist weak ideas. The advisor should not roleplay vaguely; they must concretely narrow the problem, improve the method, and earn conditional acceptance.";
  room.discussionLanguage = defaultDiscussionLanguage;
  room.researchDirectionKey = "ai-ml";
  room.researchDirectionLabel = getResearchProfile("ai-ml").label;
  room.researchDirectionDescription = getResearchProfile("ai-ml").scholarFraming;
  room.researchDirectionNote = "Assume the audience is a serious research group or paper-review setting.";
  room.autoRunDelaySeconds = defaultAutoRunDelaySeconds;
  room.roles = [
    createRole({
      name: "Reviewer",
      kind: "participant",
      roleTemplateKey: "reviewer",
      accentColor: "#8b3d3d",
      providerPresetId: PRESET_IDS.mock,
      provider: createProviderConfig("mock"),
      persona: "A demanding reviewer who does not grant acceptance unless the proposal is genuinely tight.",
      principles: "Press on novelty, scope control, evaluation quality, and hidden assumptions.",
      voiceStyle: "Short, cold, explicit.",
      goal: "Reject weak or underspecified work unless it becomes concrete enough to survive review.",
    }),
    createRole({
      name: "Advisor",
      kind: "participant",
      roleTemplateKey: "advisor",
      accentColor: "#2e6f95",
      providerPresetId: PRESET_IDS.mock,
      provider: createProviderConfig("mock"),
      persona: "An experienced advisor who turns loose ideas into sharp, defensible projects.",
      principles: "Acknowledge real flaws, then repair them with scope cuts, measurable claims, and realistic validation.",
      voiceStyle: "Compact, strategic, solution-driven.",
      goal: "Transform the proposal until the reviewer has a credible path to acceptance.",
    }),
    createRole({
      name: "Recorder",
      kind: "recorder",
      roleTemplateKey: "recorder",
      accentColor: "#5b6475",
      providerPresetId: PRESET_IDS.mock,
      provider: createProviderConfig("mock"),
      persona: "A neutral analyst who tracks decisive objections, repairs, and verdict shifts.",
      principles: "Record only what changes the final decision.",
      voiceStyle: "Tight notes with real insight.",
      goal: "Produce checkpoint notes and a final decision summary worth saving.",
    }),
  ];
  room.updatedAt = nowIso();
  return room;
};
