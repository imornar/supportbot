import { chatModel } from "@/server/answers/provider";

/**
 * Published list rates for the configured chat model, used only to label an
 * optional live run. They are not an invoice and they are not read from the
 * provider response.
 */
export const liveChatListRates = {
  model: chatModel,
  inputUsdPerMillionTokens: 0.4,
  outputUsdPerMillionTokens: 1.6,
} as const;

export function estimateLiveChatUsd(usage: {
  inputTokens: number;
  outputTokens: number;
}): number {
  const usd =
    (usage.inputTokens / 1_000_000) *
      liveChatListRates.inputUsdPerMillionTokens +
    (usage.outputTokens / 1_000_000) *
      liveChatListRates.outputUsdPerMillionTokens;
  return Math.round(usd * 1_000_000) / 1_000_000;
}
