import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { api } from "./api";
import {
  createLocalizedRoomSeed,
  createProviderDraft,
  createRoleFromTemplate,
  getAvailableRoleTemplates,
  getBuiltInRoleTemplatePreset,
  getBuiltInRoleTemplatePresets,
  getResearchDirectionDescription,
  getResearchDirectionLabel,
  isBuiltInRoleTemplateId,
  isBuiltInResearchDirection,
  PROVIDER_TYPE_ORDER,
  RESEARCH_DIRECTION_ORDER,
} from "./catalog";
import {
  formatTemplate,
  getBuiltInPresetDescription,
  getBuiltInPresetName,
  getDocumentKindLabel,
  getExchangeReasonLabel,
  getProviderTypeLabel,
  getStatusLabel,
  getText,
  localizeDocumentWarning,
  localizeKnownError,
  STORAGE_KEYS,
  UI_COPY,
} from "./i18n";
import {
  ChatMessage,
  DocumentOutlineNode,
  DocumentSegment,
  DiscussionLanguage,
  DiscussionRole,
  DiscussionRoleKind,
  DiscussionRoom,
  InsightEntry,
  ProviderConfig,
  ProviderPreset,
  ProviderType,
  ResearchDirectionPreset,
  RoleTemplatePreset,
  ChatFontPreset,
  UiScalePreset,
  UiLocale,
} from "./types";

type StudioTab = "room" | "roles" | "presets";

type LoadingRoleSnapshot = {
  roleId: string;
  roleName: string;
  kind: DiscussionRoleKind;
  accentColor: string;
};

type AutoPlayState = "idle" | "running" | "pause-requested";

const UI_SCALE_FACTORS: Record<UiScalePreset, number> = {
  compact: 0.9,
  default: 1,
  comfortable: 1.1,
};

const CHAT_FONT_FACTORS: Record<ChatFontPreset, number> = {
  small: 0.92,
  medium: 1,
  large: 1.12,
};

const ROOM_LIMIT_MAX = 999;
const MESSAGE_COLLAPSE_MAX_LENGTH = 420;
const MESSAGE_COLLAPSE_MAX_LINES = 8;
const CUSTOM_ROLE_TEMPLATE_ID = "__custom-role-template__";

function getEnabledParticipants(room: DiscussionRoom): DiscussionRole[] {
  return room.roles.filter((role) => role.enabled && role.kind === "participant");
}

function getEnabledParticipant(room: DiscussionRoom, roleId: string | null | undefined): DiscussionRole | null {
  if (!roleId) {
    return null;
  }
  return room.roles.find((role) => role.enabled && role.kind === "participant" && role.id === roleId) ?? null;
}

function getEnabledRecorder(room: DiscussionRoom): DiscussionRole | null {
  return room.roles.find((role) => role.enabled && role.kind === "recorder") ?? null;
}

