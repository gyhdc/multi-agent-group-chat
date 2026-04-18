import cors from "cors";
import express from "express";
import { createBlankRoom, normalizePreset, normalizeRole } from "./defaults";
import { addUserMessage, runDiscussion, startDiscussion, stepDiscussion, stopDiscussion, toggleInsightSaved } from "./orchestrator";
import {
  deleteProviderPreset,
  deleteRoom,
  ensureStorage,
  getProviderPreset,
  getRoom,
  listProviderPresets,
  listRooms,
  saveProviderPreset,
  saveRoom,
} from "./store";
import { DiscussionRole, DiscussionRoom, ProviderPreset } from "./types";

const app = express();
const port = Number(process.env.PORT || 3030);

app.use(cors());
app.use(express.json({ limit: "2mb" }));

function normalizeRoles(roles: unknown): DiscussionRole[] {
  if (!Array.isArray(roles)) {
    return createBlankRoom().roles;
  }
  const normalized = roles.map((role) => normalizeRole(role as Partial<DiscussionRole>));
  return normalized.length > 0 ? normalized : createBlankRoom().roles;
}

function mergeRoom(existing: DiscussionRoom, incoming: Partial<DiscussionRoom>): DiscussionRoom {
  return {
    ...existing,
    title: incoming.title?.trim() || existing.title,
    topic: incoming.topic?.trim() || existing.topic,
    objective: incoming.objective?.trim() || existing.objective,
    discussionLanguage: incoming.discussionLanguage ?? existing.discussionLanguage,
    researchDirectionKey: incoming.researchDirectionKey ?? existing.researchDirectionKey,
    researchDirectionNote: incoming.researchDirectionNote?.trim() ?? existing.researchDirectionNote,
    autoRunDelaySeconds:
      typeof incoming.autoRunDelaySeconds === "number" && Number.isFinite(incoming.autoRunDelaySeconds)
        ? Math.max(0.2, Math.min(30, incoming.autoRunDelaySeconds))
        : existing.autoRunDelaySeconds,
    maxRounds:
      typeof incoming.maxRounds === "number" && Number.isFinite(incoming.maxRounds)
        ? Math.max(1, Math.min(12, incoming.maxRounds))
        : existing.maxRounds,
    checkpointEveryRound:
      typeof incoming.checkpointEveryRound === "boolean" ? incoming.checkpointEveryRound : existing.checkpointEveryRound,
    roles: incoming.roles ? normalizeRoles(incoming.roles) : existing.roles,
    updatedAt: new Date().toISOString(),
  };
}

function assertMutablePreset(preset: ProviderPreset | undefined): ProviderPreset {
  if (!preset) {
    throw new Error("Provider preset not found.");
  }
  if (preset.builtIn) {
    throw new Error("Built-in presets are read-only. Duplicate one if you want to customize it.");
  }
  return preset;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/rooms", async (_req, res) => {
  res.json(await listRooms());
});

app.get("/api/rooms/:roomId", async (req, res) => {
  const room = await getRoom(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found." });
    return;
  }
  res.json(room);
});

app.post("/api/rooms", async (req, res) => {
  const room = mergeRoom(createBlankRoom(), req.body as Partial<DiscussionRoom>);
  await saveRoom(room);
  res.status(201).json(room);
});

app.put("/api/rooms/:roomId", async (req, res) => {
  const existing = await getRoom(req.params.roomId);
  if (!existing) {
    res.status(404).json({ error: "Room not found." });
    return;
  }

  const room = mergeRoom(existing, req.body as Partial<DiscussionRoom>);
  await saveRoom(room);
  res.json(room);
});

app.delete("/api/rooms/:roomId", async (req, res) => {
  const removed = await deleteRoom(req.params.roomId);
  if (!removed) {
    res.status(404).json({ error: "Room not found." });
    return;
  }
  res.status(204).send();
});

app.post("/api/rooms/:roomId/start", async (req, res) => {
  const room = await getRoom(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found." });
    return;
  }

  try {
    startDiscussion(room);
    await saveRoom(room);
    res.json(room);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to start discussion." });
  }
});

app.post("/api/rooms/:roomId/step", async (req, res) => {
  const room = await getRoom(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found." });
    return;
  }

  try {
    await stepDiscussion(room);
    await saveRoom(room);
    res.json(room);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to step discussion." });
  }
});

app.post("/api/rooms/:roomId/run", async (req, res) => {
  const room = await getRoom(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found." });
    return;
  }

  try {
    await runDiscussion(room);
    await saveRoom(room);
    res.json(room);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to run discussion." });
  }
});

app.post("/api/rooms/:roomId/stop", async (req, res) => {
  const room = await getRoom(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found." });
    return;
  }

  stopDiscussion(room);
  await saveRoom(room);
  res.json(room);
});

app.post("/api/rooms/:roomId/insights/:insightId/toggle-save", async (req, res) => {
  const room = await getRoom(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found." });
    return;
  }

  try {
    toggleInsightSaved(room, req.params.insightId);
    await saveRoom(room);
    res.json(room);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to toggle saved insight." });
  }
});

app.post("/api/rooms/:roomId/messages", async (req, res) => {
  const room = await getRoom(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found." });
    return;
  }

  try {
    const content = typeof req.body?.content === "string" ? req.body.content : "";
    const replyToMessageId = typeof req.body?.replyToMessageId === "string" ? req.body.replyToMessageId : null;
    addUserMessage(room, content, replyToMessageId);
    await saveRoom(room);
    res.json(room);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to add user message." });
  }
});

app.get("/api/provider-presets", async (_req, res) => {
  res.json(await listProviderPresets());
});

app.post("/api/provider-presets", async (req, res) => {
  const preset = normalizePreset({
    ...(req.body as Partial<ProviderPreset>),
    builtIn: false,
  });
  await saveProviderPreset(preset);
  res.status(201).json(preset);
});

app.put("/api/provider-presets/:presetId", async (req, res) => {
  const existing = await getProviderPreset(req.params.presetId);

  try {
    const mutablePreset = assertMutablePreset(existing);
    const preset = normalizePreset({
      ...mutablePreset,
      ...(req.body as Partial<ProviderPreset>),
      id: mutablePreset.id,
      builtIn: false,
      createdAt: mutablePreset.createdAt,
    });
    await saveProviderPreset(preset);
    res.json(preset);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to update provider preset." });
  }
});

app.delete("/api/provider-presets/:presetId", async (req, res) => {
  const removed = await deleteProviderPreset(req.params.presetId);
  if (!removed) {
    res.status(400).json({ error: "Preset not found or cannot be deleted." });
    return;
  }
  res.status(204).send();
});

async function main(): Promise<void> {
  await ensureStorage();
  app.listen(port, () => {
    console.log(`Multi-Agent Group Chat backend listening on http://localhost:${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
