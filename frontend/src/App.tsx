import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import {
  createLocalizedRoomSeed,
  createProviderDraft,
  createRoleFromTemplate,
  getAvailableRoleTemplates,
  getResearchDirectionDescription,
  getResearchDirectionLabel,
  getRoleTemplateName,
  PROVIDER_TYPE_ORDER,
  RESEARCH_DIRECTION_ORDER,
} from "./catalog";
import { formatTemplate, getProviderTypeLabel, getStatusLabel, getText, STORAGE_KEYS, UI_COPY } from "./i18n";
import {
  ChatMessage,
  DiscussionLanguage,
  DiscussionRole,
  DiscussionRoleKind,
  DiscussionRoom,
  InsightEntry,
  ProviderConfig,
  ProviderPreset,
  ProviderType,
  RoleTemplateKey,
  UiLocale,
} from "./types";

type StudioTab = "room" | "roles" | "presets";

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

function App() {
  const [rooms, setRooms] = useState<DiscussionRoom[]>([]);
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [draftRoom, setDraftRoom] = useState<DiscussionRoom | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [studioTab, setStudioTab] = useState<StudioTab>("roles");
  const [locale, setLocale] = useState<UiLocale>(() => readLocaleStorage());
  const [roomRailCollapsed, setRoomRailCollapsed] = useState<boolean>(() =>
    readBooleanStorage(STORAGE_KEYS.roomRailCollapsed, false),
  );
  const [insightPanelCollapsed, setInsightPanelCollapsed] = useState<boolean>(() =>
    readBooleanStorage(STORAGE_KEYS.insightPanelCollapsed, false),
  );
  const [studioOpen, setStudioOpen] = useState<boolean>(() => readBooleanStorage(STORAGE_KEYS.studioOpen, true));
  const [userMessageDraft, setUserMessageDraft] = useState("");
  const [pendingReplyToMessageId, setPendingReplyToMessageId] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState("");
  const autoRunTimerRef = useRef<number | null>(null);
  const autoRunBusyRef = useRef(false);
  const chatStreamRef = useRef<HTMLDivElement | null>(null);
  const lastHydratedRoomIdRef = useRef<string | null>(null);

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

  const participantCount = useMemo(
    () => draftRoom?.roles.filter((role) => role.kind === "participant" && role.enabled).length ?? 0,
    [draftRoom],
  );

  const finalInsight = useMemo(
    () => draftRoom?.summary.insights.find((insight) => insight.kind === "final") ?? null,
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
  const canIntervene = draftRoom?.state.status === "running";
  const pendingReplyMessage = useMemo(
    () => draftRoom?.messages.find((message) => message.id === pendingReplyToMessageId) ?? null,
    [draftRoom, pendingReplyToMessageId],
  );

  const t = <T extends { "zh-CN": string; "en-US": string }>(value: T): string => getText(locale, value);

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.locale, locale);
  }, [locale]);

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
    if (!selectedRoom) {
      setDraftRoom(null);
      setSelectedRoleId(null);
      setPendingReplyToMessageId(null);
      setAutoRunning(false);
      lastHydratedRoomIdRef.current = null;
      return;
    }

    const roomChanged = lastHydratedRoomIdRef.current !== selectedRoom.id;
    lastHydratedRoomIdRef.current = selectedRoom.id;
    const nextDraft = cloneRoom(selectedRoom);
    setDraftRoom(nextDraft);
    if (roomChanged) {
      setPendingReplyToMessageId(null);
      setAutoRunning(false);
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
    if (!chatStreamRef.current) {
      return;
    }
    chatStreamRef.current.scrollTop = chatStreamRef.current.scrollHeight;
  }, [draftRoom?.messages.length]);

  useEffect(() => {
    return () => {
      if (autoRunTimerRef.current !== null) {
        window.clearTimeout(autoRunTimerRef.current);
      }
    };
  }, []);

  async function loadAll(preferredRoomId?: string): Promise<void> {
    setLoading(true);
    setError("");

    try {
      const [nextRooms, nextPresets] = await Promise.all([api.listRooms(), api.listProviderPresets()]);
      setRooms(nextRooms);
      setPresets(nextPresets);

      if (nextRooms.length === 0) {
        setSelectedRoomId(null);
      } else if (preferredRoomId && nextRooms.some((room) => room.id === preferredRoomId)) {
        setSelectedRoomId(preferredRoomId);
      } else if (!selectedRoomId || !nextRooms.some((room) => room.id === selectedRoomId)) {
        setSelectedRoomId(nextRooms[0].id);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load data.");
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

  async function runTask(label: string, task: () => Promise<void>): Promise<void> {
    setBusyLabel(label);
    setError("");

    try {
      await task();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Operation failed.");
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

  async function performAutoStep(): Promise<void> {
    if (!draftRoom || autoRunBusyRef.current) {
      return;
    }

    autoRunBusyRef.current = true;
    setError("");

    try {
      const room = await ensureRunningRoom();
      const stepped = await api.stepRoom(room.id);
      syncRoom(stepped);
    } catch (nextError) {
      setAutoRunning(false);
      setError(nextError instanceof Error ? nextError.message : "Auto play failed.");
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

    if (!autoRunning || !draftRoom) {
      return;
    }

    if (draftRoom.state.status === "completed" || draftRoom.state.status === "stopped") {
      setAutoRunning(false);
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
    autoRunning,
    draftRoom,
    draftRoom?.id,
    draftRoom?.autoRunDelaySeconds,
    draftRoom?.state.status,
    draftRoom?.state.phase,
    draftRoom?.state.currentRound,
    draftRoom?.state.totalTurns,
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
    return {
      ...createProviderDraft(nextType),
      ...provider,
      type: nextType,
      model:
        nextType === "mock"
          ? provider.model || "mock-discussion-v2"
          : nextType === "codex-cli"
            ? provider.model || "gpt-5-codex"
            : provider.model,
      command: nextType === "codex-cli" ? provider.command || "codex" : provider.command,
      timeoutMs: nextType === "codex-cli" ? provider.timeoutMs || 240000 : provider.timeoutMs || 120000,
    };
  }

  function applyRoleTemplate(roleId: string, templateKey: RoleTemplateKey): void {
    updateRole(roleId, (role) =>
      createRoleFromTemplate({
        templateKey,
        locale,
        id: role.id,
        enabled: role.enabled,
        providerPresetId: role.providerPresetId,
        provider: role.provider,
      }),
    );
  }

  function createRoleDraft(kind: DiscussionRoleKind): DiscussionRole {
    const mockPresetId = presets.find((preset) => preset.provider.type === "mock")?.id ?? null;
    const templateKey: RoleTemplateKey = kind === "recorder" ? "recorder" : "methodologist";
    return createRoleFromTemplate({
      templateKey,
      locale,
      providerPresetId: mockPresetId,
      provider: createProviderDraft("mock"),
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
    setAutoRunning(false);
    setPendingReplyToMessageId(null);
    await runTask(t(UI_COPY.startFresh), async () => {
      const saved = await persistDraft();
      const started = await api.startRoom(saved.id);
      syncRoom(started);
    });
  }

  async function handleStep(): Promise<void> {
    setAutoRunning(false);
    await runTask(t(UI_COPY.step), async () => {
      const room = await ensureRunningRoom();
      const stepped = await api.stepRoom(room.id);
      syncRoom(stepped);
    });
  }

  function handleRun(): void {
    setAutoRunning((current) => !current);
  }

  async function handleStop(): Promise<void> {
    if (!draftRoom) {
      return;
    }

    setAutoRunning(false);
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

    const name = window.prompt(t(UI_COPY.duplicatePresetPrompt), `${selectedPreset.name} Copy`);
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
            placeholder={provider.type === "codex-cli" ? "gpt-5-codex" : t(UI_COPY.modelLabel)}
          />
        </label>

        {(provider.type === "openai-compatible" || provider.type === "custom-http") && (
          <>
            <label className="full-span">
              {t(UI_COPY.endpointLabel)}
              <input
                value={provider.endpoint}
                onChange={(event) => onChange({ ...provider, endpoint: event.target.value })}
                placeholder={
                  provider.type === "openai-compatible"
                    ? "http://localhost:11434/v1 or https://api.openai.com/v1"
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
              <input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={provider.temperature}
                onChange={(event) => onChange({ ...provider, temperature: Number(event.target.value) })}
              />
            </label>
            <label>
              {t(UI_COPY.maxTokensLabel)}
              <input
                type="number"
                min={32}
                max={4000}
                value={provider.maxTokens}
                onChange={(event) => onChange({ ...provider, maxTokens: Number(event.target.value) })}
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
              <input
                type="number"
                min={10000}
                step={1000}
                value={provider.timeoutMs}
                onChange={(event) => onChange({ ...provider, timeoutMs: Number(event.target.value) })}
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
          <p className="field-note full-span">
            Mock provider is useful for offline demos, layout checks, and prompt iteration without calling a real model.
          </p>
        ) : null}
      </div>
    );
  }

  function renderReplyPreview(message: ChatMessage) {
    if (!message.replyToMessageId || !message.replyToExcerpt) {
      return null;
    }

    return (
      <button
        type="button"
        className="reply-preview"
        onClick={() => scrollToMessage(message.replyToMessageId!)}
      >
        <strong>{message.replyToRoleName ?? "Earlier message"}</strong>
        <span>{message.replyToExcerpt}</span>
      </button>
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
            <h4>{insight.title}</h4>
            <p className="muted small-text">
              {locale === "zh-CN"
                ? `第 ${insight.round} 轮 · ${formatWhen(insight.createdAt, locale)}`
                : `Round ${insight.round} · ${formatWhen(insight.createdAt, locale)}`}
            </p>
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
    >
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
                  <p className="room-meta">{getResearchDirectionLabel(room.researchDirectionKey, locale)}</p>
                  <p className="room-meta clamp-2">{room.topic}</p>
                </>
              )}
            </button>
          ))}
        </div>
      </aside>

      <main className="stage">
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
            <button className="primary-button" onClick={() => void handleSaveRoom()} disabled={Boolean(busyLabel)}>
              {t(UI_COPY.saveRoom)}
            </button>
          </div>
        </section>

        <section className="objective-strip">
          <article className="objective-card">
            <span className="strip-label">{t(UI_COPY.roomSectionObjective)}</span>
            <p>{draftRoom.objective}</p>
          </article>
          <article className="objective-card">
            <span className="strip-label">{t(UI_COPY.roomSectionDirection)}</span>
            <p>{getResearchDirectionLabel(draftRoom.researchDirectionKey, locale)}</p>
            <p className="helper-text">{getResearchDirectionDescription(draftRoom.researchDirectionKey, locale)}</p>
          </article>
          <article className="objective-card">
            <span className="strip-label">{t(UI_COPY.roomSectionLanguage)}</span>
            <p>
              {draftRoom.discussionLanguage === "zh-CN"
                ? t(UI_COPY.discussionLanguageZh)
                : t(UI_COPY.discussionLanguageEn)}
            </p>
            <p className="helper-text">
              {draftRoom.state.status === "idle" ? t(UI_COPY.idleHint) : getStatusLabel(locale, draftRoom.state.status)}
            </p>
          </article>
        </section>

        <section className="role-strip">
          {activeRoles.map((role) => (
            <article key={role.id} className={`role-pill ${role.id === selectedRoleId ? "selected" : ""}`}>
              <div className="role-pill-head">
                <span className="role-pill-dot" style={{ backgroundColor: role.accentColor }} />
                <span className="role-pill-name">{role.name}</span>
              </div>
              <small>
                {role.kind === "recorder" ? t(UI_COPY.recorderTag) : t(UI_COPY.participantTag)}
                {role.roleTemplateKey ? ` · ${getRoleTemplateName(role.roleTemplateKey, locale)}` : ""}
              </small>
              <p className="role-pill-goal">{role.goal}</p>
            </article>
          ))}
        </section>

        {error ? <div className="error-banner">{error}</div> : null}

        <section className={`chat-layout ${insightPanelCollapsed ? "insight-collapsed" : ""}`}>
          <div className="chat-column">
            <section className="chat-panel">
              <div className="chat-panel-header">
                <div>
                  <p className="eyebrow">{t(UI_COPY.roomSectionTopic)}</p>
                  <h3>{draftRoom.title}</h3>
                  <div className="chat-stats">
                    <span>{t(UI_COPY.participantCount)}: {participantCount}</span>
                    <span>{t(UI_COPY.roundsLabel)}: {draftRoom.maxRounds}</span>
                    <span>{t(UI_COPY.activeRound)}: {draftRoom.state.currentRound}</span>
                    <span>{t(UI_COPY.chatTurns)}: {draftRoom.messages.length}</span>
                    <span>{t(UI_COPY.autoRunDelayLabel)}: {draftRoom.autoRunDelaySeconds}s</span>
                  </div>
                </div>
                <div className="inline-actions">
                  <button
                    className="ghost-button"
                    data-testid="start-fresh-button"
                    onClick={() => void handleStartFresh()}
                    disabled={Boolean(busyLabel)}
                  >
                    {t(UI_COPY.startFresh)}
                  </button>
                  <button
                    className="ghost-button"
                    data-testid="step-button"
                    onClick={() => void handleStep()}
                    disabled={Boolean(busyLabel)}
                  >
                    {t(UI_COPY.step)}
                  </button>
                  <button
                    className="primary-button"
                    data-testid="run-all-button"
                    onClick={handleRun}
                    disabled={Boolean(busyLabel) || autoRunBusyRef.current}
                  >
                    {autoRunning ? t(UI_COPY.pausePlay) : t(UI_COPY.autoPlay)}
                  </button>
                  <button className="danger-button" onClick={() => void handleStop()} disabled={Boolean(busyLabel)}>
                    {t(UI_COPY.stop)}
                  </button>
                </div>
              </div>

              {busyLabel ? <div className="busy-chip">{busyLabel}</div> : null}
              {autoRunning ? <div className="busy-chip auto-play-chip">{t(UI_COPY.autoPlayRunning)}</div> : null}

              <div className="chat-stream" ref={chatStreamRef}>
                {draftRoom.messages.length > 0 ? (
                  draftRoom.messages.map((message) => {
                    const relatedRole = draftRoom.roles.find((role) => role.id === message.roleId);
                    const accent =
                      message.kind === "user"
                        ? "#8c5d14"
                        : relatedRole?.accentColor ?? (message.kind === "recorder" ? "#5c6476" : "#738195");
                    const messageMeta =
                      locale === "zh-CN"
                        ? `第 ${message.round} 轮 · 第 ${message.turn} 条 · ${formatWhen(message.createdAt, locale)}`
                        : `Round ${message.round} · Turn ${message.turn} · ${formatWhen(message.createdAt, locale)}`;

                    return (
                      <article
                        key={message.id}
                        className={`chat-message kind-${message.kind} ${
                          draftRoom.state.lastActiveRoleId === message.roleId ? "active" : ""
                        } ${highlightedMessageId === message.id ? "highlighted" : ""}`}
                        data-message-id={message.id}
                      >
                        <div className="avatar" style={{ backgroundColor: accent }}>
                          {message.kind === "user"
                            ? locale === "zh-CN"
                              ? "你"
                              : "You"
                            : message.roleName.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="bubble-wrap">
                          <div className="message-meta">
                            <strong>{message.roleName}</strong>
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
                            {message.content}
                          </div>
                        </div>
                      </article>
                    );
                  })
                ) : (
                  <div className="empty-chat">
                    <p>{t(UI_COPY.noTranscriptTitle)}</p>
                    <p>{t(UI_COPY.noTranscriptBody)}</p>
                  </div>
                )}
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
                      <strong>{t(UI_COPY.replyingTo)} {pendingReplyMessage.roleName}</strong>
                      <p>{truncateText(pendingReplyMessage.content, 120)}</p>
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
                  rows={3}
                  data-testid="user-intervention-input"
                  value={userMessageDraft}
                  onChange={(event) => setUserMessageDraft(event.target.value)}
                  placeholder={t(UI_COPY.userInterventionPlaceholder)}
                  disabled={!canIntervene}
                />
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
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={draftRoom.maxRounds}
                    onChange={(event) => updateRoomField("maxRounds", Number(event.target.value))}
                  />
                </label>
                <label>
                  {t(UI_COPY.autoRunDelayLabel)}
                  <input
                    type="number"
                    min={0.2}
                    max={30}
                    step={0.1}
                    data-testid="auto-run-delay-input"
                    value={draftRoom.autoRunDelaySeconds}
                    onChange={(event) => {
                      const nextValue = Number(event.target.value);
                      updateRoomField(
                        "autoRunDelaySeconds",
                        Number.isFinite(nextValue) ? Math.max(0.2, Math.min(30, nextValue)) : 2,
                      );
                    }}
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
                    onChange={(event) =>
                      updateRoomField("researchDirectionKey", event.target.value as DiscussionRoom["researchDirectionKey"])
                    }
                  >
                    {RESEARCH_DIRECTION_ORDER.map((direction) => (
                      <option key={direction} value={direction}>
                        {getResearchDirectionLabel(direction, locale)}
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
                <label className="checkbox-line full-span">
                  <input
                    type="checkbox"
                    checked={draftRoom.checkpointEveryRound}
                    onChange={(event) => updateRoomField("checkpointEveryRound", event.target.checked)}
                  />
                  {t(UI_COPY.checkpointEveryRoundLabel)}
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
                        onChange={(event) => updateRole(selectedRole.id, (role) => ({ ...role, name: event.target.value }))}
                      />
                    </label>
                    <label>
                      {t(UI_COPY.roleTemplateLabel)}
                      <select
                        value={selectedRole.roleTemplateKey ?? getAvailableRoleTemplates(selectedRole.kind)[0]}
                        onChange={(event) => applyRoleTemplate(selectedRole.id, event.target.value as RoleTemplateKey)}
                      >
                        {getAvailableRoleTemplates(selectedRole.kind).map((templateKey) => (
                          <option key={templateKey} value={templateKey}>
                            {getRoleTemplateName(templateKey, locale)}
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
                          updateRole(selectedRole.id, (role) => ({ ...role, accentColor: event.target.value }))
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
                            {preset.name}
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
                          updateRole(selectedRole.id, (role) => ({ ...role, persona: event.target.value }))
                        }
                      />
                    </label>
                    <label className="full-span">
                      {t(UI_COPY.goalLabel)}
                      <textarea
                        rows={3}
                        value={selectedRole.goal}
                        onChange={(event) =>
                          updateRole(selectedRole.id, (role) => ({ ...role, goal: event.target.value }))
                        }
                      />
                    </label>
                    <label className="full-span">
                      {t(UI_COPY.strategyLabel)}
                      <textarea
                        rows={3}
                        value={selectedRole.principles}
                        onChange={(event) =>
                          updateRole(selectedRole.id, (role) => ({ ...role, principles: event.target.value }))
                        }
                      />
                    </label>
                    <label className="full-span">
                      {t(UI_COPY.voiceStyleLabel)}
                      <textarea
                        rows={2}
                        value={selectedRole.voiceStyle}
                        onChange={(event) =>
                          updateRole(selectedRole.id, (role) => ({ ...role, voiceStyle: event.target.value }))
                        }
                      />
                    </label>
                    <div className="inline-actions full-span">
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
                          provider: nextProvider,
                        })),
                      "role",
                    )}
                  </details>
                </div>
              ) : (
                <p className="muted">{t(UI_COPY.roleEditorEmpty)}</p>
              )}
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

              <div className="entity-list">
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    className={`entity-chip ${preset.id === selectedPresetId ? "selected" : ""}`}
                    onClick={() => setSelectedPresetId(preset.id)}
                  >
                    <span>{preset.name}</span>
                    <small>{preset.builtIn ? t(UI_COPY.presetBuiltIn) : t(UI_COPY.presetCustom)}</small>
                  </button>
                ))}
              </div>

              {selectedPreset ? (
                <div className="editor-card">
                  <div className="panel-header tight">
                    <div>
                      <h4>{selectedPreset.name}</h4>
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
                        value={selectedPreset.name}
                        onChange={(event) => updatePreset((preset) => ({ ...preset, name: event.target.value }))}
                        disabled={selectedPreset.builtIn}
                      />
                    </label>
                    <label className="full-span">
                      {t(UI_COPY.descriptionLabel)}
                      <textarea
                        rows={2}
                        value={selectedPreset.description}
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
            </div>
            <div className="guide-section">
              <h4>{t(UI_COPY.guideOpenAITitle)}</h4>
              <p>{t(UI_COPY.guideOpenAIBody)}</p>
              <code className="guide-code">Endpoint: https://api.openai.com/v1 | Model: gpt-5.4 | API Key: sk-...</code>
            </div>
            <div className="guide-section">
              <h4>{t(UI_COPY.guideCustomTitle)}</h4>
              <p>{t(UI_COPY.guideCustomBody)}</p>
              <code className="guide-code">POST http://127.0.0.1:8000/chat -&gt; &#123; "content": "...", "replyToMessageId": null &#125;</code>
            </div>
            <div className="guide-section">
              <h4>{t(UI_COPY.guideCodexTitle)}</h4>
              <p>{t(UI_COPY.guideCodexBody)}</p>
              <code className="guide-code">Command: codex | Args: exec ...  or  Command: npx | Args: -y @openai/codex</code>
            </div>
            <div className="guide-section">
              <h4>{t(UI_COPY.guideLocalAgentTitle)}</h4>
              <p>{t(UI_COPY.guideLocalAgentBody)}</p>
              <pre className="guide-flow">
{"Chat role -> backend provider adapter ->\nCustom HTTP bridge or Codex CLI -> local agent / model"}
              </pre>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default App;
