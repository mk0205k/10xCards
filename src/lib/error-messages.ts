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
  EMAIL_REQUIRED: m.error_email_required,
};

const CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

function isKnownCode(input: string): input is ErrorCode {
  return input in RESOLVERS;
}

/**
 * Resolve a server-side error code to a localized message.
 * - Known UPPER_SNAKE codes → translated via Paraglide.
 * - Unknown UPPER_SNAKE codes → error_unknown fallback.
 * - Free-form strings (e.g. raw Supabase SDK messages) → returned as-is.
 */
export function errorCodeToMessage(input: string | null | undefined): string | null {
  if (!input) return null;
  if (isKnownCode(input)) return RESOLVERS[input]();
  if (CODE_PATTERN.test(input)) return m.error_unknown();
  return input;
}
