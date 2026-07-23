import React, { useState } from "react";
import { Lock } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { PasswordToggle } from "@/components/auth/PasswordToggle";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
import { m } from "@/paraglide/messages.js";

const MIN_PASSWORD_LENGTH = 6;

interface Props {
  serverError?: string | null;
}

export default function UpdatePasswordForm({ serverError }: Props) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<{ password?: string; confirmPassword?: string }>({});

  function validate() {
    const next: typeof errors = {};

    if (!password) {
      next.password = m.auth_form_password_required();
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      next.password = m.auth_form_password_too_short({ min: MIN_PASSWORD_LENGTH });
    }

    if (!confirmPassword) {
      next.confirmPassword = m.auth_form_confirm_password_required();
    } else if (password !== confirmPassword) {
      next.confirmPassword = m.auth_form_passwords_dont_match();
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function clearError(field: keyof typeof errors) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  const passwordHint =
    !errors.password && password.length > 0 && password.length < MIN_PASSWORD_LENGTH ? (
      <p className="mt-1 text-xs text-blue-100/50">
        {m.auth_form_password_hint_remaining({ n: MIN_PASSWORD_LENGTH - password.length })}
      </p>
    ) : (
      <p className="mt-1 text-xs text-blue-100/50">{m.auth_form_password_hint_min({ min: MIN_PASSWORD_LENGTH })}</p>
    );

  return (
    <form method="POST" action="/api/auth/reset-confirm" className="space-y-4" onSubmit={handleSubmit} noValidate>
      <FormField
        id="password"
        label={m.auth_form_new_password_label()}
        type={showPassword ? "text" : "password"}
        value={password}
        onChange={(v) => {
          setPassword(v);
          clearError("password");
        }}
        placeholder={m.auth_form_password_placeholder_min()}
        error={errors.password}
        hint={passwordHint}
        icon={<Lock className="size-4" />}
        endContent={
          <PasswordToggle
            visible={showPassword}
            onToggle={() => {
              setShowPassword(!showPassword);
            }}
          />
        }
      />

      <FormField
        id="confirmPassword"
        name="confirmPassword"
        label={m.auth_form_confirm_password_label()}
        type={showConfirmPassword ? "text" : "password"}
        value={confirmPassword}
        onChange={(v) => {
          setConfirmPassword(v);
          clearError("confirmPassword");
        }}
        placeholder={m.auth_form_confirm_password_placeholder()}
        error={errors.confirmPassword}
        icon={<Lock className="size-4" />}
        endContent={
          <PasswordToggle
            visible={showConfirmPassword}
            onToggle={() => {
              setShowConfirmPassword(!showConfirmPassword);
            }}
          />
        }
      />

      <ServerError message={serverError} />

      <SubmitButton pendingText={m.auth_form_update_password_pending()} icon={<Lock className="size-4" />}>
        {m.auth_form_update_password_button()}
      </SubmitButton>
    </form>
  );
}
