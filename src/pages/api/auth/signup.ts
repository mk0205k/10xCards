import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent("Supabase is not configured")}`);
  }

  // Guard: block re-signup on an email still in the soft-delete retention
  // window. Fail-open — an RPC error should not lock users out of signup
  // entirely; the standard signUp path will still catch duplicate emails.
  const { data: pending, error: peErr } = await supabase.rpc("email_pending_deletion", { p_email: email });
  if (peErr) {
    console.error("[/api/auth/signup] email_pending_deletion RPC failed (fail-open)", {
      code: peErr.code,
      message: peErr.message,
    });
  } else if (pending) {
    return context.redirect(`/auth/signup?error=account_pending_deletion`);
  }

  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent(error.message)}`);
  }

  return context.redirect("/auth/confirm-email");
};
