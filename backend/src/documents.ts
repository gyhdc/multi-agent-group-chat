import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { DiscussionRoom, DiscussionRole, DocumentDiscussionMode, DocumentParseResult, DocumentSegment, RoomDocumentAsset } from "./types";

const APP_ROOT = path.resolve(__dirname, "../..");
const DATA_DOCUMENTS_DIR = path.join(APP_ROOT, "data", "documents");
const TMP_DOCS_DIR = path.join(APP_ROOT, "tmp", "docs");
const PARSER_DIR = path.join(APP_ROOT, "backend", "scripts", "document");
const SHORT_DOCUMENT_MAX_CHARS = 12_000;
const SHORT_DOCUMENT_MAX_PAGES = 8;

type ParsedDocumentPayload = {
  title: string;
  pageCount: number | null;
  charCount: number;
  fullText: string;
  segments: DocumentSegment[];
  outline: DocumentParseResult["outline"];
  warnings: string[];
  status: DocumentParseResult["status"];
};

export const WHOLE_DOCUMENT_SEGMENT_ID = "document-whole";

function getDocumentDiscussionLanguage(room: DiscussionRoom): "zh-CN" | "en-US" {
  return room.discussionLanguage === "en-US" ? "en-US" : "zh-CN";
}

function sanitizeStoredFileName(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  return `source${ext}`;
}

function getFileKind(fileName: string, mimeType: string): RoomDocumentAsset["fileKind"] {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".pdf" || mimeType === "application/pdf") {
    return "pdf";
  }
  if (
    ext === ".docx" ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  if (ext === ".md" || ext === ".markdown" || mimeType === "text/markdown") {
    return "md";
  }
  if (ext === ".txt" || mimeType === "text/plain") {
    return "txt";
  }
  throw new Error("Unsupported document format. Supported formats: PDF, DOCX, TXT, MD.");
}

function supportsWholeDocument(payload: ParsedDocumentPayload): boolean {
  const pageCountOkay = payload.pageCount === null || payload.pageCount <= SHORT_DOCUMENT_MAX_PAGES;
  return payload.charCount <= SHORT_DOCUMENT_MAX_CHARS && pageCountOkay;
}

function buildWholeDocumentSegment(asset: RoomDocumentAsset, fullText: string): DocumentSegment {
  return {
    id: WHOLE_DOCUMENT_SEGMENT_ID,
    kind: "document",
    title: asset.title,
    content: fullText,
    pageStart: 1,
    pageEnd: asset.pageCount,
    level: 0,
    parentId: null,
    path: [asset.title],
    order: -1,
  };
}

function getSelectedDocumentSegments(room: DiscussionRoom): DocumentSegment[] {
  if (!room.documentAsset) {
    return [];
  }

  const ids = new Set(room.selectedDocumentSegmentIds);
  return room.documentSegments.filter((segment) => ids.has(segment.id));
}

function compactSegmentLabel(segment: DocumentSegment): string {
  return segment.path.length > 0 ? segment.path[segment.path.length - 1] : segment.title;
}

export function buildDefaultDocumentTopic(room: DiscussionRoom): string {
  if (!room.documentAsset) {
    return room.topic;
  }

  const language = getDocumentDiscussionLanguage(room);
  const selectedSegments = getSelectedDocumentSegments(room).filter((segment) => segment.id !== WHOLE_DOCUMENT_SEGMENT_ID);

  if (room.documentDiscussionMode === "whole-document") {
    return language === "zh-CN"
      ? `围绕《${room.documentAsset.title}》整篇内容进行讨论，提炼关键观点、问题和改进建议。`
      : `Discuss the full document "${room.documentAsset.title}" and extract the key claims, issues, and improvements.`;
  }

  if (selectedSegments.length > 0) {
    const focusLabel = selectedSegments.slice(0, 2).map((segment) => `「${compactSegmentLabel(segment)}」`).join("、");
    return language === "zh-CN"
      ? `围绕《${room.documentAsset.title}》中的${focusLabel}展开讨论，提炼关键观点、证据与改进建议。`
      : `Discuss ${focusLabel} from "${room.documentAsset.title}" and extract the key claims, evidence, and improvements.`;
  }

  return language === "zh-CN"
    ? `从《${room.documentAsset.title}》中选择一个章节或片段，围绕其关键观点、证据和问题展开讨论。`
    : `Select a section or excerpt from "${room.documentAsset.title}" and discuss its key claims, evidence, and issues.`;
}

export function canGenerateRecorderTopic(room: DiscussionRoom): { enabled: boolean; reason: string | null; recorder: DiscussionRole | null } {
  const recorder = room.roles.find((role) => role.enabled && role.kind === "recorder") ?? null;
  if (!room.documentAsset) {
    return { enabled: false, reason: "document_missing", recorder };
  }
  if (!recorder) {
    return { enabled: false, reason: "recorder_missing", recorder: null };
  }
  if (recorder.provider.type === "mock") {
    return { enabled: false, reason: "recorder_provider_unavailable", recorder };
  }
  return { enabled: true, reason: null, recorder };
}

