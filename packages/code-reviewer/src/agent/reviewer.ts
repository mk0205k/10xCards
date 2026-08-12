import { ToolLoopAgent, Output } from "ai";
import type { OpenRouterProvider } from "@openrouter/ai-sdk-provider";
import { ReviewResult } from "../schemas/review.js";
import { REVIEW_SYSTEM_INSTRUCTIONS, buildReviewPrompt } from "../prompts/review.js";
import type { ReviewInput } from "../prompts/review.js";
import { getOpenRouter, resolveModelId, OPENROUTER_USAGE_ACCOUNTING } from "../provider/openrouter.js";
import { extractUsage } from "../provider/usage.js";
import type { ReviewUsage } from "../provider/usage.js";

/**
 * The reviewer agent, built on `ToolLoopAgent` with pure structured output (no
 * tools). Supports model/provider injection for testability and future evals,
 * and provides the ergonomic `reviewCode` wrapper the rest of the project uses.
 */

export interface ReviewOptions {
  /** OpenRouter model id; defaults to OPENROUTER_MODEL env var or a sane default. */
  model?: string;
}

/**
 * Build a reviewer agent for the resolved model. Pass a `provider` to inject a
 * pre-built OpenRouter instance (e.g. in evals); otherwise one is created from
 * the ambient `OPENROUTER_API_KEY`.
 */
export function createReviewAgent(opts: { model?: string; provider?: OpenRouterProvider } = {}) {
  const modelId = resolveModelId(opts.model);
  const provider = opts.provider ?? getOpenRouter();
  return new ToolLoopAgent({
    // Usage accounting on, so the run's token + dollar cost is recoverable.
    model: provider(modelId, OPENROUTER_USAGE_ACCOUNTING),
    instructions: REVIEW_SYSTEM_INSTRUCTIONS,
    output: Output.object({ schema: ReviewResult }),
  });
}

/**
 * A default reviewer agent, constructed lazily on first use. Building eagerly
 * would call `getOpenRouter()` at import time and throw for key-less consumers
 * (and evals that inject their own model), so construction is deferred.
 */
let defaultAgent: ReturnType<typeof createReviewAgent> | undefined;
export function reviewAgent(): ReturnType<typeof createReviewAgent> {
  defaultAgent ??= createReviewAgent();
  return defaultAgent;
}

/** A review plus the token/dollar usage the run cost. */
export interface ReviewCodeResult {
  review: ReviewResult;
  usage: ReviewUsage;
}

/**
 * Review a pull request and return both the structured scores and the run's
 * usage (tokens + OpenRouter-reported dollar cost), recovered from the model
 * steps. Consumers that want cost accounting (e.g. the promptfoo eval) use this;
 * `reviewCode` is the thin wrapper for callers that only need the scores.
 */
export async function reviewCodeWithUsage(input: ReviewInput, options: ReviewOptions = {}): Promise<ReviewCodeResult> {
  const agent = createReviewAgent({ model: options.model });
  const { output, steps } = await agent.generate({
    prompt: buildReviewPrompt(input),
  });
  return { review: output, usage: extractUsage(steps ?? []) };
}

/**
 * Review a pull request (title + description + diff) and return structured,
 * schema-validated scores. This is the single integration point the rest of the
 * project builds on.
 */
export async function reviewCode(input: ReviewInput, options: ReviewOptions = {}): Promise<ReviewResult> {
  return (await reviewCodeWithUsage(input, options)).review;
}
