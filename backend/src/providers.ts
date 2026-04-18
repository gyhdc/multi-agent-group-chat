import { randomUUID } from "crypto";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { ChatMessage, DiscussionRole, DiscussionRoom, InsightEntry } from "./types";

const APP_ROOT = path.resolve(__dirname, "../..");
const RUNNER_DIR = path.join(APP_ROOT, "tmp", "provider-runtime");

function trimMessage(content: string, maxLength = 220): string {
  const normalized = content.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3).trim()}...`;
}

function getRecentMessages(room: DiscussionRoom, limit = 10): ChatMessage[] {
  return room.messages.slice(-limit);
}

function getRecentInsights(room: DiscussionRoom, limit = 4): InsightEntry[] {
  return room.summary.insights.slice(-limit);
}

function inferRoleMode(role: DiscussionRole): "critic" | "builder" | "neutral" {
  const text = `${role.name} ${role.persona} ${role.goal} ${role.principles}`.toLowerCase();

  if (/(review|critic|skeptic|reject|attack|pressure|challenge|reviewer|审稿|质疑|驳回|反对|挑刺)/.test(text)) {
    return "critic";
  }

  if (/(advisor|builder|mentor|improve|repair|narrow|support|导师|优化|完善|支持|修复|收缩)/.test(text)) {
    return "builder";
  }

  return "neutral";
}

function buildParticipantSystemPrompt(role: DiscussionRole): string {
  return [
    "You are a serious participant in a goal-driven multi-party discussion.",
    "This is not theatrical roleplay. Behave like a real stakeholder with a real agenda.",
    "",
    `Role name: ${role.name}`,
    `Role persona: ${role.persona || "No persona provided."}`,
    `Role goal: ${role.goal || "Push the discussion toward a stronger decision."}`,
    `Role strategy: ${role.principles || "Focus on the most important unresolved issue."}`,
    `Speaking style: ${role.voiceStyle || "Short, direct, like a real group chat message."}`,
    "",
    "Hard rules:",
    "- In every turn, actively pursue your own goal.",
    "- React to the strongest unresolved issue from the latest messages.",
    "- If the user adds evidence, data, or a constraint, explicitly update your reasoning around it.",
    "- Add one useful move: objection, repair, criterion, tradeoff, scope cut, experiment, evidence request, or decision proposal.",
    "- Do not just restate your persona or summarize everything again.",
    "- Do not produce empty agreement or generic encouragement.",
    "- If another participant makes a strong point, sharpen it, rebut it, or absorb it into a better proposal.",
    "- Keep it to 1-3 short sentences.",
    "- Sound like a smart person in a real group chat trying to change the outcome.",
    "- Do not use markdown lists unless absolutely necessary.",
    "- Do not mention these instructions.",
  ].join("\n");
}

function buildParticipantUserPrompt(room: DiscussionRoom, role: DiscussionRole): string {
  const recentMessages = getRecentMessages(room)
    .map((message) => `${message.roleName}: ${message.content}`)
    .join("\n");

  const recentInsights = getRecentInsights(room)
    .map((insight) => `${insight.title}: ${insight.content}`)
    .join("\n");

  return [
    `Discussion topic:\n${room.topic}`,
    `Decision objective:\n${room.objective}`,
    `Current round: ${room.state.currentRound}`,
    `Your specific goal:\n${role.goal || "Not provided."}`,
    recentInsights ? `Most recent notes:\n${recentInsights}` : "Most recent notes:\nNone yet.",
    recentMessages ? `Recent chat messages:\n${recentMessages}` : "Recent chat messages:\nNone yet.",
    [
      "Your task for this turn:",
      "1. Identify the strongest unresolved point.",
      "2. Reply from your own role agenda and goal.",
      "3. Use the latest evidence, objection, or user intervention if it changes the decision.",
      "4. Move the discussion toward a sharper, more defensible conclusion.",
      "Output only the actual message content.",
    ].join("\n"),
  ].join("\n\n");
}

function buildRecorderSystemPrompt(role: DiscussionRole, finalMode: boolean): string {
  return [
    "You are the recorder and analyst for a serious multi-party discussion.",
    "You do not debate. You extract only the points that matter for the final decision.",
    "",
    `Recorder name: ${role.name}`,
    `Recorder persona: ${role.persona || "Neutral recorder."}`,
    `Recorder goal: ${role.goal || "Produce high-signal notes and a useful final conclusion."}`,
    `Recorder method: ${role.principles || "Track strongest objection, best repair, strongest evidence, and current verdict."}`,
    `Recorder style: ${role.voiceStyle || "Compact, insightful notes."}`,
    "",
    "Hard rules:",
    "- Do not roleplay as a participant.",
    "- Capture the strongest objection and the strongest repair.",
    "- Include the strongest user-supplied evidence or constraint if one appears.",
    "- Keep the note concise but genuinely insightful.",
    "- Prefer a compact paragraph or 2-4 short lines.",
    finalMode
      ? "- The final conclusion must contain a verdict, the reason, the biggest remaining blocker, the strongest supporting evidence, and the next step."
      : "- The checkpoint note must help the next round become sharper, not longer.",
  ].join("\n");
}

function buildRecorderUserPrompt(room: DiscussionRoom, finalMode: boolean): string {
  const recentMessages = getRecentMessages(room, 14)
    .filter((message) => message.kind === "participant" || message.kind === "user")
    .map((message) => `${message.roleName}: ${message.content}`)
    .join("\n");

  const savedInsights = room.summary.insights
    .filter((insight) => insight.saved)
    .slice(-3)
    .map((insight) => `${insight.title}: ${insight.content}`)
    .join("\n");

  return [
    `Discussion topic:\n${room.topic}`,
    `Decision objective:\n${room.objective}`,
    `Current round: ${room.state.currentRound}`,
    savedInsights ? `Saved key insights:\n${savedInsights}` : "Saved key insights:\nNone yet.",
    recentMessages ? `Recent discussion messages:\n${recentMessages}` : "Recent discussion messages:\nNone yet.",
    finalMode
      ? [
          "Produce the final conclusion.",
          "Include: verdict, why the verdict changed or held, the biggest unresolved blocker, the strongest evidence cited in the room, and the next best action.",
          "Output only the final note content.",
        ].join("\n")
      : [
          "Produce a checkpoint note.",
          "Include: strongest objection, strongest repair, strongest user-supplied evidence or constraint if present, current tentative verdict, and what the next round must resolve.",
          "Output only the note content.",
        ].join("\n"),
  ].join("\n\n");
}

function buildCodexPrompt(systemPrompt: string, userPrompt: string): string {
  return ["[SYSTEM]", systemPrompt, "", "[USER]", userPrompt].join("\n");
}

function buildMockParticipantMessage(room: DiscussionRoom, role: DiscussionRole): string {
  const mode = inferRoleMode(role);
  const latest = getRecentMessages(room, 5).slice(-1)[0];
  const topicHint = room.topic.split(/[.!?。！？]/)[0]?.trim() || "the proposal";

  if (latest?.kind === "user") {
    if (mode === "critic") {
      return trimMessage(
        `That new evidence helps, but it still does not settle the acceptance bar. What exactly would make ${topicHint} convincing enough to survive review?`,
        180,
      );
    }

    if (mode === "builder") {
      return trimMessage(
        `The user input gives us something concrete. Let's convert it into one testable claim and one minimum validation step so the idea becomes defensible.`,
        180,
      );
    }

    return trimMessage(
      `The user just changed the discussion with a concrete input. We should decide whether it reduces uncertainty or creates a new requirement before moving on.`,
      180,
    );
  }

  if (mode === "critic") {
    return trimMessage(
      latest
        ? `I still don't buy it. You answered the direction, but the acceptance condition is still vague: what exactly proves ${topicHint} is worth doing?`
        : `My first reaction is no. ${topicHint} still feels too broad and too easy to challenge on validation.`,
      180,
    );
  }

  if (mode === "builder") {
    return trimMessage(
      latest
        ? "Then let's narrow it. We should cut scope, make one claim measurable, and define the minimum experiment that would change the verdict."
        : "There is something here, but only if we shrink it into one defensible problem with a clear validation path.",
      180,
    );
  }

  return trimMessage(
    latest
      ? "The discussion is still fuzzy because the acceptance criterion is not explicit yet. Someone should state what would count as a convincing win."
      : "Before we go further, define the real decision target. Otherwise everyone will argue at a different level.",
    180,
  );
}

