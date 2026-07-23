import type { ReactNode } from "react";
import { AlertCircle, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type AlertVariant = "error" | "warning" | "info";

interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  role?: "alert" | "status";
}

const VARIANT_CLASSES: Record<AlertVariant, string> = {
  error: "border-red-400/40 bg-red-500/10 text-red-100",
  warning: "border-amber-400/40 bg-amber-500/10 text-amber-100",
  info: "border-blue-400/40 bg-blue-500/10 text-blue-100",
};

const VARIANT_ICON: Record<AlertVariant, ReactNode> = {
  error: <AlertCircle aria-hidden="true" className="size-4 shrink-0" />,
  warning: <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />,
  info: <Info aria-hidden="true" className="size-4 shrink-0" />,
};

export function Alert({ variant = "error", title, children, action, className, role }: AlertProps) {
  const resolvedRole = role ?? (variant === "info" ? "status" : "alert");
  return (
    <div
      role={resolvedRole}
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3 text-sm",
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      <div className="flex flex-1 items-start gap-2">
        {VARIANT_ICON[variant]}
        <div className="flex flex-col gap-1">
          {title ? <p className="font-semibold">{title}</p> : null}
          {children ? <div>{children}</div> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
