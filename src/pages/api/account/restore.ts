import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { ERROR_CODES } from "@/lib/error-messages";

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
    return context.redirect(`/auth/restore-account?error=${ERROR_CODES.SUPABASE_NOT_CONFIGURED}`, 303);
  }

  const { error } = await supabase.rpc("restore_account");
  if (error) {
    console.error("[/api/account/restore] restore_account failed", {
      code: error.code,
      message: error.message,
      user_id: user.id,
    });
    return context.redirect(`/auth/restore-account?error=${ERROR_CODES.ACCOUNT_RESTORE_FAILED}`, 303);
  }

  return context.redirect("/dashboard", 303);
};