export function getDocumentContextForPrompt(room: DiscussionRoom, maxChars = 14_000): string {
  if (!room.documentAsset) {
    return "";
  }

  const selectedSegments = getSelectedDocumentSegments(room);
  const effectiveSegments =
    room.documentDiscussionMode === "whole-document"
      ? selectedSegments.filter((segment) => segment.id === WHOLE_DOCUMENT_SEGMENT_ID)
      : selectedSegments;

  const textParts: string[] = [];
  for (const segment of effectiveSegments) {
    const heading = segment.id === WHOLE_DOCUMENT_SEGMENT_ID ? room.documentAsset.title : segment.path.join(" > ") || segment.title;
    const range =
      segment.pageStart && segment.pageEnd
        ? `Pages ${segment.pageStart}${segment.pageEnd > segment.pageStart ? `-${segment.pageEnd}` : ""}`
        : "No page range";
    const chunk = `${heading}\n${range}\n${segment.content}`.trim();
    if (textParts.join("\n\n").length + chunk.length > maxChars) {
      const remaining = Math.max(0, maxChars - textParts.join("\n\n").length - 2);
      if (remaining > 120) {
        textParts.push(chunk.slice(0, remaining).trim());
      }
      break;
    }
    textParts.push(chunk);
  }

  const focusLabel =
    room.documentDiscussionMode === "whole-document"
      ? room.documentAsset.title
      : effectiveSegments.length > 0
        ? effectiveSegments.map((segment) => compactSegmentLabel(segment)).join(", ")
        : "No focus selected";

  const warnings = room.documentWarnings.length > 0 ? room.documentWarnings.join(", ") : "none";
  const summary = room.documentSummary?.abstract?.trim() || "No abstract available.";

  return [
    `Document title: ${room.documentAsset.title}`,
    `Document type: ${room.documentAsset.fileKind}`,
    `Document mode: ${room.documentDiscussionMode}`,
    `Document focus: ${focusLabel}`,
    `Document warnings: ${warnings}`,
    `Document abstract:\n${summary}`,
    textParts.length > 0 ? `Document material:\n${textParts.join("\n\n")}` : "Document material:\nNone selected.",
  ].join("\n\n");
}

export function assertDocumentReadyForDiscussion(room: DiscussionRoom): void {
  if (!room.documentAsset) {
    return;
  }

  if (room.documentParseStatus === "processing") {
    throw new Error("Document parsing is still running. Wait until parsing finishes before starting the discussion.");
  }

  if (room.documentParseStatus === "failed") {
    throw new Error("The current document could not be parsed. Replace it or remove it before starting the discussion.");
  }

  if (room.selectedDocumentSegmentIds.length === 0) {
    throw new Error("Select at least one document section or excerpt before starting the discussion.");
  }
}

async function ensureDocumentDirectories(): Promise<void> {
  await fs.mkdir(DATA_DOCUMENTS_DIR, { recursive: true });
  await fs.mkdir(TMP_DOCS_DIR, { recursive: true });
}

async function readProcessJson(command: string, args: string[], workdir: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workdir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(stderr.trim() || `Process exited with code ${code}.`));
    });
  });
}

