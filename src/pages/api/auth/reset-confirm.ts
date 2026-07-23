import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const prerender = false;

const errRedirect = (context: Parameters<APIRoute>[0], path: string, msg: string) =>
  context.redirect(`${path}?error=${encodeURIComponent(msg)}`);

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const password = form.get("password") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return errRedirect(context, "/auth/update-password", "Supabase is not configured");
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    if (error.code === "weak_password") {
      return errRedirect(context, "/auth/update-password", "Hasło jest zbyt słabe — użyj co najmniej 6 znaków.");
    }
    if (error.code === "same_password") {
      return errRedirect(context, "/auth/update-password", "Nowe hasło musi się różnić od poprzedniego.");
    }
    if (error.name === "AuthSessionMissingError") {
      return errRedirect(context, "/auth/reset-password", "Sesja resetu wygasła — zażądaj nowego linku.");
    }
    return errRedirect(context, "/auth/update-password", error.message);
  }

  return context.redirect("/");
};
