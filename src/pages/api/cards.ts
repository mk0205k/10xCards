import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { emptyCardState } from "@/lib/review/scheduler";

export const prerender = false;

const bodySchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  source: z.enum(["ai", "manual"]).default("ai"),
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const GET: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return jsonResponse(401, { error: "unauthorized" });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse(500, { error: "supabase not configured" });
  }

  const { data, error } = await supabase.from("cards").select("*").order("created_at", { ascending: false });

  if (error) {
    console.error("[/api/cards] supabase list error", {
      code: error.code,
      message: error.message,
      user_id: user.id,
    });
    return jsonResponse(500, { error: "list failed" });
  }

  return jsonResponse(200, { cards: data });
};

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return jsonResponse(401, { error: "unauthorized" });
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
    .insert({
      user_id: user.id,
      question: parsed.data.question,
      answer: parsed.data.answer,
      source: parsed.data.source,
      ...emptyCardState(),
    })
    .select()
    .single();

  if (error) {
    console.error("[/api/cards] supabase insert error", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      user_id: user.id,
    });
    return jsonResponse(500, { error: "insert failed" });
  }

  return jsonResponse(201, { card: data });
};

export const ALL: APIRoute = () => jsonResponse(405, { error: "method not allowed" });
