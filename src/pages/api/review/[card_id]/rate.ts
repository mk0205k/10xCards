import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { defaultScheduler, hydrateCard, serializeCardForRpc, serializeLogForRpc } from "@/lib/review/scheduler";

export const prerender = false;

const bodySchema = z.object({
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
});

const paramsSchema = z.object({
  card_id: z.uuid(),
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const POST: APIRoute = async (context) => {
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

  const { data: row, error: selectError } = await supabase
    .from("cards")
    .select("*")
    .eq("id", paramsParsed.data.card_id)
    .maybeSingle();

  if (selectError) {
    console.error("[/api/review/rate] select card error", {
      code: selectError.code,
      message: selectError.message,
      user_id: user.id,
      card_id: paramsParsed.data.card_id,
    });
    return jsonResponse(500, { error: "select failed" });
  }
  if (!row) {
    return jsonResponse(404, { error: "card not found" });
  }

  const now = new Date();
  const card = hydrateCard(row);
  const { card: updated, log } = defaultScheduler.next(card, now, parsed.data.rating);

  const { data: rpcData, error: rpcError } = await supabase.rpc("commit_review", {
    p_card_id: paramsParsed.data.card_id,
    p_rating: parsed.data.rating,
    p_now: now.toISOString(),
    p_updated_card: serializeCardForRpc(updated),
    p_log: serializeLogForRpc(log),
  });

  if (rpcError) {
    console.error("[/api/review/rate] rpc commit_review error", {
      code: rpcError.code,
      message: rpcError.message,
      user_id: user.id,
      card_id: paramsParsed.data.card_id,
    });
    // 42501: RLS-filtered UPDATE (cross-user attempt or RLS misconfig). Return
    // 404 to avoid disclosing that the id exists but is not owned.
    if (rpcError.code === "42501") {
      return jsonResponse(404, { error: "card not found" });
    }
    return jsonResponse(500, { error: "commit failed" });
  }

  return jsonResponse(200, { card: rpcData });
};

export const ALL: APIRoute = () => jsonResponse(405, { error: "method not allowed" });
