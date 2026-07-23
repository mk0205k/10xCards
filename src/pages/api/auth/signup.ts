import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { ERROR_CODES } from "@/lib/error-messages";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const rawEmail = form.get("email");
  // Normalize at the endpoint boundary so email_pending_deletion (which
  // does lower() but not trim()) and supabase.auth.signUp (which trims +
  // lowercases server-side) see the same value. Skip this and a padded
  // variant like "  foo@x.local  " escapes the retention guard.
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  const password = form.get("password") as string;

  if (!email) {
    return context.redirect(`/auth/signup?error=${ERROR_CODES.EMAIL_REQUIRED}`);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signup?error=${ERROR_CODES.SUPABASE_NOT_CONFIGURED}`);
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