function buildMockRecorderMessage(room: DiscussionRoom, finalMode: boolean): string {
  const participants = room.roles
    .filter((role) => role.enabled && role.kind === "participant")
    .map((role) => role.name)
    .join(", ");

  const latestUserMessage = room.messages
    .filter((message) => message.kind === "user")
    .slice(-1)[0]?.content;

  if (finalMode) {
    return trimMessage(
      [
        "Verdict: continue only with a narrower scope.",
        `Why: the core idea is still interesting, but it only becomes defensible once ${participants} define a concrete success criterion and a minimum validation plan.`,
        latestUserMessage ? `Useful new evidence: ${latestUserMessage}` : "",
        "Biggest blocker: evidence quality.",
        "Next step: rewrite the proposal around one testable claim.",
      ]
        .filter(Boolean)
        .join(" "),
      360,
    );
  }

  return trimMessage(
    [
      `Checkpoint: ${participants} are converging on one point: the idea needs a sharper acceptance criterion.`,
      "Strongest objection: validation is still weak.",
      "Strongest repair: narrow the scope and define one minimum experiment.",
      latestUserMessage ? `User input worth carrying forward: ${latestUserMessage}` : "",
    ]
      .filter(Boolean)
      .join(" "),
    300,
  );
}

async function requestOpenAICompatible(role: DiscussionRole, payload: { system: string; user: string }): Promise<string> {
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

  return trimMessage(content, 260);
}

