import { randomUUID } from "crypto";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { getResearchProfile, getRoleTemplateProfile } from "./discussionCatalog";
import { getDocumentContextForPrompt } from "./documents";
import {
  ChatMessage,
  DiscussionLanguage,
  DiscussionRole,
  DiscussionRoom,
  InsightEntry,
  PendingRequiredReply,
} from "./types";

const APP_ROOT = path.resolve(__dirname, "../..");

export interface ParticipantReply {
  content: string;
  replyToMessageId: string | null;
  replyToRoleName: string | null;
  replyToExcerpt: string | null;
  forceReplyRoleId: string | null;
}

interface ParticipantGenerationOptions {
  forcedReply?: PendingRequiredReply | null;
  selectionReason?: string;
  deliveryMode?: "must-reply" | "prefer-reply" | "prefer-broadcast";
  orderedReplyCandidateIds?: string[];
  allowedForceReplyRoleIds?: string[];
}

interface TextPromptPayload {
  system: string;
  user: string;
  finalMode?: boolean;
}

interface ReplyCandidate {
  id: string;
  roleId: string;
  roleName: string;
  excerpt: string;
  kind: ChatMessage["kind"];
  turn: number;
  round: number;
  replyToMessageId: string | null;
  replyToRoleName: string | null;
  requiredReplyRoleName: string | null;
}

interface ForceReplyCandidate {
  id: string;
  roleName: string;
  goal: string;
}

type OpenAICompatibleRouteKind = "chat-completions" | "responses";
type AnthropicCompatibleRouteKind = "messages";

interface HttpResponseBody {
  contentType: string;
  isJson: boolean;
  isEventStream: boolean;
  rawText: string;
  data: unknown;
}

interface HttpRequestResult {
  response: Response;
  body: HttpResponseBody;
}

interface ProviderErrorDescriptor {
  message: string;
  type: string | null;
  code: string | null;
}

interface OpenAICompatibleRequestPlan {
  kind: OpenAICompatibleRouteKind;
  url: string;
}

interface AnthropicCompatibleRequestPlan {
  kind: AnthropicCompatibleRouteKind;
  url: string;
}

function trimText(content: string, maxLength = 360): string {
  const normalized = content.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3).trim()}...`;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function collectTextFragments(value: unknown, depth = 0, preserveWhitespace = false): string[] {
  if (depth > 6 || value == null) {
    return [];
  }

  if (typeof value === "string") {
    const normalized = preserveWhitespace ? value : value.trim();
    return normalized.trim() ? [normalized] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTextFragments(item, depth + 1, preserveWhitespace));
  }

  const record = toRecord(value);
  if (!record) {
    return [];
  }

  const candidates: unknown[] = [];
  if (Object.hasOwn(record, "text")) {
    candidates.push(record.text);
  }
  if (Object.hasOwn(record, "value")) {
    candidates.push(record.value);
  }
  if (Object.hasOwn(record, "content")) {
    candidates.push(record.content);
  }
  if (Object.hasOwn(record, "parts")) {
    candidates.push(record.parts);
  }
  if (Object.hasOwn(record, "message")) {
    candidates.push(record.message);
  }

  return candidates.flatMap((candidate) => collectTextFragments(candidate, depth + 1, preserveWhitespace));
}

function getFirstTextCandidate(candidates: unknown[], options: { preserveWhitespace?: boolean } = {}): string | null {
  for (const candidate of candidates) {
    const preserveWhitespace = options.preserveWhitespace ?? false;
    const pieces = collectTextFragments(candidate, 0, preserveWhitespace);
    if (pieces.length > 0) {
      const combined = preserveWhitespace ? pieces.join("") : pieces.join("\n").trim();
      if (combined.trim()) {
        return preserveWhitespace ? combined : combined.trim();
      }
    }
  }
  return null;
}

function redactSecrets(text: string, secrets: string[]): string {
  let redacted = text.replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]");
  for (const secret of secrets) {
    const trimmed = secret.trim();
    if (trimmed.length >= 6) {
      redacted = redacted.split(trimmed).join("[REDACTED]");
    }
  }
  return redacted;
}

function formatErrorMessage(message: string, secrets: string[] = []): string {
  return redactSecrets(message.replace(/\s+/g, " ").trim(), secrets).slice(0, 400);
}

function detectOpenAICompatibleTerminal(pathname: string): OpenAICompatibleRouteKind | null {
  const normalized = pathname.replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(normalized)) {
    return "chat-completions";
  }
  if (/\/responses$/i.test(normalized)) {
    return "responses";
  }
  return null;
}

function hasV1PathSegment(pathname: string): boolean {
  return pathname
    .replace(/\/+$/, "")
    .split("/")
    .some((segment) => segment === "v1");
}

function toNormalizedUrlString(url: URL): string {
  const normalized = new URL(url.toString());
  const trimmedPath = normalized.pathname.replace(/\/+$/, "");
  normalized.pathname = trimmedPath || "/";
  return normalized.toString();
}

function appendUrlPath(url: URL, suffix: string): string {
  const next = new URL(url.toString());
  const basePath = next.pathname.replace(/\/+$/, "");
  next.pathname = `${basePath}${suffix}`;
  return next.toString();
}

function buildOpenAICompatibleRequestPlans(endpoint: string): OpenAICompatibleRequestPlan[] {
  const trimmed = endpoint.trim();
  if (!trimmed) {
    throw new Error("OpenAI-compatible provider requires an endpoint.");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("OpenAI-compatible provider endpoint must be a valid absolute URL.");
  }

  const terminal = detectOpenAICompatibleTerminal(url.pathname);
  const candidates =
    terminal !== null
      ? [{ kind: terminal, url: toNormalizedUrlString(url) }]
      : hasV1PathSegment(url.pathname)
        ? [
            { kind: "chat-completions" as const, url: appendUrlPath(url, "/chat/completions") },
            { kind: "responses" as const, url: appendUrlPath(url, "/responses") },
          ]
        : [
            { kind: "chat-completions" as const, url: appendUrlPath(url, "/v1/chat/completions") },
            { kind: "chat-completions" as const, url: appendUrlPath(url, "/chat/completions") },
            { kind: "responses" as const, url: appendUrlPath(url, "/v1/responses") },
            { kind: "responses" as const, url: appendUrlPath(url, "/responses") },
          ];

  const deduped: OpenAICompatibleRequestPlan[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = `${candidate.kind}:${candidate.url}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(candidate);
    }
  }
  return deduped;
}

