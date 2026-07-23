import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const prerender = false;

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

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/account?error=${encodeURIComponent("Supabase is not configured")}`, 303);
  }

  const { error: rpcErr } = await supabase.rpc("enqueue_hard_delete", { p_user_id: user.id });
  if (rpcErr) {
    console.error("[/api/account/delete] enqueue_hard_delete failed", {
      code: rpcErr.code,
      message: rpcErr.message,
      user_id: user.id,
    });
    return context.redirect(
      `/account?error=${encodeURIComponent("Nie udało się usunąć konta. Spróbuj ponownie.")}`,
      303,
    );
  }

  // Global signout must happen AFTER the DB write so the RLS EXISTS gate
  // already blocks this user before their session is torn down. If signOut
  // itself fails we still redirect — the RLS gate is the real security
  // boundary; signOut is a defence-in-depth cleanup.
  const { error: signOutErr } = await supabase.auth.signOut({ scope: "global" });
  if (signOutErr) {
    console.error("[/api/account/delete] global signOut failed (best-effort)", {
      message: signOutErr.message,
      user_id: user.id,
    });
  }

  return context.redirect("/", 303);
};
