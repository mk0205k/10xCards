import type { ApiProvider, CallApiContextParams, ProviderResponse } from "promptfoo";
import { reviewCodeWithUsage } from "../src/index.ts";

/**
 * promptfoo custom provider that *is* the reviewer agent.
 *
 * promptfoo's own prompt-templating and model-calling are bypassed: this
 * provider reads the PR vars (`title`, `description`, `diff`) straight from
 * `context.vars`, calls `reviewCodeWithUsage` with the model from its per-entry
 * `config.model`, and returns the structured `ReviewResult` as `output`. That
 * object flows directly into the assertions — no JSON round-trip.
 *
 * It also back-propagates the run's accounting to promptfoo via `tokenUsage` and
 * `cost`, so the eval table/web viewer shows what each model call cost (tokens
 * and OpenRouter-reported dollars) and rolls it up into the run totals.
 *
 * The same file is listed multiple times in `promptfooconfig.yaml` with
 * different `config.model` values to express the model sweep.
 */
export default class ReviewProvider implements ApiProvider {
  constructor(private readonly options: { id?: string; config?: { model?: string } } = {}) {}

  id(): string {
    return this.options.id ?? `review:${this.options.config?.model ?? "default"}`;
  }

  async callApi(_prompt: string, context?: CallApiContextParams): Promise<ProviderResponse> {
    const vars = context?.vars ?? {};
    const title = String(vars.title ?? "");
    const description = String(vars.description ?? "");
    const diff = String(vars.diff ?? "");
    const model = this.options.config?.model;

    try {
      const { review, usage } = await reviewCodeWithUsage({ title, description, diff }, { model });
      return {
        output: review,
        // OpenRouter-reported dollar cost for this call (undefined → omitted).
        cost: usage.cost,
        // Map our normalized usage onto promptfoo's TokenUsage shape so the eval
        // surfaces per-cell token counts and aggregates them across the sweep.
        tokenUsage: {
          prompt: usage.promptTokens,
          completion: usage.completionTokens,
          total: usage.totalTokens,
          cached: usage.cachedTokens || undefined,
          numRequests: usage.numRequests,
          completionDetails: usage.reasoningTokens ? { reasoning: usage.reasoningTokens } : undefined,
        },
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
}