function buildAnthropicCompatibleRequestPlans(endpoint: string): AnthropicCompatibleRequestPlan[] {
  const trimmed = endpoint.trim();
  if (!trimmed) {
    throw new Error("Claude / Anthropic provider requires an endpoint.");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Claude / Anthropic provider endpoint must be a valid absolute URL.");
  }

  const normalized = url.pathname.replace(/\/+$/, "");
  const candidates =
    /\/messages$/i.test(normalized)
      ? [{ kind: "messages" as const, url: toNormalizedUrlString(url) }]
      : hasV1PathSegment(url.pathname)
        ? [{ kind: "messages" as const, url: appendUrlPath(url, "/messages") }]
        : [
            { kind: "messages" as const, url: appendUrlPath(url, "/v1/messages") },
            { kind: "messages" as const, url: appendUrlPath(url, "/messages") },
          ];

  const deduped: AnthropicCompatibleRequestPlan[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = `${candidate.kind}:${candidate.url}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(candidate);
    }
  }
  return deduped;
}

function buildOpenAICompatibleRequestBody(
  kind: OpenAICompatibleRouteKind,
  role: DiscussionRole,
  payload: TextPromptPayload,
  includeOptionalParams: boolean,
): Record<string, unknown> {
  if (kind === "responses") {
    return {
      model: role.provider.model,
      instructions: payload.system,
      input: payload.user,
      stream: false,
      ...(includeOptionalParams ? { temperature: role.provider.temperature, max_output_tokens: role.provider.maxTokens } : {}),
    };
  }

  return {
    model: role.provider.model,
    messages: [
      { role: "system", content: payload.system },
      { role: "user", content: payload.user },
    ],
    stream: false,
    ...(includeOptionalParams ? { temperature: role.provider.temperature, max_tokens: role.provider.maxTokens } : {}),
  };
}

function buildAnthropicCompatibleRequestBody(
  role: DiscussionRole,
  payload: TextPromptPayload,
  includeOptionalParams: boolean,
): Record<string, unknown> {
  return {
    model: role.provider.model,
    system: payload.system,
    messages: [
      {
        role: "user",
        content: payload.user,
      },
    ],
    max_tokens: role.provider.maxTokens,
    ...(includeOptionalParams ? { temperature: role.provider.temperature } : {}),
  };
}

async function readHttpResponseBody(response: Response): Promise<HttpResponseBody> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const rawText = await response.text();
  let data: unknown = null;
  let isJson = contentType.includes("application/json") || contentType.includes("+json");
  const isEventStream = contentType.includes("text/event-stream");

  if (rawText) {
    const trimmed = rawText.trim();
    if (isJson || /^[\[{]/.test(trimmed)) {
      try {
        data = JSON.parse(rawText);
        isJson = true;
      } catch {
        data = null;
      }
    }
  }

  return {
    contentType,
    isJson,
    isEventStream,
    rawText,
    data,
  };
}

async function performHttpRequest(options: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}): Promise<HttpRequestResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch(options.url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });
    const body = await readHttpResponseBody(response);
    return { response, body };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timed out after ${options.timeoutMs} ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function extractTextFromSsePayload(payload: string): string | null {
  const trimmed = payload.trim();
  if (!trimmed || trimmed === "[DONE]") {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
    const firstChoice = toRecord(choices[0]);
    const delta = toRecord(firstChoice?.delta);
    return getFirstTextCandidate(
      [
        parsed.output_text,
        delta?.content,
        delta?.text,
        firstChoice?.message,
        firstChoice?.text,
        parsed.content,
        parsed.message,
        parsed.output,
      ],
      { preserveWhitespace: true },
    );
  } catch {
    return trimmed;
  }
}

function extractTextFromEventStream(rawText: string): string | null {
  const chunks: string[] = [];
  for (const line of rawText.split(/\r?\n/)) {
    if (!line.startsWith("data:")) {
      continue;
    }
    const piece = extractTextFromSsePayload(line.slice(5));
    if (piece) {
      chunks.push(piece);
    }
  }

  const combined = chunks.join("").trim();
  return combined || null;
}

function extractOpenAICompatibleContent(body: HttpResponseBody): string | null {
  if (body.isEventStream) {
    return extractTextFromEventStream(body.rawText);
  }

  const record = toRecord(body.data);
  const choices = Array.isArray(record?.choices) ? record.choices : [];
  const firstChoice = toRecord(choices[0]);
  return getFirstTextCandidate([
    firstChoice?.message ? toRecord(firstChoice.message)?.content ?? firstChoice.message : null,
    firstChoice?.text,
    record?.output_text,
    record?.output,
    record?.content,
    record?.message,
    record?.output,
    body.isJson ? body.data : null,
  ]);
}

function extractAnthropicCompatibleContent(body: HttpResponseBody): string | null {
  const record = toRecord(body.data);
  return getFirstTextCandidate([
    record?.content,
    record?.completion,
    record?.message,
    record?.output,
    body.isJson ? body.data : null,
  ]);
}

function extractProviderErrorDescriptor(body: HttpResponseBody, secrets: string[]): ProviderErrorDescriptor {
  const record = toRecord(body.data);
  const errorRecord = toRecord(record?.error);
  return {
    message:
      formatErrorMessage(
        getFirstTextCandidate([errorRecord?.message, errorRecord?.detail, record?.message, record?.detail, record?.error, body.rawText]) ??
          "Request failed.",
        secrets,
      ) || "Request failed.",
    type:
      typeof errorRecord?.type === "string"
        ? errorRecord.type
        : typeof record?.type === "string"
          ? record.type
          : null,
    code:
      typeof errorRecord?.code === "string"
        ? errorRecord.code
        : typeof record?.code === "string"
          ? record.code
          : null,
  };
}

function isHtmlDocumentResponse(body: HttpResponseBody): boolean {
  if (body.contentType.includes("text/html")) {
    return true;
  }

  const snippet = body.rawText.trimStart().slice(0, 256).toLowerCase();
  return snippet.startsWith("<!doctype html") || snippet.startsWith("<html");
}

function formatProviderHttpError(
  providerLabel: string,
  url: string,
  status: number | null,
  descriptor: ProviderErrorDescriptor,
): string {
  const details = [descriptor.type ? `type=${descriptor.type}` : null, descriptor.code ? `code=${descriptor.code}` : null]
    .filter(Boolean)
    .join(", ");
  return `${providerLabel} error at ${url}${status ? ` (HTTP ${status})` : ""}: ${descriptor.message}${details ? ` [${details}]` : ""}`;
}

function shouldRetryWithoutOptionalParams(status: number, descriptor: ProviderErrorDescriptor): boolean {
  if (status !== 400) {
    return false;
  }

  const text = `${descriptor.message} ${descriptor.type ?? ""} ${descriptor.code ?? ""}`.toLowerCase();
  return (
    /\b(temperature|max_tokens|max_output_tokens)\b/.test(text) &&
    /(unsupported|unknown|unexpected|not allowed|not permitted|invalid|extra|additional)/.test(text)
  );
}

function shouldRetryAnthropicWithoutOptionalParams(status: number, descriptor: ProviderErrorDescriptor): boolean {
  if (status !== 400) {
    return false;
  }

  const text = `${descriptor.message} ${descriptor.type ?? ""} ${descriptor.code ?? ""}`.toLowerCase();
  return /\btemperature\b/.test(text) && /(unsupported|unknown|unexpected|not allowed|not permitted|invalid|extra|additional)/.test(text);
}

function shouldAdvanceOpenAICompatibleCandidate(
  status: number,
  descriptor: ProviderErrorDescriptor,
  kind: OpenAICompatibleRouteKind,
): boolean {
  const text = `${descriptor.message} ${descriptor.type ?? ""} ${descriptor.code ?? ""}`.toLowerCase();

  if ([404, 405, 415].includes(status)) {
    return true;
  }

  if (status >= 500 && status <= 504) {
    return (
      /(wrong request|bad request|invalid request|malformed|schema|unsupported|unknown field|unknown parameter|unexpected field|unexpected parameter)/.test(
        text,
      ) ||
      /(错误请求|请求错误|本地客户端发送错误请求|无法被.*正确响应|参数.*错误|字段.*错误|请求.*格式)/.test(text)
    );
  }

  if (status !== 400) {
    return false;
  }

  if (kind === "chat-completions") {
    return (
      /(messages?.*(not supported|not allowed|invalid|unexpected|unknown)|unknown field.*messages|unsupported.*messages)/.test(text) ||
      /(input.*required|instructions.*required|use .*responses|responses api)/.test(text)
    );
  }

  return (
    /(input.*(not supported|not allowed|invalid|unexpected|unknown)|instructions.*(not supported|not allowed|invalid|unexpected|unknown))/.test(
      text,
    ) ||
    /(unknown field.*input|unknown field.*instructions|messages.*required|use .*chat|chat\/completions)/.test(text)
  );
}

function shouldAdvanceAnthropicCompatibleCandidate(status: number, descriptor: ProviderErrorDescriptor): boolean {
  const text = `${descriptor.message} ${descriptor.type ?? ""} ${descriptor.code ?? ""}`.toLowerCase();

  if ([404, 405, 415].includes(status)) {
    return true;
  }

  if (status >= 500 && status <= 504) {
    return (
      /(wrong request|bad request|invalid request|malformed|schema|unsupported|unknown field|unknown parameter|unexpected field|unexpected parameter)/.test(
        text,
      ) ||
      /(错误请求|请求错误|本地客户端发送错误请求|无法被.*正确响应|参数.*错误|字段.*错误|请求.*格式)/.test(text)
    );
  }

  if (status !== 400) {
    return false;
  }

  return (
    /(messages?.*(not supported|not allowed|invalid|unexpected|unknown)|unknown field.*messages|unsupported.*messages)/.test(text) ||
    /(use .*chat|chat\/completions|input.*required|instructions.*required)/.test(text)
  );
}

function getParticipants(room: DiscussionRoom): DiscussionRole[] {
  return room.roles.filter((role) => role.enabled && role.kind === "participant");
}

function getOutputLanguageLabel(language: DiscussionLanguage): string {
  return language === "zh-CN" ? "Simplified Chinese" : "English";
}

function getOutputLanguageRule(language: DiscussionLanguage): string {
  return language === "zh-CN"
    ? "All output must be concise Simplified Chinese."
    : "All output must be concise English.";
}

function getRecentMessages(room: DiscussionRoom, limit = 12): ChatMessage[] {
  return room.messages.slice(-limit);
}

function getRecentInsights(room: DiscussionRoom, limit = 4): InsightEntry[] {
  return room.summary.insights.slice(-limit);
}

function getReplyCandidates(room: DiscussionRoom, limit = 8, orderedIds?: string[]): ReplyCandidate[] {
  const baseCandidates = room.messages
    .filter((message) => message.kind !== "system")
    .slice(-limit)
    .map((message) => ({
      id: message.id,
      roleId: message.roleId,
      roleName: message.roleName,
      excerpt: trimText(message.content, 200),
      kind: message.kind,
      turn: message.turn,
      round: message.round,
      replyToMessageId: message.replyToMessageId ?? null,
      replyToRoleName: message.replyToRoleName ?? null,
      requiredReplyRoleName: message.requiredReplyRoleName ?? null,
    }));

  if (!orderedIds || orderedIds.length === 0) {
    return baseCandidates;
  }

  const candidateById = new Map(baseCandidates.map((candidate) => [candidate.id, candidate]));
  const orderedCandidates = orderedIds
    .map((candidateId) => candidateById.get(candidateId) ?? null)
    .filter((candidate): candidate is ReplyCandidate => Boolean(candidate));
  const seenIds = new Set(orderedCandidates.map((candidate) => candidate.id));

  return [...orderedCandidates, ...baseCandidates.filter((candidate) => !seenIds.has(candidate.id))];
}

function getForceReplyCandidates(room: DiscussionRoom, role: DiscussionRole, allowedRoleIds?: string[]): ForceReplyCandidate[] {
  return getParticipants(room)
    .filter((participant) => participant.id !== role.id)
    .filter((participant) => !allowedRoleIds || allowedRoleIds.includes(participant.id))
    .map((participant) => ({
      id: participant.id,
      roleName: participant.name,
      goal: trimText(participant.goal || "No goal provided.", 80),
    }));
}

function findMessage(room: DiscussionRoom, messageId: string | null | undefined): ChatMessage | null {
  if (!messageId) {
    return null;
  }
  return room.messages.find((message) => message.id === messageId) ?? null;
}

function normalizeForceReplyTarget(room: DiscussionRoom, role: DiscussionRole, requestedRoleId: string | null | undefined): string | null {
  if (!requestedRoleId || requestedRoleId === role.id) {
    return null;
  }

  const target = room.roles.find(
    (candidate) => candidate.enabled && candidate.kind === "participant" && candidate.id === requestedRoleId,
  );
  return target?.id ?? null;
}

function toReplyMetadata(room: DiscussionRoom, messageId: string | null): ParticipantReply {
  const target = findMessage(room, messageId);
  return {
    content: "",
    replyToMessageId: target?.id ?? null,
    replyToRoleName: target?.roleName ?? null,
    replyToExcerpt: target ? trimText(target.content, 110) : null,
    forceReplyRoleId: null,
  };
}

function pickFallbackReply(room: DiscussionRoom, forcedReply?: PendingRequiredReply | null): ParticipantReply {
  if (forcedReply) {
    return toReplyMetadata(room, forcedReply.sourceMessageId);
  }

  return {
    content: "",
    replyToMessageId: null,
    replyToRoleName: null,
    replyToExcerpt: null,
    forceReplyRoleId: null,
  };
}

function applyForcedReplyConstraints(
  room: DiscussionRoom,
  reply: ParticipantReply,
  forcedReply?: PendingRequiredReply | null,
): ParticipantReply {
  if (!forcedReply) {
    return reply;
  }

  const meta = toReplyMetadata(room, forcedReply.sourceMessageId);
  return {
    ...reply,
    replyToMessageId: meta.replyToMessageId,
    replyToRoleName: meta.replyToRoleName,
    replyToExcerpt: meta.replyToExcerpt,
    forceReplyRoleId: null,
  };
}

function formatResearchContext(room: DiscussionRoom): string {
  const profile = getResearchProfile(room.researchDirectionKey);
  const directionLabel = room.researchDirectionLabel.trim() || profile.label;
  const directionDescription = room.researchDirectionDescription.trim() || profile.scholarFraming;
  const lines = [
    `Research direction: ${directionLabel}`,
    `Scholar framing: ${directionDescription}`,
    `Evaluation axes: ${profile.evaluationAxes.join(", ")}`,
    `Evidence standards: ${profile.evidenceStandards.join(", ")}`,
    `Common failure modes: ${profile.failureModes.join(", ")}`,
  ];

  if (room.researchDirectionNote.trim()) {
    lines.push(`Additional user context: ${room.researchDirectionNote.trim()}`);
  }

  return lines.join("\n");
}

function formatDocumentContext(room: DiscussionRoom): string {
  const context = getDocumentContextForPrompt(room);
  return context ? `Document context:\n${context}` : "Document context:\nNone.";
}

function formatActiveExchangeContext(room: DiscussionRoom, role: DiscussionRole, selectionReason?: string): string {
  const exchange = room.state.activeExchange;
  if (!exchange) {
    return [
      "Active exchange reason: none",
      "Trigger message: none",
      "Hard target role: none",
      "Responded roles in current exchange: none",
      `Recommended reason you should speak now: ${selectionReason ?? "No explicit recommendation."}`,
    ].join("\n");
  }

  const triggerMessage = exchange.triggerMessageId ? findMessage(room, exchange.triggerMessageId) : null;
  const hardTargetRole = exchange.hardTargetRoleId
    ? room.roles.find((candidate) => candidate.id === exchange.hardTargetRoleId)
    : null;
  const respondedRoles = exchange.respondedRoleIds
    .map((roleId) => room.roles.find((candidate) => candidate.id === roleId)?.name)
    .filter((name): name is string => Boolean(name));

  return [
    `Active exchange reason: ${exchange.reason}`,
    triggerMessage
      ? `Trigger message:\n${triggerMessage.roleName}: ${triggerMessage.content}`
      : "Trigger message:\nNone.",
    `Hard target role: ${hardTargetRole?.name ?? "None."}`,
    `Responded roles in current exchange: ${respondedRoles.length > 0 ? respondedRoles.join(", ") : "None."}`,
    `Recommended reason you should speak now: ${selectionReason ?? "No explicit recommendation."}`,
    `You have ${exchange.followUpTurnsRemaining} follow-up turns remaining in this exchange after the hard target response.`,
    `You are${exchange.hardTargetRoleId === role.id ? "" : " not"} the hard target role for this exchange.`,
  ].join("\n\n");
}

function formatPromptMessage(message: ChatMessage): string {
  const replyLabel = message.replyToMessageId
    ? `reply-to=${message.replyToRoleName ?? "unknown"}#${message.replyToMessageId}`
    : "reply-to=broadcast";
  const requiredReplyLabel = message.requiredReplyRoleName ? `next-required-reply=${message.requiredReplyRoleName}` : "next-required-reply=none";
  return `[round ${message.round} turn ${message.turn}] ${message.roleName} (${message.kind}; ${replyLabel}; ${requiredReplyLabel})\n${trimText(message.content, 260)}`;
}

function formatReplyCandidate(candidate: ReplyCandidate): string {
  const replyLabel = candidate.replyToMessageId
    ? `reply-to=${candidate.replyToRoleName ?? "unknown"}#${candidate.replyToMessageId}`
    : "reply-to=broadcast";
  const requiredReplyLabel = candidate.requiredReplyRoleName
    ? `next-required-reply=${candidate.requiredReplyRoleName}`
    : "next-required-reply=none";
  return `${candidate.id} | round ${candidate.round} turn ${candidate.turn} | ${candidate.roleName} | ${candidate.kind} | ${replyLabel} | ${requiredReplyLabel}\n${candidate.excerpt}`;
}

function buildParticipantSystemPrompt(
  room: DiscussionRoom,
  role: DiscussionRole,
  replyCandidates: ReplyCandidate[],
  forceReplyCandidates: ForceReplyCandidate[],
  forcedReply?: PendingRequiredReply | null,
  deliveryMode?: ParticipantGenerationOptions["deliveryMode"],
  selectionReason?: string,
): string {
  const template = getRoleTemplateProfile(role.roleTemplateId);
  const templateLines = template
    ? [
        `Template identity: ${template.defaultName}`,
        `Identity contract: ${template.identityContract}`,
        `Evidence focus: ${template.evidenceFocus}`,
        `Non-negotiable boundary: ${template.nonNegotiable}`,
      ]
    : ["Template identity: custom participant", "Identity contract: act like a serious scholar with a fixed stake."];

  const mandatoryReplyLines = forcedReply
    ? [
        "",
        "This turn is a mandatory reply.",
        `- You must directly answer message ${forcedReply.sourceMessageId}.`,
        "- Set replyToMessageId to that mandatory source message.",
        "- Set forceReplyRoleId to null on this turn.",
      ]
    : [
        "",
        "Optional escalation rule:",
        "- You may set forceReplyRoleId to one participant if that person must directly answer your point next.",
        "- Only do this when a direct response is genuinely necessary.",
      ];

  const deliveryModeLines = [
    "",
    `Preferred delivery mode: ${deliveryMode ?? "prefer-broadcast"}`,
    `Service-side selection reason: ${selectionReason ?? "natural continuation"}`,
  ];

  return [
    "You are a serious scholar in a multi-party research discussion.",
    "This is not theatrical roleplay. Behave like a real expert with a real agenda and evidence standard.",
    getOutputLanguageRule(room.discussionLanguage),
    "",
    `Role name: ${role.name}`,
    `Role persona: ${role.persona || "No persona provided."}`,
    `Role goal: ${role.goal || "Push the room toward a more defensible conclusion."}`,
    `Role strategy: ${role.principles || "Engage the strongest unresolved issue."}`,
    `Speaking style: ${role.voiceStyle || "Short, direct, professional."}`,
    ...templateLines,
    "",
    "Hard rules:",
    "- The latest user-supplied evidence or constraint has the highest priority. If it materially changes the judgment, address it before anything else.",
    "- Reply as the selected role, not as a neutral moderator.",
    "- Use the research direction's evidence standards and review criteria.",
    "- If you reply to a message, your content must actually engage that message's claim or evidence.",
    "- You may either reply to a specific message or publish an independent view when no direct reply is needed.",
    "- Do not give empty praise, vague brainstorming, or generic 'it can be improved' language.",
    "- Keep the content to 2-4 short sentences.",
    "- Do not use markdown bullets.",
    "- Output valid JSON only.",
    `- replyToMessageId must be one candidate id or null. Reply candidate count: ${replyCandidates.length}.`,
    `- forceReplyRoleId must be one participant id or null. Force-reply candidate count: ${forceReplyCandidates.length}.`,
    ...deliveryModeLines,
    ...mandatoryReplyLines,
    '- Output schema: {"replyToMessageId":"candidate-id-or-null","forceReplyRoleId":"participant-role-id-or-null","content":"your short message"}',
  ].join("\n");
}

function buildParticipantUserPrompt(
  room: DiscussionRoom,
  role: DiscussionRole,
  replyCandidates: ReplyCandidate[],
  forceReplyCandidates: ForceReplyCandidate[],
  forcedReply?: PendingRequiredReply | null,
  deliveryMode?: ParticipantGenerationOptions["deliveryMode"],
  selectionReason?: string,
): string {
  const recentMessages = getRecentMessages(room, 12)
    .map((message) => formatPromptMessage(message))
    .join("\n");
  const recentInsights = getRecentInsights(room, 4)
    .map((insight) => `${insight.title}: ${insight.content}`)
    .join("\n");
  const latestUser = [...room.messages].reverse().find((message) => message.kind === "user");
  const replyCandidateLines = replyCandidates.length
    ? replyCandidates.map((candidate) => formatReplyCandidate(candidate)).join("\n\n")
    : "No reply candidates.";
  const forceReplyCandidateLines = forceReplyCandidates.length
    ? forceReplyCandidates.map((candidate) => `${candidate.id} | ${candidate.roleName} | ${candidate.goal}`).join("\n")
    : "No force-reply candidates.";
  const forcedTargetMessage = forcedReply ? findMessage(room, forcedReply.sourceMessageId) : null;

  return [
    `Discussion language: ${getOutputLanguageLabel(room.discussionLanguage)}`,
    `Discussion topic:\n${room.topic}`,
    `Decision objective:\n${room.objective}`,
    `Current participant round: ${room.state.currentRound}`,
    formatResearchContext(room),
    formatDocumentContext(room),
    formatActiveExchangeContext(room, role, selectionReason),
    `Your specific goal:\n${role.goal || "Not provided."}`,
    latestUser ? `Latest user evidence to prioritize:\n${latestUser.roleName}: ${latestUser.content}` : "Latest user evidence to prioritize:\nNone.",
    forcedTargetMessage
      ? `Mandatory reply to fulfill:\n${forcedTargetMessage.id} | ${forcedTargetMessage.roleName} | ${forcedTargetMessage.content}`
      : "Mandatory reply to fulfill:\nNone.",
    recentInsights ? `Recent notes:\n${recentInsights}` : "Recent notes:\nNone yet.",
    recentMessages ? `Recent messages:\n${recentMessages}` : "Recent messages:\nNone yet.",
    `Reply candidates:\n${replyCandidateLines}`,
    `Force-reply candidates:\n${forceReplyCandidateLines}`,
    `Delivery mode recommendation:\n${deliveryMode ?? "prefer-broadcast"}`,
    `Selection reason:\n${selectionReason ?? "natural continuation"}`,
    [
      "Your task:",
      "1. Decide whether the latest user evidence changes the room's judgment.",
      forcedReply
        ? "2. Directly answer the mandatory target message."
        : "2. Pick the best reply target if one should be addressed directly, or null if a free-standing point is better.",
      forcedReply
        ? "3. Do not assign a new mandatory reply on this turn."
        : "3. Optionally assign one participant to reply next if their direct response is necessary.",
      "4. Speak from your role's goal, evidence standard, and non-negotiable boundary.",
      "5. Push the discussion toward a sharper, academically defensible conclusion.",
      "Output only valid JSON.",
    ].join("\n"),
  ].join("\n\n");
}

function buildRecorderSystemPrompt(room: DiscussionRoom, role: DiscussionRole, finalMode: boolean): string {
  const template = getRoleTemplateProfile(role.roleTemplateId);
  return [
    "You are the recorder and analytical note-taker for a serious multi-party research discussion.",
    "You do not debate. You extract the decisive signal and compress it into useful notes.",
    getOutputLanguageRule(room.discussionLanguage),
    "",
    `Recorder name: ${role.name}`,
    `Recorder persona: ${role.persona || template?.persona || "Neutral recorder."}`,
    `Recorder goal: ${role.goal || template?.goal || "Produce high-signal checkpoint notes and a final conclusion."}`,
    `Recorder method: ${role.principles || template?.principles || "Track decisive objections, strongest repairs, evidence shifts, and the current verdict."}`,
    "",
    "Hard rules:",
    "- State whether the latest user-supplied evidence changed the judgment, and if so, how much.",
    "- Extract the strongest claim, strongest objection, strongest repair, and strongest evidence.",
    finalMode
      ? "- The final conclusion must include: final judgment, why it holds, decisive evidence, remaining risk, and next action."
      : "- The checkpoint must include: strongest current claim, strongest rebuttal, strongest evidence, unresolved blocker, and what the next round must settle.",
    finalMode
      ? "- Write 2-4 compact paragraphs with enough detail to stand alone as a usable conclusion."
      : "- Write 1-3 compact paragraphs with enough concrete detail to guide the next round.",
    "- Keep it dense and readable, not verbose.",
    "- Do not use markdown bullets.",
  ].join("\n");
}

function buildRecorderUserPrompt(room: DiscussionRoom, finalMode: boolean): string {
  const recentMessages = getRecentMessages(room, 16)
    .filter((message) => message.kind === "participant" || message.kind === "user")
    .map((message) => formatPromptMessage(message))
    .join("\n");
  const latestUser = [...room.messages].reverse().find((message) => message.kind === "user");

  return [
    `Discussion language: ${getOutputLanguageLabel(room.discussionLanguage)}`,
    `Discussion topic:\n${room.topic}`,
    `Decision objective:\n${room.objective}`,
    `Current participant round: ${room.state.currentRound}`,
    formatResearchContext(room),
    formatDocumentContext(room),
    latestUser ? `Latest user evidence:\n${latestUser.content}` : "Latest user evidence:\nNone.",
    recentMessages ? `Recent discussion messages:\n${recentMessages}` : "Recent discussion messages:\nNone yet.",
    finalMode
      ? "Produce the final conclusion with enough detail to stand on its own."
      : "Produce a checkpoint note with concrete detail that helps the next round.",
  ].join("\n\n");
}

function buildRecorderTopicSystemPrompt(room: DiscussionRoom, role: DiscussionRole): string {
  return [
    "You are the recorder for a serious document-centered discussion workspace.",
    "Your task is to write one concise discussion topic that tells the room what to debate about this document.",
    getOutputLanguageRule(room.discussionLanguage),
    "",
    `Recorder name: ${role.name}`,
    `Recorder persona: ${role.persona || "Neutral recorder."}`,
    `Recorder goal: ${role.goal || "Produce high-signal framing."}`,
    "",
    "Hard rules:",
    "- Produce a single sentence topic only.",
    "- Focus on the document and the currently selected scope, not generic brainstorming.",
    "- The topic should be specific enough to guide a real discussion.",
    "- Do not use markdown bullets or labels.",
  ].join("\n");
}

function buildRecorderTopicUserPrompt(room: DiscussionRoom): string {
  const defaultTopic = room.documentSummary?.defaultTopic?.trim() || "None.";
  return [
    `Discussion language: ${getOutputLanguageLabel(room.discussionLanguage)}`,
    `Current room objective:\n${room.objective}`,
    formatResearchContext(room),
    formatDocumentContext(room),
    `Default local topic suggestion:\n${defaultTopic}`,
    "Generate one improved discussion topic sentence for this document.",
  ].join("\n\n");
}

function buildCodexPrompt(systemPrompt: string, userPrompt: string): string {
  return ["[SYSTEM]", systemPrompt, "", "[USER]", userPrompt].join("\n");
}

function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const candidate = fenced[1].trim();
    if (candidate.startsWith("{") && candidate.endsWith("}")) {
      return candidate;
    }
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return null;
}

