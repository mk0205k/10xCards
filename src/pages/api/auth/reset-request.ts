import type { APIRoute } from "astro";
import { PUBLIC_SITE_URL } from "astro:env/server";
import { createClient } from "@/lib/supabase";
import { ERROR_CODES } from "@/lib/error-messages";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/reset-password?error=${ERROR_CODES.SUPABASE_NOT_CONFIGURED}`);
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${PUBLIC_SITE_URL}/auth/update-password`,
  });

  if (error) {
    if (error.status === 429) {
      return context.redirect(`/auth/reset-password?error=${ERROR_CODES.RESET_TOO_MANY_ATTEMPTS}`);
    }
    return context.redirect(`/auth/reset-password?error=${encodeURIComponent(error.message)}`);
  }

  return context.redirect("/auth/reset-password-sent");
};
