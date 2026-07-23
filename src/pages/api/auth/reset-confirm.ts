import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { ERROR_CODES } from "@/lib/error-messages";

export const prerender = false;

const errRedirect = (context: Parameters<APIRoute>[0], path: string, code: string) =>
  context.redirect(`${path}?error=${code}`);

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const password = form.get("password") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return errRedirect(context, "/auth/update-password", ERROR_CODES.SUPABASE_NOT_CONFIGURED);
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    if (error.code === "weak_password") {
      return errRedirect(context, "/auth/update-password", ERROR_CODES.PASSWORD_TOO_WEAK);
    }
    if (error.code === "same_password") {
      return errRedirect(context, "/auth/update-password", ERROR_CODES.PASSWORD_SAME_AS_OLD);
    }
    if (error.name === "AuthSessionMissingError") {
      return errRedirect(context, "/auth/reset-password", ERROR_CODES.RESET_SESSION_EXPIRED);
    }
    return context.redirect(`/auth/update-password?error=${encodeURIComponent(error.message)}`);
  }

  return context.redirect("/");
};
