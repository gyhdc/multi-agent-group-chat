import assert from "node:assert/strict";
import test from "node:test";
import { createBlankRoom, createProviderConfig, normalizeRole } from "../src/defaults";
import { generateRecorderFinal } from "../src/providers";
import { DiscussionRoom, DiscussionRole, ProviderConfig } from "../src/types";

interface RecordedFetchCall {
  url: string;
  init?: RequestInit;
  jsonBody: Record<string, unknown> | null;
}

function createRecorder(
  providerOverrides: Partial<ProviderConfig> = {},
  providerType: ProviderConfig["type"] = "openai-compatible",
): { room: DiscussionRoom; role: DiscussionRole } {
  const room = createBlankRoom();
  room.discussionLanguage = "en-US";

  const provider: ProviderConfig = {
    ...createProviderConfig(providerType),
    ...providerOverrides,
    type: providerType,
  };

  const role = normalizeRole({
    name: "Recorder",
    kind: "recorder",
    roleTemplateKey: "recorder",
    providerPresetId: null,
    provider,
    accentColor: "#5b6475",
    persona: "Recorder persona",
    principles: "Recorder principles",
    goal: "Recorder goal",
    voiceStyle: "Recorder voice",
    enabled: true,
  });

  room.roles = [role];
  return { room, role };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function installFetchSequence(
  responses: Array<Response | ((url: string, init?: RequestInit, callIndex?: number) => Response | Promise<Response>)>,
): { calls: RecordedFetchCall[]; restore: () => void } {
  const originalFetch = globalThis.fetch;
  const calls: RecordedFetchCall[] = [];
  let callIndex = 0;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    let jsonBody: Record<string, unknown> | null = null;
    if (typeof init?.body === "string" && init.body.trim()) {
      try {
        jsonBody = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        jsonBody = null;
      }
    }

    calls.push({ url, init, jsonBody });

    const entry = responses[Math.min(callIndex, responses.length - 1)];
    const response =
      typeof entry === "function"
        ? await entry(url, init, callIndex)
        : entry;

    callIndex += 1;
    return response;
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

test("openai-compatible falls back from /v1/chat/completions to /chat/completions for prefix endpoints", async () => {
  const { room, role } = createRecorder({
    endpoint: "https://api.claudecode.net.cn/api/claudecode",
    model: "Claude Opus 4.6",
  });

  const { calls, restore } = installFetchSequence([
    jsonResponse({ error: { message: "Not found." } }, 404),
    jsonResponse({ choices: [{ message: { content: "Prefix route works." } }] }),
  ]);

  try {
    const content = await generateRecorderFinal(room, role);
    assert.equal(content, "Prefix route works.");
    assert.deepEqual(
      calls.map((call) => call.url),
      [
        "https://api.claudecode.net.cn/api/claudecode/v1/chat/completions",
        "https://api.claudecode.net.cn/api/claudecode/chat/completions",
      ],
    );
    assert.equal(calls[0].jsonBody?.model, "Claude Opus 4.6");
    assert.equal(calls[0].jsonBody?.stream, false);
    assert.ok(Array.isArray(calls[0].jsonBody?.messages));
  } finally {
    restore();
  }
});

test("openai-compatible also falls back when a provider misreports route mismatch as a 503 request error", async () => {
  const { room, role } = createRecorder({
    endpoint: "https://api.claudecode.net.cn/api/claudecode",
    model: "Claude Opus 4.6",
  });

  const { calls, restore } = installFetchSequence([
    jsonResponse(
      {
        error: {
          message:
            "你的请求无法被claudecode正确响应。此错误大概率为本地客户端发送错误请求导致，请先尝试双击esc回退几个历史会话后重试，或新开对话窗口。",
        },
      },
      503,
    ),
    jsonResponse({ choices: [{ message: { content: "503 fallback works." } }] }),
  ]);

  try {
    const content = await generateRecorderFinal(room, role);
    assert.equal(content, "503 fallback works.");
    assert.deepEqual(
      calls.map((call) => call.url),
      [
        "https://api.claudecode.net.cn/api/claudecode/v1/chat/completions",
        "https://api.claudecode.net.cn/api/claudecode/chat/completions",
      ],
    );
  } finally {
    restore();
  }
});

test("openai-compatible switches from chat/completions to responses on schema mismatch", async () => {
  const { room, role } = createRecorder({
    endpoint: "https://example.com/proxy/v1",
    model: "gpt-4.1-mini",
  });

  const { calls, restore } = installFetchSequence([
    jsonResponse({ error: { message: "Unknown field: messages. Use input instead." } }, 400),
    jsonResponse({ output_text: "Responses route works." }),
  ]);

  try {
    const content = await generateRecorderFinal(room, role);
    assert.equal(content, "Responses route works.");
    assert.deepEqual(
      calls.map((call) => call.url),
      [
        "https://example.com/proxy/v1/chat/completions",
        "https://example.com/proxy/v1/responses",
      ],
    );
    assert.ok(Array.isArray(calls[0].jsonBody?.messages));
    assert.equal(typeof calls[1].jsonBody?.input, "string");
    assert.equal(typeof calls[1].jsonBody?.instructions, "string");
  } finally {
    restore();
  }
});

test("openai-compatible retries the same route without optional params when the provider rejects them", async () => {
  const { room, role } = createRecorder({
    endpoint: "https://example.com/v1/chat/completions",
    model: "gpt-4.1-mini",
    temperature: 0.4,
    maxTokens: 512,
  });

  const { calls, restore } = installFetchSequence([
    jsonResponse({ error: { message: "Unsupported parameter: temperature." } }, 400),
    jsonResponse({ choices: [{ message: { content: "Retried without optional params." } }] }),
  ]);

  try {
    const content = await generateRecorderFinal(room, role);
    assert.equal(content, "Retried without optional params.");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://example.com/v1/chat/completions");
    assert.equal(calls[1].url, "https://example.com/v1/chat/completions");
    assert.equal(calls[0].jsonBody?.temperature, 0.4);
    assert.equal(calls[0].jsonBody?.max_tokens, 512);
    assert.equal(Object.hasOwn(calls[1].jsonBody ?? {}, "temperature"), false);
    assert.equal(Object.hasOwn(calls[1].jsonBody ?? {}, "max_tokens"), false);
  } finally {
    restore();
  }
});

test("openai-compatible parses content-part arrays and nested responses output", async () => {
  {
    const { room, role } = createRecorder({
      endpoint: "https://example.com/v1/chat/completions",
      model: "gpt-4.1-mini",
    });
    const { restore } = installFetchSequence([
      jsonResponse({ choices: [{ message: { content: [{ type: "text", text: "Array payload works." }] } }] }),
    ]);

    try {
      const content = await generateRecorderFinal(room, role);
      assert.equal(content, "Array payload works.");
    } finally {
      restore();
    }
  }

  {
    const { room, role } = createRecorder({
      endpoint: "https://example.com/v1/responses",
      model: "gpt-4.1-mini",
    });
    const { restore } = installFetchSequence([
      jsonResponse({ output: [{ content: [{ type: "output_text", text: "Nested response payload works." }] }] }),
    ]);

    try {
      const content = await generateRecorderFinal(room, role);
      assert.equal(content, "Nested response payload works.");
    } finally {
      restore();
    }
  }
});

test("openai-compatible aggregates text/event-stream payloads into a final message", async () => {
  const { room, role } = createRecorder({
    endpoint: "https://example.com/v1/chat/completions",
    model: "gpt-4.1-mini",
  });

  const { restore } = installFetchSequence([
    new Response('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: {"choices":[{"delta":{"content":" world"}}]}\n\ndata: [DONE]\n\n', {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
      },
    }),
  ]);

  try {
    const content = await generateRecorderFinal(room, role);
    assert.equal(content, "Hello world");
  } finally {
    restore();
  }
});

test("openai-compatible stops immediately on authentication errors and keeps the attempted URL in the message", async () => {
  const { room, role } = createRecorder({
    endpoint: "https://api.claudecode.net.cn/api/claudecode",
    model: "Claude Opus 4.6",
  });

  const { calls, restore } = installFetchSequence([
    jsonResponse({ error: { message: "Invalid API key.", type: "invalid_request_error", code: "invalid_api_key" } }, 401),
  ]);

  try {
    await assert.rejects(
      () => generateRecorderFinal(room, role),
      /https:\/\/api\.claudecode\.net\.cn\/api\/claudecode\/v1\/chat\/completions.*HTTP 401.*Invalid API key/i,
    );
    assert.equal(calls.length, 1);
  } finally {
    restore();
  }
});

test("openai-compatible reports empty content when a successful response body cannot be parsed into text", async () => {
  const { room, role } = createRecorder({
    endpoint: "https://example.com/v1/chat/completions",
    model: "gpt-4.1-mini",
  });

  const { restore } = installFetchSequence([
    jsonResponse({ choices: [{ message: { content: [] } }] }),
  ]);

  try {
    await assert.rejects(
      () => generateRecorderFinal(room, role),
      /empty content.*https:\/\/example\.com\/v1\/chat\/completions/i,
    );
  } finally {
    restore();
  }
});

test("openai-compatible reports HTML success responses as wrong endpoints instead of empty content", async () => {
  const { room, role } = createRecorder({
    endpoint: "https://example.com/chat/completions",
    model: "gpt-4.1-mini",
  });

  const { restore } = installFetchSequence([
    new Response("<!doctype html><html><head><title>New API</title></head><body>hello</body></html>", {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    }),
  ]);

  try {
    await assert.rejects(
      () => generateRecorderFinal(room, role),
      /returned an HTML page instead of JSON/i,
    );
  } finally {
    restore();
  }
});

test("anthropic-compatible falls back from /v1/messages to /messages for prefix endpoints", async () => {
  const { room, role } = createRecorder(
    {
      endpoint: "https://gateway.example/claude",
      model: "claude-3-7-sonnet-latest",
    },
    "anthropic-compatible",
  );

  const { calls, restore } = installFetchSequence([
    jsonResponse({ error: { message: "Request path not found." } }, 404),
    jsonResponse({ content: [{ type: "text", text: "Anthropic fallback works." }] }),
  ]);

  try {
    const content = await generateRecorderFinal(room, role);
    assert.equal(content, "Anthropic fallback works.");
    assert.deepEqual(
      calls.map((call) => call.url),
      ["https://gateway.example/claude/v1/messages", "https://gateway.example/claude/messages"],
    );
    assert.equal(calls[0].jsonBody?.model, "claude-3-7-sonnet-latest");
    assert.equal(typeof calls[0].jsonBody?.system, "string");
    assert.ok(Array.isArray(calls[0].jsonBody?.messages));
    const headers = new Headers(calls[0].init?.headers);
    assert.equal(headers.get("anthropic-version"), "2023-06-01");
    assert.ok(headers.get("x-api-key") === "" || headers.get("x-api-key") === null);
  } finally {
    restore();
  }
});

test("anthropic-compatible retries without temperature when the provider rejects it", async () => {
  const { room, role } = createRecorder(
    {
      endpoint: "https://api.anthropic.com",
      model: "claude-3-7-sonnet-latest",
      apiKey: "sk-ant-test",
      temperature: 0.2,
      maxTokens: 64,
    },
    "anthropic-compatible",
  );

  const { calls, restore } = installFetchSequence([
    jsonResponse({ error: { message: "Unsupported parameter: temperature" } }, 400),
    jsonResponse({ content: [{ type: "text", text: "Retried without temperature." }] }),
  ]);

  try {
    const content = await generateRecorderFinal(room, role);
    assert.equal(content, "Retried without temperature.");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
    assert.equal(calls[1].url, "https://api.anthropic.com/v1/messages");
    assert.equal(calls[0].jsonBody?.temperature, 0.2);
    assert.equal(Object.hasOwn(calls[1].jsonBody ?? {}, "temperature"), false);
    const headers = new Headers(calls[0].init?.headers);
    assert.equal(headers.get("x-api-key"), "sk-ant-test");
    assert.equal(headers.get("authorization"), "Bearer sk-ant-test");
  } finally {
    restore();
  }
});

test("anthropic-compatible reports HTML success responses as wrong endpoints", async () => {
  const { room, role } = createRecorder(
    {
      endpoint: "https://api.aicodemirror.com/api/claudecode",
      model: "claude-3-7-sonnet-latest",
    },
    "anthropic-compatible",
  );

  const { restore } = installFetchSequence([
    jsonResponse({ error: { message: "你的请求无法被claudecode正确响应。此错误大概率为本地客户端发送错误请求导致。" } }, 503),
    new Response("<!doctype html><html><head><title>New API</title></head><body>hello</body></html>", {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    }),
  ]);

  try {
    await assert.rejects(
      () => generateRecorderFinal(room, role),
      /returned an HTML page instead of JSON/i,
    );
  } finally {
    restore();
  }
});
