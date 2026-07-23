import { m } from "@/paraglide/messages.js";

export const ERROR_CODES = {
  UNKNOWN: "UNKNOWN",
  SUPABASE_NOT_CONFIGURED: "SUPABASE_NOT_CONFIGURED",
  PASSWORD_TOO_WEAK: "PASSWORD_TOO_WEAK",
  PASSWORD_SAME_AS_OLD: "PASSWORD_SAME_AS_OLD",
  RESET_SESSION_EXPIRED: "RESET_SESSION_EXPIRED",
  RESET_TOO_MANY_ATTEMPTS: "RESET_TOO_MANY_ATTEMPTS",
  ACCOUNT_DELETE_FAILED: "ACCOUNT_DELETE_FAILED",
  ACCOUNT_RESTORE_FAILED: "ACCOUNT_RESTORE_FAILED",
  ACCOUNT_PENDING_DELETION: "ACCOUNT_PENDING_DELETION",
  EMAIL_REQUIRED: "EMAIL_REQUIRED",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const RESOLVERS: Record<ErrorCode, () => string> = {
  UNKNOWN: m.error_unknown,
  SUPABASE_NOT_CONFIGURED: m.error_supabase_not_configured,
  PASSWORD_TOO_WEAK: m.error_password_too_weak,
  PASSWORD_SAME_AS_OLD: m.error_password_same_as_old,
  RESET_SESSION_EXPIRED: m.error_reset_session_expired,
  RESET_TOO_MANY_ATTEMPTS: m.error_reset_too_many_attempts,
  ACCOUNT_DELETE_FAILED: m.error_account_delete_failed,
  ACCOUNT_RESTORE_FAILED: m.error_account_restore_failed,
  ACCOUNT_PENDING_DELETION: m.auth_signup_pending_deletion,
  EMAIL_REQUIRED: m.error_email_required,
};

function isKnownCode(input: string): input is ErrorCode {
  return input in RESOLVERS;
}

/**
 * Resolve a server-side error code to a localized message.
 * Known codes translate via Paraglide; anything else — unknown codes or raw
 * vendor strings — collapses to `error_unknown` so untranslated vendor text
 * never renders in a localized UI.
 */
export function errorCodeToMessage(input: string | null | undefined): string | null {
  if (!input) return null;
  if (isKnownCode(input)) return RESOLVERS[input]();
  return m.error_unknown();
}