async function runPythonScript(scriptName: string, args: string[]): Promise<string> {
  const scriptPath = path.join(PARSER_DIR, scriptName);
  const launches: Array<{ command: string; prefixArgs: string[] }> = [];
  if (process.env.PYTHON_PATH?.trim()) {
    launches.push({ command: process.env.PYTHON_PATH.trim(), prefixArgs: [] });
  }
  launches.push({ command: "python", prefixArgs: [] });
  launches.push({ command: "py", prefixArgs: ["-3"] });

  let lastError: Error | null = null;
  for (const launch of launches) {
    try {
      return await readProcessJson(launch.command, [...launch.prefixArgs, scriptPath, ...args], APP_ROOT);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("Python runtime was not found.");
}

async function parseDocumentFile(filePath: string, fileKind: RoomDocumentAsset["fileKind"]): Promise<ParsedDocumentPayload> {
  const scriptName =
    fileKind === "pdf" ? "parse_pdf.py" : fileKind === "docx" ? "parse_docx.py" : "parse_text.py";
  const scriptArgs = fileKind === "txt" || fileKind === "md" ? [filePath, fileKind] : [filePath];
  const raw = await runPythonScript(scriptName, scriptArgs);
  const parsed = JSON.parse(raw) as ParsedDocumentPayload;
  return parsed;
}

async function removeRoomDocumentDirectory(room: DiscussionRoom): Promise<void> {
  if (!room.documentAsset) {
    return;
  }
  const documentDir = path.join(DATA_DOCUMENTS_DIR, room.id, room.documentAsset.id);
  await fs.rm(documentDir, { recursive: true, force: true });
}

function resetRoomDocumentState(room: DiscussionRoom): DiscussionRoom {
  room.documentAsset = null;
  room.documentSegments = [];
  room.documentOutline = [];
  room.documentSummary = null;
  room.documentParseStatus = "idle";
  room.documentWarnings = [];
  room.selectedDocumentSegmentIds = [];
  room.documentDiscussionMode = "selected-segments";
  return room;
}

export async function clearRoomDocument(room: DiscussionRoom): Promise<DiscussionRoom> {
  await removeRoomDocumentDirectory(room);
  resetRoomDocumentState(room);
  return room;
}

export async function attachDocumentToRoom(
  room: DiscussionRoom,
  upload: { path: string; originalName: string; mimeType: string; sizeBytes: number },
): Promise<DiscussionRoom> {
  await ensureDocumentDirectories();
  await removeRoomDocumentDirectory(room);

  const fileKind = getFileKind(upload.originalName, upload.mimeType);
  const documentId = randomUUID();
  const roomDir = path.join(DATA_DOCUMENTS_DIR, room.id);
  const documentDir = path.join(roomDir, documentId);
  await fs.mkdir(documentDir, { recursive: true });

  const storedFileName = sanitizeStoredFileName(upload.originalName);
  const storedFilePath = path.join(documentDir, storedFileName);
  await fs.rename(upload.path, storedFilePath).catch(async () => {
    await fs.copyFile(upload.path, storedFilePath);
    await fs.rm(upload.path, { force: true });
  });

  const parsed = await parseDocumentFile(storedFilePath, fileKind);
  const asset: RoomDocumentAsset = {
    id: documentId,
    fileName: upload.originalName,
    storedFileName,
    mimeType: upload.mimeType || "application/octet-stream",
    fileKind,
    sizeBytes: upload.sizeBytes,
    pageCount: parsed.pageCount,
    charCount: parsed.charCount,
    title: parsed.title || path.parse(upload.originalName).name,
    createdAt: new Date().toISOString(),
  };

  let documentSegments = parsed.segments;
  let discussionMode: DocumentDiscussionMode = "selected-segments";
  let selectedDocumentSegmentIds: string[] = [];

  if (supportsWholeDocument(parsed)) {
    const wholeDocumentSegment = buildWholeDocumentSegment(asset, parsed.fullText);
    documentSegments = [wholeDocumentSegment, ...parsed.segments];
    discussionMode = "whole-document";
    selectedDocumentSegmentIds = [wholeDocumentSegment.id];
  }

  room.documentAsset = asset;
  room.documentSegments = documentSegments;
  room.documentOutline = parsed.outline;
  room.documentSummary = {
    title: asset.title,
    abstract: parsed.fullText.slice(0, 1600).trim(),
    defaultTopic: "",
  };
  room.documentParseStatus = parsed.status;
  room.documentWarnings = parsed.warnings;
  room.documentDiscussionMode = discussionMode;
  room.selectedDocumentSegmentIds = selectedDocumentSegmentIds;

  const defaultTopic = buildDefaultDocumentTopic(room);
  room.documentSummary.defaultTopic = defaultTopic;
  room.topic = defaultTopic;
  room.updatedAt = new Date().toISOString();
  return room;
}

export function updateRoomDocumentFocus(
  room: DiscussionRoom,
  input: { selectedSegmentIds?: string[]; discussionMode?: DocumentDiscussionMode },
): DiscussionRoom {
  if (!room.documentAsset) {
    throw new Error("No document is attached to this room.");
  }

  const hasWholeSegment = room.documentSegments.some((segment) => segment.id === WHOLE_DOCUMENT_SEGMENT_ID);
  const nextMode = input.discussionMode ?? room.documentDiscussionMode;
  const existingIds = new Set(room.documentSegments.map((segment) => segment.id));
  const filteredIds = Array.isArray(input.selectedSegmentIds)
    ? input.selectedSegmentIds.filter((segmentId) => existingIds.has(segmentId))
    : room.selectedDocumentSegmentIds.filter((segmentId) => existingIds.has(segmentId));

  if (nextMode === "whole-document") {
    if (!hasWholeSegment) {
      throw new Error("Whole-document mode is only available for shorter documents.");
    }
    room.documentDiscussionMode = "whole-document";
    room.selectedDocumentSegmentIds = [WHOLE_DOCUMENT_SEGMENT_ID];
  } else {
    room.documentDiscussionMode = "selected-segments";
    room.selectedDocumentSegmentIds = filteredIds.filter((segmentId) => segmentId !== WHOLE_DOCUMENT_SEGMENT_ID);
  }

  room.updatedAt = new Date().toISOString();
  return room;
}

export function refreshRoomDocumentDefaultTopic(room: DiscussionRoom): DiscussionRoom {
  if (!room.documentAsset) {
    throw new Error("No document is attached to this room.");
  }
  const defaultTopic = buildDefaultDocumentTopic(room);
  room.topic = defaultTopic;
  if (room.documentSummary) {
    room.documentSummary.defaultTopic = defaultTopic;
  }
  room.updatedAt = new Date().toISOString();
  return room;
}
