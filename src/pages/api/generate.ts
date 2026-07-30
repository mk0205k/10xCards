import type { APIRoute } from "astro";
import { z } from "zod";
import { createTextStreamResponse, toTextStream } from "ai";
import { OPENROUTER_API_KEY, OPENROUTER_MODEL } from "astro:env/server";
import { generateProposals } from "@/lib/ai/generate-proposals";
import { ERROR_CODES } from "@/lib/error-messages";

export const prerender = false;

const GENERATION_TIMEOUT_MS = 30_000;

const requestSchema = z.object({
  text: z.string().min(1).max(10_000),
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // AbortSignal.timeout produces a DOMException with name "TimeoutError" on
  // browsers/workerd; some polyfills surface it as AbortError. Match both.
  return err.name === "TimeoutError" || err.name === "AbortError";
}

export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return jsonResponse(401, { error: "unauthorized" });
  }

  let payload: unknown;
  try {
    payload = await context.request.json();
  } catch {
    return jsonResponse(400, { error: "invalid json" });
  }

  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) {
    return jsonResponse(400, { error: "invalid input", issues: parsed.error.issues });
  }

  try {
    const result = generateProposals({
      text: parsed.data.text,
      apiKey: OPENROUTER_API_KEY,
      model: OPENROUTER_MODEL,
      abortSignal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
      onError: ({ error }) => {
        console.error("[/api/generate] SDK mid-stream error", {
          user_id: context.locals.user?.id,
          message: error instanceof Error ? error.message : String(error),
        });
      },
    });
    // Guard the pipe: response headers are already sent by the time the SDK
    // stream is iterated, so a mid-stream provider error / abort cannot be
    // turned into a 502 — but it CAN escape as an unhandled rejection and
    // corrupt the workerd isolate. Wrap the byte stream in a controlled
    // ReadableStream that catches downstream errors, logs, and closes
    // cleanly. Client-side truncation detection is deferred (see plan §
    // "What We're NOT Doing").
    const textStream = toTextStream({ stream: result.stream });
    const guarded = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = textStream.getReader();
        try {
          let chunk = await reader.read();
          while (!chunk.done) {
            controller.enqueue(chunk.value);
            chunk = await reader.read();
          }
          controller.close();
        } catch (err) {
          console.error("[/api/generate] mid-stream iteration failed", {
            user_id: context.locals.user?.id,
            message: err instanceof Error ? err.message : String(err),
          });
          controller.close();
        } finally {
          reader.releaseLock();
        }
      },
    });
    return createTextStreamResponse({ stream: guarded });
  } catch (err) {
    if (isTimeoutError(err)) {
      console.error("[/api/generate] provider call timed out", { user_id: context.locals.user.id });
      return jsonResponse(504, { error: ERROR_CODES.GENERATION_TIMEOUT });
    }
    console.error("[/api/generate] provider call failed", {
      user_id: context.locals.user.id,
      message: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse(502, { error: ERROR_CODES.GENERATION_FAILED });
  }
};

export const ALL: APIRoute = () => jsonResponse(405, { error: "method not allowed" });