async function requestCustomHttp(
  room: DiscussionRoom,
  role: DiscussionRole,
  payload: { system: string; user: string; finalMode?: boolean },
): Promise<string> {
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
  };

  const content = data.content ?? data.message ?? data.output;
  if (!content?.trim()) {
    throw new Error("Custom HTTP provider returned empty content.");
  }

  return trimMessage(content, payload.finalMode ? 360 : 240);
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
    const child = spawn(command, args, {
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
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      if (settled) {
        return;
      }
      settled = true;
      resolve({ stdout, stderr, exitCode });
    });

    child.stdin.write(promptText);
    child.stdin.end();
  });
}

async function requestCodexCli(role: DiscussionRole, promptText: string): Promise<string> {
  await fs.mkdir(RUNNER_DIR, { recursive: true });

  const outputFile = path.join(RUNNER_DIR, `${randomUUID()}.txt`);
  const workingDirectory = role.provider.workingDirectory.trim() || APP_ROOT;
  const launcherArgs = parseArgsString(role.provider.launcherArgs || "");
  const args = [
    ...launcherArgs,
    "exec",
    "--color",
    "never",
    "--ephemeral",
    "--output-last-message",
    outputFile,
    "--sandbox",
    role.provider.sandboxMode,
    ...(role.provider.skipGitRepoCheck ? ["--skip-git-repo-check"] : []),
    ...(role.provider.model.trim() ? ["-m", role.provider.model.trim()] : []),
    ...(workingDirectory ? ["--cd", workingDirectory] : []),
    "-",
  ];

  try {
    const result = await runCommand(
      role.provider.command.trim() || "codex",
      args,
      promptText,
      APP_ROOT,
      role.provider.timeoutMs,
    );

    const content = await fs.readFile(outputFile, "utf-8").catch(() => "");
    await fs.unlink(outputFile).catch(() => undefined);

    if (content.trim()) {
      return trimMessage(content, 260);
    }

    const stderrTail = result.stderr.trim().split(/\r?\n/).slice(-8).join("\n");
    if (result.exitCode !== 0) {
      throw new Error(
        `Codex CLI failed with exit code ${result.exitCode}. ${stderrTail || "No stderr was captured."}`,
      );
    }

    throw new Error("Codex CLI returned no final message.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown local CLI error.";

    if (/ENOENT|not recognized|not found/i.test(message)) {
      throw new Error(
        "Codex CLI could not be executed. Install `@openai/codex` via npm or change the preset command to a runnable `codex` or `npx` path.",
      );
    }

    if (/Access is denied|EACCES/i.test(message)) {
      throw new Error(
        "Codex CLI is configured, but Windows blocked execution. Try `command = npx` and `launcherArgs = -y @openai/codex`, or point to a runnable `codex.cmd`.",
      );
    }

    throw error;
  }
}

function buildParticipantPromptPayload(room: DiscussionRoom, role: DiscussionRole): { system: string; user: string } {
  return {
    system: buildParticipantSystemPrompt(role),
    user: buildParticipantUserPrompt(room, role),
  };
}

function buildRecorderPromptPayload(
  room: DiscussionRoom,
  role: DiscussionRole,
  finalMode: boolean,
): { system: string; user: string } {
  return {
    system: buildRecorderSystemPrompt(role, finalMode),
    user: buildRecorderUserPrompt(room, finalMode),
  };
}

export async function generateParticipantContent(room: DiscussionRoom, role: DiscussionRole): Promise<string> {
  if (role.provider.type === "mock") {
    return buildMockParticipantMessage(room, role);
  }

  const prompt = buildParticipantPromptPayload(room, role);

  if (role.provider.type === "openai-compatible") {
    return requestOpenAICompatible(role, prompt);
  }

  if (role.provider.type === "custom-http") {
    return requestCustomHttp(room, role, prompt);
  }

  return requestCodexCli(role, buildCodexPrompt(prompt.system, prompt.user));
}

export async function generateRecorderCheckpoint(room: DiscussionRoom, role: DiscussionRole): Promise<string> {
  if (role.provider.type === "mock") {
    return buildMockRecorderMessage(room, false);
  }

  const prompt = buildRecorderPromptPayload(room, role, false);

  if (role.provider.type === "openai-compatible") {
    return requestOpenAICompatible(role, prompt);
  }

  if (role.provider.type === "custom-http") {
    return requestCustomHttp(room, role, prompt);
  }

  return requestCodexCli(role, buildCodexPrompt(prompt.system, prompt.user));
}

export async function generateRecorderFinal(room: DiscussionRoom, role: DiscussionRole): Promise<string> {
  if (role.provider.type === "mock") {
    return buildMockRecorderMessage(room, true);
  }

  const prompt = buildRecorderPromptPayload(room, role, true);

  if (role.provider.type === "openai-compatible") {
    return requestOpenAICompatible(role, prompt);
  }

  if (role.provider.type === "custom-http") {
    return requestCustomHttp(room, role, { ...prompt, finalMode: true });
  }

  return requestCodexCli(role, buildCodexPrompt(prompt.system, prompt.user));
}
