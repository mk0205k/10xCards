import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { ERROR_CODES } from "@/lib/error-messages";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${ERROR_CODES.SUPABASE_NOT_CONFIGURED}`);
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    console.error("[/api/auth/signin] signInWithPassword failed", {
      code: error.code,
      status: error.status,
      message: error.message,
    });
    if (error.code === "invalid_credentials") {
      return context.redirect(`/auth/signin?error=${ERROR_CODES.INVALID_CREDENTIALS}`);
    }
    return context.redirect(`/auth/signin?error=${ERROR_CODES.UNKNOWN}`);
  }

  return context.redirect("/");
};