function parseParticipantReply(raw: string, room: DiscussionRoom, role: DiscussionRole): ParticipantReply | null {
  const jsonBlock = extractJsonObject(raw);
  if (!jsonBlock) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonBlock) as {
      replyToMessageId?: string | null;
      forceReplyRoleId?: string | null;
      content?: string;
      message?: string;
      output?: string;
    };
    const content = (parsed.content ?? parsed.message ?? parsed.output ?? "").trim();
    if (!content) {
      return null;
    }

    const meta = toReplyMetadata(room, typeof parsed.replyToMessageId === "string" ? parsed.replyToMessageId : null);
    return {
      ...meta,
      content: trimText(content),
      forceReplyRoleId: normalizeForceReplyTarget(room, role, parsed.forceReplyRoleId),
    };
  } catch {
    return null;
  }
}

function finalizeParticipantReply(raw: string, room: DiscussionRoom, role: DiscussionRole): ParticipantReply {
  const parsed = parseParticipantReply(raw, room, role);
  if (parsed) {
    return parsed;
  }

  const fallback = pickFallbackReply(room);
  return {
    ...fallback,
    content: trimText(raw),
    forceReplyRoleId: null,
  };
}

function getMockForceReplyTarget(room: DiscussionRoom, role: DiscussionRole): DiscussionRole | null {
  const participants = getParticipants(room);
  if (participants.length < 3) {
    return null;
  }

  const latestParticipant = [...room.messages].reverse().find((message) => message.kind === "participant" && message.roleId !== role.id);
  if (!latestParticipant) {
    return null;
  }

  const currentIndex = participants.findIndex((participant) => participant.id === role.id);
  if (currentIndex < 0) {
    return null;
  }

  for (let offset = 1; offset < participants.length; offset += 1) {
    const candidate = participants[(currentIndex + offset) % participants.length];
    if (candidate.id !== role.id) {
      return candidate;
    }
  }

  return null;
}

