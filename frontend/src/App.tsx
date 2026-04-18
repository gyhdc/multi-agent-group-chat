import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import {
  DiscussionRole,
  DiscussionRoom,
  InsightEntry,
  ProviderConfig,
  ProviderPreset,
  ProviderType,
} from "./types";

type StudioTab = "room" | "roles" | "presets";

const PROVIDER_OPTIONS: Array<{ value: ProviderType; label: string }> = [
  { value: "mock", label: "Mock demo" },
  { value: "openai-compatible", label: "OpenAI-compatible API" },
  { value: "custom-http", label: "Custom HTTP agent" },
  { value: "codex-cli", label: "Local Codex CLI" },
];

function createProviderDraft(type: ProviderType = "mock"): ProviderConfig {
  return {
    type,
    model: type === "mock" ? "mock-discussion-v2" : type === "codex-cli" ? "gpt-5-codex" : "",
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
  };
}

function createRoleDraft(kind: DiscussionRole["kind"], preset?: ProviderPreset): DiscussionRole {
  return {
    id: crypto.randomUUID(),
    name: kind === "recorder" ? "Recorder" : "New Role",
    kind,
    persona:
      kind === "recorder"
        ? "Neutral analyst who extracts the strongest objection, strongest repair, and the current verdict."
        : "State who this role is, what perspective they represent, and what bias they bring into the room.",
    principles:
      kind === "recorder"
        ? "Track strongest objection, strongest repair, strongest user evidence, and next unresolved blocker."
        : "State what this role attacks, protects, optimizes, or accepts as evidence.",
    voiceStyle:
      kind === "recorder" ? "Compact, high-signal notes." : "Short, direct, and natural like a real chat message.",
    goal:
      kind === "recorder"
        ? "Produce checkpoint notes and a final conclusion worth saving."
        : "Define one concrete goal this role is trying to achieve in the discussion.",
    accentColor: kind === "recorder" ? "#5c6476" : "#2f7a6c",
    enabled: true,
    providerPresetId: preset?.id ?? null,
    provider: preset ? structuredClone(preset.provider) : createProviderDraft(),
  };
}

function cloneRoom(room: DiscussionRoom): DiscussionRoom {
  return structuredClone(room);
}

