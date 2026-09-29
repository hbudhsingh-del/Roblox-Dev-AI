import { Router, type IRouter, type Request } from "express";
import { CreateChatCompletionBody } from "@workspace/api-zod";

const router: IRouter = Router();

const MAX_HISTORY_MESSAGES = 24;
const MAX_MESSAGE_CHARS = 12_000;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 25;
const requestLog = new Map<string, number[]>();

const SYSTEM_PROMPT = `You are Roblox Dev AI, an expert Roblox game development assistant.

Your specialty is Roblox Studio, Luau, Roblox APIs, game design, debugging, UI systems, gameplay mechanics, optimization, monetization, and multiplayer architecture. You know modern Roblox services and patterns including RemoteEvents, RemoteFunctions, ServerScriptService, ReplicatedStorage, StarterGui, StarterPlayer, Workspace, DataStoreService, MarketplaceService, Players, CollectionService, TweenService, UserInputService, ContextActionService, RunService, ProximityPrompt, ClickDetector, and Humanoid systems.

Answer clearly and professionally for beginners and experienced developers. Prefer Luau. When giving code:
- Give complete, working code whenever practical.
- Say exactly where each script belongs.
- List required Roblox objects and folders.
- Explain configuration values and IDs.
- Explain how to test inside Roblox Studio.
- Mention common mistakes and client/server security concerns.
- Keep server-authoritative logic on the server and validate all client-provided data.
- Never invent Roblox APIs, properties, or services.
- Never place secrets or sensitive server logic in LocalScripts.

For coding questions, use these sections when they help: What we're building, Where to put it, Setup, Code, How it works, Test it, Common problems. Keep simple answers concise and go deeper only when the question needs it.

Do not execute or claim to execute user-provided Roblox code. Do not generate copyrighted clones of existing games.`;

const MODE_PROMPTS = {
  chat: "",
  debugger: `The user is using Code Debugger mode. Analyze the pasted Luau for syntax errors, runtime problems, incorrect services or paths, client/server mistakes, RemoteEvent issues, infinite loops, nil references, incorrect properties, performance problems, and security issues. Structure the response as Problem, Why it happens, Fixed Code, Where to put it, and How to test.`,
  idea: `The user is using Game Idea Generator mode. Generate an original Roblox game concept, not a copyrighted clone. Include a game title, core gameplay loop, main mechanics, progression, ethical monetization ideas, map ideas, UI ideas, retention ideas, and development difficulty.`,
} as const;

function getClientKey(req: Request): string {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.length > 0) {
    return forwardedFor.split(",")[0].trim();
  }
  return req.ip ?? "unknown";
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const activeRequests = (requestLog.get(key) ?? []).filter(
    (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS,
  );

  if (activeRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
    requestLog.set(key, activeRequests);
    return true;
  }

  activeRequests.push(now);
  requestLog.set(key, activeRequests);
  return false;
}

function getGroqErrorMessage(status: number): string {
  if (status === 429) {
    return "The AI service is busy right now. Please wait a moment and try again.";
  }
  return "AI service is temporarily unavailable. Please try again.";
}

router.post("/chat", async (req, res) => {
  if (isRateLimited(getClientKey(req))) {
    res.status(429).json({
      error: "Too many requests. Please wait a few minutes and try again.",
    });
    return;
  }

  const parsed = CreateChatCompletionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Please provide a valid chat message." });
    return;
  }

  const { messages, mode = "chat", context } = parsed.data;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    req.log.warn("GROQ_API_KEY is not configured");
    res
      .status(503)
      .json({ error: "AI service is temporarily unavailable. Please try again." });
    return;
  }

  const boundedMessages = messages
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, MAX_MESSAGE_CHARS),
    }));
  const modeInstruction = MODE_PROMPTS[mode];
  const contextInstruction = context
    ? `\nAdditional user-provided context:\n${context.slice(0, 5000)}`
    : "";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        temperature: 0.35,
        max_tokens: 2_400,
        messages: [
          {
            role: "system",
            content: `${SYSTEM_PROMPT}\n\n${modeInstruction}${contextInstruction}`,
          },
          ...boundedMessages,
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      req.log.error({ status: response.status }, "Groq request returned an error");
      res.status(response.status === 429 ? 429 : 503).json({
        error: getGroqErrorMessage(response.status),
      });
      return;
    }

    const payload: unknown = await response.json();
    if (
      !payload ||
      typeof payload !== "object" ||
      !("choices" in payload) ||
      !Array.isArray(payload.choices) ||
      payload.choices.length === 0 ||
      !payload.choices[0] ||
      typeof payload.choices[0] !== "object" ||
      !("message" in payload.choices[0]) ||
      !payload.choices[0].message ||
      typeof payload.choices[0].message !== "object" ||
      !("content" in payload.choices[0].message) ||
      typeof payload.choices[0].message.content !== "string"
    ) {
      req.log.error("Groq returned an unexpected response");
      res
        .status(503)
        .json({ error: "AI service is temporarily unavailable. Please try again." });
      return;
    }

    const usage =
      "usage" in payload && payload.usage && typeof payload.usage === "object"
        ? payload.usage
        : undefined;
    const promptTokens =
      usage && "prompt_tokens" in usage && typeof usage.prompt_tokens === "number"
        ? usage.prompt_tokens
        : undefined;
    const completionTokens =
      usage &&
      "completion_tokens" in usage &&
      typeof usage.completion_tokens === "number"
        ? usage.completion_tokens
        : undefined;

    const model =
      "model" in payload && typeof payload.model === "string"
        ? payload.model
        : process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

    res.json({
      message: payload.choices[0].message.content,
      model,
      ...(promptTokens !== undefined && completionTokens !== undefined
        ? { usage: { promptTokens, completionTokens } }
        : {}),
    });
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";
    req.log.error({ err: error, isTimeout }, "Groq request failed");
    res
      .status(503)
      .json({ error: "AI service is temporarily unavailable. Please try again." });
  } finally {
    clearTimeout(timeout);
  }
});

export default router;