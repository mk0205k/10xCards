import type { APIRoute } from "astro";
import { z } from "zod";
import { createTextStreamResponse, toTextStream } from "ai";
import { OPENROUTER_API_KEY, OPENROUTER_MODEL } from "astro:env/server";
import { generateProposals } from "@/lib/ai/generate-proposals";

export const prerender = false;

const requestSchema = z.object({
  text: z.string().min(1).max(10_000),
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
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

  const result = generateProposals({
    text: parsed.data.text,
    apiKey: OPENROUTER_API_KEY,
    model: OPENROUTER_MODEL,
  });

  return createTextStreamResponse({ stream: toTextStream({ stream: result.stream }) });
};

export const ALL: APIRoute = () => jsonResponse(405, { error: "method not allowed" });