function buildMockParticipantReply(
  room: DiscussionRoom,
  role: DiscussionRole,
  options: ParticipantGenerationOptions = {},
): ParticipantReply {
  const forcedReply = options.forcedReply ?? null;
  const profile = getResearchProfile(room.researchDirectionKey);
  const template = getRoleTemplateProfile(role.roleTemplateId);
  const latestUser = [...room.messages].reverse().find((message) => message.kind === "user");
  const reply = pickFallbackReply(room, forcedReply);
  const forceReplyTarget = !forcedReply && !latestUser ? getMockForceReplyTarget(room, role) : null;

  if (room.discussionLanguage === "zh-CN") {
    const content = forcedReply
      ? `我先直接回应这条点名意见：这条新证据会改变讨论重心，但还要继续按${profile.evidenceStandards[0]}重新判断。我的当前立场会相应收缩，而不是照旧重复前面的结论。`
      : latestUser && reply.replyToMessageId
        ? `先回应这条新证据：它${template?.key === "reviewer" ? "会改变我对风险的判断，但还不足以直接放宽标准" : "确实改变了下一步优先级，我会据此调整原先观点"}。接下来我会继续围绕${profile.evaluationAxes[0]}和${profile.evidenceStandards[0]}推进结论。`
        : forceReplyTarget
          ? `我先给出当前判断：关键仍在${profile.evaluationAxes[0]}。接下来请${forceReplyTarget.name}直接回应这条论点，明确它是否足以通过${profile.evidenceStandards[0]}。`
          : template?.key === "reviewer"
            ? `我仍然卡在${profile.failureModes[0]}。没有更扎实的${profile.evidenceStandards[0]}，这个结论还站不稳。`
            : template?.key === "advisor"
              ? `可以继续，但必须把主张收缩到一个可验证命题。下一步要直接补上${profile.evidenceStandards[0]}。`
              : `我更关心${profile.evaluationAxes[0]}。如果这点说不清，后面的争论都会发散。`;

    return {
      ...reply,
      content: trimText(content, 220),
      forceReplyRoleId: forceReplyTarget?.id ?? null,
    };
  }

  const content = forcedReply
    ? `I need to answer this directed challenge first. The new evidence changes the discussion focus, but it still has to clear ${profile.evidenceStandards[0]} before I fully revise the judgment.`
    : latestUser && reply.replyToMessageId
      ? `I need to address this new evidence first. It shifts the discussion focus, but it still has to clear ${profile.evidenceStandards[0]}.`
      : forceReplyTarget
        ? `My current view still turns on ${profile.evaluationAxes[0]}. ${forceReplyTarget.name} should answer this point directly before the room moves on.`
        : template?.key === "reviewer"
          ? `${profile.mockCritic} The weakest point is still ${profile.failureModes[0]}.`
          : template?.key === "advisor"
            ? `${profile.mockBuilder} I would narrow the claim and tie it directly to ${profile.evidenceStandards[0]}.`
            : profile.mockNeutral;

  return {
    ...reply,
    content: trimText(content, 220),
    forceReplyRoleId: forceReplyTarget?.id ?? null,
  };
}

