import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { computePreview, defaultScheduler, hydrateCard } from "@/lib/review/scheduler";

export const prerender = false;

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

  const now = new Date();
  const nowIso = now.toISOString();

  const { data: due, error: dueError } = await supabase
    .from("cards")
    .select("*")
    .eq("user_id", user.id)
    .lte("due", nowIso)
    .order("due", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (dueError) {
    console.error("[/api/review/next] select due card error", {
      code: dueError.code,
      message: dueError.message,
      user_id: user.id,
    });
    return jsonResponse(500, { error: "select failed" });
  }

  if (due) {
    const preview = computePreview(defaultScheduler, hydrateCard(due), now);
    return jsonResponse(200, { card: due, preview });
  }

  // Queue empty for today — find the next-due timestamp (if any).
  const { data: upcoming, error: upcomingError } = await supabase
    .from("cards")
    .select("due")
    .eq("user_id", user.id)
    .gt("due", nowIso)
    .order("due", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (upcomingError) {
    console.error("[/api/review/next] select upcoming due error", {
      code: upcomingError.code,
      message: upcomingError.message,
      user_id: user.id,
    });
    return jsonResponse(500, { error: "select failed" });
  }

  return jsonResponse(200, { card: null, nextDueAt: upcoming?.due ?? null });
};

export const ALL: APIRoute = () => jsonResponse(405, { error: "method not allowed" });
