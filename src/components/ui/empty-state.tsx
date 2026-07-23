import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 p-6 text-center backdrop-blur-md",
        className,
      )}
    >
      {icon ? <div className="text-white/60">{icon}</div> : null}
      <p className="text-lg font-medium text-white">{title}</p>
      {description ? <p className="text-sm text-white/60">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