function buildMockRecorderMessage(room: DiscussionRoom, finalMode: boolean): string {
  const profile = getResearchProfile(room.researchDirectionKey);
  const latestUser = [...room.messages].reverse().find((message) => message.kind === "user");

  if (room.discussionLanguage === "zh-CN") {
    if (finalMode) {
      return trimText(
        [
          "最终判断：这个方向可以继续，但必须更收缩、更可验证。",
          `判断依据：讨论已集中到 ${profile.evaluationAxes[0]}，但 ${profile.failureModes[0]} 仍未完全消除。`,
          latestUser ? "用户证据影响：最新用户证据改变了讨论重心，但尚未单独构成决定性证据。" : "用户证据影响：本轮没有新的用户证据改写判断。",
          `下一步：补上 ${profile.evidenceStandards[0]}，再决定是否进入更强结论。`,
        ].join("\n"),
        420,
      );
    }

    return trimText(
      [
        `当前最强主张：讨论正在围绕 ${profile.evaluationAxes[0]} 收敛。`,
        `最强反驳：${profile.failureModes[0]} 仍是主要阻碍。`,
        latestUser ? "用户证据影响：最新用户证据已被吸收，但尚未彻底改写结论。" : "用户证据影响：暂无新的用户证据。",
        `下一轮必须解决：${profile.evidenceStandards[0]} 是否足以支持更强判断。`,
      ].join("\n"),
      360,
    );
  }

  if (finalMode) {
    return trimText(
      [
        "Final judgment: continue only in a narrower and more testable form.",
        `Why: the room is converging on ${profile.evaluationAxes[0]}, but ${profile.failureModes[0]} still limits confidence.`,
        latestUser ? "User evidence impact: the latest user evidence changed the discussion focus, but not enough to close the case." : "User evidence impact: no new user evidence materially changed the judgment.",
        `Next action: provide ${profile.evidenceStandards[0]} before strengthening the claim.`,
      ].join("\n"),
      420,
    );
  }

  return trimText(
    [
      `Strongest current claim: the room is converging on ${profile.evaluationAxes[0]}.`,
      `Strongest rebuttal: ${profile.failureModes[0]} remains the main blocker.`,
      latestUser ? "User evidence impact: the latest user evidence shifted the room, but did not settle the dispute." : "User evidence impact: no fresh user evidence changed the room.",
      `Next round must settle whether ${profile.evidenceStandards[0]} can be met.`,
    ].join("\n"),
    360,
  );
}

