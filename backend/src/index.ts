import cors from "cors";
import express from "express";
import fs from "fs/promises";
import multer from "multer";
import path from "path";
import { createBlankRoom, normalizePreset, normalizeRole } from "./defaults";
import {
  attachDocumentToRoom,
  canGenerateRecorderTopic,
  clearRoomDocument,
  refreshRoomDocumentDefaultTopic,
  updateRoomDocumentFocus,
} from "./documents";
import { addUserMessage, runDiscussion, startDiscussion, stepDiscussion, stopDiscussion, toggleInsightSaved } from "./orchestrator";
import { generateRecorderTopic } from "./providers";
import {
  deleteResearchDirection,
  deleteProviderPreset,
  deleteRoom,
  ensureStorage,
  getResearchDirection,
  getProviderPreset,
  getRoom,
  listResearchDirections,
  listProviderPresets,
  saveResearchDirection,
  listRooms,
  saveProviderPreset,
  saveRoom,
} from "./store";
import { DiscussionRole, DiscussionRoom, ProviderPreset, ResearchDirectionPreset } from "./types";

const app = express();
const port = Number(process.env.PORT || 3030);
const upload = multer({
  dest: path.resolve(__dirname, "../../tmp/uploads"),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

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
  const legacyIncoming = incoming as Partial<DiscussionRoom> & { checkpointIntervalExchanges?: number };
  return {
    ...existing,
    title: incoming.title?.trim() || existing.title,
    topic: incoming.topic?.trim() || existing.topic,
    objective: incoming.objective?.trim() || existing.objective,
    discussionLanguage: incoming.discussionLanguage ?? existing.discussionLanguage,
    researchDirectionKey: incoming.researchDirectionKey ?? existing.researchDirectionKey,
    researchDirectionLabel: incoming.researchDirectionLabel?.trim() || existing.researchDirectionLabel,
    researchDirectionDescription: incoming.researchDirectionDescription?.trim() || existing.researchDirectionDescription,
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
    checkpointIntervalRounds:
      typeof legacyIncoming.checkpointIntervalRounds === "number" && Number.isFinite(legacyIncoming.checkpointIntervalRounds)
        ? Math.max(0, Math.min(12, Math.floor(legacyIncoming.checkpointIntervalRounds)))
        : typeof legacyIncoming.checkpointIntervalExchanges === "number" &&
            Number.isFinite(legacyIncoming.checkpointIntervalExchanges)
          ? Math.max(0, Math.min(12, Math.floor(legacyIncoming.checkpointIntervalExchanges)))
          : existing.checkpointIntervalRounds,
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

app.post("/api/rooms/:roomId/document", upload.single("document"), async (req, res) => {
  const roomId = Array.isArray(req.params.roomId) ? req.params.roomId[0] : req.params.roomId;
  const room = await getRoom(roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found." });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "No document file was uploaded." });
    return;
  }

  try {
    await attachDocumentToRoom(room, {
      path: req.file.path,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
    });
    await saveRoom(room);
    res.json(room);
  } catch (error) {
    await fs.rm(req.file.path, { force: true }).catch(() => undefined);
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to attach document." });
  }
});

app.delete("/api/rooms/:roomId/document", async (req, res) => {
  const room = await getRoom(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found." });
    return;
  }

  await clearRoomDocument(room);
  await saveRoom(room);
  res.json(room);
});

app.post("/api/rooms/:roomId/document/focus", async (req, res) => {
  const room = await getRoom(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found." });
    return;
  }

  try {
    updateRoomDocumentFocus(room, {
      selectedSegmentIds: Array.isArray(req.body?.selectedSegmentIds)
        ? req.body.selectedSegmentIds.filter((segmentId: unknown): segmentId is string => typeof segmentId === "string")
        : undefined,
      discussionMode:
        req.body?.discussionMode === "whole-document" || req.body?.discussionMode === "selected-segments"
          ? req.body.discussionMode
          : undefined,
    });
    await saveRoom(room);
    res.json(room);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to update document focus." });
  }
});

app.post("/api/rooms/:roomId/document/topic-default", async (req, res) => {
  const room = await getRoom(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found." });
    return;
  }

  try {
    refreshRoomDocumentDefaultTopic(room);
    await saveRoom(room);
    res.json(room);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to generate the default topic." });
  }
});

app.post("/api/rooms/:roomId/document/topic-recorder", async (req, res) => {
  const room = await getRoom(req.params.roomId);
  if (!room) {
    res.status(404).json({ error: "Room not found." });
    return;
  }

  const availability = canGenerateRecorderTopic(room);
  if (!availability.enabled || !availability.recorder) {
    const reason =
      availability.reason === "document_missing"
        ? "Attach a document before asking the recorder to generate a topic."
        : availability.reason === "recorder_missing"
          ? "Enable a recorder role before generating a topic with recorder AI."
          : "Recorder provider is unavailable for AI topic generation.";
    res.status(400).json({ error: reason });
    return;
  }

  try {
    room.topic = await generateRecorderTopic(room, availability.recorder);
    await saveRoom(room);
    res.json(room);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to generate a recorder topic." });
  }
});

app.get("/api/provider-presets", async (_req, res) => {
  res.json(await listProviderPresets());
});

app.get("/api/research-directions", async (_req, res) => {
  res.json(await listResearchDirections());
});

app.post("/api/research-directions", async (req, res) => {
  const preset = {
    ...(req.body as Partial<ResearchDirectionPreset>),
    builtIn: false,
  } as ResearchDirectionPreset;
  const saved = await saveResearchDirection(preset);
  res.status(201).json(saved);
});

app.put("/api/research-directions/:directionId", async (req, res) => {
  const existing = await getResearchDirection(req.params.directionId);
  if (!existing) {
    res.status(404).json({ error: "Research direction not found." });
    return;
  }

  const saved = await saveResearchDirection({
    ...existing,
    ...(req.body as Partial<ResearchDirectionPreset>),
    id: existing.id,
    builtIn: false,
    createdAt: existing.createdAt,
  });
  res.json(saved);
});

app.delete("/api/research-directions/:directionId", async (req, res) => {
  const removed = await deleteResearchDirection(req.params.directionId);
  if (!removed) {
    res.status(404).json({ error: "Research direction not found." });
    return;
  }
  res.status(204).send();
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
  await fs.mkdir(path.resolve(__dirname, "../../tmp/uploads"), { recursive: true });
  app.listen(port, () => {
    console.log(`Multi-Agent Group Chat backend listening on http://localhost:${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