function getParticipantActivity(room: DiscussionRoom, roleId: string): DiscussionRoom["state"]["participantActivity"][string] {
  return (
    room.state.participantActivity[roleId] ?? {
      lastSpokeTurn: 0,
      lastSpokeRound: 0,
      starvationDebt: 0,
      consecutiveSelections: 0,
      lastReplyTargetRoleId: null,
      directPressureDebt: 0,
      userPressureDebt: 0,
    }
  );
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

function roleRespondedAfterTurn(room: DiscussionRoom, roleId: string, turn: number): boolean {
  return room.messages.some((message) => message.kind === "participant" && message.roleId === roleId && message.turn > turn);
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
    const replyTarget = room.messages.find((candidate) => candidate.id === message.replyToMessageId) ?? null;
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
  const latestUserMessage = getLatestUserMessage(room, openedAtTurn);
  if (!latestUserMessage) {
    return false;
  }
  return !roleRespondedAfterTurn(room, roleId, latestUserMessage.turn);
}

function toLoadingRoleSnapshot(role: DiscussionRole | null): LoadingRoleSnapshot | null {
  if (!role) {
    return null;
  }
  return {
    roleId: role.id,
    roleName: role.name,
    kind: role.kind,
    accentColor: role.accentColor,
  };
}

function predictNextSpeakingRole(room: DiscussionRoom): DiscussionRole | null {
  const recorder = getEnabledRecorder(room);
  if (room.state.phase === "recorder" || room.state.phase === "final") {
    return recorder;
  }

  const participants = getEnabledParticipants(room);
  if (participants.length === 0) {
    return recorder;
  }

  if (room.state.status !== "running") {
    return participants[0] ?? recorder;
  }

  const forcedReply = room.state.pendingRequiredReplies.find(
    (candidate) => room.messages.some((message) => message.id === candidate.sourceMessageId) && getEnabledParticipant(room, candidate.targetRoleId),
  );
  if (forcedReply) {
    return getEnabledParticipant(room, forcedReply.targetRoleId);
  }

  const exchange = room.state.activeExchange;
  if (!exchange) {
    return participants.find((role) => room.state.roundPendingRoleIds.includes(role.id)) ?? participants[0] ?? recorder;
  }

  const participantById = new Map(participants.map((role) => [role.id, role]));
  const pendingPool = room.state.roundPendingRoleIds
    .map((roleId) => participantById.get(roleId) ?? null)
    .filter((role): role is DiscussionRole => Boolean(role));

  if (pendingPool.length === 0) {
    return null;
  }

  const starvedPool = pendingPool.filter((role) => getParticipantActivity(room, role.id).starvationDebt >= 3);
  const pool = starvedPool.length > 0 ? starvedPool : pendingPool;
  const latestParticipant = getLatestParticipantMessage(room);

  const sortedCandidates = pool
    .map((role) => {
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

      return {
        role,
        score,
        starvationDebt: activity.starvationDebt,
        turnsSinceLastSpeech,
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (right.starvationDebt !== left.starvationDebt) {
        return right.starvationDebt - left.starvationDebt;
      }
      if (right.turnsSinceLastSpeech !== left.turnsSinceLastSpeech) {
        return right.turnsSinceLastSpeech - left.turnsSinceLastSpeech;
      }
      return participants.findIndex((role) => role.id === left.role.id) - participants.findIndex((role) => role.id === right.role.id);
    });

  return sortedCandidates[0]?.role ?? pendingPool[0] ?? participants[0] ?? recorder;
}

function cloneRoom(room: DiscussionRoom): DiscussionRoom {
  return structuredClone(room);
}

function readBooleanStorage(key: string, fallback: boolean): boolean {
  const value = window.localStorage.getItem(key);
  if (value === null) {
    return fallback;
  }
  return value === "true";
}

function readLocaleStorage(): UiLocale {
  const value = window.localStorage.getItem(STORAGE_KEYS.locale);
  return value === "en-US" ? "en-US" : "zh-CN";
}

function readUiScalePresetStorage(): UiScalePreset {
  const value = window.localStorage.getItem(STORAGE_KEYS.uiScalePreset);
  return value === "compact" || value === "comfortable" ? value : "default";
}

function readChatFontPresetStorage(): ChatFontPreset {
  const value = window.localStorage.getItem(STORAGE_KEYS.chatFontPreset);
  return value === "small" || value === "large" ? value : "medium";
}

function formatWhen(timestamp: string, locale: UiLocale): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncateText(content: string, maxLength = 120): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3).trim()}...`;
}

function isMessageCollapsible(content: string): boolean {
  const normalized = content.trim();
  if (!normalized) {
    return false;
  }
  return normalized.length > MESSAGE_COLLAPSE_MAX_LENGTH || normalized.split(/\r?\n/).length > MESSAGE_COLLAPSE_MAX_LINES;
}

function getCollapsedMessagePreview(content: string): string {
  const normalized = content.trim();
  if (!normalized) {
    return normalized;
  }

  const lines = normalized.split(/\r?\n/);
  const limitedLines = lines.slice(0, MESSAGE_COLLAPSE_MAX_LINES).join("\n");
  if (limitedLines.length <= MESSAGE_COLLAPSE_MAX_LENGTH && lines.length <= MESSAGE_COLLAPSE_MAX_LINES) {
    return limitedLines;
  }

  return `${limitedLines.slice(0, MESSAGE_COLLAPSE_MAX_LENGTH).trimEnd()}...`;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getPrecision(step?: number): number {
  if (!step || Number.isInteger(step)) {
    return 0;
  }
  const fraction = step.toString().split(".")[1] ?? "";
  return fraction.length;
}

function formatNumberDraft(value: number, step?: number): string {
  const precision = getPrecision(step);
  return precision > 0 ? value.toFixed(precision).replace(/0+$/, "").replace(/\.$/, "") : String(Math.round(value));
}

function sanitizeFileName(input: string): string {
  return input.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 80);
}

function sortPresetsForDisplay(left: ProviderPreset, right: ProviderPreset): number {
  if (left.builtIn !== right.builtIn) {
    return left.builtIn ? -1 : 1;
  }
  return left.name.localeCompare(right.name);
}

function sortRoleTemplatesForDisplay(left: RoleTemplatePreset, right: RoleTemplatePreset): number {
  if (left.builtIn !== right.builtIn) {
    return left.builtIn ? -1 : 1;
  }
  return left.name.localeCompare(right.name);
}

function hasOutstandingForcedReplyWork(room: DiscussionRoom): boolean {
  if (room.state.pendingRequiredReplies.length > 0) {
    return true;
  }

  const exchange = room.state.activeExchange;
  if (!exchange?.hardTargetRoleId) {
    return false;
  }

  return !exchange.respondedRoleIds.includes(exchange.hardTargetRoleId);
}

function downloadTextFile(fileName: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function NumericInput(props: {
  value: number;
  onCommit: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  testId?: string;
}) {
  const { value, onCommit, min, max, step, testId } = props;
  const [draft, setDraft] = useState(() => formatNumberDraft(value, step));

  useEffect(() => {
    setDraft(formatNumberDraft(value, step));
  }, [value, step]);

  function commit(nextDraft: string): void {
    const parsed = Number(nextDraft);
    if (!Number.isFinite(parsed)) {
      setDraft(formatNumberDraft(value, step));
      return;
    }

    const clamped = clampNumber(parsed, min, max);
    onCommit(clamped);
    setDraft(formatNumberDraft(clamped, step));
  }

  return (
    <input
      type="text"
      inputMode={step && step < 1 ? "decimal" : "numeric"}
      data-testid={testId}
      value={draft}
      onChange={(event) => {
        const nextValue = event.target.value.trim();
        if (nextValue === "" || /^\d*([.]\d*)?$/.test(nextValue)) {
          setDraft(nextValue);
        }
      }}
      onBlur={() => commit(draft)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function App() {
  const [rooms, setRooms] = useState<DiscussionRoom[]>([]);
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [customResearchDirections, setCustomResearchDirections] = useState<ResearchDirectionPreset[]>([]);
  const [roleTemplates, setRoleTemplates] = useState<RoleTemplatePreset[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [draftRoom, setDraftRoom] = useState<DiscussionRoom | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [selectedRoleTemplateId, setSelectedRoleTemplateId] = useState<string | null>(null);
  const [templateLibraryKind, setTemplateLibraryKind] = useState<DiscussionRoleKind>("participant");
  const [roleTemplatesCollapsed, setRoleTemplatesCollapsed] = useState<boolean>(() =>
    readBooleanStorage(STORAGE_KEYS.roleTemplatesCollapsed, true),
  );
  const [roleTemplateDraft, setRoleTemplateDraft] = useState<RoleTemplatePreset | null>(null);
  const [roleTemplateDirty, setRoleTemplateDirty] = useState(false);
  const [studioTab, setStudioTab] = useState<StudioTab>("roles");
  const [locale, setLocale] = useState<UiLocale>(() => readLocaleStorage());
  const [uiScalePreset, setUiScalePreset] = useState<UiScalePreset>(() => readUiScalePresetStorage());
  const [chatFontPreset, setChatFontPreset] = useState<ChatFontPreset>(() => readChatFontPresetStorage());
  const [roomRailCollapsed, setRoomRailCollapsed] = useState<boolean>(() =>
    readBooleanStorage(STORAGE_KEYS.roomRailCollapsed, false),
  );
  const [insightPanelCollapsed, setInsightPanelCollapsed] = useState<boolean>(() =>
    readBooleanStorage(STORAGE_KEYS.insightPanelCollapsed, false),
  );
  const [studioOpen, setStudioOpen] = useState<boolean>(() => readBooleanStorage(STORAGE_KEYS.studioOpen, true));
  const [topInfoCollapsed, setTopInfoCollapsed] = useState<boolean>(() =>
    readBooleanStorage(STORAGE_KEYS.topInfoCollapsed, true),
  );
  const [objectiveCollapsed, setObjectiveCollapsed] = useState<boolean>(() =>
    readBooleanStorage(STORAGE_KEYS.objectiveCollapsed, true),
  );
  const [directionCollapsed, setDirectionCollapsed] = useState<boolean>(() =>
    readBooleanStorage(STORAGE_KEYS.directionCollapsed, true),
  );
  const [languageCollapsed, setLanguageCollapsed] = useState<boolean>(() =>
    readBooleanStorage(STORAGE_KEYS.languageCollapsed, true),
  );
  const [documentCollapsed, setDocumentCollapsed] = useState<boolean>(() =>
    readBooleanStorage(STORAGE_KEYS.documentCollapsed, true),
  );
  const [rolesCollapsed, setRolesCollapsed] = useState<boolean>(() =>
    readBooleanStorage(STORAGE_KEYS.rolesCollapsed, true),
  );
  const [userMessageDraft, setUserMessageDraft] = useState("");
  const [pendingReplyToMessageId, setPendingReplyToMessageId] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [autoPlayState, setAutoPlayState] = useState<AutoPlayState>("idle");
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [expandedMessageIds, setExpandedMessageIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState("");
  const [stepPending, setStepPending] = useState(false);
  const [loadingRoleSnapshot, setLoadingRoleSnapshot] = useState<LoadingRoleSnapshot | null>(null);
  const [selectedCustomResearchDirectionId, setSelectedCustomResearchDirectionId] = useState<string | null>(null);
  const autoRunTimerRef = useRef<number | null>(null);
  const autoRunBusyRef = useRef(false);
  const busyLabelRef = useRef("");
  const stepPendingRef = useRef(false);
  const chatTimelineRef = useRef<HTMLDivElement | null>(null);
  const lastHydratedRoomIdRef = useRef<string | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);

  const selectedRoom = useMemo(
    () => rooms.find((room) => room.id === selectedRoomId) ?? null,
    [rooms, selectedRoomId],
  );

  const selectedRole = useMemo(
    () => draftRoom?.roles.find((role) => role.id === selectedRoleId) ?? null,
    [draftRoom, selectedRoleId],
  );

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === selectedPresetId) ?? null,
    [presets, selectedPresetId],
  );
  const builtInRoleTemplates = useMemo(() => getBuiltInRoleTemplatePresets(locale), [locale]);
  const customRoleTemplates = useMemo(
    () => roleTemplates.filter((template) => !template.builtIn).slice().sort(sortRoleTemplatesForDisplay),
    [roleTemplates],
  );
  const allRoleTemplates = useMemo(
    () => [...builtInRoleTemplates, ...customRoleTemplates],
    [builtInRoleTemplates, customRoleTemplates],
  );
  const autoRunning = autoPlayState !== "idle";

  const builtInResearchDirections = useMemo(
    () =>
      RESEARCH_DIRECTION_ORDER.map((direction) => ({
        id: direction,
        label: getResearchDirectionLabel(direction, locale),
        description: getResearchDirectionDescription(direction, locale),
        builtIn: true,
        createdAt: "",
        updatedAt: "",
      })),
    [locale],
  );

  const allResearchDirections = useMemo(
    () => [...builtInResearchDirections, ...customResearchDirections],
    [builtInResearchDirections, customResearchDirections],
  );

  const presetGroups = useMemo(
    () =>
      PROVIDER_TYPE_ORDER.map((providerType) => ({
        providerType,
        label: getProviderTypeLabel(locale, providerType),
        presets: presets
          .filter((preset) => preset.provider.type === providerType)
          .slice()
          .sort(sortPresetsForDisplay),
      })).filter((group) => group.presets.length > 0),
    [locale, presets],
  );

  const selectedCustomResearchDirection = useMemo(
    () => customResearchDirections.find((direction) => direction.id === selectedCustomResearchDirectionId) ?? null,
    [customResearchDirections, selectedCustomResearchDirectionId],
  );
  const selectedRoleTemplate = useMemo(
    () => allRoleTemplates.find((template) => template.id === selectedRoleTemplateId) ?? null,
    [allRoleTemplates, selectedRoleTemplateId],
  );
  const displayedRoleTemplate = roleTemplateDraft ?? selectedRoleTemplate;
  const activeRoleTemplates = useMemo(
    () => allRoleTemplates.filter((template) => template.kind === templateLibraryKind).slice().sort(sortRoleTemplatesForDisplay),
    [allRoleTemplates, templateLibraryKind],
  );

  const participantCount = useMemo(
    () => draftRoom?.roles.filter((role) => role.kind === "participant" && role.enabled).length ?? 0,
    [draftRoom],
  );

  const finalInsight = useMemo(
    () => draftRoom?.summary.insights.find((insight) => insight.kind === "final") ?? null,
    [draftRoom],
  );
  const discussionEndStatus = useMemo(
    () =>
      draftRoom?.state.status === "completed" || draftRoom?.state.status === "stopped" ? draftRoom.state.status : null,
    [draftRoom],
  );

  const savedInsights = useMemo(
    () =>
      draftRoom?.summary.insights
        .filter((insight) => insight.saved && insight.kind !== "final")
        .slice()
        .reverse() ?? [],
    [draftRoom],
  );

  const checkpointInsights = useMemo(
    () =>
      draftRoom?.summary.insights
        .filter((insight) => insight.kind === "checkpoint")
        .slice()
        .reverse() ?? [],
    [draftRoom],
  );

  const activeRoles = useMemo(() => draftRoom?.roles.filter((role) => role.enabled) ?? [], [draftRoom]);
  const recorderRole = useMemo(
    () => draftRoom?.roles.find((role) => role.enabled && role.kind === "recorder") ?? null,
    [draftRoom],
  );
  const canIntervene = draftRoom?.state.status === "running";
  const pendingReplyMessage = useMemo(
    () => draftRoom?.messages.find((message) => message.id === pendingReplyToMessageId) ?? null,
    [draftRoom, pendingReplyToMessageId],
  );
  const selectedDocumentSegments = useMemo(
    () =>
      draftRoom
        ? draftRoom.documentSegments.filter((segment) => draftRoom.selectedDocumentSegmentIds.includes(segment.id))
        : [],
    [draftRoom],
  );
  const documentSupportsWholeMode = useMemo(
    () => draftRoom?.documentSegments.some((segment) => segment.kind === "document") ?? false,
    [draftRoom],
  );
  const canStartDocumentDiscussion = useMemo(() => {
    if (!draftRoom?.documentAsset) {
      return true;
    }
    if (draftRoom.documentParseStatus === "processing" || draftRoom.documentParseStatus === "failed") {
      return false;
    }
    return draftRoom.selectedDocumentSegmentIds.length > 0;
  }, [draftRoom]);
  const canGenerateRecorderDocumentTopic = useMemo(
    () => Boolean(draftRoom?.documentAsset && recorderRole && recorderRole.provider.type !== "mock"),
    [draftRoom, recorderRole],
  );
  const exchangeRespondedNames = useMemo(
    () =>
      draftRoom?.state.activeExchange?.respondedRoleIds
        .map((roleId) => draftRoom.roles.find((role) => role.id === roleId)?.name)
        .filter((name): name is string => Boolean(name)) ?? [],
    [draftRoom],
  );
  const displayedExchangeNumber = useMemo(
    () => draftRoom?.state.currentRound ?? 0,
    [draftRoom],
  );
  const appScaleStyle = useMemo(
    () =>
      ({
        "--ui-scale": String(UI_SCALE_FACTORS[uiScalePreset]),
        "--chat-font-scale": String(CHAT_FONT_FACTORS[chatFontPreset]),
      }) as CSSProperties,
    [uiScalePreset, chatFontPreset],
  );

  const t = <T extends { "zh-CN": string; "en-US": string }>(value: T): string => getText(locale, value);
  const guideCopy = useMemo(
    () =>
      locale === "zh-CN"
        ? {
            introHint: "下面写的是这个项目当前界面里实际需要填写的字段，以及每种接入方式各自的输入要求。",
            labels: {
              useCase: "适用场景",
              required: "必填字段",
              optional: "可选字段",
              example: "填写示例",
              request: "请求格式",
              response: "返回格式",
              notes: "注意事项",
            },
            mock: {
              required: "Provider：选择 Mock Demo\nModel：可保留默认值；这里只是本地标签，不会真的请求模型",
              notes: "不需要填写 Endpoint、API Key、Command 等接入字段。适合先检查房间流程、UI 和 prompt 走向。",
            },
            openai: {
              required:
                "Provider：选择 OpenAI-Compatible HTTP API\nEndpoint：可填写基础地址、带 /v1 的基础地址，或完整的 /chat/completions /responses 地址，例如 https://api.openai.com、https://api.openai.com/v1、https://api.openai.com/v1/chat/completions\nModel：建议填写模型名，例如 gpt-5.4、gpt-4.1、qwen2.5:14b、deepseek-chat",
              optional:
                "API Key：OpenAI 或其他需要鉴权的服务通常必填；本地 Ollama / 无鉴权 vLLM 通常可留空\nTemperature：采样温度\nMax Tokens：单次输出上限\nTimeout：单次请求最长等待时间",
              example:
                "OpenAI 官方接口：\nEndpoint: https://api.openai.com\nModel: gpt-5.4\nAPI Key: sk-...\n\nOllama 本地接口：\nEndpoint: http://127.0.0.1:11434/v1\nModel: qwen2.5:14b\nAPI Key: 留空",
              notes: "Endpoint 支持基础地址、/v1 基础地址或完整 route。后端会按兼容顺序尝试 chat/completions 与 responses，并在部分字段不被接受时自动裁剪后重试。",
            },
            claude: {
              required:
                "Provider：选择 Claude / Anthropic Messages API\nEndpoint：可填写基础地址、带 /v1 的基础地址，或完整的 /v1/messages 地址，例如 https://api.anthropic.com、https://api.anthropic.com/v1、https://api.anthropic.com/v1/messages\nModel：填写 Claude 风格模型名，例如 claude-3-7-sonnet-latest、claude-3-5-sonnet-latest",
              optional:
                "API Key：Anthropic 官方或兼容服务通常必填\nTemperature：采样温度\nMax Tokens：单次输出上限\nTimeout：单次请求最长等待时间",
              example:
                "Anthropic 官方接口：\nEndpoint: https://api.anthropic.com\nModel: claude-3-7-sonnet-latest\nAPI Key: sk-ant-...\n\n完整 messages 路径：\nEndpoint: https://your-gateway.example/v1/messages\nModel: claude-3-5-sonnet-latest\nAPI Key: sk-ant-...",
              notes: "后端会自动按 messages 协议发送请求，并优先使用 x-api-key + anthropic-version 头。像 api.aicodemirror.com/api/claudecode 这类当前返回网页或伪 503 的地址，实测并不是可直接使用的 JSON messages API。",
            },
            custom: {
              required:
                "Provider：选择 Custom HTTP Agent\nEndpoint：你的 POST JSON 接口地址，例如 http://127.0.0.1:8000/chat",
              optional:
                "API Key：如果 bridge 需要鉴权就填写；应用会以 Bearer Token 写入 Authorization 头\nModel / Temperature / Max Tokens：可选；这些值会随 role.provider 一起发给你的 bridge，由你自己决定是否使用",
              request:
                '{\n  "room": { ... },\n  "role": { ... },\n  "prompt": {\n    "system": "...",\n    "user": "..."\n  }\n}',
              response:
                '{\n  "content": "你的回复文本",\n  "replyToMessageId": null,\n  "forceReplyRoleId": null\n}',
              notes: "返回必须是 JSON。内容字段优先读取 content，也兼容 message / output。replyToMessageId 和 forceReplyRoleId 都是可选字段。",
            },
            codex: {
              required:
                "Provider：选择 Local Codex CLI\nCommand：可填 codex；Windows 上更稳的是 D:\\nodejs\\npx.cmd\nModel：建议留空，让 Codex 自动选择当前账号可用模型",
              optional:
                "Launcher Args：只有 Command = npx / npx.cmd 时才需要，填写 -y @openai/codex\nWorking Directory：建议填你希望 agent 执行的项目根目录；留空则使用应用根目录\nTimeout：CLI 最长等待时间\nSandbox：运行权限\nSkip Git Repo Check：在非 Git 目录里可勾选",
              example:
                "Windows 推荐配置：\nCommand: D:\\nodejs\\npx.cmd\nLauncher Args: -y @openai/codex\nModel: 留空\nWorking Directory: D:\\your\\repo\nSandbox: workspace-write\nTimeout: 120000",
              notes: "不要自己在 Launcher Args 里填写 exec、--sandbox、--output-last-message 这些运行参数；应用会自动追加。",
            },
            localAgent: {
              useCase:
                "只想直接调用本机 Codex CLI：用 Local Codex CLI\n已经有自己的 bridge、想接别的本地 agent、或要走多步代理系统：用 Custom HTTP Agent",
            },
          }
        : {
            introHint: "The blocks below map directly to the fields shown in this UI, including what each integration method expects you to fill in.",
            labels: {
              useCase: "When to Use",
              required: "Required Fields",
              optional: "Optional Fields",
              example: "Example",
              request: "Request Shape",
              response: "Response Shape",
              notes: "Notes",
            },
            mock: {
              required: "Provider: choose Mock Demo\nModel: you can keep the default value; it is only a local label and does not call a real model",
              notes: "You do not need Endpoint, API Key, Command, or any live integration fields. Use it to verify room flow, UI behavior, and prompt wiring first.",
            },
            openai: {
              required:
                "Provider: choose OpenAI-Compatible HTTP API\nEndpoint: you can use a base URL, a /v1 base URL, or a full /chat/completions or /responses route, such as https://api.openai.com, https://api.openai.com/v1, or https://api.openai.com/v1/chat/completions\nModel: usually fill the model name, for example gpt-5.4, gpt-4.1, qwen2.5:14b, or deepseek-chat",
              optional:
                "API Key: usually required for OpenAI or any authenticated service; usually optional for local Ollama or unauthenticated vLLM\nTemperature: sampling temperature\nMax Tokens: single-response output cap\nTimeout: maximum wait time per request",
              example:
                "OpenAI official endpoint:\nEndpoint: https://api.openai.com\nModel: gpt-5.4\nAPI Key: sk-...\n\nLocal Ollama endpoint:\nEndpoint: http://127.0.0.1:11434/v1\nModel: qwen2.5:14b\nAPI Key: leave blank",
              notes: "The endpoint can be a base URL, a /v1 base URL, or a full route. The backend probes chat/completions and responses in a compatible order and can retry without optional sampling fields when needed.",
            },
            claude: {
              required:
                "Provider: choose Claude / Anthropic Messages API\nEndpoint: you can use a base URL, a /v1 base URL, or a full /v1/messages route, such as https://api.anthropic.com, https://api.anthropic.com/v1, or https://api.anthropic.com/v1/messages\nModel: fill a Claude-style model id such as claude-3-7-sonnet-latest or claude-3-5-sonnet-latest",
              optional:
                "API Key: usually required for Anthropic or compatible gateways\nTemperature: sampling temperature\nMax Tokens: single-response output cap\nTimeout: maximum wait time per request",
              example:
                "Anthropic official endpoint:\nEndpoint: https://api.anthropic.com\nModel: claude-3-7-sonnet-latest\nAPI Key: sk-ant-...\n\nFull messages route:\nEndpoint: https://your-gateway.example/v1/messages\nModel: claude-3-5-sonnet-latest\nAPI Key: sk-ant-...",
              notes: "The backend sends Anthropic-style messages requests and prefers x-api-key plus anthropic-version headers. Endpoints like api.aicodemirror.com/api/claudecode currently returned HTML pages or pseudo-503 request errors during live probing, so they do not behave like usable JSON messages APIs here.",
            },
            custom: {
              required:
                "Provider: choose Custom HTTP Agent\nEndpoint: your POST JSON endpoint, for example http://127.0.0.1:8000/chat",
              optional:
                "API Key: fill it if your bridge needs authentication; the app sends it as a Bearer token in the Authorization header\nModel / Temperature / Max Tokens: optional; these values are forwarded inside role.provider and your bridge can choose whether to use them",
              request:
                '{\n  "room": { ... },\n  "role": { ... },\n  "prompt": {\n    "system": "...",\n    "user": "..."\n  }\n}',
              response:
                '{\n  "content": "your reply text",\n  "replyToMessageId": null,\n  "forceReplyRoleId": null\n}',
              notes: "The response must be JSON. The app prefers content, and also accepts message / output. Both replyToMessageId and forceReplyRoleId are optional.",
            },
            codex: {
              required:
                "Provider: choose Local Codex CLI\nCommand: you can use codex; on Windows the more reliable choice is D:\\nodejs\\npx.cmd\nModel: recommended to leave blank so Codex can choose an account-supported model",
              optional:
                "Launcher Args: only needed when Command = npx / npx.cmd, typically -y @openai/codex\nWorking Directory: recommended to point at the project root the agent should operate in; if left blank the app root is used\nTimeout: maximum wait time for the CLI\nSandbox: runtime permission mode\nSkip Git Repo Check: enable this when the working directory is not a Git repo",
              example:
                "Recommended Windows setup:\nCommand: D:\\nodejs\\npx.cmd\nLauncher Args: -y @openai/codex\nModel: leave blank\nWorking Directory: D:\\your\\repo\nSandbox: workspace-write\nTimeout: 120000",
              notes: "Do not put exec, --sandbox, --output-last-message, or similar runtime flags into Launcher Args; the app appends them automatically.",
            },
            localAgent: {
              useCase:
                "Only want to call local Codex directly: use Local Codex CLI\nAlready have your own bridge, want another local agent, or need a multi-step agent system: use Custom HTTP Agent",
            },
          },
    [locale],
  );
  const templateCopy = useMemo(
    () =>
      locale === "zh-CN"
        ? {
            libraryEyebrow: "角色模板库",
            libraryTitle: "可复用角色模板",
            createTemplate: "新建模板",
            duplicateTemplate: "复制为自定义模板",
            saveTemplate: "保存模板",
            deleteTemplate: "删除模板",
            applyTemplate: "应用到当前角色",
            saveCurrentRoleTemplate: "保存当前角色为模板",
            templateName: "模板名称",
            kindLabel: "模板类型",
            participantKind: "参与者",
            recorderKind: "记录员",
            customLabel: "Custom",
            noTemplateSelected: "选择一个模板查看或编辑。",
            builtInHint: "内置模板只读；若要修改，请先复制为自定义模板。",
            customHint: "自定义模板会全局保存，可复用于其他房间和角色。",
            deleteConfirm: "确定删除角色模板“{name}”吗？",
            templateNamePrompt: "输入新模板名称",
            createParticipantDefault: "自定义参与者模板",
            createRecorderDefault: "自定义记录员模板",
            collapseLibrary: "收起模板库",
            expandLibrary: "展开模板库",
            unsavedChanges: "有未保存修改",
          }
        : {
            libraryEyebrow: "Role Template Library",
            libraryTitle: "Reusable Role Templates",
            createTemplate: "New Template",
            duplicateTemplate: "Duplicate as Custom",
            saveTemplate: "Save Template",
            deleteTemplate: "Delete Template",
            applyTemplate: "Apply to Current Role",
            saveCurrentRoleTemplate: "Save Current Role as Template",
            templateName: "Template Name",
            kindLabel: "Template Kind",
            participantKind: "Participant",
            recorderKind: "Recorder",
            customLabel: "Custom",
            noTemplateSelected: "Select one template to inspect or edit it.",
            builtInHint: "Built-in templates are read-only. Duplicate one to customize it.",
            customHint: "Custom templates are saved globally and can be reused across rooms and roles.",
            deleteConfirm: "Delete role template \"{name}\"?",
            templateNamePrompt: "Enter a name for the new template",
            createParticipantDefault: "Custom Participant Template",
            createRecorderDefault: "Custom Recorder Template",
            collapseLibrary: "Collapse Library",
            expandLibrary: "Expand Library",
            unsavedChanges: "Unsaved changes",
          },
    [locale],
  );
  const autoPlayCopy = useMemo(
    () =>
      locale === "zh-CN"
        ? {
            requestPause: "请求暂停",
            cancelPause: "取消暂停",
            pauseRequested: "已请求暂停",
            pauseAfterForcedReply: "将在当前强制回复结束后暂停",
            pauseCanceled: "已取消暂停请求",
          }
        : {
            requestPause: "Pause Safely",
            cancelPause: "Cancel Pause",
            pauseRequested: "Pause requested",
            pauseAfterForcedReply: "Pausing after the current forced-reply chain",
            pauseCanceled: "Pause request canceled",
          },
    [locale],
  );
  const visibleLoadingRoleSnapshot = useMemo(() => {
    if (loadingRoleSnapshot) {
      return loadingRoleSnapshot;
    }
    if (!draftRoom) {
      return null;
    }
    if (draftRoom.state.status === "completed" || draftRoom.state.status === "stopped") {
      return null;
    }
    if (!stepPending && !shouldContinueAutoPlay(draftRoom, autoPlayState)) {
      return null;
    }
    return toLoadingRoleSnapshot(predictNextSpeakingRole(draftRoom));
  }, [autoPlayState, draftRoom, loadingRoleSnapshot, stepPending]);
  const activeRoleSummaryText = useMemo(() => {
    if (activeRoles.length === 0) {
      return t(UI_COPY.roleStripEmpty);
    }
    const names = activeRoles.slice(0, 4).map((role) => role.name);
    const overflow = activeRoles.length - names.length;
    return overflow > 0 ? `${names.join(" / ")} +${overflow}` : names.join(" / ");
  }, [activeRoles, locale]);

  function getDisplayErrorMessage(message: string): string {
    return localizeKnownError(locale, message);
  }

  function getPresetDisplayName(preset: ProviderPreset): string {
    return preset.builtIn ? getBuiltInPresetName(locale, preset.provider.type) : preset.name;
  }

  function getPresetDisplayDescription(preset: ProviderPreset): string {
    return preset.builtIn ? getBuiltInPresetDescription(locale, preset.provider.type) : preset.description;
  }

  function getRoleTemplateDisplayName(templateId: string | null | undefined): string {
    if (!templateId) {
      return templateCopy.customLabel;
    }
    const template = allRoleTemplates.find((item) => item.id === templateId);
    if (template) {
      return template.name;
    }
    return isBuiltInRoleTemplateId(templateId) ? getBuiltInRoleTemplatePreset(templateId, locale)?.name ?? templateId : templateCopy.customLabel;
  }

  function resolveRoleTemplate(templateId: string | null | undefined): RoleTemplatePreset | null {
    if (!templateId) {
      return null;
    }
    return allRoleTemplates.find((template) => template.id === templateId) ?? null;
  }

  function getRoleTemplateSelectValue(role: DiscussionRole): string {
    return role.roleTemplateId && allRoleTemplates.some((template) => template.id === role.roleTemplateId)
      ? role.roleTemplateId
      : CUSTOM_ROLE_TEMPLATE_ID;
  }

  function shouldContinueAutoPlay(room: DiscussionRoom | null, state: AutoPlayState): boolean {
    if (!room || room.state.status !== "running") {
      return false;
    }
    if (state === "running") {
      return true;
    }
    return state === "pause-requested" && hasOutstandingForcedReplyWork(room);
  }

  function getAutoPlayButtonLabel(): string {
    if (autoPlayState === "running") {
      return autoPlayCopy.requestPause;
    }
    if (autoPlayState === "pause-requested") {
      return autoPlayCopy.cancelPause;
    }
    return t(UI_COPY.autoPlay);
  }

  function getAutoPlayStatusText(): string | null {
    if (!draftRoom || autoPlayState === "idle") {
      return null;
    }
    if (autoPlayState === "pause-requested") {
      return hasOutstandingForcedReplyWork(draftRoom) ? autoPlayCopy.pauseAfterForcedReply : autoPlayCopy.pauseRequested;
    }
    return t(UI_COPY.autoPlayRunning);
  }

  function getMessageMetaText(message: ChatMessage): string {
    return formatTemplate(locale, t(UI_COPY.messageMeta), {
      round: String(message.round),
      turn: String(message.turn),
      time: formatWhen(message.createdAt, locale),
    });
  }

  function isMessageExpanded(messageId: string): boolean {
    return expandedMessageIds.includes(messageId);
  }

  function toggleMessageExpanded(messageId: string): void {
    setExpandedMessageIds((current) =>
      current.includes(messageId) ? current.filter((id) => id !== messageId) : [...current, messageId],
    );
  }

  function getDiscussionEndTitle(status: "completed" | "stopped"): string {
    return status === "completed" ? t(UI_COPY.discussionCompleted) : t(UI_COPY.discussionStopped);
  }

  function getInsightMetaText(insight: InsightEntry): string {
    return formatTemplate(locale, t(UI_COPY.insightMeta), {
      round: String(insight.round),
      time: formatWhen(insight.createdAt, locale),
    });
  }

  function getDisplayMessageRoleName(message: Pick<ChatMessage, "kind" | "roleName">): string {
    if (message.kind === "user") {
      return locale === "zh-CN" ? "你" : "You";
    }
    return message.roleName;
  }

  function getInsightDisplayTitle(insight: InsightEntry): string {
    if (insight.kind === "final") {
      return t(UI_COPY.noteHeadingFinal);
    }
    return formatTemplate(locale, t(UI_COPY.noteHeadingCheckpoint), { index: String(insight.round) });
  }

  function getRequiredReplyText(message: ChatMessage): string | null {
    if (!message.requiredReplyRoleName) {
      return null;
    }
    return formatTemplate(locale, t(UI_COPY.requiredReplyLabel), { name: message.requiredReplyRoleName });
  }

  function getDirectionLabelForRoom(room: DiscussionRoom): string {
    return isBuiltInResearchDirection(room.researchDirectionKey)
      ? getResearchDirectionLabel(room.researchDirectionKey, locale)
      : room.researchDirectionLabel || room.researchDirectionKey;
  }

  function getDirectionDescriptionForRoom(room: DiscussionRoom): string {
    return isBuiltInResearchDirection(room.researchDirectionKey)
      ? getResearchDirectionDescription(room.researchDirectionKey, locale)
      : room.researchDirectionDescription;
  }

  function getDocumentStatusLabel(room: DiscussionRoom): string {
    switch (room.documentParseStatus) {
      case "processing":
        return t(UI_COPY.documentStatusProcessing);
      case "ready":
        return t(UI_COPY.documentStatusReady);
      case "partial":
        return t(UI_COPY.documentStatusPartial);
      case "failed":
        return t(UI_COPY.documentStatusFailed);
      default:
        return t(UI_COPY.documentStatusIdle);
    }
  }

  function getDocumentModeLabel(mode: DiscussionRoom["documentDiscussionMode"]): string {
    return mode === "whole-document" ? t(UI_COPY.documentModeWhole) : t(UI_COPY.documentModeSelected);
  }

  function getDocumentSegmentLabel(segment: DocumentSegment): string {
    if (segment.kind === "document") {
      return t(UI_COPY.documentModeWhole);
    }
    return segment.path.length > 0 ? segment.path[segment.path.length - 1] : segment.title;
  }

  function getDocumentFocusSummary(room: DiscussionRoom): string {
    if (!room.documentAsset) {
      return t(UI_COPY.documentNoAsset);
    }
    if (room.documentDiscussionMode === "whole-document") {
      return t(UI_COPY.documentWholeActive);
    }
    if (selectedDocumentSegments.length === 0) {
      return t(UI_COPY.documentFocusMissing);
    }
    return selectedDocumentSegments.map((segment) => getDocumentSegmentLabel(segment)).join(" / ");
  }

  function getDocumentWarningText(warning: string): string {
    return localizeDocumentWarning(locale, warning);
  }

  function getExchangeHardTargetName(room: DiscussionRoom): string | null {
    const hardTargetRoleId = room.state.activeExchange?.hardTargetRoleId;
    if (!hardTargetRoleId) {
      return null;
    }
    return room.roles.find((role) => role.id === hardTargetRoleId)?.name ?? null;
  }

  function getDirectionSummaryText(room: DiscussionRoom): string {
    const directionLabel = getDirectionLabelForRoom(room);
    const directionDescription = getDirectionDescriptionForRoom(room).trim();
    return directionDescription ? `${directionLabel} · ${directionDescription}` : directionLabel;
  }

  function getLanguageSummaryText(room: DiscussionRoom): string {
    const languageLabel =
      room.discussionLanguage === "zh-CN" ? t(UI_COPY.discussionLanguageZh) : t(UI_COPY.discussionLanguageEn);
    const statusText = room.state.status === "idle" ? t(UI_COPY.idleHint) : getStatusLabel(locale, room.state.status);
    return `${languageLabel} · ${statusText}`;
  }

  function renderTopInfoCard(props: {
    label: string;
    primary: string;
    secondary?: string;
    collapsed: boolean;
    onToggle: () => void;
    collapseLabel: string;
    expandLabel: string;
    testId: string;
  }) {
    const { label, primary, secondary, collapsed, onToggle, collapseLabel, expandLabel, testId } = props;

    return (
      <article className={`objective-card top-info-card ${collapsed ? "collapsed" : ""}`}>
        <div className="objective-card-head">
          <span className="strip-label">{label}</span>
          <button
            type="button"
            className="section-toggle"
            aria-expanded={!collapsed}
            data-testid={testId}
            onClick={onToggle}
          >
            {collapsed ? expandLabel : collapseLabel}
          </button>
        </div>
        <p className={collapsed ? "compact-card-text clamp-2" : "compact-card-text"}>{primary}</p>
        {!collapsed && secondary ? <p className="helper-text">{secondary}</p> : null}
      </article>
    );
  }

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.locale, locale);
  }, [locale]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.uiScalePreset, uiScalePreset);
  }, [uiScalePreset]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.chatFontPreset, chatFontPreset);
  }, [chatFontPreset]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.roomRailCollapsed, String(roomRailCollapsed));
  }, [roomRailCollapsed]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.insightPanelCollapsed, String(insightPanelCollapsed));
  }, [insightPanelCollapsed]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.studioOpen, String(studioOpen));
  }, [studioOpen]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.topInfoCollapsed, String(topInfoCollapsed));
  }, [topInfoCollapsed]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.objectiveCollapsed, String(objectiveCollapsed));
  }, [objectiveCollapsed]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.directionCollapsed, String(directionCollapsed));
  }, [directionCollapsed]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.languageCollapsed, String(languageCollapsed));
  }, [languageCollapsed]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.documentCollapsed, String(documentCollapsed));
  }, [documentCollapsed]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.rolesCollapsed, String(rolesCollapsed));
  }, [rolesCollapsed]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.roleTemplatesCollapsed, String(roleTemplatesCollapsed));
  }, [roleTemplatesCollapsed]);

  useEffect(() => {
    if (!selectedRoomId && rooms.length > 0) {
      setSelectedRoomId(rooms[0].id);
    }
  }, [rooms, selectedRoomId]);

  useEffect(() => {
    if (!selectedPresetId && presets.length > 0) {
      setSelectedPresetId(presets[0].id);
    }
  }, [presets, selectedPresetId]);

  useEffect(() => {
    if (!selectedCustomResearchDirectionId && customResearchDirections.length > 0) {
      setSelectedCustomResearchDirectionId(customResearchDirections[0].id);
    }
  }, [customResearchDirections, selectedCustomResearchDirectionId]);

  useEffect(() => {
    if (!selectedRole) {
      return;
    }
    setTemplateLibraryKind((current) => (current === selectedRole.kind ? current : selectedRole.kind));
    const nextTemplateId =
      selectedRole.roleTemplateId && allRoleTemplates.some((template) => template.id === selectedRole.roleTemplateId)
        ? selectedRole.roleTemplateId
        : null;
    setSelectedRoleTemplateId(nextTemplateId);
  }, [allRoleTemplates, selectedRole?.id, selectedRole?.kind, selectedRole?.roleTemplateId]);

  useEffect(() => {
    if (selectedRoleTemplateId && !allRoleTemplates.some((template) => template.id === selectedRoleTemplateId)) {
      setSelectedRoleTemplateId(null);
    }
  }, [allRoleTemplates, selectedRoleTemplateId]);

  useEffect(() => {
    if (!selectedRoleTemplateId) {
      setRoleTemplateDraft(null);
      setRoleTemplateDirty(false);
      return;
    }
    const template = allRoleTemplates.find((item) => item.id === selectedRoleTemplateId) ?? null;
    setRoleTemplateDraft(template ? structuredClone(template) : null);
    setRoleTemplateDirty(false);
  }, [allRoleTemplates, selectedRoleTemplateId]);

  useEffect(() => {
    if (!selectedRoom) {
      setDraftRoom(null);
      setSelectedRoleId(null);
      setPendingReplyToMessageId(null);
      setExpandedMessageIds([]);
      setAutoPlayState("idle");
      lastHydratedRoomIdRef.current = null;
      return;
    }

    const roomChanged = lastHydratedRoomIdRef.current !== selectedRoom.id;
    lastHydratedRoomIdRef.current = selectedRoom.id;
    const nextDraft = cloneRoom(selectedRoom);
    setDraftRoom(nextDraft);
    if (roomChanged) {
      setPendingReplyToMessageId(null);
      setExpandedMessageIds([]);
      setAutoPlayState("idle");
    }
    setSelectedRoleId((current) => {
      if (current && nextDraft.roles.some((role) => role.id === current)) {
        return current;
      }
      return nextDraft.roles[0]?.id ?? null;
    });
  }, [selectedRoom]);

  useEffect(() => {
    if (!draftRoom) {
      return;
    }
    if (!pendingReplyToMessageId) {
      return;
    }
    if (!draftRoom.messages.some((message) => message.id === pendingReplyToMessageId)) {
      setPendingReplyToMessageId(null);
    }
  }, [draftRoom, pendingReplyToMessageId]);

  useEffect(() => {
    if (!draftRoom) {
      return;
    }
    setExpandedMessageIds((current) => {
      const validIds = new Set(draftRoom.messages.map((message) => message.id));
      const next = current.filter((id) => validIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [draftRoom?.id, draftRoom?.updatedAt]);

  useEffect(() => {
    if (!draftRoom) {
      return;
    }
    if (isBuiltInResearchDirection(draftRoom.researchDirectionKey)) {
      return;
    }
    if (customResearchDirections.some((direction) => direction.id === draftRoom.researchDirectionKey)) {
      return;
    }
    applyResearchDirectionSelection("general");
  }, [draftRoom, customResearchDirections, locale]);

  useEffect(() => {
    if (!chatTimelineRef.current) {
      return;
    }
    chatTimelineRef.current.scrollTop = chatTimelineRef.current.scrollHeight;
  }, [draftRoom?.messages.length]);

  useEffect(() => {
    busyLabelRef.current = busyLabel;
  }, [busyLabel]);

  useEffect(() => {
    stepPendingRef.current = stepPending;
  }, [stepPending]);

  useEffect(() => {
    return () => {
      clearAutoRunTimer();
    };
  }, []);

  async function loadAll(preferredRoomId?: string): Promise<void> {
    setLoading(true);
    setError("");

    try {
      const [nextRooms, nextPresets, nextDirections, nextRoleTemplates] = await Promise.all([
        api.listRooms(),
        api.listProviderPresets(),
        api.listResearchDirections(),
        api.listRoleTemplates(),
      ]);
      setRooms(nextRooms);
      setPresets(nextPresets);
      setCustomResearchDirections(nextDirections);
      setRoleTemplates(nextRoleTemplates);

      if (nextRooms.length === 0) {
        setSelectedRoomId(null);
      } else if (preferredRoomId && nextRooms.some((room) => room.id === preferredRoomId)) {
        setSelectedRoomId(preferredRoomId);
      } else if (!selectedRoomId || !nextRooms.some((room) => room.id === selectedRoomId)) {
        setSelectedRoomId(nextRooms[0].id);
      }
    } catch (nextError) {
      setError(getDisplayErrorMessage(nextError instanceof Error ? nextError.message : t(UI_COPY.loadFailed)));
    } finally {
      setLoading(false);
    }
  }

  function clearAutoRunTimer(): void {
    if (autoRunTimerRef.current !== null) {
      window.clearTimeout(autoRunTimerRef.current);
      autoRunTimerRef.current = null;
    }
  }

  function scrollToMessage(messageId: string): void {
    const target = document.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
    if (!target) {
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedMessageId(messageId);
    window.setTimeout(() => {
      setHighlightedMessageId((current) => (current === messageId ? null : current));
    }, 1800);
  }

  function scrollChatToTop(): void {
    chatTimelineRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  function syncRoom(room: DiscussionRoom): void {
    setRooms((current) => {
      const exists = current.some((item) => item.id === room.id);
      return exists ? current.map((item) => (item.id === room.id ? room : item)) : [...current, room];
    });
    setSelectedRoomId(room.id);
    setDraftRoom(cloneRoom(room));
  }

  function syncPreset(preset: ProviderPreset): void {
    setPresets((current) => {
      const exists = current.some((item) => item.id === preset.id);
      return exists ? current.map((item) => (item.id === preset.id ? preset : item)) : [...current, preset];
    });
    setSelectedPresetId(preset.id);
  }

  function syncRoleTemplate(template: RoleTemplatePreset): void {
    setRoleTemplates((current) => {
      const exists = current.some((item) => item.id === template.id);
      return exists ? current.map((item) => (item.id === template.id ? template : item)) : [...current, template];
    });
    setSelectedRoleTemplateId(template.id);
    setTemplateLibraryKind(template.kind);
  }

  function getRoleTemplatePayload(template: Pick<RoleTemplatePreset, "name" | "kind" | "persona" | "principles" | "goal" | "voiceStyle" | "accentColor">): Partial<RoleTemplatePreset> {
    return {
      name: template.name.trim(),
      kind: template.kind,
      persona: template.persona,
      principles: template.principles,
      goal: template.goal,
      voiceStyle: template.voiceStyle,
      accentColor: template.accentColor,
    };
  }

  function updateRoleTemplateDraft(updater: (template: RoleTemplatePreset) => RoleTemplatePreset): void {
    setRoleTemplateDraft((current) => {
      if (!current) {
        return current;
      }
      const next = updater(current);
      setRoleTemplateDirty(true);
      return next;
    });
  }

  function syncResearchDirection(direction: ResearchDirectionPreset): void {
    setCustomResearchDirections((current) => {
      const exists = current.some((item) => item.id === direction.id);
      return exists ? current.map((item) => (item.id === direction.id ? direction : item)) : [...current, direction];
    });
    setSelectedCustomResearchDirectionId(direction.id);
  }

  function applyResearchDirectionSelection(directionId: string): void {
    const builtIn = isBuiltInResearchDirection(directionId);
    updateRoomField("researchDirectionKey", directionId);
    updateRoomField(
      "researchDirectionLabel",
      builtIn
        ? getResearchDirectionLabel(directionId, locale)
        : customResearchDirections.find((direction) => direction.id === directionId)?.label ?? directionId,
    );
    updateRoomField(
      "researchDirectionDescription",
      builtIn
        ? getResearchDirectionDescription(directionId, locale)
        : customResearchDirections.find((direction) => direction.id === directionId)?.description ?? "",
    );
  }

  async function runTask(label: string, task: () => Promise<void>): Promise<void> {
    setBusyLabel(label);
    setError("");

    try {
      await task();
    } catch (nextError) {
      setError(getDisplayErrorMessage(nextError instanceof Error ? nextError.message : t(UI_COPY.operationFailed)));
    } finally {
      setBusyLabel("");
    }
  }

  async function persistDraft(): Promise<DiscussionRoom> {
    if (!draftRoom) {
      throw new Error("No room draft is currently selected.");
    }
    const saved = await api.updateRoom(draftRoom.id, draftRoom);
    syncRoom(saved);
    return saved;
  }

  async function runWithSpeakingIndicator<T>(previewRoom: DiscussionRoom | null, task: () => Promise<T>): Promise<T> {
    setStepPending(true);
    setLoadingRoleSnapshot(toLoadingRoleSnapshot(previewRoom ? predictNextSpeakingRole(previewRoom) : null));
    try {
      return await task();
    } finally {
      setLoadingRoleSnapshot(null);
      setStepPending(false);
    }
  }

  async function stepDiscussion(options: { stopAutoRunning: boolean; withTaskLabel: boolean }): Promise<void> {
    const execute = async () => {
      await runWithSpeakingIndicator(draftRoom, async () => {
        const room = await ensureRunningRoom();
        setLoadingRoleSnapshot(toLoadingRoleSnapshot(predictNextSpeakingRole(room)));
        const stepped = await api.stepRoom(room.id);
        syncRoom(stepped);
      });
    };

    if (options.stopAutoRunning) {
      setAutoPlayState("idle");
    }

    if (options.withTaskLabel) {
      await runTask(t(UI_COPY.step), execute);
      return;
    }

    await execute();
  }

  async function advanceRoomOnce(room: DiscussionRoom): Promise<DiscussionRoom> {
    let nextRoom = room;
    await runWithSpeakingIndicator(room, async () => {
      const stepped = await api.stepRoom(room.id);
      nextRoom = stepped;
      syncRoom(stepped);
    });
    return nextRoom;
  }

  async function advanceAfterUserMessage(room: DiscussionRoom): Promise<DiscussionRoom> {
    if (room.state.status !== "running") {
      return room;
    }

    const requiresForcedReply = room.state.pendingRequiredReplies.length > 0;
    let nextRoom = await advanceRoomOnce(room);

    if (!requiresForcedReply || nextRoom.state.status !== "running") {
      return nextRoom;
    }

    return advanceRoomOnce(nextRoom);
  }

  async function performAutoStep(): Promise<void> {
    if (!draftRoom || autoRunBusyRef.current || busyLabelRef.current || stepPendingRef.current) {
      return;
    }

    autoRunBusyRef.current = true;
    setError("");

    try {
      await stepDiscussion({ stopAutoRunning: false, withTaskLabel: false });
    } catch (nextError) {
      setAutoPlayState("idle");
      setError(getDisplayErrorMessage(nextError instanceof Error ? nextError.message : t(UI_COPY.autoPlayFailed)));
    } finally {
      autoRunBusyRef.current = false;
    }
  }

  async function ensureRunningRoom(): Promise<DiscussionRoom> {
    const saved = await persistDraft();
    if (saved.state.status === "running") {
      return saved;
    }
    const started = await api.startRoom(saved.id);
    syncRoom(started);
    return started;
  }

  useEffect(() => {
    clearAutoRunTimer();

    if (!draftRoom) {
      return;
    }

    if (draftRoom.state.status === "completed" || draftRoom.state.status === "stopped") {
      if (autoPlayState !== "idle") {
        setAutoPlayState("idle");
      }
      return;
    }

    const shouldSchedule = shouldContinueAutoPlay(draftRoom, autoPlayState);
    if (!shouldSchedule) {
      if (autoPlayState === "pause-requested" && !busyLabel && !stepPending) {
        setAutoPlayState("idle");
      }
      return;
    }

    if (busyLabel || stepPending) {
      return;
    }

    const delayMs = Math.max(200, Math.round(draftRoom.autoRunDelaySeconds * 1000));
    autoRunTimerRef.current = window.setTimeout(() => {
      void performAutoStep();
    }, delayMs);

    return () => {
      clearAutoRunTimer();
    };
  }, [
    autoPlayState,
    busyLabel,
    stepPending,
    draftRoom?.id,
    draftRoom?.autoRunDelaySeconds,
    draftRoom?.state.status,
    draftRoom?.state.totalTurns,
    draftRoom?.state.activeExchange?.hardTargetRoleId,
    draftRoom?.state.activeExchange?.respondedRoleIds.join(","),
    draftRoom?.state.pendingRequiredReplies.length,
    draftRoom?.updatedAt,
  ]);

  function updateRoomField<K extends keyof DiscussionRoom>(field: K, value: DiscussionRoom[K]): void {
    setDraftRoom((current) => (current ? { ...current, [field]: value } : current));
  }

  function updateRole(roleId: string, updater: (role: DiscussionRole) => DiscussionRole): void {
    setDraftRoom((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        roles: current.roles.map((role) => (role.id === roleId ? updater(role) : role)),
      };
    });
  }

  function updateRoleTemplateAware(
    roleId: string,
    updater: (role: DiscussionRole) => DiscussionRole,
    options: { clearTemplateBinding?: boolean } = {},
  ): void {
    updateRole(roleId, (role) => {
      const nextRole = updater(role);
      return options.clearTemplateBinding ? { ...nextRole, roleTemplateId: null } : nextRole;
    });
  }

  function updatePreset(updater: (preset: ProviderPreset) => ProviderPreset): void {
    if (!selectedPreset) {
      return;
    }
    const nextPreset = updater(selectedPreset);
    syncPreset(nextPreset);
  }

  function applyPresetToRole(roleId: string, presetId: string): void {
    const preset = presets.find((item) => item.id === presetId);
    if (!preset) {
      return;
    }

    updateRole(roleId, (role) => ({
      ...role,
      providerPresetId: preset.id,
      provider: structuredClone(preset.provider),
    }));
  }

  function clearRolePreset(roleId: string): void {
    updateRole(roleId, (role) => ({
      ...role,
      providerPresetId: null,
    }));
  }

  function setProviderType(provider: ProviderConfig, nextType: ProviderType): ProviderConfig {
    const sameType = provider.type === nextType;
    return {
      ...createProviderDraft(nextType),
      ...provider,
      type: nextType,
      model:
        nextType === "mock"
          ? sameType && provider.model
            ? provider.model
            : "mock-discussion-v2"
          : sameType
            ? provider.model
            : "",
      command: nextType === "codex-cli" ? (sameType ? provider.command || "codex" : "codex") : "",
      timeoutMs: nextType === "codex-cli" ? (sameType ? provider.timeoutMs || 240000 : 240000) : sameType ? provider.timeoutMs || 120000 : 120000,
    };
  }

  function applyRoleTemplate(roleId: string, templateId: string): void {
    if (templateId === CUSTOM_ROLE_TEMPLATE_ID) {
      updateRole(roleId, (role) => ({ ...role, roleTemplateId: null }));
      return;
    }

    const template = resolveRoleTemplate(templateId);
    if (!template) {
      return;
    }

    applyRoleTemplatePreset(roleId, template);
  }

  function applyRoleTemplatePreset(roleId: string, template: RoleTemplatePreset): void {
    updateRole(roleId, (role) =>
      createRoleFromTemplate({
        template,
        id: role.id,
        enabled: role.enabled,
        providerPresetId: role.providerPresetId,
        provider: role.provider,
      }),
    );
  }

  function createRoleDraft(kind: DiscussionRoleKind): DiscussionRole {
    const mockPresetId = presets.find((preset) => preset.provider.type === "mock")?.id ?? null;
    const template = getBuiltInRoleTemplatePreset(kind === "recorder" ? "recorder" : "methodologist", locale);
    if (!template) {
      throw new Error("Default role template could not be resolved.");
    }
    return createRoleFromTemplate({
      template,
      providerPresetId: mockPresetId,
      provider: createProviderDraft("mock"),
    });
  }

  function createRoleTemplatePayloadFromRole(role: DiscussionRole): Partial<RoleTemplatePreset> {
    return {
      name: role.name.trim(),
      kind: role.kind,
      persona: role.persona,
      principles: role.principles,
      goal: role.goal,
      voiceStyle: role.voiceStyle,
      accentColor: role.accentColor,
    };
  }

  async function handleCreateRoleTemplateFromScratch(): Promise<void> {
    const defaultName =
      templateLibraryKind === "recorder" ? templateCopy.createRecorderDefault : templateCopy.createParticipantDefault;
    const name = window.prompt(templateCopy.templateNamePrompt, defaultName);
    if (!name?.trim()) {
      return;
    }

    const builtInTemplate = getBuiltInRoleTemplatePreset(
      templateLibraryKind === "recorder" ? "recorder" : "methodologist",
      locale,
    );
    if (!builtInTemplate) {
      return;
    }

    await runTask(templateCopy.createTemplate, async () => {
      const saved = await api.createRoleTemplate({
        ...getRoleTemplatePayload(builtInTemplate),
        name: name.trim(),
      });
      syncRoleTemplate(saved);
      setRoleTemplatesCollapsed(false);
    });
  }

  async function handleDuplicateRoleTemplate(): Promise<void> {
    const sourceTemplate = displayedRoleTemplate ?? selectedRoleTemplate;
    if (!sourceTemplate) {
      return;
    }

    const fallbackName = `${sourceTemplate.name} Copy`;
    const name = window.prompt(templateCopy.templateNamePrompt, fallbackName);
    if (!name?.trim()) {
      return;
    }

    await runTask(templateCopy.duplicateTemplate, async () => {
      const saved = await api.createRoleTemplate({
        ...getRoleTemplatePayload(sourceTemplate),
        name: name.trim(),
      });
      syncRoleTemplate(saved);
      setRoleTemplatesCollapsed(false);
    });
  }

  async function saveRoleTemplateDraft(): Promise<RoleTemplatePreset | null> {
    if (!selectedRoleTemplate || selectedRoleTemplate.builtIn || !roleTemplateDraft) {
      return selectedRoleTemplate;
    }
    if (!roleTemplateDirty) {
      return selectedRoleTemplate;
    }

    const saved = await api.updateRoleTemplate(selectedRoleTemplate.id, getRoleTemplatePayload(roleTemplateDraft));
    syncRoleTemplate(saved);
    return saved;
  }

  async function handleSaveRoleTemplate(): Promise<void> {
    if (!selectedRoleTemplate || selectedRoleTemplate.builtIn) {
      return;
    }

    await runTask(templateCopy.saveTemplate, async () => {
      await saveRoleTemplateDraft();
    });
  }

  async function handleDeleteRoleTemplate(): Promise<void> {
    if (!selectedRoleTemplate || selectedRoleTemplate.builtIn) {
      return;
    }

    if (!window.confirm(formatTemplate(locale, templateCopy.deleteConfirm, { name: selectedRoleTemplate.name }))) {
      return;
    }

    await runTask(templateCopy.deleteTemplate, async () => {
      const currentTemplates = activeRoleTemplates;
      const currentIndex = currentTemplates.findIndex((template) => template.id === selectedRoleTemplate.id);
      const remainingTemplates = currentTemplates.filter((template) => template.id !== selectedRoleTemplate.id);
      const nextSelection =
        remainingTemplates[currentIndex] ?? remainingTemplates[Math.max(0, currentIndex - 1)] ?? null;
      await api.deleteRoleTemplate(selectedRoleTemplate.id);
      setRoleTemplates((current) => current.filter((template) => template.id !== selectedRoleTemplate.id));
      setSelectedRoleTemplateId(nextSelection?.id ?? null);
      setRoleTemplateDraft(null);
      setRoleTemplateDirty(false);
      setDraftRoom((current) =>
        current
          ? {
              ...current,
              roles: current.roles.map((role) =>
                role.roleTemplateId === selectedRoleTemplate.id ? { ...role, roleTemplateId: null } : role,
              ),
            }
          : current,
      );
    });
  }

  async function handleSaveCurrentRoleAsTemplate(): Promise<void> {
    if (!selectedRole) {
      return;
    }

    const fallbackName = `${selectedRole.name} Template`;
    const name = window.prompt(templateCopy.templateNamePrompt, fallbackName);
    if (!name?.trim()) {
      return;
    }

    await runTask(templateCopy.saveCurrentRoleTemplate, async () => {
      const saved = await api.createRoleTemplate({
        ...createRoleTemplatePayloadFromRole(selectedRole),
        name: name.trim(),
      });
      syncRoleTemplate(saved);
      updateRole(selectedRole.id, (role) => ({ ...role, roleTemplateId: saved.id }));
      setRoleTemplatesCollapsed(false);
    });
  }

  async function handleApplySelectedRoleTemplate(): Promise<void> {
    if (!selectedRole || !selectedRoleTemplate || selectedRole.kind !== selectedRoleTemplate.kind) {
      return;
    }

    await runTask(templateCopy.applyTemplate, async () => {
      const templateToApply = roleTemplateDirty ? await saveRoleTemplateDraft() : selectedRoleTemplate;
      if (!templateToApply) {
        return;
      }
      applyRoleTemplatePreset(selectedRole.id, templateToApply);
    });
  }

  async function handleCreateRoom(): Promise<void> {
    await runTask(t(UI_COPY.createRoom), async () => {
      const mockPresetId = presets.find((preset) => preset.provider.type === "mock")?.id ?? null;
      const room = await api.createRoom(createLocalizedRoomSeed(locale, mockPresetId));
      syncRoom(room);
      setStudioOpen(true);
      setStudioTab("room");
    });
  }

  async function handleSaveRoom(): Promise<void> {
    await runTask(t(UI_COPY.saveRoom), async () => {
      await persistDraft();
    });
  }

  async function handleDeleteRoom(): Promise<void> {
    if (!draftRoom) {
      return;
    }

    if (!window.confirm(formatTemplate(locale, t(UI_COPY.deleteRoomConfirm), { name: draftRoom.title }))) {
      return;
    }

    await runTask(t(UI_COPY.deleteRoom), async () => {
      await api.deleteRoom(draftRoom.id);
      const remaining = rooms.filter((room) => room.id !== draftRoom.id);
      setRooms(remaining);
      setSelectedRoomId(remaining[0]?.id ?? null);
      setDraftRoom(remaining[0] ? cloneRoom(remaining[0]) : null);
    });
  }

  function handleAddRole(kind: DiscussionRoleKind): void {
    const nextRole = createRoleDraft(kind);

    setDraftRoom((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        roles: [...current.roles, nextRole],
      };
    });

    setSelectedRoleId(nextRole.id);
    setStudioOpen(true);
    setStudioTab("roles");
  }

  function handleRemoveRole(roleId: string): void {
    setDraftRoom((current) => {
      if (!current) {
        return current;
      }
      const nextRoles = current.roles.filter((role) => role.id !== roleId);
      setSelectedRoleId((currentSelectedId) => (currentSelectedId === roleId ? nextRoles[0]?.id ?? null : currentSelectedId));
      return {
        ...current,
        roles: nextRoles,
      };
    });
  }

  async function handleStartFresh(): Promise<void> {
    setAutoPlayState("idle");
    setPendingReplyToMessageId(null);
    await runTask(t(UI_COPY.startFresh), async () => {
      const saved = await persistDraft();
      const started = await api.startRoom(saved.id);
      syncRoom(started);
    });
  }

  async function handleStep(): Promise<void> {
    await stepDiscussion({ stopAutoRunning: true, withTaskLabel: true });
  }

  function handleRun(): void {
    setAutoPlayState((current) =>
      current === "idle" ? "running" : current === "running" ? "pause-requested" : "running",
    );
  }

  async function handleStop(): Promise<void> {
    if (!draftRoom) {
      return;
    }

    setAutoPlayState("idle");
    await runTask(t(UI_COPY.stop), async () => {
      const stopped = await api.stopRoom(draftRoom.id);
      syncRoom(stopped);
    });
  }

  async function handleToggleSavedInsight(insightId: string): Promise<void> {
    if (!draftRoom) {
      return;
    }

    await runTask(t(UI_COPY.savedInsightsTitle), async () => {
      const room = await api.toggleInsightSaved(draftRoom.id, insightId);
      syncRoom(room);
    });
  }

  async function handleSendUserMessage(): Promise<void> {
    if (!draftRoom || !userMessageDraft.trim()) {
      return;
    }

    await runTask(t(UI_COPY.sendToDiscussion), async () => {
      const saved = await persistDraft();
      const room = await api.addUserMessage(saved.id, userMessageDraft.trim(), pendingReplyToMessageId);
      syncRoom(room);
      setUserMessageDraft("");
      setPendingReplyToMessageId(null);
      await advanceAfterUserMessage(room);
    });
  }

  function openDocumentPicker(): void {
    documentInputRef.current?.click();
  }

  async function handleDocumentFileSelected(file: File | null): Promise<void> {
    if (!file || !draftRoom) {
      return;
    }

    await runTask(t(UI_COPY.uploadDocument), async () => {
      const saved = await persistDraft();
      const room = await api.uploadRoomDocument(saved.id, file);
      syncRoom(room);
    });

    if (documentInputRef.current) {
      documentInputRef.current.value = "";
    }
  }

  async function handleRemoveDocument(): Promise<void> {
    if (!draftRoom?.documentAsset) {
      return;
    }

    if (!window.confirm(formatTemplate(locale, t(UI_COPY.documentDeleteConfirm), { name: draftRoom.documentAsset.fileName }))) {
      return;
    }

    await runTask(t(UI_COPY.removeDocument), async () => {
      const room = await api.deleteRoomDocument(draftRoom.id);
      syncRoom(room);
    });
  }

  async function handleUseDefaultDocumentTopic(): Promise<void> {
    if (!draftRoom?.documentAsset) {
      return;
    }

    await runTask(t(UI_COPY.documentGenerateDefaultTopic), async () => {
      const room = await api.generateDefaultDocumentTopic(draftRoom.id);
      syncRoom(room);
    });
  }

  async function handleGenerateRecorderDocumentTopic(): Promise<void> {
    if (!draftRoom?.documentAsset || !canGenerateRecorderDocumentTopic) {
      return;
    }

    await runTask(t(UI_COPY.topicDocumentRecorder), async () => {
      const room = await api.generateRecorderDocumentTopic(draftRoom.id);
      syncRoom(room);
    });
  }

  async function handleDocumentModeChange(nextMode: DiscussionRoom["documentDiscussionMode"]): Promise<void> {
    if (!draftRoom?.documentAsset) {
      return;
    }

    await runTask(t(UI_COPY.documentModeLabel), async () => {
      const selectedSegmentIds =
        nextMode === "whole-document"
          ? [draftRoom.documentSegments.find((segment) => segment.kind === "document")?.id ?? ""].filter(Boolean)
          : draftRoom.selectedDocumentSegmentIds.filter((segmentId) => segmentId !== "document-whole");
      const room = await api.updateRoomDocumentFocus(draftRoom.id, {
        discussionMode: nextMode,
        selectedSegmentIds,
      });
      syncRoom(room);
    });
  }

  async function handleToggleDocumentSegment(segmentId: string): Promise<void> {
    if (!draftRoom?.documentAsset) {
      return;
    }

    const currentlySelected = new Set(draftRoom.selectedDocumentSegmentIds.filter((id) => id !== "document-whole"));
    if (currentlySelected.has(segmentId)) {
      currentlySelected.delete(segmentId);
    } else {
      currentlySelected.add(segmentId);
    }

    await runTask(t(UI_COPY.documentModeSelected), async () => {
      const room = await api.updateRoomDocumentFocus(draftRoom.id, {
        discussionMode: "selected-segments",
        selectedSegmentIds: Array.from(currentlySelected),
      });
      syncRoom(room);
    });
  }

  async function handleSaveCurrentProviderAsPreset(): Promise<void> {
    if (!selectedRole) {
      return;
    }

    const suggestedName = `${selectedRole.name}${t(UI_COPY.savePresetDefaultNameSuffix)}`;
    const name = window.prompt(t(UI_COPY.presetNamePrompt), suggestedName);
    if (!name?.trim()) {
      return;
    }
    const description = window.prompt(t(UI_COPY.presetDescriptionPrompt), selectedRole.goal) ?? "";

    await runTask(t(UI_COPY.savePreset), async () => {
      const preset = await api.createProviderPreset({
        name: name.trim(),
        description: description.trim(),
        provider: selectedRole.provider,
      });
      syncPreset(preset);
      applyPresetToRole(selectedRole.id, preset.id);
      setStudioOpen(true);
      setStudioTab("presets");
    });
  }

  async function handleCreatePresetFromScratch(): Promise<void> {
    const name = window.prompt(t(UI_COPY.presetNamePrompt), t(UI_COPY.createPresetDefaultName));
    if (!name?.trim()) {
      return;
    }

    await runTask(t(UI_COPY.newPreset), async () => {
      const preset = await api.createProviderPreset({
        name: name.trim(),
        description: "",
        provider: createProviderDraft(),
      });
      syncPreset(preset);
      setStudioOpen(true);
      setStudioTab("presets");
    });
  }

  async function handleDuplicatePreset(): Promise<void> {
    if (!selectedPreset) {
      return;
    }

    const name = window.prompt(t(UI_COPY.duplicatePresetPrompt), `${getPresetDisplayName(selectedPreset)}${t(UI_COPY.duplicatePresetSuffix)}`);
    if (!name?.trim()) {
      return;
    }

    await runTask(t(UI_COPY.duplicatePreset), async () => {
      const duplicated = await api.createProviderPreset({
        name: name.trim(),
        description: selectedPreset.description,
        provider: selectedPreset.provider,
      });
      syncPreset(duplicated);
    });
  }

  async function handleSavePreset(): Promise<void> {
    if (!selectedPreset || selectedPreset.builtIn) {
      return;
    }

    await runTask(t(UI_COPY.savePreset), async () => {
      const saved = await api.updateProviderPreset(selectedPreset.id, selectedPreset);
      syncPreset(saved);
    });
  }

  async function handleDeletePreset(): Promise<void> {
    if (!selectedPreset || selectedPreset.builtIn) {
      return;
    }

    if (!window.confirm(formatTemplate(locale, t(UI_COPY.deletePresetConfirm), { name: selectedPreset.name }))) {
      return;
    }

    await runTask(t(UI_COPY.deletePreset), async () => {
      await api.deleteProviderPreset(selectedPreset.id);
      const nextPresets = presets.filter((preset) => preset.id !== selectedPreset.id);
      setPresets(nextPresets);
      setSelectedPresetId(nextPresets[0]?.id ?? null);
    });
  }

  async function handleCreateCustomResearchDirection(): Promise<void> {
    const defaultLabel = t(UI_COPY.customDirectionDefaultName);
    const label = window.prompt(t(UI_COPY.customDirectionNamePrompt), defaultLabel);
    if (!label?.trim()) {
      return;
    }
    const description = window.prompt(t(UI_COPY.customDirectionDescriptionPrompt), "") ?? "";

    await runTask(t(UI_COPY.addCustomDirection), async () => {
      const saved = await api.createResearchDirection({
        label: label.trim(),
        description: description.trim(),
      });
      syncResearchDirection(saved);
      updateRoomField("researchDirectionKey", saved.id);
      updateRoomField("researchDirectionLabel", saved.label);
      updateRoomField("researchDirectionDescription", saved.description);
    });
  }

  async function handleSaveCustomResearchDirection(): Promise<void> {
    if (!selectedCustomResearchDirection) {
      return;
    }

    await runTask(t(UI_COPY.saveCustomDirection), async () => {
      const saved = await api.updateResearchDirection(selectedCustomResearchDirection.id, selectedCustomResearchDirection);
      syncResearchDirection(saved);
      if (draftRoom?.researchDirectionKey === saved.id) {
        updateRoomField("researchDirectionLabel", saved.label);
        updateRoomField("researchDirectionDescription", saved.description);
      }
    });
  }

  async function handleDeleteCustomResearchDirection(): Promise<void> {
    if (!selectedCustomResearchDirection) {
      return;
    }

    if (
      !window.confirm(
        formatTemplate(locale, t(UI_COPY.deleteCustomDirectionConfirm), { name: selectedCustomResearchDirection.label }),
      )
    ) {
      return;
    }

    await runTask(t(UI_COPY.deleteCustomDirection), async () => {
      await api.deleteResearchDirection(selectedCustomResearchDirection.id);
      const nextDirections = customResearchDirections.filter((direction) => direction.id !== selectedCustomResearchDirection.id);
      setCustomResearchDirections(nextDirections);
      setSelectedCustomResearchDirectionId(nextDirections[0]?.id ?? null);
      if (draftRoom?.researchDirectionKey === selectedCustomResearchDirection.id) {
        applyResearchDirectionSelection("general");
      }
    });
  }

  function buildRoomNoteContent(format: "md" | "txt", finalOnly = false): string {
    if (!draftRoom) {
      return "";
    }

    const topicHeading = t(UI_COPY.noteHeadingTopic);
    const objectiveHeading = t(UI_COPY.noteHeadingObjective);
    const finalHeading = t(UI_COPY.noteHeadingFinal);
    const checkpointHeading = (index: number) =>
      formatTemplate(locale, t(UI_COPY.noteHeadingCheckpoint), { index: String(index) });
    const finalBlock = finalInsight
      ? `${format === "md" ? `## ${finalHeading}` : finalHeading}\n${finalInsight.content}\n`
      : "";
    const checkpoints = checkpointInsights
      .slice()
      .reverse()
      .map((insight, index) =>
        format === "md"
          ? `## ${checkpointHeading(index + 1)}\n${insight.content}\n`
          : `${checkpointHeading(index + 1)}\n${insight.content}\n`,
      )
      .join("\n");

    if (finalOnly) {
      return format === "md"
        ? `# ${draftRoom.title}\n\n## ${topicHeading}\n${draftRoom.topic}\n\n${finalBlock}`.trim()
        : `${draftRoom.title}\n\n${topicHeading}\n${draftRoom.topic}\n\n${finalInsight?.content ?? ""}`.trim();
    }

    return format === "md"
      ? [
          `# ${draftRoom.title}`,
          "",
          `## ${topicHeading}`,
          draftRoom.topic,
          "",
          `## ${objectiveHeading}`,
          draftRoom.objective,
          "",
          finalBlock.trim(),
          checkpoints.trim(),
        ]
          .filter(Boolean)
          .join("\n")
      : [
          draftRoom.title,
          "",
          topicHeading,
          draftRoom.topic,
          "",
          objectiveHeading,
          draftRoom.objective,
          "",
          finalInsight ? `${finalHeading}\n${finalInsight.content}` : "",
          checkpoints.trim(),
        ]
          .filter(Boolean)
          .join("\n");
  }

  function handleDownloadNotes(format: "md" | "txt", finalOnly = false): void {
    if (!draftRoom) {
      return;
    }
    const content = buildRoomNoteContent(format, finalOnly);
    if (!content.trim()) {
      return;
    }
    const stem = sanitizeFileName(draftRoom.title || "discussion-notes");
    const suffix = finalOnly ? "final" : "notes";
    const fileName = `${stem}-${suffix}.${format}`;
    downloadTextFile(fileName, content, format === "md" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8");
  }

  function renderProviderFields(
    provider: ProviderConfig,
    onChange: (nextProvider: ProviderConfig) => void,
    mode: "role" | "preset",
  ) {
    return (
      <div className="field-grid compact-grid">
        <label>
          {t(UI_COPY.providerLabel)}
          <select
            value={provider.type}
            onChange={(event) => onChange(setProviderType(provider, event.target.value as ProviderType))}
          >
            {PROVIDER_TYPE_ORDER.map((providerType) => (
              <option key={providerType} value={providerType}>
                {getProviderTypeLabel(locale, providerType)}
              </option>
            ))}
          </select>
        </label>

        <label>
          {t(UI_COPY.modelLabel)}
          <input
            value={provider.model}
            onChange={(event) => onChange({ ...provider, model: event.target.value })}
            placeholder={provider.type === "codex-cli" ? "Optional. Leave blank to use Codex default." : t(UI_COPY.modelLabel)}
          />
        </label>

        {(provider.type === "openai-compatible" || provider.type === "anthropic-compatible" || provider.type === "custom-http") && (
          <>
            <label className="full-span">
              {t(UI_COPY.endpointLabel)}
              <input
                value={provider.endpoint}
                onChange={(event) => onChange({ ...provider, endpoint: event.target.value })}
                placeholder={
                  provider.type === "openai-compatible"
                    ? "https://api.openai.com, https://api.openai.com/v1, or a full route"
                    : provider.type === "anthropic-compatible"
                      ? "https://api.anthropic.com, https://api.anthropic.com/v1, or /v1/messages"
                    : "http://127.0.0.1:8000/chat"
                }
              />
            </label>
            <label className="full-span">
              {t(UI_COPY.apiKeyLabel)}
              <input
                type="password"
                value={provider.apiKey}
                onChange={(event) => onChange({ ...provider, apiKey: event.target.value })}
                placeholder={t(UI_COPY.apiKeyPlaceholder)}
              />
            </label>
            <label>
              {t(UI_COPY.temperatureLabel)}
              <NumericInput
                value={provider.temperature}
                min={0}
                max={2}
                step={0.1}
                onCommit={(value) => onChange({ ...provider, temperature: value })}
              />
            </label>
            <label>
              {t(UI_COPY.maxTokensLabel)}
              <NumericInput
                value={provider.maxTokens}
                min={32}
                max={4000}
                step={1}
                onCommit={(value) => onChange({ ...provider, maxTokens: Math.round(value) })}
              />
            </label>
            <label>
              {t(UI_COPY.timeoutLabel)}
              <NumericInput
                value={provider.timeoutMs}
                min={10000}
                max={600000}
                step={1000}
                onCommit={(value) => onChange({ ...provider, timeoutMs: Math.round(value) })}
              />
            </label>
          </>
        )}

        {provider.type === "codex-cli" && (
          <>
            <label>
              {t(UI_COPY.commandLabel)}
              <input
                value={provider.command}
                onChange={(event) => onChange({ ...provider, command: event.target.value })}
                placeholder="codex or npx"
              />
            </label>
            <label>
              {t(UI_COPY.launcherArgsLabel)}
              <input
                value={provider.launcherArgs}
                onChange={(event) => onChange({ ...provider, launcherArgs: event.target.value })}
                placeholder="-y @openai/codex"
              />
            </label>
            <label className="full-span">
              {t(UI_COPY.workingDirectoryLabel)}
              <input
                value={provider.workingDirectory}
                onChange={(event) => onChange({ ...provider, workingDirectory: event.target.value })}
                placeholder="Optional. Leave blank to use the app root."
              />
            </label>
            <label>
              {t(UI_COPY.timeoutLabel)}
              <NumericInput
                value={provider.timeoutMs}
                min={10000}
                max={600000}
                step={1000}
                onCommit={(value) => onChange({ ...provider, timeoutMs: Math.round(value) })}
              />
            </label>
            <label>
              {t(UI_COPY.sandboxLabel)}
              <select
                value={provider.sandboxMode}
                onChange={(event) =>
                  onChange({
                    ...provider,
                    sandboxMode: event.target.value as ProviderConfig["sandboxMode"],
                  })
                }
              >
                <option value="read-only">read-only</option>
                <option value="workspace-write">workspace-write</option>
                <option value="danger-full-access">danger-full-access</option>
              </select>
            </label>
            <label className="checkbox-line full-span">
              <input
                type="checkbox"
                checked={provider.skipGitRepoCheck}
                onChange={(event) => onChange({ ...provider, skipGitRepoCheck: event.target.checked })}
              />
              {t(UI_COPY.skipRepoCheckLabel)}
            </label>
          </>
        )}

        {provider.type === "mock" && mode === "preset" ? (
          <p className="field-note full-span">{t(UI_COPY.mockProviderHint)}</p>
        ) : null}
      </div>
    );
  }

  function renderReplyPreview(message: ChatMessage) {
    if (!message.replyToMessageId || !message.replyToExcerpt) {
      return null;
    }

    const replyTarget = draftRoom?.messages.find((candidate) => candidate.id === message.replyToMessageId) ?? null;
    const replyTargetName = replyTarget ? getDisplayMessageRoleName(replyTarget) : message.replyToRoleName ?? t(UI_COPY.replyPreviewFallback);

    return (
      <button
        type="button"
        className="reply-preview"
        onClick={() => scrollToMessage(message.replyToMessageId!)}
      >
        <strong>{replyTargetName}</strong>
        <span>{message.replyToExcerpt}</span>
      </button>
    );
  }

  function renderRequiredReplyNotice(message: ChatMessage) {
    const requiredReplyText = getRequiredReplyText(message);
    if (!requiredReplyText) {
      return null;
    }

    return (
      <div className="required-reply-chip">
        <strong>{t(UI_COPY.requiredReplyBadge)}</strong>
        <span>{requiredReplyText}</span>
      </div>
    );
  }

  function renderDocumentOutlineNode(node: DocumentOutlineNode, depth = 0) {
    if (!draftRoom) {
      return null;
    }

    const segment = draftRoom.documentSegments.find((item) => item.id === node.segmentId);
    if (!segment || segment.kind === "document") {
      return null;
    }

    const selected = draftRoom.selectedDocumentSegmentIds.includes(segment.id);
    return (
      <div key={node.id} className="document-outline-node" style={{ paddingLeft: `${depth * 14}px` }}>
        <button
          type="button"
          className={`entity-chip document-segment-chip ${selected ? "selected" : ""}`}
          onClick={() => void handleToggleDocumentSegment(segment.id)}
        >
          <span>{getDocumentSegmentLabel(segment)}</span>
          <small>
            {segment.pageStart ? `P${segment.pageStart}${segment.pageEnd && segment.pageEnd > segment.pageStart ? `-${segment.pageEnd}` : ""}` : ""}
          </small>
        </button>
        {node.children.length > 0 ? node.children.map((child) => renderDocumentOutlineNode(child, depth + 1)) : null}
      </div>
    );
  }

  function renderInsightCard(insight: InsightEntry, section: "final" | "saved" | "checkpoint" = "checkpoint") {
    const badge =
      insight.kind === "final"
        ? t(UI_COPY.finalBadge)
        : section === "saved"
          ? t(UI_COPY.savedLabel)
          : t(UI_COPY.checkpointBadge);

    return (
      <article
        key={insight.id}
        className={`insight-card ${insight.kind === "final" ? "insight-final" : ""} ${
          section === "saved" ? "insight-saved" : ""
        }`}
        data-testid={insight.kind === "final" ? "final-insight-card" : undefined}
      >
        <div className="insight-card-header">
          <div>
            <span className="insight-meta">{badge}</span>
            <h4>{getInsightDisplayTitle(insight)}</h4>
            <p className="muted small-text">{getInsightMetaText(insight)}</p>
          </div>
          <button
            className={`save-chip ${insight.saved ? "saved" : ""}`}
            onClick={() => void handleToggleSavedInsight(insight.id)}
            disabled={Boolean(busyLabel)}
          >
            {insight.saved ? t(UI_COPY.savedLabel) : t(UI_COPY.unsavedLabel)}
          </button>
        </div>
        <p className="insight-preview">{insight.content.split("\n")[0]}</p>
        <details>
          <summary>{t(UI_COPY.showDetails)}</summary>
          <div className="insight-content">{insight.content}</div>
        </details>
      </article>
    );
  }

  function renderGuideDetail(label: string, content: string, variant: "text" | "code" = "text") {
    return (
      <div className="guide-detail-card">
        <span className="guide-detail-label">{label}</span>
        <pre className={variant === "code" ? "guide-code" : "guide-detail-copy"}>{content}</pre>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="loading-state">
        <p>{t(UI_COPY.loading)}</p>
      </div>
    );
  }

  if (!draftRoom) {
    return (
      <div className="loading-state">
        <button className="primary-button" data-testid="new-room-button" onClick={() => void handleCreateRoom()}>
          {t(UI_COPY.createRoom)}
        </button>
      </div>
    );
  }

  return (
    <div
      className={`app-shell ${studioOpen ? "" : "studio-hidden"} ${roomRailCollapsed ? "room-rail-collapsed" : ""}`}
      style={appScaleStyle}
    >
      <input
        ref={documentInputRef}
        type="file"
        accept=".pdf,.docx,.txt,.md,.markdown"
        className="hidden-file-input"
        data-testid="document-upload-input"
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          void handleDocumentFileSelected(file);
        }}
      />
      <aside className={`left-rail ${roomRailCollapsed ? "collapsed" : ""}`}>
        <div className="rail-top">
          <button
            className="ghost-button rail-toggle"
            data-testid="room-rail-toggle"
            onClick={() => setRoomRailCollapsed((current) => !current)}
            title={roomRailCollapsed ? t(UI_COPY.expandRooms) : t(UI_COPY.collapseRooms)}
          >
            {roomRailCollapsed ? ">>" : "<<"}
          </button>
          {!roomRailCollapsed ? (
            <div className="brand-block">
              <p className="eyebrow">{t(UI_COPY.brandEyebrow)}</p>
              <h1>{t(UI_COPY.brandTitle)}</h1>
              <p className="brand-copy">{t(UI_COPY.brandDescription)}</p>
            </div>
          ) : null}
        </div>

        <div className="sidebar-actions">
          <button className="primary-button" data-testid="new-room-button" onClick={() => void handleCreateRoom()}>
            {roomRailCollapsed ? "+" : t(UI_COPY.createRoom)}
          </button>
        </div>

        <div className="room-list">
          {rooms.map((room) => (
            <button
              key={room.id}
              className={`room-card ${room.id === draftRoom.id ? "selected" : ""} ${roomRailCollapsed ? "mini" : ""}`}
              onClick={() => setSelectedRoomId(room.id)}
              title={room.title}
            >
              {roomRailCollapsed ? (
                <>
                  <span className="room-avatar">{room.title.slice(0, 1).toUpperCase()}</span>
                  <span className={`status-dot status-${room.state.status}`} />
                </>
              ) : (
                <>
                  <div className="room-card-head">
                    <span className="room-title">{room.title}</span>
                    <span className={`status-pill status-${room.state.status}`}>
                      {getStatusLabel(locale, room.state.status)}
                    </span>
                  </div>
                  <p className="room-meta">{getDirectionLabelForRoom(room)}</p>
                  <p className="room-meta clamp-2">{room.topic}</p>
                </>
              )}
            </button>
          ))}
        </div>
      </aside>

      <main className={`stage ${topInfoCollapsed ? "top-info-collapsed" : ""}`}>
        {topInfoCollapsed ? (
          <section className="topic-summary-bar" data-testid="topic-summary-bar">
            <div className="topic-summary-copy">
              <p className="topic-summary-room">{draftRoom.title}</p>
              <p className="topic-summary-text clamp-2">{draftRoom.topic}</p>
            </div>
            <button
              type="button"
              className="ghost-button compact-toggle-button"
              data-testid="top-info-expand-button"
              aria-expanded={!topInfoCollapsed}
              onClick={() => setTopInfoCollapsed(false)}
            >
              {t(UI_COPY.expandTopInfo)}
            </button>
          </section>
        ) : (
          <>
            <section className="stage-header">
          <div>
            <p className="eyebrow">{t(UI_COPY.brandEyebrow)}</p>
            <h2>{draftRoom.title}</h2>
            <p className="topic-line">{draftRoom.topic}</p>
          </div>

          <div className="toolbar">
            <button
              className="ghost-button"
              data-testid="locale-toggle"
              onClick={() => setLocale((current) => (current === "zh-CN" ? "en-US" : "zh-CN"))}
            >
              {t(UI_COPY.localeToggle)}
            </button>
            <button
              className="ghost-button"
              data-testid="insight-panel-toggle"
              onClick={() => setInsightPanelCollapsed((current) => !current)}
            >
              {insightPanelCollapsed ? t(UI_COPY.expandInsights) : t(UI_COPY.collapseInsights)}
            </button>
            <button
              className="ghost-button"
              data-testid="studio-toggle"
              onClick={() => setStudioOpen((current) => !current)}
            >
              {studioOpen ? t(UI_COPY.hideConfig) : t(UI_COPY.showConfig)}
            </button>
            <button
              type="button"
              className="ghost-button"
              data-testid="top-info-collapse-button"
              aria-expanded={!topInfoCollapsed}
              onClick={() => setTopInfoCollapsed(true)}
            >
              {t(UI_COPY.collapseTopInfo)}
            </button>
            <button className="primary-button" onClick={() => void handleSaveRoom()} disabled={Boolean(busyLabel)}>
              {t(UI_COPY.saveRoom)}
            </button>
          </div>
        </section>

            <section className="objective-strip">
              {renderTopInfoCard({
                label: t(UI_COPY.roomSectionObjective),
                primary: draftRoom.objective,
                collapsed: objectiveCollapsed,
                onToggle: () => setObjectiveCollapsed((current) => !current),
                collapseLabel: t(UI_COPY.collapseObjective),
                expandLabel: t(UI_COPY.expandObjective),
                testId: "objective-collapse-button",
              })}
              {renderTopInfoCard({
                label: t(UI_COPY.roomSectionDirection),
                primary: directionCollapsed ? getDirectionSummaryText(draftRoom) : getDirectionLabelForRoom(draftRoom),
                secondary: getDirectionDescriptionForRoom(draftRoom),
                collapsed: directionCollapsed,
                onToggle: () => setDirectionCollapsed((current) => !current),
                collapseLabel: t(UI_COPY.collapseDirection),
                expandLabel: t(UI_COPY.expandDirection),
                testId: "direction-collapse-button",
              })}
              {renderTopInfoCard({
                label: t(UI_COPY.roomSectionLanguage),
                primary:
                  languageCollapsed
                    ? getLanguageSummaryText(draftRoom)
                    : draftRoom.discussionLanguage === "zh-CN"
                      ? t(UI_COPY.discussionLanguageZh)
                      : t(UI_COPY.discussionLanguageEn),
                secondary:
                  draftRoom.state.status === "idle" ? t(UI_COPY.idleHint) : getStatusLabel(locale, draftRoom.state.status),
                collapsed: languageCollapsed,
                onToggle: () => setLanguageCollapsed((current) => !current),
                collapseLabel: t(UI_COPY.collapseLanguage),
                expandLabel: t(UI_COPY.expandLanguage),
                testId: "language-collapse-button",
              })}
            </section>

            {draftRoom.documentAsset ? (
              <section className={`document-focus-panel ${documentCollapsed ? "collapsed" : ""}`}>
                <div className="panel-header tight">
                  <div>
                    <p className="eyebrow">{t(UI_COPY.documentSourceTitle)}</p>
                    <h3>{draftRoom.documentAsset.title}</h3>
                    <p className="helper-text">{getDocumentFocusSummary(draftRoom)}</p>
                  </div>
                  <div className="inline-actions">
                    {!documentCollapsed ? (
                      <span className="busy-chip">{getDocumentModeLabel(draftRoom.documentDiscussionMode)}</span>
                    ) : null}
                    <span className="busy-chip">{getDocumentStatusLabel(draftRoom)}</span>
                    <button
                      type="button"
                      className="section-toggle"
                      aria-expanded={!documentCollapsed}
                      data-testid="document-collapse-button"
                      onClick={() => setDocumentCollapsed((current) => !current)}
                    >
                      {documentCollapsed ? t(UI_COPY.expandDocumentPanel) : t(UI_COPY.collapseDocumentPanel)}
                    </button>
                  </div>
                </div>
              </section>
            ) : null}

        <section className={`role-section ${rolesCollapsed ? "collapsed" : ""}`}>
          <div className="panel-header tight">
            <div>
              <p className="eyebrow">{t(UI_COPY.roomSectionRoles)}</p>
              <p className="helper-text role-strip-summary">{activeRoleSummaryText}</p>
            </div>
            <div className="inline-actions">
              <span className="busy-chip">{`${t(UI_COPY.roomSectionRoles)}: ${activeRoles.length}`}</span>
              <button
                type="button"
                className="section-toggle"
                aria-expanded={!rolesCollapsed}
                data-testid="roles-collapse-button"
                onClick={() => setRolesCollapsed((current) => !current)}
              >
                {rolesCollapsed ? t(UI_COPY.expandRoles) : t(UI_COPY.collapseRoles)}
              </button>
            </div>
          </div>
          {!rolesCollapsed ? (
            <div className="role-strip">
              {activeRoles.map((role) => (
                <article key={role.id} className={`role-pill ${role.id === selectedRoleId ? "selected" : ""}`}>
              <div className="role-pill-head">
                <span className="role-pill-dot" style={{ backgroundColor: role.accentColor }} />
                <span className="role-pill-name">{role.name}</span>
              </div>
              <small>
                {role.kind === "recorder" ? t(UI_COPY.recorderTag) : t(UI_COPY.participantTag)}
                {role.roleTemplateId ? ` · ${getRoleTemplateDisplayName(role.roleTemplateId)}` : ""}
              </small>
              <p className="role-pill-goal">{role.goal}</p>
            </article>
          ))}
            </div>
          ) : null}
        </section>
          </>
        )}

        {error ? <div className="error-banner">{error}</div> : null}

        <section className={`chat-layout ${insightPanelCollapsed ? "insight-collapsed" : ""}`}>
          <div className="chat-column">
            <section className="chat-panel">
              <div className="chat-panel-top">
                <div className="chat-panel-header">
                  <div>
                    <p className="eyebrow">{t(UI_COPY.roomSectionTopic)}</p>
                    <h3>{draftRoom.title}</h3>
                    <div className="chat-stats">
                      <span>{t(UI_COPY.participantCount)}: {participantCount}</span>
                      <span>{t(UI_COPY.roundsLabel)}: {draftRoom.maxRounds}</span>
                      <span>{t(UI_COPY.activeRound)}: {displayedExchangeNumber}</span>
                      <span>{t(UI_COPY.chatTurns)}: {draftRoom.messages.length}</span>
                      <span>{t(UI_COPY.autoRunDelayLabel)}: {draftRoom.autoRunDelaySeconds}s</span>
                    </div>
                  </div>
                  <div className="inline-actions">
                    <button
                      className="ghost-button"
                      data-testid="start-fresh-button"
                      onClick={() => void handleStartFresh()}
                      disabled={Boolean(busyLabel) || (!canStartDocumentDiscussion && draftRoom.state.status !== "running")}
                    >
                      {t(UI_COPY.startFresh)}
                    </button>
                    <button
                      className="ghost-button"
                      data-testid="step-button"
                      onClick={() => void handleStep()}
                      disabled={Boolean(busyLabel) || (!canStartDocumentDiscussion && draftRoom.state.status !== "running")}
                    >
                      {t(UI_COPY.step)}
                    </button>
                    <button
                      className="primary-button"
                      data-testid="run-all-button"
                      onClick={handleRun}
                      disabled={Boolean(busyLabel) || autoRunBusyRef.current || (!canStartDocumentDiscussion && draftRoom.state.status !== "running")}
                    >
                      {getAutoPlayButtonLabel()}
                    </button>
                    <button className="danger-button" onClick={() => void handleStop()} disabled={Boolean(busyLabel)}>
                      {t(UI_COPY.stop)}
                    </button>
                  </div>
                </div>

                <div className="display-controls" data-testid="display-controls">
                  <div className="display-control-group">
                    <span className="display-control-label">{t(UI_COPY.uiScaleLabel)}</span>
                    <div className="display-control-options">
                      <button
                        type="button"
                        className={`display-scale-button ${uiScalePreset === "compact" ? "active" : ""}`}
                        data-testid="ui-scale-compact"
                        aria-pressed={uiScalePreset === "compact"}
                        onClick={() => setUiScalePreset("compact")}
                      >
                        {t(UI_COPY.uiScaleCompact)}
                      </button>
                      <button
                        type="button"
                        className={`display-scale-button ${uiScalePreset === "default" ? "active" : ""}`}
                        data-testid="ui-scale-default"
                        aria-pressed={uiScalePreset === "default"}
                        onClick={() => setUiScalePreset("default")}
                      >
                        {t(UI_COPY.uiScaleDefault)}
                      </button>
                      <button
                        type="button"
                        className={`display-scale-button ${uiScalePreset === "comfortable" ? "active" : ""}`}
                        data-testid="ui-scale-comfortable"
                        aria-pressed={uiScalePreset === "comfortable"}
                        onClick={() => setUiScalePreset("comfortable")}
                      >
                        {t(UI_COPY.uiScaleComfortable)}
                      </button>
                    </div>
                  </div>
                  <div className="display-control-group">
                    <span className="display-control-label">{t(UI_COPY.chatFontLabel)}</span>
                    <div className="display-control-options">
                      <button
                        type="button"
                        className={`display-scale-button ${chatFontPreset === "small" ? "active" : ""}`}
                        data-testid="chat-font-small"
                        aria-pressed={chatFontPreset === "small"}
                        onClick={() => setChatFontPreset("small")}
                      >
                        {t(UI_COPY.chatFontSmall)}
                      </button>
                      <button
                        type="button"
                        className={`display-scale-button ${chatFontPreset === "medium" ? "active" : ""}`}
                        data-testid="chat-font-medium"
                        aria-pressed={chatFontPreset === "medium"}
                        onClick={() => setChatFontPreset("medium")}
                      >
                        {t(UI_COPY.chatFontMedium)}
                      </button>
                      <button
                        type="button"
                        className={`display-scale-button ${chatFontPreset === "large" ? "active" : ""}`}
                        data-testid="chat-font-large"
                        aria-pressed={chatFontPreset === "large"}
                        onClick={() => setChatFontPreset("large")}
                      >
                        {t(UI_COPY.chatFontLarge)}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="chat-timeline" ref={chatTimelineRef} tabIndex={0}>
                {finalInsight ? (
                  <section className="summary-spotlight" data-testid="summary-spotlight">
                    <div className="summary-spotlight-header">
                      <div>
                        <p className="eyebrow">{t(UI_COPY.summarySpotlightEyebrow)}</p>
                        <h4>{t(UI_COPY.summarySpotlightTitle)}</h4>
                        <p className="helper-text">{t(UI_COPY.summarySpotlightHint)}</p>
                      </div>
                      <div className="inline-actions">
                        <button className="ghost-button" onClick={() => handleDownloadNotes("md", true)}>
                          {t(UI_COPY.downloadFinalMd)}
                        </button>
                        <button className="ghost-button" onClick={() => handleDownloadNotes("txt", true)}>
                          {t(UI_COPY.downloadFinalTxt)}
                        </button>
                        <button className="primary-button" onClick={() => handleDownloadNotes("md", false)}>
                          {t(UI_COPY.downloadNotesMd)}
                        </button>
                      </div>
                    </div>
                    <div className="summary-spotlight-body">{finalInsight.content}</div>
                  </section>
                ) : null}

                <div className="chat-status-rail">
                  {busyLabel ? <div className="busy-chip">{busyLabel}</div> : null}
                  {getAutoPlayStatusText() ? <div className="busy-chip auto-play-chip">{getAutoPlayStatusText()}</div> : null}
                  {draftRoom.state.activeExchange ? (
                    <div className="exchange-status-card">
                      <strong>{t(UI_COPY.exchangeStatusTitle)}</strong>
                      <span>
                        {t(UI_COPY.exchangeReasonLabel)}: {getExchangeReasonLabel(locale, draftRoom.state.activeExchange.reason)}
                      </span>
                      <span>
                        {t(UI_COPY.exchangeHardTargetLabel)}: {getExchangeHardTargetName(draftRoom) ?? "-"}
                      </span>
                      <span>
                        {t(UI_COPY.exchangeRespondedLabel)}: {exchangeRespondedNames.length > 0 ? exchangeRespondedNames.join(", ") : "-"}
                      </span>
                      <span>{t(UI_COPY.exchangeOpenLabel)}</span>
                    </div>
                  ) : null}
                </div>

                <div className="chat-stream">
                  {draftRoom.messages.map((message) => {
                    const relatedRole = draftRoom.roles.find((role) => role.id === message.roleId);
                    const accent =
                      message.kind === "user"
                        ? "#8c5d14"
                        : relatedRole?.accentColor ?? (message.kind === "recorder" ? "#5c6476" : "#738195");
                    const messageMeta = getMessageMetaText(message);
                    const collapsible = isMessageCollapsible(message.content);
                    const expanded = isMessageExpanded(message.id);
                    const visibleContent = collapsible && !expanded ? getCollapsedMessagePreview(message.content) : message.content;

                    return (
                      <article
                        key={message.id}
                        className={`chat-message kind-${message.kind} ${
                          draftRoom.state.lastActiveRoleId === message.roleId ? "active" : ""
                        } ${highlightedMessageId === message.id ? "highlighted" : ""}`}
                        data-message-id={message.id}
                      >
                        <div className="avatar" style={{ backgroundColor: accent }}>
                          {message.kind === "user" ? getDisplayMessageRoleName(message) : message.roleName.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="bubble-wrap">
                          <div className="message-meta">
                            <strong>{getDisplayMessageRoleName(message)}</strong>
                            <span>{messageMeta}</span>
                            <button
                              type="button"
                              className="message-reply-button"
                              data-testid={`reply-button-${message.id}`}
                              onClick={() => setPendingReplyToMessageId(message.id)}
                            >
                              {t(UI_COPY.reply)}
                            </button>
                          </div>
                          <div className="message-bubble">
                            {renderReplyPreview(message)}
                            {renderRequiredReplyNotice(message)}
                            <div className={`message-content ${collapsible && !expanded ? "collapsed" : ""}`}>{visibleContent}</div>
                            {collapsible ? (
                              <button
                                type="button"
                                className="message-toggle-button"
                                onClick={() => toggleMessageExpanded(message.id)}
                              >
                                {expanded ? t(UI_COPY.collapseMessage) : t(UI_COPY.expandMessage)}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                  {visibleLoadingRoleSnapshot ? (
                    <article
                      className={`chat-message typing-message kind-${visibleLoadingRoleSnapshot.kind}`}
                      data-testid={`typing-indicator-${visibleLoadingRoleSnapshot.roleId}`}
                    >
                      <div className="avatar" style={{ backgroundColor: visibleLoadingRoleSnapshot.accentColor }}>
                        {visibleLoadingRoleSnapshot.roleName.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="bubble-wrap">
                        <div className="message-meta">
                          <strong>{visibleLoadingRoleSnapshot.roleName}</strong>
                          <span className="typing-status">...</span>
                        </div>
                        <div className="message-bubble typing-bubble">
                          <div className="typing-dots" style={{ color: visibleLoadingRoleSnapshot.accentColor }} aria-hidden="true">
                            <span />
                            <span />
                            <span />
                          </div>
                        </div>
                      </div>
                    </article>
                  ) : null}
                  {discussionEndStatus ? (
                    <div className="chat-end-marker" data-testid="chat-end-marker">
                      <div className="chat-end-marker-copy">
                        <strong>{getDiscussionEndTitle(discussionEndStatus)}</strong>
                        <span>{t(UI_COPY.discussionEndHint)}</span>
                      </div>
                      <button type="button" className="ghost-button" onClick={scrollChatToTop}>
                        {t(UI_COPY.scrollToTop)}
                      </button>
                    </div>
                  ) : null}
                  {draftRoom.messages.length === 0 && !visibleLoadingRoleSnapshot && !discussionEndStatus ? (
                    <div className="empty-chat">
                      <p>{t(UI_COPY.noTranscriptTitle)}</p>
                      <p>{t(UI_COPY.noTranscriptBody)}</p>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="composer-card">
                <div>
                  <p className="eyebrow">{t(UI_COPY.userInterventionEyebrow)}</p>
                  <h4>{t(UI_COPY.userInterventionTitle)}</h4>
                  <p className="helper-text">
                    {canIntervene ? t(UI_COPY.userInterventionReady) : t(UI_COPY.userInterventionLocked)}
                  </p>
                </div>
                {pendingReplyMessage ? (
                  <div className="composer-reply-card" data-testid="composer-reply-card">
                    <div>
                      <strong>{t(UI_COPY.replyingTo)} {getDisplayMessageRoleName(pendingReplyMessage)}</strong>
                      <p>{truncateText(pendingReplyMessage.content, 120)}</p>
                      <p className="helper-text">
                        {pendingReplyMessage.kind === "participant"
                          ? formatTemplate(locale, t(UI_COPY.replyingToRoleImmediate), { name: getDisplayMessageRoleName(pendingReplyMessage) })
                          : t(UI_COPY.replyingToGeneric)}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="ghost-button"
                      data-testid="cancel-reply-button"
                      onClick={() => setPendingReplyToMessageId(null)}
                    >
                      {t(UI_COPY.cancelReply)}
                    </button>
                  </div>
                ) : null}
                <textarea
                  rows={1}
                  data-testid="user-intervention-input"
                  value={userMessageDraft}
                  onChange={(event) => setUserMessageDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key !== "Enter" ||
                      !event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey ||
                      event.metaKey ||
                      event.nativeEvent.isComposing
                    ) {
                      return;
                    }
                    if (!draftRoom || !canIntervene || !userMessageDraft.trim() || Boolean(busyLabel)) {
                      return;
                    }
                    event.preventDefault();
                    void handleSendUserMessage();
                  }}
                  placeholder={t(UI_COPY.userInterventionPlaceholder)}
                  disabled={!canIntervene}
                />
                <div className="composer-action-bar">
                  <div className="inline-actions">
                    <button
                      className="ghost-button"
                      data-testid="composer-step-button"
                      onClick={() => void handleStep()}
                      disabled={Boolean(busyLabel) || (!canStartDocumentDiscussion && draftRoom.state.status !== "running")}
                    >
                      {t(UI_COPY.composerStep)}
                    </button>
                    <button
                      className="ghost-button"
                      data-testid="composer-auto-play-button"
                      onClick={handleRun}
                      disabled={Boolean(busyLabel) || autoRunBusyRef.current || (!canStartDocumentDiscussion && draftRoom.state.status !== "running")}
                    >
                      {getAutoPlayButtonLabel()}
                    </button>
                    <button
                      className="danger-button subtle"
                      data-testid="composer-stop-button"
                      onClick={() => void handleStop()}
                      disabled={Boolean(busyLabel)}
                    >
                      {t(UI_COPY.stop)}
                    </button>
                  </div>
                  <div className="inline-actions">
                    <button
                      className="primary-button"
                      data-testid="user-message-send"
                      onClick={() => void handleSendUserMessage()}
                      disabled={!draftRoom || !canIntervene || !userMessageDraft.trim() || Boolean(busyLabel)}
                    >
                      {t(UI_COPY.sendToDiscussion)}
                    </button>
                    <button
                      className="ghost-button"
                      onClick={() => setUserMessageDraft("")}
                      disabled={!userMessageDraft || Boolean(busyLabel)}
                    >
                      {t(UI_COPY.clear)}
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>

          {!insightPanelCollapsed ? (
            <aside className="insight-panel">
              <section className="insight-section">
                <div className="insight-section-header">
                  <div>
                    <p className="eyebrow">{t(UI_COPY.finalVerdictEyebrow)}</p>
                    <h3>{t(UI_COPY.finalVerdictTitle)}</h3>
                  </div>
                </div>
                {finalInsight ? renderInsightCard(finalInsight, "final") : <p className="muted">{t(UI_COPY.finalVerdictEmpty)}</p>}
              </section>

              <section className="insight-section">
                <div className="insight-section-header">
                  <div>
                    <p className="eyebrow">{t(UI_COPY.savedInsightsEyebrow)}</p>
                    <h3>{t(UI_COPY.savedInsightsTitle)}</h3>
                  </div>
                </div>
                {savedInsights.length > 0 ? (
                  savedInsights.map((insight) => renderInsightCard(insight, "saved"))
                ) : (
                  <p className="muted">{t(UI_COPY.savedInsightsEmpty)}</p>
                )}
              </section>

              <section className="insight-section">
                <div className="insight-section-header">
                  <div>
                    <p className="eyebrow">{t(UI_COPY.checkpointsEyebrow)}</p>
                    <h3>{t(UI_COPY.checkpointsTitle)}</h3>
                  </div>
                </div>
                {checkpointInsights.length > 0 ? (
                  checkpointInsights.map((insight) => renderInsightCard(insight))
                ) : (
                  <p className="muted">{t(UI_COPY.checkpointsEmpty)}</p>
                )}
              </section>
            </aside>
          ) : null}
        </section>
      </main>

      {studioOpen ? (
        <aside className="studio">
          <div className="studio-tabs">
            <button
              className={studioTab === "room" ? "active" : ""}
              data-testid="room-tab-button"
              onClick={() => setStudioTab("room")}
            >
              {t(UI_COPY.roomTab)}
            </button>
            <button
              className={studioTab === "roles" ? "active" : ""}
              data-testid="roles-tab-button"
              onClick={() => setStudioTab("roles")}
            >
              {t(UI_COPY.rolesTab)}
            </button>
            <button
              className={studioTab === "presets" ? "active" : ""}
              data-testid="presets-tab-button"
              onClick={() => setStudioTab("presets")}
            >
              {t(UI_COPY.presetsTab)}
            </button>
          </div>

          {studioTab === "room" ? (
            <section className="studio-section">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">{t(UI_COPY.roomConfigEyebrow)}</p>
                  <h3>{t(UI_COPY.roomConfigTitle)}</h3>
                </div>
                <button className="danger-button subtle" onClick={() => void handleDeleteRoom()} disabled={Boolean(busyLabel)}>
                  {t(UI_COPY.deleteRoom)}
                </button>
              </div>

              <div className="field-grid">
                <label>
                  {t(UI_COPY.roomTitleLabel)}
                  <input value={draftRoom.title} onChange={(event) => updateRoomField("title", event.target.value)} />
                </label>
                <label>
                  {t(UI_COPY.maxRoundsLabel)}
                  <NumericInput
                    value={draftRoom.maxRounds}
                    min={1}
                    max={ROOM_LIMIT_MAX}
                    step={1}
                    onCommit={(value) => updateRoomField("maxRounds", Math.round(value))}
                  />
                </label>
                <label>
                  {t(UI_COPY.autoRunDelayLabel)}
                  <NumericInput
                    value={draftRoom.autoRunDelaySeconds}
                    min={0.2}
                    max={30}
                    step={0.1}
                    testId="auto-run-delay-input"
                    onCommit={(value) => updateRoomField("autoRunDelaySeconds", value)}
                  />
                </label>
                <label className="full-span">
                  {t(UI_COPY.topicLabel)}
                  <textarea
                    rows={5}
                    value={draftRoom.topic}
                    onChange={(event) => updateRoomField("topic", event.target.value)}
                  />
                </label>
                <div className="full-span document-source-panel">
                  <div className="panel-header tight">
                    <div>
                      <h4>{t(UI_COPY.documentSourceTitle)}</h4>
                      <p className="muted">{t(UI_COPY.documentSourceHint)}</p>
                    </div>
                    <div className="inline-actions">
                      <button className="ghost-button" type="button" onClick={openDocumentPicker}>
                        {draftRoom.documentAsset ? t(UI_COPY.replaceDocument) : t(UI_COPY.uploadDocument)}
                      </button>
                      {draftRoom.documentAsset ? (
                        <button className="danger-button subtle" type="button" onClick={() => void handleRemoveDocument()}>
                          {t(UI_COPY.removeDocument)}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {draftRoom.documentAsset ? (
                    <>
                      <div className="document-asset-card">
                        <div className="document-asset-meta">
                          <strong>{draftRoom.documentAsset.fileName}</strong>
                          <span>{getDocumentKindLabel(locale, draftRoom.documentAsset.fileKind)}</span>
                          <span>{t(UI_COPY.documentStatusLabel)}: {getDocumentStatusLabel(draftRoom)}</span>
                          <span>{t(UI_COPY.documentModeLabel)}: {getDocumentModeLabel(draftRoom.documentDiscussionMode)}</span>
                          <span>{t(UI_COPY.documentPageCountLabel)}: {draftRoom.documentAsset.pageCount ?? "-"}</span>
                          <span>{t(UI_COPY.documentCharCountLabel)}: {draftRoom.documentAsset.charCount}</span>
                        </div>
                        <div className="inline-actions">
                          <button className="ghost-button" type="button" onClick={() => void handleUseDefaultDocumentTopic()}>
                            {t(UI_COPY.documentGenerateDefaultTopic)}
                          </button>
                          <button
                            className="ghost-button"
                            type="button"
                            onClick={() => void handleGenerateRecorderDocumentTopic()}
                            disabled={!canGenerateRecorderDocumentTopic}
                            title={!canGenerateRecorderDocumentTopic ? t(UI_COPY.documentGenerateRecorderDisabled) : undefined}
                          >
                            {t(UI_COPY.topicDocumentRecorder)}
                          </button>
                        </div>
                      </div>

                      {draftRoom.documentWarnings.length > 0 ? (
                        <div className="document-warning-list">
                          <strong>{t(UI_COPY.documentWarningsTitle)}</strong>
                          {draftRoom.documentWarnings.map((warning) => (
                            <p key={warning} className="helper-text">
                              {getDocumentWarningText(warning)}
                            </p>
                          ))}
                        </div>
                      ) : null}

                      <div className="inline-actions top-gap">
                        {documentSupportsWholeMode ? (
                          <button
                            className={draftRoom.documentDiscussionMode === "whole-document" ? "primary-button" : "ghost-button"}
                            type="button"
                            onClick={() => void handleDocumentModeChange("whole-document")}
                          >
                            {t(UI_COPY.documentModeWhole)}
                          </button>
                        ) : null}
                        <button
                          className={draftRoom.documentDiscussionMode === "selected-segments" ? "primary-button" : "ghost-button"}
                          type="button"
                          onClick={() => void handleDocumentModeChange("selected-segments")}
                        >
                          {t(UI_COPY.documentModeSelected)}
                        </button>
                      </div>

                      {draftRoom.documentDiscussionMode === "selected-segments" ? (
                        <div className="top-gap">
                          <div className="panel-header tight">
                            <div>
                              <h4>{t(UI_COPY.documentOutlineTitle)}</h4>
                              <p className="muted">
                                {selectedDocumentSegments.length > 0
                                  ? formatTemplate(locale, t(UI_COPY.documentSelectedCount), { count: String(selectedDocumentSegments.length) })
                                  : t(UI_COPY.documentFocusMissing)}
                              </p>
                            </div>
                          </div>
                          {draftRoom.documentOutline.length > 0 ? (
                            <div className="document-outline-tree">
                              {draftRoom.documentOutline.map((node) => renderDocumentOutlineNode(node))}
                            </div>
                          ) : (
                            <p className="muted small-text">{t(UI_COPY.documentOutlineEmpty)}</p>
                          )}
                        </div>
                      ) : (
                        <p className="muted small-text top-gap">{t(UI_COPY.documentWholeActive)}</p>
                      )}

                      {!canGenerateRecorderDocumentTopic ? (
                        <p className="muted small-text top-gap">{t(UI_COPY.documentGenerateRecorderDisabled)}</p>
                      ) : null}
                    </>
                  ) : (
                    <p className="muted small-text">{t(UI_COPY.documentNoAsset)}</p>
                  )}
                </div>
                <label className="full-span">
                  {t(UI_COPY.objectiveLabel)}
                  <textarea
                    rows={5}
                    value={draftRoom.objective}
                    onChange={(event) => updateRoomField("objective", event.target.value)}
                  />
                </label>
                <label>
                  {t(UI_COPY.discussionLanguageLabel)}
                  <select
                    value={draftRoom.discussionLanguage}
                    onChange={(event) => updateRoomField("discussionLanguage", event.target.value as DiscussionLanguage)}
                  >
                    <option value="zh-CN">{t(UI_COPY.discussionLanguageZh)}</option>
                    <option value="en-US">{t(UI_COPY.discussionLanguageEn)}</option>
                  </select>
                </label>
                <label>
                  {t(UI_COPY.researchDirectionLabel)}
                  <select
                    value={draftRoom.researchDirectionKey}
                    onChange={(event) => applyResearchDirectionSelection(event.target.value)}
                  >
                    {allResearchDirections.map((direction) => (
                      <option key={direction.id} value={direction.id}>
                        {direction.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="full-span">
                  {t(UI_COPY.researchDirectionNoteLabel)}
                  <textarea
                    rows={4}
                    value={draftRoom.researchDirectionNote}
                    placeholder={t(UI_COPY.researchDirectionNotePlaceholder)}
                    onChange={(event) => updateRoomField("researchDirectionNote", event.target.value)}
                  />
                </label>
                <div className="full-span custom-direction-panel">
                  <div className="panel-header tight">
                    <div>
                      <h4>{t(UI_COPY.customDirectionLibraryTitle)}</h4>
                      <p className="muted">{t(UI_COPY.customDirectionLibraryHint)}</p>
                    </div>
                    <button className="ghost-button" onClick={() => void handleCreateCustomResearchDirection()}>
                      {t(UI_COPY.addCustomDirection)}
                    </button>
                  </div>

                  {customResearchDirections.length > 0 ? (
                    <div className="entity-list compact-entity-list">
                      {customResearchDirections.map((direction) => (
                        <button
                          key={direction.id}
                          className={`entity-chip ${direction.id === selectedCustomResearchDirectionId ? "selected" : ""}`}
                          onClick={() => setSelectedCustomResearchDirectionId(direction.id)}
                        >
                          <span>{direction.label}</span>
                          <small>{draftRoom.researchDirectionKey === direction.id ? t(UI_COPY.inUseLabel) : t(UI_COPY.customDirectionLabel)}</small>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="muted small-text">{t(UI_COPY.customDirectionEmpty)}</p>
                  )}

                  {selectedCustomResearchDirection ? (
                    <div className="field-grid top-gap">
                      <label>
                        {t(UI_COPY.customDirectionNameLabel)}
                        <input
                          value={selectedCustomResearchDirection.label}
                          onChange={(event) =>
                            setCustomResearchDirections((current) =>
                              current.map((direction) =>
                                direction.id === selectedCustomResearchDirection.id
                                  ? { ...direction, label: event.target.value }
                                  : direction,
                              ),
                            )
                          }
                        />
                      </label>
                      <label className="full-span">
                        {t(UI_COPY.customDirectionDescriptionLabel)}
                        <textarea
                          rows={3}
                          value={selectedCustomResearchDirection.description}
                          onChange={(event) =>
                            setCustomResearchDirections((current) =>
                              current.map((direction) =>
                                direction.id === selectedCustomResearchDirection.id
                                  ? { ...direction, description: event.target.value }
                                  : direction,
                              ),
                            )
                          }
                        />
                      </label>
                      <div className="inline-actions full-span">
                        <button className="ghost-button" onClick={() => void handleSaveCustomResearchDirection()}>
                          {t(UI_COPY.saveCustomDirection)}
                        </button>
                        <button className="danger-button subtle" onClick={() => void handleDeleteCustomResearchDirection()}>
                          {t(UI_COPY.deleteCustomDirection)}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
                <label>
                  {t(UI_COPY.checkpointIntervalLabel)}
                  <NumericInput
                    value={draftRoom.checkpointIntervalRounds}
                    min={0}
                    max={ROOM_LIMIT_MAX}
                    step={1}
                    testId="checkpoint-interval-input"
                    onCommit={(value) =>
                      setDraftRoom((current) =>
                        current
                          ? {
                              ...current,
                              checkpointIntervalRounds: Math.round(value),
                              checkpointEveryRound: Math.round(value) > 0,
                            }
                          : current,
                      )
                    }
                  />
                  <p className="field-note">{t(UI_COPY.checkpointIntervalHint)}</p>
                </label>
              </div>
            </section>
          ) : null}

          {studioTab === "roles" ? (
            <section className="studio-section">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">{t(UI_COPY.roleStudioEyebrow)}</p>
                  <h3>{t(UI_COPY.roleStudioTitle)}</h3>
                </div>
                <div className="role-actions">
                  <button className="ghost-button" onClick={() => handleAddRole("participant")}>
                    {t(UI_COPY.addParticipant)}
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() => handleAddRole("recorder")}
                    disabled={Boolean(draftRoom.roles.some((role) => role.kind === "recorder"))}
                  >
                    {t(UI_COPY.addRecorder)}
                  </button>
                </div>
              </div>

              <div className="entity-list">
                {draftRoom.roles.map((role) => (
                  <button
                    key={role.id}
                    className={`entity-chip ${role.id === selectedRoleId ? "selected" : ""}`}
                    onClick={() => setSelectedRoleId(role.id)}
                  >
                    <span className="role-pill-dot" style={{ backgroundColor: role.accentColor }} />
                    <span>{role.name}</span>
                    <small>{role.kind === "recorder" ? t(UI_COPY.recorderTag) : t(UI_COPY.participantTag)}</small>
                  </button>
                ))}
              </div>

              {selectedRole ? (
                <div className="editor-card">
                  <div className="panel-header tight">
                    <div>
                      <h4>{selectedRole.name}</h4>
                      <p className="muted">{t(UI_COPY.roleDefinitionHint)}</p>
                    </div>
                    <button className="text-button" onClick={() => handleRemoveRole(selectedRole.id)}>
                      {t(UI_COPY.removeRole)}
                    </button>
                  </div>

                  <div className="field-grid">
                    <label>
                      {t(UI_COPY.roleNameLabel)}
                      <input
                        value={selectedRole.name}
                        onChange={(event) =>
                          updateRoleTemplateAware(
                            selectedRole.id,
                            (role) => ({ ...role, name: event.target.value }),
                            { clearTemplateBinding: true },
                          )
                        }
                      />
                    </label>
                    <label>
                      {t(UI_COPY.roleTemplateLabel)}
                      <select
                        value={getRoleTemplateSelectValue(selectedRole)}
                        onChange={(event) => applyRoleTemplate(selectedRole.id, event.target.value)}
                      >
                        <option value={CUSTOM_ROLE_TEMPLATE_ID}>{templateCopy.customLabel}</option>
                        {getAvailableRoleTemplates(selectedRole.kind, allRoleTemplates).map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {t(UI_COPY.accentColorLabel)}
                      <input
                        type="color"
                        value={selectedRole.accentColor}
                        onChange={(event) =>
                          updateRoleTemplateAware(
                            selectedRole.id,
                            (role) => ({ ...role, accentColor: event.target.value }),
                            { clearTemplateBinding: true },
                          )
                        }
                      />
                    </label>
                    <label className="checkbox-line">
                      <input
                        type="checkbox"
                        checked={selectedRole.enabled}
                        onChange={(event) =>
                          updateRole(selectedRole.id, (role) => ({ ...role, enabled: event.target.checked }))
                        }
                      />
                      {t(UI_COPY.enableRoleLabel)}
                    </label>
                    <label>
                      {t(UI_COPY.presetLabel)}
                      <select
                        value={selectedRole.providerPresetId ?? ""}
                        onChange={(event) => {
                          const nextPresetId = event.target.value;
                          if (!nextPresetId) {
                            clearRolePreset(selectedRole.id);
                            return;
                          }
                          applyPresetToRole(selectedRole.id, nextPresetId);
                        }}
                      >
                        <option value="">{t(UI_COPY.noPreset)}</option>
                        {presets.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {getPresetDisplayName(preset)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="full-span">
                      {t(UI_COPY.personaLabel)}
                      <textarea
                        rows={3}
                        value={selectedRole.persona}
                        onChange={(event) =>
                          updateRoleTemplateAware(
                            selectedRole.id,
                            (role) => ({ ...role, persona: event.target.value }),
                            { clearTemplateBinding: true },
                          )
                        }
                      />
                    </label>
                    <label className="full-span">
                      {t(UI_COPY.goalLabel)}
                      <textarea
                        rows={3}
                        value={selectedRole.goal}
                        onChange={(event) =>
                          updateRoleTemplateAware(
                            selectedRole.id,
                            (role) => ({ ...role, goal: event.target.value }),
                            { clearTemplateBinding: true },
                          )
                        }
                      />
                    </label>
                    <label className="full-span">
                      {t(UI_COPY.strategyLabel)}
                      <textarea
                        rows={3}
                        value={selectedRole.principles}
                        onChange={(event) =>
                          updateRoleTemplateAware(
                            selectedRole.id,
                            (role) => ({ ...role, principles: event.target.value }),
                            { clearTemplateBinding: true },
                          )
                        }
                      />
                    </label>
                    <label className="full-span">
                      {t(UI_COPY.voiceStyleLabel)}
                      <textarea
                        rows={2}
                        value={selectedRole.voiceStyle}
                        onChange={(event) =>
                          updateRoleTemplateAware(
                            selectedRole.id,
                            (role) => ({ ...role, voiceStyle: event.target.value }),
                            { clearTemplateBinding: true },
                          )
                        }
                      />
                    </label>
                    <div className="inline-actions full-span">
                      <button className="ghost-button" onClick={() => void handleSaveCurrentRoleAsTemplate()}>
                        {templateCopy.saveCurrentRoleTemplate}
                      </button>
                      <button className="ghost-button" onClick={() => void handleSaveCurrentProviderAsPreset()}>
                        {t(UI_COPY.saveCurrentProviderPreset)}
                      </button>
                      <button
                        className="ghost-button"
                        onClick={() => {
                          setStudioOpen(true);
                          setStudioTab("presets");
                        }}
                      >
                        {t(UI_COPY.managePresets)}
                      </button>
                    </div>
                  </div>

                  <details className="advanced-panel">
                    <summary>{t(UI_COPY.advancedProviderSettings)}</summary>
                    {renderProviderFields(
                      selectedRole.provider,
                      (nextProvider) =>
                        updateRole(selectedRole.id, (role) => ({
                          ...role,
                          providerPresetId: null,
                          provider: nextProvider,
                        })),
                      "role",
                    )}
                  </details>
                </div>
              ) : (
                <p className="muted">{t(UI_COPY.roleEditorEmpty)}</p>
              )}

              <div className="editor-card top-gap template-library-panel">
                <div className="panel-header tight">
                  <div>
                    <p className="eyebrow">{templateCopy.libraryEyebrow}</p>
                    <h4>{templateCopy.libraryTitle}</h4>
                    <p className="muted">
                      {displayedRoleTemplate?.builtIn ? templateCopy.builtInHint : templateCopy.customHint}
                    </p>
                  </div>
                  <div className="inline-actions">
                    <button className="ghost-button" onClick={() => void handleCreateRoleTemplateFromScratch()}>
                      {templateCopy.createTemplate}
                    </button>
                    <button className="ghost-button" onClick={() => void handleDuplicateRoleTemplate()} disabled={!selectedRoleTemplate}>
                      {templateCopy.duplicateTemplate}
                    </button>
                    <button
                      type="button"
                      className="section-toggle"
                      aria-expanded={!roleTemplatesCollapsed}
                      onClick={() => setRoleTemplatesCollapsed((current) => !current)}
                    >
                      {roleTemplatesCollapsed ? templateCopy.expandLibrary : templateCopy.collapseLibrary}
                    </button>
                  </div>
                </div>

                {roleTemplatesCollapsed ? (
                  <div className="template-library-summary">
                    <span>{displayedRoleTemplate?.name ?? templateCopy.noTemplateSelected}</span>
                    {roleTemplateDirty ? <small>{templateCopy.unsavedChanges}</small> : null}
                  </div>
                ) : (
                  <>
                    <div className="inline-actions">
                      <button
                        type="button"
                        className={templateLibraryKind === "participant" ? "primary-button" : "ghost-button"}
                        onClick={() => setTemplateLibraryKind("participant")}
                      >
                        {templateCopy.participantKind}
                      </button>
                      <button
                        type="button"
                        className={templateLibraryKind === "recorder" ? "primary-button" : "ghost-button"}
                        onClick={() => setTemplateLibraryKind("recorder")}
                      >
                        {templateCopy.recorderKind}
                      </button>
                    </div>

                    {activeRoleTemplates.length > 0 ? (
                      <div className="entity-list compact-entity-list top-gap">
                        {activeRoleTemplates.map((template) => (
                          <button
                            key={template.id}
                            className={`entity-chip ${template.id === selectedRoleTemplateId ? "selected" : ""}`}
                            onClick={() => setSelectedRoleTemplateId(template.id)}
                          >
                            <span>{template.name}</span>
                            <small>{template.builtIn ? t(UI_COPY.presetBuiltIn) : t(UI_COPY.presetCustom)}</small>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="muted small-text top-gap">{templateCopy.noTemplateSelected}</p>
                    )}

                    {displayedRoleTemplate ? (
                      <div className="field-grid top-gap">
                        <label>
                          {templateCopy.templateName}
                          <input
                            value={displayedRoleTemplate.name}
                            onChange={(event) =>
                              updateRoleTemplateDraft((template) => ({ ...template, name: event.target.value }))
                            }
                            disabled={displayedRoleTemplate.builtIn}
                          />
                        </label>
                        <label>
                          {templateCopy.kindLabel}
                          <input
                            value={displayedRoleTemplate.kind === "recorder" ? templateCopy.recorderKind : templateCopy.participantKind}
                            disabled
                          />
                        </label>
                        <label>
                          {t(UI_COPY.accentColorLabel)}
                          <input
                            type="color"
                            value={displayedRoleTemplate.accentColor}
                            onChange={(event) =>
                              updateRoleTemplateDraft((template) => ({ ...template, accentColor: event.target.value }))
                            }
                            disabled={displayedRoleTemplate.builtIn}
                          />
                        </label>
                        <label className="full-span">
                          {t(UI_COPY.personaLabel)}
                          <textarea
                            rows={3}
                            value={displayedRoleTemplate.persona}
                            onChange={(event) =>
                              updateRoleTemplateDraft((template) => ({ ...template, persona: event.target.value }))
                            }
                            disabled={displayedRoleTemplate.builtIn}
                          />
                        </label>
                        <label className="full-span">
                          {t(UI_COPY.goalLabel)}
                          <textarea
                            rows={3}
                            value={displayedRoleTemplate.goal}
                            onChange={(event) =>
                              updateRoleTemplateDraft((template) => ({ ...template, goal: event.target.value }))
                            }
                            disabled={displayedRoleTemplate.builtIn}
                          />
                        </label>
                        <label className="full-span">
                          {t(UI_COPY.strategyLabel)}
                          <textarea
                            rows={3}
                            value={displayedRoleTemplate.principles}
                            onChange={(event) =>
                              updateRoleTemplateDraft((template) => ({ ...template, principles: event.target.value }))
                            }
                            disabled={displayedRoleTemplate.builtIn}
                          />
                        </label>
                        <label className="full-span">
                          {t(UI_COPY.voiceStyleLabel)}
                          <textarea
                            rows={2}
                            value={displayedRoleTemplate.voiceStyle}
                            onChange={(event) =>
                              updateRoleTemplateDraft((template) => ({ ...template, voiceStyle: event.target.value }))
                            }
                            disabled={displayedRoleTemplate.builtIn}
                          />
                        </label>
                        <div className="inline-actions full-span">
                          {!displayedRoleTemplate.builtIn ? (
                            <>
                              <button className="ghost-button" onClick={() => void handleSaveRoleTemplate()} disabled={!roleTemplateDirty}>
                                {templateCopy.saveTemplate}
                              </button>
                              <button className="danger-button subtle" onClick={() => void handleDeleteRoleTemplate()}>
                                {templateCopy.deleteTemplate}
                              </button>
                            </>
                          ) : null}
                          {selectedRole && selectedRole.kind === displayedRoleTemplate.kind ? (
                            <button className="primary-button" onClick={() => void handleApplySelectedRoleTemplate()}>
                              {templateCopy.applyTemplate}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </section>
          ) : null}

          {studioTab === "presets" ? (
            <section className="studio-section">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">{t(UI_COPY.providerPresetsEyebrow)}</p>
                  <h3>{t(UI_COPY.providerPresetsTitle)}</h3>
                </div>
                <div className="role-actions">
                  <button
                    className="ghost-button"
                    data-testid="provider-guide-button"
                    onClick={() => setGuideOpen(true)}
                  >
                    {t(UI_COPY.providerGuide)}
                  </button>
                  <button className="ghost-button" onClick={() => void handleCreatePresetFromScratch()}>
                    {t(UI_COPY.newPreset)}
                  </button>
                  <button className="ghost-button" onClick={() => void handleDuplicatePreset()} disabled={!selectedPreset}>
                    {t(UI_COPY.duplicatePreset)}
                  </button>
                </div>
              </div>

              <div className="preset-group-list">
                {presetGroups.map((group) => (
                  <section key={group.providerType} className="preset-group">
                    <div className="preset-group-header">
                      <h4>{group.label}</h4>
                    </div>
                    <div className="entity-list compact-entity-list">
                      {group.presets.map((preset) => (
                        <button
                          key={preset.id}
                          className={`entity-chip ${preset.id === selectedPresetId ? "selected" : ""}`}
                          onClick={() => setSelectedPresetId(preset.id)}
                        >
                          <span>{getPresetDisplayName(preset)}</span>
                          <small>{preset.builtIn ? t(UI_COPY.presetBuiltIn) : t(UI_COPY.presetCustom)}</small>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>

              {selectedPreset ? (
                <div className="editor-card">
                  <div className="panel-header tight">
                    <div>
                      <h4>{getPresetDisplayName(selectedPreset)}</h4>
                      <p className="muted">
                        {selectedPreset.builtIn ? t(UI_COPY.builtInPresetHint) : t(UI_COPY.customPresetHint)}
                      </p>
                    </div>
                    {!selectedPreset.builtIn ? (
                      <div className="inline-actions">
                        <button className="ghost-button" onClick={() => void handleSavePreset()}>
                          {t(UI_COPY.savePreset)}
                        </button>
                        <button className="danger-button subtle" onClick={() => void handleDeletePreset()}>
                          {t(UI_COPY.deletePreset)}
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <div className="field-grid">
                    <label>
                      {t(UI_COPY.presetNameLabel)}
                      <input
                        value={selectedPreset.builtIn ? getPresetDisplayName(selectedPreset) : selectedPreset.name}
                        onChange={(event) => updatePreset((preset) => ({ ...preset, name: event.target.value }))}
                        disabled={selectedPreset.builtIn}
                      />
                    </label>
                    <label className="full-span">
                      {t(UI_COPY.descriptionLabel)}
                      <textarea
                        rows={2}
                        value={selectedPreset.builtIn ? getPresetDisplayDescription(selectedPreset) : selectedPreset.description}
                        onChange={(event) =>
                          updatePreset((preset) => ({
                            ...preset,
                            description: event.target.value,
                          }))
                        }
                        disabled={selectedPreset.builtIn}
                      />
                    </label>
                  </div>

                  {renderProviderFields(
                    selectedPreset.provider,
                    (nextProvider) =>
                      updatePreset((preset) => ({
                        ...preset,
                        provider: nextProvider,
                      })),
                    "preset",
                  )}

                  {selectedRole ? (
                    <div className="inline-actions top-gap">
                      <button className="primary-button" onClick={() => applyPresetToRole(selectedRole.id, selectedPreset.id)}>
                        {t(UI_COPY.applyToCurrentRole)}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="muted">{t(UI_COPY.presetEditorEmpty)}</p>
              )}
            </section>
          ) : null}
        </aside>
      ) : null}

      {guideOpen ? (
        <div className="modal-overlay" data-testid="provider-guide-modal" onClick={() => setGuideOpen(false)}>
          <section className="guide-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header tight">
              <div>
                <p className="eyebrow">{t(UI_COPY.providerPresetsEyebrow)}</p>
                <h3>{t(UI_COPY.guideIntroTitle)}</h3>
                <p className="guide-intro-note">{guideCopy.introHint}</p>
              </div>
              <button
                type="button"
                className="ghost-button"
                data-testid="provider-guide-close"
                onClick={() => setGuideOpen(false)}
              >
                {t(UI_COPY.closeGuide)}
              </button>
            </div>

            <div className="guide-section">
              <h4>{t(UI_COPY.guideMockTitle)}</h4>
              <p>{t(UI_COPY.guideMockBody)}</p>
              <div className="guide-detail-stack">
                {renderGuideDetail(guideCopy.labels.required, guideCopy.mock.required)}
                {renderGuideDetail(guideCopy.labels.notes, guideCopy.mock.notes)}
              </div>
            </div>
            <div className="guide-section">
              <h4>{t(UI_COPY.guideOpenAITitle)}</h4>
              <p>{t(UI_COPY.guideOpenAIBody)}</p>
              <div className="guide-detail-stack">
                {renderGuideDetail(guideCopy.labels.required, guideCopy.openai.required)}
                {renderGuideDetail(guideCopy.labels.optional, guideCopy.openai.optional)}
                {renderGuideDetail(guideCopy.labels.example, guideCopy.openai.example, "code")}
                {renderGuideDetail(guideCopy.labels.notes, guideCopy.openai.notes)}
              </div>
            </div>
            <div className="guide-section">
              <h4>{t(UI_COPY.guideClaudeTitle)}</h4>
              <p>{t(UI_COPY.guideClaudeBody)}</p>
              <div className="guide-detail-stack">
                {renderGuideDetail(guideCopy.labels.required, guideCopy.claude.required)}
                {renderGuideDetail(guideCopy.labels.optional, guideCopy.claude.optional)}
                {renderGuideDetail(guideCopy.labels.example, guideCopy.claude.example, "code")}
                {renderGuideDetail(guideCopy.labels.notes, guideCopy.claude.notes)}
              </div>
            </div>
            <div className="guide-section">
              <h4>{t(UI_COPY.guideCustomTitle)}</h4>
              <p>{t(UI_COPY.guideCustomBody)}</p>
              <div className="guide-detail-stack">
                {renderGuideDetail(guideCopy.labels.required, guideCopy.custom.required)}
                {renderGuideDetail(guideCopy.labels.optional, guideCopy.custom.optional)}
                {renderGuideDetail(guideCopy.labels.request, guideCopy.custom.request, "code")}
                {renderGuideDetail(guideCopy.labels.response, guideCopy.custom.response, "code")}
                {renderGuideDetail(guideCopy.labels.notes, guideCopy.custom.notes)}
              </div>
            </div>
            <div className="guide-section">
              <h4>{t(UI_COPY.guideCodexTitle)}</h4>
              <p>{t(UI_COPY.guideCodexBody)}</p>
              <div className="guide-detail-stack">
                {renderGuideDetail(guideCopy.labels.required, guideCopy.codex.required)}
                {renderGuideDetail(guideCopy.labels.optional, guideCopy.codex.optional)}
                {renderGuideDetail(guideCopy.labels.example, guideCopy.codex.example, "code")}
                {renderGuideDetail(guideCopy.labels.notes, guideCopy.codex.notes)}
              </div>
            </div>
            <div className="guide-section">
              <h4>{t(UI_COPY.guideLocalAgentTitle)}</h4>
              <p>{t(UI_COPY.guideLocalAgentBody)}</p>
              {renderGuideDetail(guideCopy.labels.useCase, guideCopy.localAgent.useCase)}
              <pre className="guide-flow">{t(UI_COPY.guideFlowText)}</pre>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default App;