function buildExpandedMockRecorderMessage(room: DiscussionRoom, finalMode: boolean): string {
  const profile = getResearchProfile(room.researchDirectionKey);
  const latestUser = [...room.messages].reverse().find((message) => message.kind === "user");

  if (room.discussionLanguage === "zh-CN") {
    if (finalMode) {
      return trimText(
        [
          "最终判断：这个方向可以继续，但结论只能建立在更收缩、更可验证的版本上。",
          `判断依据：讨论已经明显围绕 ${profile.evaluationAxes[0]} 收敛，但 ${profile.failureModes[0]} 仍然压低整体置信度。`,
          latestUser ? "用户证据影响：最新的用户证据确实改变了讨论焦点，但还不足以单独构成定案证据。" : "用户证据影响：本轮没有新的用户证据足以改写总体判断。",
          `决定性证据：当前最有价值的支持仍然来自围绕 ${profile.evidenceStandards[0]} 所构造的可验证路径，而不是额外扩张结论。`,
          `剩余风险：如果 ${profile.failureModes[0]} 继续存在，那么现阶段最合理的结论就只能是谨慎推进，而不是高置信接受。`,
          `下一步：优先补足 ${profile.evidenceStandards[0]}，再决定是否能把谨慎判断升级成更强结论。`,
        ].join("\n"),
        1100,
      );
    }

    return trimText(
      [
        `当前最强主张：讨论正在围绕 ${profile.evaluationAxes[0]} 收敛，这说明房间已经找到主要分歧轴。`,
        `最强反驳：${profile.failureModes[0]} 仍是主要障碍，所以现阶段还不能把中间判断直接抬升为最终结论。`,
        latestUser ? "用户证据影响：最新的用户证据已经被吸收进论证，但它更像是重排优先级，而不是一次性解决争议。" : "用户证据影响：暂无新的用户证据改变当前争议结构。",
        `当前最有效的修正方向：把后续论证直接绑定到 ${profile.evidenceStandards[0]}，避免继续停留在宽泛表述。`,
        `下一轮必须解决：${profile.evidenceStandards[0]} 是否真的足以支持更强判断，以及它能否实质削弱 ${profile.failureModes[0]}。`,
      ].join("\n"),
      820,
    );
  }

  if (finalMode) {
    return trimText(
      [
        "Final judgment: continue only in a narrower and more testable form.",
        `Why: the room is converging on ${profile.evaluationAxes[0]}, but ${profile.failureModes[0]} still limits confidence.`,
        latestUser ? "User evidence impact: the latest user evidence changed the discussion focus, but not enough to close the case on its own." : "User evidence impact: no new user evidence materially changed the overall judgment.",
        `Decisive evidence: the most useful support still depends on whether the room can satisfy ${profile.evidenceStandards[0]}.`,
        `Remaining risk: if ${profile.failureModes[0]} stays unresolved, the conclusion should remain cautious rather than strong.`,
        `Next action: provide ${profile.evidenceStandards[0]} before strengthening the claim.`,
      ].join("\n"),
      1100,
    );
  }

  return trimText(
    [
      `Strongest current claim: the room is converging on ${profile.evaluationAxes[0]}, which has become the main decision axis.`,
      `Strongest rebuttal: ${profile.failureModes[0]} remains the main blocker, so the current case is not yet decisive.`,
      latestUser ? "User evidence impact: the latest user evidence shifted the room, but it reprioritized the debate more than it resolved it." : "User evidence impact: no fresh user evidence changed the current dispute structure.",
      `Best current repair: tie the next argument directly to ${profile.evidenceStandards[0]} instead of broadening the claim.`,
      `Next round must settle whether ${profile.evidenceStandards[0]} can actually be met and whether it weakens ${profile.failureModes[0]}.`,
    ].join("\n"),
    820,
  );
}

