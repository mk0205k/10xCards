import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";

export interface DeckStats {
  total: number;
  ai: number;
  manual: number;
  dueToday: number;
}

export async function getDeckStats(supabase: SupabaseClient<Database>, userId: string): Promise<DeckStats> {
  const nowIso = new Date().toISOString();

  const [totalResult, aiResult, dueTodayResult] = await Promise.all([
    supabase.from("cards").select("*", { count: "exact", head: true }).eq("user_id", userId),
    supabase.from("cards").select("*", { count: "exact", head: true }).eq("user_id", userId).eq("source", "ai"),
    supabase.from("cards").select("*", { count: "exact", head: true }).eq("user_id", userId).lte("due", nowIso),
  ]);

  if (totalResult.error) {
    throw new Error(`[deck-stats] total count failed: ${totalResult.error.message}`);
  }
  if (aiResult.error) {
    throw new Error(`[deck-stats] ai count failed: ${aiResult.error.message}`);
  }
  if (dueTodayResult.error) {
    throw new Error(`[deck-stats] dueToday count failed: ${dueTodayResult.error.message}`);
  }

  const total = totalResult.count ?? 0;
  const ai = aiResult.count ?? 0;
  const dueToday = dueTodayResult.count ?? 0;
  const manual = total - ai;

  return { total, ai, manual, dueToday };
}
