import { Button } from "@/components/ui/button";
import type { StreamState } from "@/components/generate/proposalsReducer";
import { m } from "@/paraglide/messages.js";

interface Props {
  streamState: StreamState;
  errorMessage: string | null;
  onRetry: () => void;
}

export default function StreamBanner({ streamState, errorMessage, onRetry }: Props) {
  if (streamState !== "aborted") return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-400/40 bg-red-500/10 p-3 text-red-100">
      <span className="text-sm">
        {m.generate_stream_interrupted()}
        {errorMessage ? <span className="ml-1 text-red-200/70">({errorMessage})</span> : null}
      </span>
      <Button size="sm" variant="outline" onClick={onRetry}>
        {m.generate_proposal_retry()}
      </Button>
    </div>
  );
}
