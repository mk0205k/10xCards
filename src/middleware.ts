import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";

const PROTECTED_ROUTES = ["/dashboard", "/generate", "/review", "/deck", "/account"];

// Paths a soft-deleted user must still reach: the restore page + its POST
// endpoint, signin (in case they want to switch identity), and signout.
const SOFT_DELETE_ALLOWED_PATHS = [
  "/auth/restore-account",
  "/auth/signin",
  "/api/account/restore",
  "/api/auth/signout",
];

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;

    if (user) {
      const pathname = context.url.pathname;
      const onAllowedPath = SOFT_DELETE_ALLOWED_PATHS.some((p) => pathname.startsWith(p));
      if (!onAllowedPath) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("deleted_at")
          .eq("user_id", user.id)
          .maybeSingle();
        if (profile?.deleted_at) {
          return context.redirect("/auth/restore-account");
        }
      }
    }
  } else {
    context.locals.user = null;
  }

  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }

  return next();
});
