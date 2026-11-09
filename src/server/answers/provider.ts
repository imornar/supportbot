import "server-only";

import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from "openai";

import type { ChatMessage } from "@/server/answers/prompt";

export const chatModel = "gpt-4.1-mini";
export const maxChatRetries = 2;
export const defaultChatTimeoutMs = 10_000;
export const minChatTimeoutMs = 1_000;
export const maxChatTimeoutMs = 30_000;
const maxCompletionTokens = 800;
const backoffBaseMs = 200;
const backoffCapMs = 2_000;
const placeholderKeys = new Set(["", "replace-me"]);

const timeoutError =
  "Invalid chat configuration: SUPPORTPILOT_AI_REQUEST_TIMEOUT_MS must be an integer from 1000 to 30000. Values are omitted.";

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type ChatCompletionResult = {
  model: string;
  content: string | null;
  usage: TokenUsage;
};

export type ChatProvider = {
  readonly model: string;
  complete(request: {
    messages: readonly ChatMessage[];
  }): Promise<ChatCompletionResult>;
};

export class ChatProviderError extends Error {
  readonly code: "not_configured" | "timeout" | "provider_failed";
  readonly retryable: boolean;

  constructor(code: ChatProviderError["code"], retryable: boolean) {
    super("Chat completion failed. Values are omitted.");
    this.name = "ChatProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function parseChatTimeoutMs(
  source: Record<string, string | undefined>,
): number {
  const value = source.SUPPORTPILOT_AI_REQUEST_TIMEOUT_MS;
  if (value === undefined || value.trim() === "") {
    return defaultChatTimeoutMs;
  }
  if (!/^[1-9]\d*$/.test(value.trim())) {
    throw new Error(timeoutError);
  }
  const timeout = Number(value.trim());
  if (timeout < minChatTimeoutMs || timeout > maxChatTimeoutMs) {
    throw new Error(timeoutError);
  }
  return timeout;
}

export function chatBackoffMs(
  retryIndex: number,
  random: () => number,
): number {
  const jitter = Math.floor(random() * 100);
  return Math.min(backoffCapMs, backoffBaseMs * 2 ** retryIndex + jitter);
}

export async function runBoundedAttempts<T>(
  attempt: () => Promise<T>,
  options: {
    maxRetries: number;
    isRetryable: (error: unknown) => boolean;
    sleep: (ms: number) => Promise<void>;
    backoffMs: (retryIndex: number) => number;
  },
): Promise<T> {
  let retries = 0;
  while (true) {
    try {
      return await attempt();
    } catch (error) {
      if (retries >= options.maxRetries || !options.isRetryable(error)) {
        throw error;
      }
      await options.sleep(options.backoffMs(retries));
      retries += 1;
    }
  }
}

export function chatCredentialsConfigured(
  env: Record<string, string | undefined>,
): boolean {
  const key = env.OPENAI_API_KEY?.trim() ?? "";
  return !placeholderKeys.has(key);
}

export function createChatProvider(
  env: Record<string, string | undefined>,
): ChatProvider {
  const timeoutMs = parseChatTimeoutMs(env);
  const key = env.OPENAI_API_KEY?.trim() ?? "";
  if (placeholderKeys.has(key)) {
    return unavailableChatProvider();
  }
  return openAiChatProvider({ apiKey: key, timeoutMs });
}

export function unavailableChatProvider(): ChatProvider {
  return {
    model: chatModel,
    async complete() {
      throw new ChatProviderError("not_configured", false);
    },
  };
}

type FetchImplementation = typeof fetch;

export function openAiChatProvider(options: {
  apiKey: string;
  timeoutMs: number;
  fetch?: FetchImplementation;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}): ChatProvider {
  const client = new OpenAI({
    apiKey: options.apiKey,
    timeout: options.timeoutMs,
    maxRetries: 0,
    fetch: options.fetch,
  });
  const sleep = options.sleep ?? delay;
  const random = options.random ?? Math.random;

  return {
    model: chatModel,
    async complete(request) {
      return runBoundedAttempts(
        () => completeOnce(client, options.timeoutMs, request.messages),
        {
          maxRetries: maxChatRetries,
          isRetryable: (error) =>
            error instanceof ChatProviderError && error.retryable,
          sleep,
          backoffMs: (retryIndex) => chatBackoffMs(retryIndex, random),
        },
      );
    },
  };
}

const groundedAnswerJsonSchema = {
  name: "grounded_answer",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      answer: { type: "string" },
      citations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            chunkId: { type: "string" },
          },
          required: ["chunkId"],
        },
      },
      abstained: { type: "boolean" },
      conflict: { type: "boolean" },
    },
    required: ["answer", "citations", "abstained", "conflict"],
  },
} as const;

async function completeOnce(
  client: OpenAI,
  timeoutMs: number,
  messages: readonly ChatMessage[],
): Promise<ChatCompletionResult> {
  try {
    const response = await client.chat.completions.create(
      {
        model: chatModel,
        temperature: 0,
        max_completion_tokens: maxCompletionTokens,
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        response_format: {
          type: "json_schema",
          json_schema: groundedAnswerJsonSchema,
        },
      },
      { signal: AbortSignal.timeout(timeoutMs) },
    );
    const content = response.choices[0]?.message.content ?? null;
    return {
      model: response.model || chatModel,
      content,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
    };
  } catch (error) {
    throw asChatError(error);
  }
}

function asChatError(error: unknown): ChatProviderError {
  if (error instanceof ChatProviderError) {
    return error;
  }
  if (
    error instanceof APIConnectionTimeoutError ||
    error instanceof APIUserAbortError ||
    (error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError"))
  ) {
    return new ChatProviderError("timeout", true);
  }
  if (error instanceof APIConnectionError) {
    return new ChatProviderError("provider_failed", true);
  }
  if (error instanceof APIError) {
    return new ChatProviderError(
      "provider_failed",
      isRetryableStatus(error.status),
    );
  }
  return new ChatProviderError("provider_failed", false);
}

function isRetryableStatus(status: number | undefined): boolean {
  return (
    status === 408 ||
    status === 409 ||
    status === 429 ||
    (typeof status === "number" && status >= 500)
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
