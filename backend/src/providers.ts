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
}

interface ForceReplyCandidate {
  id: string;
  roleName: string;
  goal: string;
}

function trimText(content: string, maxLength = 360): string {
  const normalized = content.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3).trim()}...`;
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

function getReplyCandidates(room: DiscussionRoom, limit = 8): ReplyCandidate[] {
  return room.messages
    .filter((message) => message.kind !== "system")
    .slice(-limit)
    .map((message) => ({
      id: message.id,
      roleId: message.roleId,
      roleName: message.roleName,
      excerpt: trimText(message.content, 110),
      kind: message.kind,
    }));
}

function getForceReplyCandidates(room: DiscussionRoom, role: DiscussionRole): ForceReplyCandidate[] {
  return getParticipants(room)
    .filter((participant) => participant.id !== role.id)
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

  const latestUser = [...room.messages].reverse().find((message) => message.kind === "user");
  if (latestUser) {
    return toReplyMetadata(room, latestUser.id);
  }

  const latestParticipant = [...room.messages].reverse().find((message) => message.kind === "participant");
  return toReplyMetadata(room, latestParticipant?.id ?? null);
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

function buildParticipantSystemPrompt(
  room: DiscussionRoom,
  role: DiscussionRole,
  replyCandidates: ReplyCandidate[],
  forceReplyCandidates: ForceReplyCandidate[],
  forcedReply?: PendingRequiredReply | null,
  selectionReason?: string,
): string {
  const template = getRoleTemplateProfile(role.roleTemplateKey);
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
  selectionReason?: string,
): string {
  const recentMessages = getRecentMessages(room, 12)
    .map((message) => `${message.roleName}: ${message.content}`)
    .join("\n");
  const recentInsights = getRecentInsights(room, 4)
    .map((insight) => `${insight.title}: ${insight.content}`)
    .join("\n");
  const latestUser = [...room.messages].reverse().find((message) => message.kind === "user");
  const replyCandidateLines = replyCandidates.length
    ? replyCandidates.map((candidate) => `${candidate.id} | ${candidate.roleName} | ${candidate.excerpt}`).join("\n")
    : "No reply candidates.";
  const forceReplyCandidateLines = forceReplyCandidates.length
    ? forceReplyCandidates.map((candidate) => `${candidate.id} | ${candidate.roleName} | ${candidate.goal}`).join("\n")
    : "No force-reply candidates.";
  const forcedTargetMessage = forcedReply ? findMessage(room, forcedReply.sourceMessageId) : null;

  return [
    `Discussion language: ${getOutputLanguageLabel(room.discussionLanguage)}`,
    `Discussion topic:\n${room.topic}`,
    `Decision objective:\n${room.objective}`,
    `Current round: ${room.state.currentRound}`,
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
  const template = getRoleTemplateProfile(role.roleTemplateKey);
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
    "- Keep it concise but genuinely insightful.",
    "- Do not use markdown bullets.",
  ].join("\n");
}

function buildRecorderUserPrompt(room: DiscussionRoom, finalMode: boolean): string {
  const recentMessages = getRecentMessages(room, 16)
    .filter((message) => message.kind === "participant" || message.kind === "user")
    .map((message) => `${message.roleName}: ${message.content}`)
    .join("\n");
  const latestUser = [...room.messages].reverse().find((message) => message.kind === "user");

  return [
    `Discussion language: ${getOutputLanguageLabel(room.discussionLanguage)}`,
    `Discussion topic:\n${room.topic}`,
    `Decision objective:\n${room.objective}`,
    `Current round: ${room.state.currentRound}`,
    formatResearchContext(room),
    formatDocumentContext(room),
    latestUser ? `Latest user evidence:\n${latestUser.content}` : "Latest user evidence:\nNone.",
    recentMessages ? `Recent discussion messages:\n${recentMessages}` : "Recent discussion messages:\nNone yet.",
    finalMode ? "Produce the final conclusion." : "Produce a checkpoint note.",
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
  const template = getRoleTemplateProfile(role.roleTemplateKey);
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

async function requestOpenAICompatible(role: DiscussionRole, payload: TextPromptPayload): Promise<string> {
  const base = role.provider.endpoint.trim().replace(/\/+$/, "");
  const url = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(role.provider.apiKey ? { Authorization: `Bearer ${role.provider.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: role.provider.model,
      temperature: role.provider.temperature,
      max_tokens: role.provider.maxTokens,
      messages: [
        { role: "system", content: payload.system },
        { role: "user", content: payload.user },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI-compatible provider error: ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("OpenAI-compatible provider returned empty content.");
  }
  return content;
}

async function requestCustomHttp(
  room: DiscussionRoom,
  role: DiscussionRole,
  payload: TextPromptPayload,
): Promise<{ content: string; replyToMessageId?: string | null; forceReplyRoleId?: string | null }> {
  const response = await fetch(role.provider.endpoint, {
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
  });

  if (!response.ok) {
    throw new Error(`Custom HTTP provider error: ${response.status}`);
  }

  const data = (await response.json()) as {
    content?: string;
    message?: string;
    output?: string;
    replyToMessageId?: string | null;
    forceReplyRoleId?: string | null;
  };
  const content = data.content ?? data.message ?? data.output;
  if (!content?.trim()) {
    throw new Error("Custom HTTP provider returned empty content.");
  }
  return {
    content,
    replyToMessageId: data.replyToMessageId ?? null,
    forceReplyRoleId: data.forceReplyRoleId ?? null,
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
      throw new Error(`Codex CLI failed with exit code ${result.exitCode}.`);
    }

    throw new Error("Codex CLI returned no final message.");
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
  const replyCandidates = getReplyCandidates(room);
  const forceReplyCandidates = getForceReplyCandidates(room, role);
  return {
    system: buildParticipantSystemPrompt(
      room,
      role,
      replyCandidates,
      forceReplyCandidates,
      options.forcedReply,
      options.selectionReason,
    ),
    user: buildParticipantUserPrompt(room, role, replyCandidates, forceReplyCandidates, options.forcedReply, options.selectionReason),
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
      : await requestCodexCli(role, buildCodexPrompt(prompt.system, prompt.user));

  return applyForcedReplyConstraints(room, finalizeParticipantReply(raw, room, role), options.forcedReply);
}

export async function generateRecorderCheckpoint(room: DiscussionRoom, role: DiscussionRole): Promise<string> {
  if (role.provider.type === "mock") {
    return buildMockRecorderMessage(room, false);
  }

  const prompt = buildRecorderPromptPayload(room, role, false);
  const raw =
    role.provider.type === "custom-http"
      ? (await requestCustomHttp(room, role, prompt)).content
      : role.provider.type === "openai-compatible"
        ? await requestOpenAICompatible(role, prompt)
        : await requestCodexCli(role, buildCodexPrompt(prompt.system, prompt.user));

  return trimText(raw, 420);
}

export async function generateRecorderFinal(room: DiscussionRoom, role: DiscussionRole): Promise<string> {
  if (role.provider.type === "mock") {
    return buildMockRecorderMessage(room, true);
  }

  const prompt = buildRecorderPromptPayload(room, role, true);
  const raw =
    role.provider.type === "custom-http"
      ? (await requestCustomHttp(room, role, prompt)).content
      : role.provider.type === "openai-compatible"
        ? await requestOpenAICompatible(role, prompt)
        : await requestCodexCli(role, buildCodexPrompt(prompt.system, prompt.user));

  return trimText(raw, 480);
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
        : await requestCodexCli(role, buildCodexPrompt(prompt.system, prompt.user));

  return trimText(raw, 200);
}
