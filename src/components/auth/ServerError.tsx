import { CircleAlert } from "lucide-react";
import { errorCodeToMessage } from "@/lib/error-messages";

interface ServerErrorProps {
  message?: string | null;
}

export function ServerError({ message }: ServerErrorProps) {
  const resolved = errorCodeToMessage(message);
  if (!resolved) return null;

  return (
    <p className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-900/30 px-3 py-2 text-sm text-red-300">
      <CircleAlert className="size-4 shrink-0" />
      {resolved}
    </p>
  );
}