async function requestOpenAICompatible(role: DiscussionRole, payload: TextPromptPayload): Promise<string> {
  const secrets = [role.provider.apiKey];
  const plans = buildOpenAICompatibleRequestPlans(role.provider.endpoint);
  let lastError: Error | null = null;

  for (const plan of plans) {
    let includeOptionalParams = true;

    while (true) {
      let result: HttpRequestResult;
      try {
        result = await performHttpRequest({
          url: plan.url,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(role.provider.apiKey ? { Authorization: `Bearer ${role.provider.apiKey}` } : {}),
          },
          body: JSON.stringify(buildOpenAICompatibleRequestBody(plan.kind, role, payload, includeOptionalParams)),
          timeoutMs: role.provider.timeoutMs,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown request failure.";
        throw new Error(
          formatProviderHttpError(
            "OpenAI-compatible provider",
            plan.url,
            null,
            {
              message: formatErrorMessage(message, secrets),
              type: null,
              code: null,
            },
          ),
        );
      }

      if (!result.response.ok) {
        const descriptor = extractProviderErrorDescriptor(result.body, secrets);
        if (includeOptionalParams && shouldRetryWithoutOptionalParams(result.response.status, descriptor)) {
          includeOptionalParams = false;
          continue;
        }

        const error = new Error(
          formatProviderHttpError("OpenAI-compatible provider", plan.url, result.response.status, descriptor),
        );

        if (
          result.response.status !== 401 &&
          result.response.status !== 403 &&
          result.response.status !== 429 &&
          shouldAdvanceOpenAICompatibleCandidate(result.response.status, descriptor, plan.kind)
        ) {
          lastError = error;
          break;
        }

        throw error;
      }

      if (isHtmlDocumentResponse(result.body)) {
        throw new Error(
          `OpenAI-compatible provider endpoint returned an HTML page instead of JSON at ${plan.url}. This usually means the configured endpoint is a website route, login page, or wrong API base URL.`,
        );
      }

      const content = extractOpenAICompatibleContent(result.body);
      if (content) {
        return content;
      }

      lastError = new Error(
        `OpenAI-compatible provider returned empty content after calling ${plan.url}.`,
      );
      break;
    }
  }

  throw lastError ?? new Error("OpenAI-compatible provider request failed.");
}

async function requestAnthropicCompatible(role: DiscussionRole, payload: TextPromptPayload): Promise<string> {
  const secrets = [role.provider.apiKey];
  const plans = buildAnthropicCompatibleRequestPlans(role.provider.endpoint);
  let lastError: Error | null = null;

  for (const plan of plans) {
    let includeOptionalParams = true;

    while (true) {
      let result: HttpRequestResult;
      try {
        result = await performHttpRequest({
          url: plan.url,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
            ...(role.provider.apiKey
              ? {
                  "x-api-key": role.provider.apiKey,
                  Authorization: `Bearer ${role.provider.apiKey}`,
                }
              : {}),
          },
          body: JSON.stringify(buildAnthropicCompatibleRequestBody(role, payload, includeOptionalParams)),
          timeoutMs: role.provider.timeoutMs,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown request failure.";
        throw new Error(
          formatProviderHttpError(
            "Claude / Anthropic provider",
            plan.url,
            null,
            {
              message: formatErrorMessage(message, secrets),
              type: null,
              code: null,
            },
          ),
        );
      }

      if (!result.response.ok) {
        const descriptor = extractProviderErrorDescriptor(result.body, secrets);
        if (includeOptionalParams && shouldRetryAnthropicWithoutOptionalParams(result.response.status, descriptor)) {
          includeOptionalParams = false;
          continue;
        }

        const error = new Error(
          formatProviderHttpError("Claude / Anthropic provider", plan.url, result.response.status, descriptor),
        );

        if (
          result.response.status !== 401 &&
          result.response.status !== 403 &&
          result.response.status !== 429 &&
          shouldAdvanceAnthropicCompatibleCandidate(result.response.status, descriptor)
        ) {
          lastError = error;
          break;
        }

        throw error;
      }

      if (isHtmlDocumentResponse(result.body)) {
        throw new Error(
          `Claude / Anthropic provider endpoint returned an HTML page instead of JSON at ${plan.url}. This usually means the configured endpoint is a website route, login page, or wrong API base URL.`,
        );
      }

      const content = extractAnthropicCompatibleContent(result.body);
      if (content) {
        return content;
      }

      lastError = new Error(`Claude / Anthropic provider returned empty content after calling ${plan.url}.`);
      break;
    }
  }

  throw lastError ?? new Error("Claude / Anthropic provider request failed.");
}

async function requestCustomHttp(
  room: DiscussionRoom,
  role: DiscussionRole,
  payload: TextPromptPayload,
): Promise<{ content: string; replyToMessageId?: string | null; forceReplyRoleId?: string | null }> {
  let result: HttpRequestResult;
  try {
    result = await performHttpRequest({
      url: role.provider.endpoint,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(role.provider.apiKey ? { Authorization: `Bearer ${role.provider.apiKey}` } : {}),
      },
      body: JSON.stringify({
        room,
        role,
        prompt: payload,
      }),
      timeoutMs: role.provider.timeoutMs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown request failure.";
    throw new Error(
      formatProviderHttpError("Custom HTTP provider", role.provider.endpoint, null, {
        message: formatErrorMessage(message, [role.provider.apiKey]),
        type: null,
        code: null,
      }),
    );
  }

  if (!result.response.ok) {
    throw new Error(
      formatProviderHttpError(
        "Custom HTTP provider",
        role.provider.endpoint,
        result.response.status,
        extractProviderErrorDescriptor(result.body, [role.provider.apiKey]),
      ),
    );
  }

  const data = toRecord(result.body.data);
  const content = getFirstTextCandidate([data?.content, data?.message, data?.output]);
  if (!content) {
    throw new Error(`Custom HTTP provider returned empty content after calling ${role.provider.endpoint}.`);
  }

  return {
    content,
    replyToMessageId: typeof data?.replyToMessageId === "string" ? data.replyToMessageId : null,
    forceReplyRoleId: typeof data?.forceReplyRoleId === "string" ? data.forceReplyRoleId : null,
  };
}

function parseArgsString(input: string): string[] {
  const result: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const nextChar = input[index + 1];

    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (char === "\\" && nextChar === quote) {
        current += quote;
        index += 1;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        result.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    result.push(current);
  }

  return result;
}

async function runCommand(
  command: string,
  args: string[],
  promptText: string,
  workingDirectory: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveSpawnCommand(command), resolveSpawnArgs(command, args), {
      cwd: workingDirectory,
      env: process.env,
      stdio: "pipe",
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill();
      reject(new Error(`Local CLI timed out after ${timeoutMs} ms.`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({ stdout, stderr, exitCode });
      }
    });

    child.stdin.write(promptText);
    child.stdin.end();
  });
}

function isWindowsCmdLauncher(command: string): boolean {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(command.trim());
}

function isWindowsShellCommand(command: string): boolean {
  if (process.platform !== "win32") {
    return false;
  }

  const trimmed = command.trim();
  if (!trimmed) {
    return false;
  }

  if (isWindowsCmdLauncher(trimmed)) {
    return true;
  }

  if (/[\\/]/.test(trimmed)) {
    return /\.(cmd|bat)$/i.test(trimmed);
  }

  return !/\.(exe|com)$/i.test(trimmed);
}

function quoteWindowsCmdArg(value: string): string {
  if (!value) {
    return '""';
  }

  if (!/[\s"&<>|^()]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}

function resolveSpawnCommand(command: string): string {
  if (isWindowsShellCommand(command)) {
    return process.env.ComSpec || "cmd.exe";
  }

  return command;
}

function resolveSpawnArgs(command: string, args: string[]): string[] {
  if (!isWindowsShellCommand(command)) {
    return args;
  }

  const commandLine = [command, ...args].map(quoteWindowsCmdArg).join(" ");
  return ["/d", "/s", "/c", commandLine];
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function extractCodexCliFailureMessage(stdout: string, stderr: string, exitCode: number | null): string | null {
  const combined = stripAnsi([stderr, stdout].filter(Boolean).join("\n"));
  const lines = combined
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const unsupportedModelLine = lines.find((line) =>
    /model is not supported when using Codex with a ChatGPT account/i.test(line),
  );
  if (unsupportedModelLine) {
    const modelMatch = unsupportedModelLine.match(/'([^']+)' model is not supported when using Codex with a ChatGPT account/i);
    const modelLabel = modelMatch?.[1] ? `\`${modelMatch[1]}\`` : "the configured model";
    return `Codex CLI rejected ${modelLabel} for the current ChatGPT-backed login. Leave the Model field blank to use Codex's default model, or choose a model supported by your account.`;
  }

  const preferredLine =
    [...lines].reverse().find((line) => line.startsWith("ERROR:")) ??
    [...lines].reverse().find((line) => /invalid_request_error|authentication|unauthorized|forbidden|not supported|timed out/i.test(line));

  if (!preferredLine) {
    return exitCode === null ? "Codex CLI terminated unexpectedly." : null;
  }

  const normalized = preferredLine.replace(/^ERROR:\s*/, "").trim();
  if (!normalized) {
    return exitCode === null ? "Codex CLI terminated unexpectedly." : null;
  }

  return `Codex CLI failed: ${normalized.slice(0, 400)}`;
}

async function requestCodexCli(role: DiscussionRole, promptText: string): Promise<string> {
  const workingDirectory = role.provider.workingDirectory.trim() || APP_ROOT;
  await fs.access(workingDirectory).catch(() => {
    throw new Error(`The working directory does not exist: ${workingDirectory}`);
  });
  const runtimeDir = path.join(workingDirectory, ".codex-provider-runtime");
  const outputFileName = `${randomUUID()}.txt`;
  const outputFile = path.join(runtimeDir, outputFileName);
  const outputFileArg = path.join(".codex-provider-runtime", outputFileName);
  await fs.mkdir(runtimeDir, { recursive: true });
  const launcherArgs = parseArgsString(role.provider.launcherArgs || "");
  const args = [
    ...launcherArgs,
    "exec",
    "--color",
    "never",
    "--ephemeral",
    "--output-last-message",
    outputFileArg,
    "--sandbox",
    role.provider.sandboxMode,
    ...(role.provider.skipGitRepoCheck ? ["--skip-git-repo-check"] : []),
    ...(role.provider.model.trim() ? ["-m", role.provider.model.trim()] : []),
    "-",
  ];

  try {
    const result = await runCommand(
      role.provider.command.trim() || "codex",
      args,
      promptText,
      workingDirectory,
      role.provider.timeoutMs,
    );

    const content = await fs.readFile(outputFile, "utf-8").catch(() => "");
    await fs.unlink(outputFile).catch(() => undefined);

    if (content.trim()) {
      return content.trim();
    }

    if (result.exitCode !== 0) {
      throw new Error(
        extractCodexCliFailureMessage(result.stdout, result.stderr, result.exitCode) ??
          `Codex CLI failed with exit code ${result.exitCode}.`,
      );
    }

    throw new Error(
      extractCodexCliFailureMessage(result.stdout, result.stderr, result.exitCode) ?? "Codex CLI returned no final message.",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown local CLI error.";

    if (/ENOENT|not recognized|not found/i.test(message)) {
      throw new Error(
        "Codex CLI could not be executed. Install @openai/codex or switch the preset to `command = npx` and `launcherArgs = -y @openai/codex`.",
      );
    }

    if (/EINVAL/i.test(message) && process.platform === "win32") {
      throw new Error(
        "The local CLI could not be spawned on Windows. Use a real executable or `.cmd` launcher such as `D:\\nodejs\\npx.cmd`, and make sure the working directory exists.",
      );
    }

    if (/EPERM|EACCES|Access is denied/i.test(message) && process.platform === "win32" && role.provider.command.trim() === "codex") {
      throw new Error(
        "The Windows Store `codex` app alias could not be spawned here. On Windows, switch the preset to `command = D:\\nodejs\\npx.cmd` and `launcherArgs = -y @openai/codex`.",
      );
    }

    throw error;
  }
}

function buildParticipantPromptPayload(
  room: DiscussionRoom,
  role: DiscussionRole,
  options: ParticipantGenerationOptions = {},
): TextPromptPayload {
  const replyCandidates = getReplyCandidates(room, 8, options.orderedReplyCandidateIds);
  const forceReplyCandidates = getForceReplyCandidates(room, role, options.allowedForceReplyRoleIds);
  return {
    system: buildParticipantSystemPrompt(
      room,
      role,
      replyCandidates,
      forceReplyCandidates,
      options.forcedReply,
      options.deliveryMode,
      options.selectionReason,
    ),
    user: buildParticipantUserPrompt(
      room,
      role,
      replyCandidates,
      forceReplyCandidates,
      options.forcedReply,
      options.deliveryMode,
      options.selectionReason,
    ),
  };
}

function buildRecorderPromptPayload(room: DiscussionRoom, role: DiscussionRole, finalMode: boolean): TextPromptPayload {
  return {
    system: buildRecorderSystemPrompt(room, role, finalMode),
    user: buildRecorderUserPrompt(room, finalMode),
    finalMode,
  };
}

export async function generateParticipantContent(
  room: DiscussionRoom,
  role: DiscussionRole,
  options: ParticipantGenerationOptions = {},
): Promise<ParticipantReply> {
  if (role.provider.type === "mock") {
    return applyForcedReplyConstraints(room, buildMockParticipantReply(room, role, options), options.forcedReply);
  }

  const prompt = buildParticipantPromptPayload(room, role, options);

  if (role.provider.type === "custom-http") {
    const result = await requestCustomHttp(room, role, prompt);
    const parsed = parseParticipantReply(result.content, room, role);
    if (parsed) {
      return applyForcedReplyConstraints(room, parsed, options.forcedReply);
    }

    const replyMeta = toReplyMetadata(room, result.replyToMessageId ?? null);
    return applyForcedReplyConstraints(
      room,
      {
        ...replyMeta,
        content: trimText(result.content),
        forceReplyRoleId: normalizeForceReplyTarget(room, role, result.forceReplyRoleId),
      },
      options.forcedReply,
    );
  }

  const raw =
    role.provider.type === "openai-compatible"
      ? await requestOpenAICompatible(role, prompt)
      : role.provider.type === "anthropic-compatible"
        ? await requestAnthropicCompatible(role, prompt)
      : await requestCodexCli(role, buildCodexPrompt(prompt.system, prompt.user));

  return applyForcedReplyConstraints(room, finalizeParticipantReply(raw, room, role), options.forcedReply);
}

export async function generateRecorderCheckpoint(room: DiscussionRoom, role: DiscussionRole): Promise<string> {
  if (role.provider.type === "mock") {
    return buildExpandedMockRecorderMessage(room, false);
  }

  const prompt = buildRecorderPromptPayload(room, role, false);
  const raw =
    role.provider.type === "custom-http"
      ? (await requestCustomHttp(room, role, prompt)).content
      : role.provider.type === "openai-compatible"
        ? await requestOpenAICompatible(role, prompt)
        : role.provider.type === "anthropic-compatible"
          ? await requestAnthropicCompatible(role, prompt)
        : await requestCodexCli(role, buildCodexPrompt(prompt.system, prompt.user));

  return trimText(raw, 900);
}

export async function generateRecorderFinal(room: DiscussionRoom, role: DiscussionRole): Promise<string> {
  if (role.provider.type === "mock") {
    return buildExpandedMockRecorderMessage(room, true);
  }

  const prompt = buildRecorderPromptPayload(room, role, true);
  const raw =
    role.provider.type === "custom-http"
      ? (await requestCustomHttp(room, role, prompt)).content
      : role.provider.type === "openai-compatible"
        ? await requestOpenAICompatible(role, prompt)
        : role.provider.type === "anthropic-compatible"
          ? await requestAnthropicCompatible(role, prompt)
        : await requestCodexCli(role, buildCodexPrompt(prompt.system, prompt.user));

  return trimText(raw, 1400);
}

export async function generateRecorderTopic(room: DiscussionRoom, role: DiscussionRole): Promise<string> {
  const prompt: TextPromptPayload = {
    system: buildRecorderTopicSystemPrompt(room, role),
    user: buildRecorderTopicUserPrompt(room),
  };

  if (role.provider.type === "mock") {
    throw new Error("Recorder provider is unavailable for AI topic generation.");
  }

  const raw =
    role.provider.type === "custom-http"
      ? (await requestCustomHttp(room, role, prompt)).content
      : role.provider.type === "openai-compatible"
        ? await requestOpenAICompatible(role, prompt)
        : role.provider.type === "anthropic-compatible"
          ? await requestAnthropicCompatible(role, prompt)
        : await requestCodexCli(role, buildCodexPrompt(prompt.system, prompt.user));

  return trimText(raw, 200);
}
