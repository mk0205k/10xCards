import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type SpinnerSize = "sm" | "md" | "lg";

interface SpinnerProps {
  size?: SpinnerSize;
  className?: string;
  label?: string;
}

const SIZE_CLASSES: Record<SpinnerSize, string> = {
  sm: "size-4",
  md: "size-6",
  lg: "size-8",
};

export function Spinner({ size = "md", className, label }: SpinnerProps) {
  const hasLabel = Boolean(label);
  return (
    <span
      className={cn("inline-flex items-center gap-2", className)}
      role={hasLabel ? "status" : undefined}
      aria-hidden={hasLabel ? undefined : true}
    >
      <Loader2 aria-hidden="true" className={cn("animate-spin text-current", SIZE_CLASSES[size])} />
      {hasLabel ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