function formatWhen(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function App() {
  const [rooms, setRooms] = useState<DiscussionRoom[]>([]);
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [draftRoom, setDraftRoom] = useState<DiscussionRoom | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [studioOpen, setStudioOpen] = useState(false);
  const [studioTab, setStudioTab] = useState<StudioTab>("roles");
  const [userMessageDraft, setUserMessageDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState("");

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
    () => draftRoom?.summary.insights.filter((insight) => insight.saved).slice().reverse() ?? [],
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

  const canIntervene = draftRoom?.state.status === "running";

  useEffect(() => {
    void loadAll();
  }, []);

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
      return;
    }

    const nextDraft = cloneRoom(selectedRoom);
    setDraftRoom(nextDraft);
    setSelectedRoleId((current) => {
      if (current && nextDraft.roles.some((role) => role.id === current)) {
        return current;
      }
      return nextDraft.roles[0]?.id ?? null;
    });
  }, [selectedRoom]);

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

  async function ensureRunningRoom(): Promise<DiscussionRoom> {
    const saved = await persistDraft();
    if (saved.state.status === "running") {
      return saved;
    }
    const started = await api.startRoom(saved.id);
    syncRoom(started);
    return started;
  }

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

  async function handleCreateRoom(): Promise<void> {
    await runTask("Creating room", async () => {
      const room = await api.createRoom();
      syncRoom(room);
      setStudioOpen(true);
      setStudioTab("roles");
    });
  }

  async function handleSaveRoom(): Promise<void> {
    await runTask("Saving room", async () => {
      await persistDraft();
    });
  }

  async function handleDeleteRoom(): Promise<void> {
    if (!draftRoom) {
      return;
    }

    if (!window.confirm(`Delete room \"${draftRoom.title}\"?`)) {
      return;
    }

    await runTask("Deleting room", async () => {
      await api.deleteRoom(draftRoom.id);
      const remaining = rooms.filter((room) => room.id !== draftRoom.id);
      setRooms(remaining);
      setSelectedRoomId(remaining[0]?.id ?? null);
      setDraftRoom(remaining[0] ? cloneRoom(remaining[0]) : null);
    });
  }

  function handleAddRole(kind: DiscussionRole["kind"]): void {
    const defaultPreset = presets.find((preset) => preset.provider.type === "mock") ?? presets[0];
    const nextRole = createRoleDraft(kind, defaultPreset);

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
      return {
        ...current,
        roles: current.roles.filter((role) => role.id !== roleId),
      };
    });

    if (selectedRoleId === roleId) {
      const nextRole = draftRoom?.roles.find((role) => role.id !== roleId);
      setSelectedRoleId(nextRole?.id ?? null);
    }
  }

  async function handleStartFresh(): Promise<void> {
    await runTask("Starting discussion", async () => {
      const saved = await persistDraft();
      const started = await api.startRoom(saved.id);
      syncRoom(started);
    });
  }

  async function handleStep(): Promise<void> {
    await runTask("Stepping discussion", async () => {
      const room = await ensureRunningRoom();
      const stepped = await api.stepRoom(room.id);
      syncRoom(stepped);
    });
  }

  async function handleRun(): Promise<void> {
    await runTask("Running discussion", async () => {
      const room = await ensureRunningRoom();
      const completed = await api.runRoom(room.id);
      syncRoom(completed);
    });
  }

  async function handleStop(): Promise<void> {
    if (!draftRoom) {
      return;
    }

    await runTask("Stopping discussion", async () => {
      const stopped = await api.stopRoom(draftRoom.id);
      syncRoom(stopped);
    });
  }

  async function handleToggleSavedInsight(insightId: string): Promise<void> {
    if (!draftRoom) {
      return;
    }

    await runTask("Updating saved insight", async () => {
      const room = await api.toggleInsightSaved(draftRoom.id, insightId);
      syncRoom(room);
    });
  }

  async function handleSendUserMessage(): Promise<void> {
    if (!draftRoom || !userMessageDraft.trim()) {
      return;
    }

    await runTask("Sending your message", async () => {
      const saved = await persistDraft();
      const room = await api.addUserMessage(saved.id, userMessageDraft.trim());
      syncRoom(room);
      setUserMessageDraft("");
    });
  }

  async function handleSaveCurrentProviderAsPreset(): Promise<void> {
    if (!selectedRole) {
      return;
    }

    const name = window.prompt("Preset name", `${selectedRole.name} Provider`);
    if (!name?.trim()) {
      return;
    }
    const description = window.prompt("Preset description", `Saved from ${selectedRole.name}`) ?? "";

    await runTask("Saving preset", async () => {
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
    const name = window.prompt("Preset name", "Custom Provider Preset");
    if (!name?.trim()) {
      return;
    }

    await runTask("Creating preset", async () => {
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

    const name = window.prompt("Duplicate preset as", `${selectedPreset.name} Copy`);
    if (!name?.trim()) {
      return;
    }

    await runTask("Duplicating preset", async () => {
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

    await runTask("Saving preset", async () => {
      const saved = await api.updateProviderPreset(selectedPreset.id, selectedPreset);
      syncPreset(saved);
    });
  }

  async function handleDeletePreset(): Promise<void> {
    if (!selectedPreset || selectedPreset.builtIn) {
      return;
    }

    if (!window.confirm(`Delete preset \"${selectedPreset.name}\"?`)) {
      return;
    }

    await runTask("Deleting preset", async () => {
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
          Provider
          <select
            value={provider.type}
            onChange={(event) => onChange(setProviderType(provider, event.target.value as ProviderType))}
          >
            {PROVIDER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Model
          <input
            value={provider.model}
            onChange={(event) => onChange({ ...provider, model: event.target.value })}
            placeholder={provider.type === "codex-cli" ? "gpt-5-codex" : "Model name"}
          />
        </label>

        {(provider.type === "openai-compatible" || provider.type === "custom-http") && (
          <>
            <label className="full-span">
              Endpoint
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
              API Key
              <input
                type="password"
                value={provider.apiKey}
                onChange={(event) => onChange({ ...provider, apiKey: event.target.value })}
                placeholder="Stored locally only"
              />
            </label>
            <label>
              Temperature
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
              Max Tokens
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
              Command
              <input
                value={provider.command}
                onChange={(event) => onChange({ ...provider, command: event.target.value })}
                placeholder="codex or npx"
              />
            </label>
            <label>
              Launcher Args
              <input
                value={provider.launcherArgs}
                onChange={(event) => onChange({ ...provider, launcherArgs: event.target.value })}
                placeholder="-y @openai/codex"
              />
            </label>
            <label className="full-span">
              Working Directory
              <input
                value={provider.workingDirectory}
                onChange={(event) => onChange({ ...provider, workingDirectory: event.target.value })}
                placeholder="Optional. Leave blank to use the app root."
              />
            </label>
            <label>
              Timeout (ms)
              <input
                type="number"
                min={10000}
                step={1000}
                value={provider.timeoutMs}
                onChange={(event) => onChange({ ...provider, timeoutMs: Number(event.target.value) })}
              />
            </label>
            <label>
              Sandbox
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
              Skip git repo check
            </label>
            {mode === "role" ? (
              <p className="helper-text full-span">
                If the Windows alias for Codex cannot execute, switch to <code>npx</code> with{" "}
                <code>-y @openai/codex</code>.
              </p>
            ) : null}
          </>
        )}

        {provider.type === "mock" ? (
          <p className="helper-text full-span">
            Mock mode is fast and deterministic. Use it for room design, demos, and UI testing.
          </p>
        ) : null}
      </div>
    );
  }

  function renderInsightCard(insight: InsightEntry, emphasis: "default" | "saved" | "final" = "default") {
    return (
      <article key={insight.id} className={`insight-card insight-${emphasis}`}>
        <div className="insight-card-header">
          <div>
            <span className="insight-meta">{insight.kind === "final" ? "FINAL" : `ROUND ${insight.round}`}</span>
            <h4>{insight.title}</h4>
          </div>
          <button
            className={`save-chip ${insight.saved ? "saved" : ""}`}
            onClick={() => void handleToggleSavedInsight(insight.id)}
            disabled={!draftRoom || Boolean(busyLabel)}
          >
            {insight.saved ? "Saved" : "Save"}
          </button>
        </div>

        <details open={insight.kind === "final"}>
          <summary>{insight.kind === "final" ? "Expand final conclusion" : "Expand notes"}</summary>
          <div className="insight-content">{insight.content}</div>
        </details>
      </article>
    );
  }

  if (loading && !draftRoom) {
    return (
      <div className="loading-state">
        <p>Loading discussion rooms...</p>
      </div>
    );
  }

  return (
    <div className={`app-shell ${studioOpen ? "" : "studio-hidden"}`}>
      <aside className="left-rail">
        <div className="brand-block">
          <p className="eyebrow">LOCAL DISCUSSION LAB</p>
          <h1>Multi-Agent Group Chat</h1>
          <p className="brand-copy">
            Transcript first. Configuration stays collapsible. Roles debate with explicit goals, and the recorder keeps
            the discussion useful.
          </p>
        </div>

        <div className="sidebar-actions">
          <button className="primary-button" onClick={() => void handleCreateRoom()} disabled={Boolean(busyLabel)}>
            New Room
          </button>
          <button className="ghost-button" onClick={() => void loadAll(selectedRoomId ?? undefined)} disabled={loading}>
            Refresh
          </button>
        </div>

        <div className="room-list">
          {rooms.map((room) => (
            <button
              key={room.id}
              className={`room-card ${room.id === selectedRoomId ? "selected" : ""}`}
              onClick={() => setSelectedRoomId(room.id)}
            >
              <span className="room-title">{room.title}</span>
              <span className="room-meta">
                {room.roles.filter((role) => role.kind === "participant" && role.enabled).length} participants •{" "}
                {room.maxRounds} rounds
              </span>
              <span className={`status-pill status-${room.state.status}`}>{room.state.status}</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="stage">
        <section className="stage-header">
          <div className="header-copy">
            <p className="eyebrow">DISCUSSION ROOM</p>
            <h2>{draftRoom?.title ?? "No room selected"}</h2>
            <p className="topic-line">{draftRoom?.topic ?? "Define a topic to start."}</p>
          </div>

          <div className="toolbar">
            <button className="ghost-button" onClick={() => void handleSaveRoom()} disabled={!draftRoom || Boolean(busyLabel)}>
              Save Setup
            </button>
            <button className="primary-button" onClick={() => void handleStartFresh()} disabled={!draftRoom || Boolean(busyLabel)}>
              Start Fresh
            </button>
            <button className="ghost-button" onClick={() => void handleStep()} disabled={!draftRoom || Boolean(busyLabel)}>
              Step
            </button>
            <button className="ghost-button" onClick={() => void handleRun()} disabled={!draftRoom || Boolean(busyLabel)}>
              Run All
            </button>
            <button className="danger-button" onClick={() => void handleStop()} disabled={!draftRoom || Boolean(busyLabel)}>
              Stop
            </button>
            <button className="ghost-button" onClick={() => setStudioOpen((current) => !current)}>
              {studioOpen ? "Hide Config" : "Show Config"}
            </button>
          </div>
        </section>

        <section className="objective-strip">
          <div className="objective-card">
            <span className="strip-label">Objective</span>
            <p>{draftRoom?.objective ?? "Set the decision target for the room."}</p>
          </div>
          <div className="objective-card">
            <span className="strip-label">Status</span>
            <p>
              {draftRoom?.state.status ?? "idle"} • round {draftRoom?.state.currentRound ?? 0} •{" "}
              {draftRoom?.state.phase ?? "participants"}
            </p>
          </div>
          <div className="objective-card">
            <span className="strip-label">Running Task</span>
            <p>{busyLabel || "Waiting for input"}</p>
          </div>
        </section>

        <section className="role-strip">
          {draftRoom?.roles.map((role) => (
            <button
              key={role.id}
              className={`role-pill ${role.id === selectedRoleId ? "selected" : ""}`}
              onClick={() => {
                setSelectedRoleId(role.id);
                setStudioOpen(true);
                setStudioTab("roles");
              }}
            >
              <span className="role-pill-dot" style={{ backgroundColor: role.accentColor }} />
              <span className="role-pill-name">{role.name}</span>
              <small>{role.goal || "No goal yet"}</small>
            </button>
          ))}
        </section>

        {error ? <div className="error-banner">{error}</div> : null}

        <section className="chat-layout">
          <div className="chat-panel">
            <div className="chat-panel-header">
              <div>
                <p className="eyebrow">TRANSCRIPT</p>
                <h3>Live discussion</h3>
              </div>
              <div className="chat-stats">
                <span>{draftRoom?.messages.length ?? 0} messages</span>
                <span>{participantCount} active participants</span>
              </div>
            </div>

            <div className="chat-stream">
              {draftRoom?.messages.length ? (
                draftRoom.messages.map((message) => {
                  const relatedRole = draftRoom.roles.find((role) => role.id === message.roleId);
                  const accent =
                    message.kind === "user"
                      ? "#8c5d14"
                      : relatedRole?.accentColor ?? (message.kind === "recorder" ? "#5c6476" : "#738195");
                  return (
                    <article
                      key={message.id}
                      className={`chat-message kind-${message.kind} ${
                        draftRoom.state.lastActiveRoleId === message.roleId ? "active" : ""
                      }`}
                    >
                      <div className="avatar" style={{ backgroundColor: accent }}>
                        {message.kind === "user" ? "You" : message.roleName.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="bubble-wrap">
                        <div className="message-meta">
                          <strong>{message.roleName}</strong>
                          <span>
                            round {message.round} • turn {message.turn} • {formatWhen(message.createdAt)}
                          </span>
                        </div>
                        <div className="message-bubble">{message.content}</div>
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className="empty-chat">
                  <p>No transcript yet.</p>
                  <p>
                    Define roles with explicit goals, start the room, and let the discussion sharpen into a real
                    conclusion.
                  </p>
                </div>
              )}
            </div>

            <div className="composer-card">
              <div>
                <p className="eyebrow">USER INTERVENTION</p>
                <h4>Add evidence, data, or a new angle</h4>
                <p className="helper-text">
                  {canIntervene
                    ? "Your message is added to the transcript and becomes visible to every participant in subsequent turns."
                    : "Start the discussion first. User intervention is meant for the middle of an active discussion."}
                </p>
              </div>
              <textarea
                rows={3}
                value={userMessageDraft}
                onChange={(event) => setUserMessageDraft(event.target.value)}
                placeholder="Add a clarification, dataset detail, counter-example, policy constraint, or any other evidence."
                disabled={!canIntervene}
              />
              <div className="inline-actions">
                <button
                  className="primary-button"
                  onClick={() => void handleSendUserMessage()}
                  disabled={!draftRoom || !canIntervene || !userMessageDraft.trim() || Boolean(busyLabel)}
                >
                  Send to Discussion
                </button>
                <button
                  className="ghost-button"
                  onClick={() => setUserMessageDraft("")}
                  disabled={!userMessageDraft || Boolean(busyLabel)}
                >
                  Clear
                </button>
              </div>
            </div>
          </div>

          <aside className="insight-panel">
            <div className="insight-section">
              <div className="insight-section-header">
                <div>
                  <p className="eyebrow">FINAL VERDICT</p>
                  <h3>Conclusion</h3>
                </div>
              </div>
              {finalInsight ? renderInsightCard(finalInsight, "final") : <p className="muted">The recorder will place the final conclusion here.</p>}
            </div>

            <div className="insight-section">
              <div className="insight-section-header">
                <div>
                  <p className="eyebrow">SAVED INSIGHTS</p>
                  <h3>Saved highlights</h3>
                </div>
              </div>
              {savedInsights.length ? (
                savedInsights.map((insight) => renderInsightCard(insight, "saved"))
              ) : (
                <p className="muted">Save any checkpoint or final conclusion you want to keep visible.</p>
              )}
            </div>

            <div className="insight-section">
              <div className="insight-section-header">
                <div>
                  <p className="eyebrow">CHECKPOINT NOTES</p>
                  <h3>Round notes</h3>
                </div>
              </div>
              {checkpointInsights.length ? (
                checkpointInsights.map((insight) => renderInsightCard(insight))
              ) : (
                <p className="muted">Checkpoint notes appear after each round if the recorder is enabled.</p>
              )}
            </div>
          </aside>
        </section>
      </main>

      {studioOpen ? (
        <aside className="studio">
          <div className="studio-tabs">
            <button className={studioTab === "room" ? "active" : ""} onClick={() => setStudioTab("room")}>
              Room
            </button>
            <button className={studioTab === "roles" ? "active" : ""} onClick={() => setStudioTab("roles")}>
              Roles
            </button>
            <button className={studioTab === "presets" ? "active" : ""} onClick={() => setStudioTab("presets")}>
              Provider Presets
            </button>
          </div>

          {studioTab === "room" && draftRoom ? (
            <section className="studio-section">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">ROOM CONFIG</p>
                  <h3>Room setup</h3>
                </div>
                <button className="danger-button subtle" onClick={() => void handleDeleteRoom()} disabled={Boolean(busyLabel)}>
                  Delete Room
                </button>
              </div>

              <div className="field-grid">
                <label>
                  Title
                  <input value={draftRoom.title} onChange={(event) => updateRoomField("title", event.target.value)} />
                </label>
                <label>
                  Max Rounds
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={draftRoom.maxRounds}
                    onChange={(event) => updateRoomField("maxRounds", Number(event.target.value))}
                  />
                </label>
                <label className="full-span">
                  Topic
                  <textarea
                    rows={5}
                    value={draftRoom.topic}
                    onChange={(event) => updateRoomField("topic", event.target.value)}
                  />
                </label>
                <label className="full-span">
                  Decision Objective
                  <textarea
                    rows={5}
                    value={draftRoom.objective}
                    onChange={(event) => updateRoomField("objective", event.target.value)}
                  />
                </label>
                <label className="checkbox-line full-span">
                  <input
                    type="checkbox"
                    checked={draftRoom.checkpointEveryRound}
                    onChange={(event) => updateRoomField("checkpointEveryRound", event.target.checked)}
                  />
                  Generate recorder notes after every round
                </label>
              </div>
            </section>
          ) : null}

          {studioTab === "roles" ? (
            <section className="studio-section">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">ROLE STUDIO</p>
                  <h3>Roles with goals</h3>
                </div>
                <div className="role-actions">
                  <button className="ghost-button" onClick={() => handleAddRole("participant")}>
                    Add Participant
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() => handleAddRole("recorder")}
                    disabled={Boolean(draftRoom?.roles.some((role) => role.kind === "recorder"))}
                  >
                    Add Recorder
                  </button>
                </div>
              </div>

              <div className="entity-list">
                {draftRoom?.roles.map((role) => (
                  <button
                    key={role.id}
                    className={`entity-chip ${role.id === selectedRoleId ? "selected" : ""}`}
                    onClick={() => setSelectedRoleId(role.id)}
                  >
                    <span className="role-pill-dot" style={{ backgroundColor: role.accentColor }} />
                    <span>{role.name}</span>
                    <small>{role.kind}</small>
                  </button>
                ))}
              </div>

              {selectedRole ? (
                <div className="editor-card">
                  <div className="panel-header tight">
                    <div>
                      <h4>{selectedRole.name}</h4>
                      <p className="muted">
                        Keep the role definition short but actionable: who they are, what they want, and how they judge
                        the discussion.
                      </p>
                    </div>
                    <button className="text-button" onClick={() => handleRemoveRole(selectedRole.id)}>
                      Remove Role
                    </button>
                  </div>

                  <div className="field-grid">
                    <label>
                      Role Name
                      <input
                        value={selectedRole.name}
                        onChange={(event) => updateRole(selectedRole.id, (role) => ({ ...role, name: event.target.value }))}
                      />
                    </label>

                    <label>
                      Accent Color
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
                      Enable this role
                    </label>

                    <label>
                      Preset
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
                        <option value="">No preset</option>
                        {presets.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="full-span">
                      Persona
                      <textarea
                        rows={3}
                        value={selectedRole.persona}
                        onChange={(event) =>
                          updateRole(selectedRole.id, (role) => ({ ...role, persona: event.target.value }))
                        }
                      />
                    </label>

                    <label className="full-span">
                      Explicit Goal
                      <textarea
                        rows={3}
                        value={selectedRole.goal}
                        onChange={(event) =>
                          updateRole(selectedRole.id, (role) => ({ ...role, goal: event.target.value }))
                        }
                      />
                    </label>

                    <label className="full-span">
                      Discussion Strategy
                      <textarea
                        rows={3}
                        value={selectedRole.principles}
                        onChange={(event) =>
                          updateRole(selectedRole.id, (role) => ({ ...role, principles: event.target.value }))
                        }
                      />
                    </label>

                    <label className="full-span">
                      Voice Style
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
                        Save Current Provider as Preset
                      </button>
                      <button
                        className="ghost-button"
                        onClick={() => {
                          setStudioOpen(true);
                          setStudioTab("presets");
                        }}
                      >
                        Manage Presets
                      </button>
                    </div>
                  </div>

                  <details className="advanced-panel">
                    <summary>Advanced provider settings</summary>
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
                <p className="muted">Select one role to edit it.</p>
              )}
            </section>
          ) : null}

          {studioTab === "presets" ? (
            <section className="studio-section">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">PROVIDER PRESETS</p>
                  <h3>Reusable API and agent setups</h3>
                </div>
                <div className="role-actions">
                  <button className="ghost-button" onClick={() => void handleCreatePresetFromScratch()}>
                    New Preset
                  </button>
                  <button className="ghost-button" onClick={() => void handleDuplicatePreset()} disabled={!selectedPreset}>
                    Duplicate
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
                    <small>{preset.builtIn ? "built-in" : "custom"}</small>
                  </button>
                ))}
              </div>

              {selectedPreset ? (
                <div className="editor-card">
                  <div className="panel-header tight">
                    <div>
                      <h4>{selectedPreset.name}</h4>
                      <p className="muted">
                        {selectedPreset.builtIn
                          ? "Built-in presets are read-only. Duplicate one to customize it."
                          : "Save once, then reuse this provider setup across multiple roles."}
                      </p>
                    </div>
                    {!selectedPreset.builtIn ? (
                      <div className="inline-actions">
                        <button className="ghost-button" onClick={() => void handleSavePreset()}>
                          Save Preset
                        </button>
                        <button className="danger-button subtle" onClick={() => void handleDeletePreset()}>
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <div className="field-grid">
                    <label>
                      Preset Name
                      <input
                        value={selectedPreset.name}
                        onChange={(event) => updatePreset((preset) => ({ ...preset, name: event.target.value }))}
                        disabled={selectedPreset.builtIn}
                      />
                    </label>
                    <label className="full-span">
                      Description
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
                        Apply to Current Role
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="muted">Select one provider preset to inspect or edit it.</p>
              )}
            </section>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}

export default App;
