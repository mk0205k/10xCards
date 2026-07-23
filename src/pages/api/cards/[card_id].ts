import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";

export const prerender = false;

const paramsSchema = z.object({
  card_id: z.uuid(),
});

const bodySchema = z
  .object({
    question: z.string().min(1),
    answer: z.string().min(1),
  })
  .strict();

function jsonResponse(status: number, body?: unknown) {
  if (body === undefined) {
    return new Response(null, { status });
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const PATCH: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return jsonResponse(401, { error: "unauthorized" });
  }

  const paramsParsed = paramsSchema.safeParse(context.params);
  if (!paramsParsed.success) {
    return jsonResponse(400, { error: "invalid card_id", issues: paramsParsed.error.issues });
  }

  let payload: unknown;
  try {
    payload = await context.request.json();
  } catch {
    return jsonResponse(400, { error: "invalid json" });
  }

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return jsonResponse(400, { error: "invalid input", issues: parsed.error.issues });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse(500, { error: "supabase not configured" });
  }

  const { data, error } = await supabase
    .from("cards")
    .update({
      question: parsed.data.question,
      answer: parsed.data.answer,
    })
    .eq("id", paramsParsed.data.card_id)
    .select()
    .maybeSingle();

  if (error) {
    console.error("[/api/cards/:card_id] supabase update error", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      user_id: user.id,
      card_id: paramsParsed.data.card_id,
    });
    return jsonResponse(500, { error: "update failed" });
  }
  if (!data) {
    return jsonResponse(404, { error: "not found" });
  }

  return jsonResponse(200, { card: data });
};

export const DELETE: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return jsonResponse(401, { error: "unauthorized" });
  }

  const paramsParsed = paramsSchema.safeParse(context.params);
  if (!paramsParsed.success) {
    return jsonResponse(400, { error: "invalid card_id", issues: paramsParsed.error.issues });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse(500, { error: "supabase not configured" });
  }

  const { data, error } = await supabase
    .from("cards")
    .delete()
    .eq("id", paramsParsed.data.card_id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[/api/cards/:card_id] supabase delete error", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      user_id: user.id,
      card_id: paramsParsed.data.card_id,
    });
    return jsonResponse(500, { error: "delete failed" });
  }
  if (!data) {
    return jsonResponse(404, { error: "not found" });
  }

  return jsonResponse(204);
};

export const ALL: APIRoute = () => jsonResponse(405, { error: "method not allowed" });
