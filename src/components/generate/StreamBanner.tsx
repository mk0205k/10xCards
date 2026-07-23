import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
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
    <Alert
      variant="error"
      action={
        <Button size="sm" variant="outline" onClick={onRetry}>
          {m.generate_proposal_retry()}
        </Button>
      }
    >
      {m.generate_stream_interrupted()}
      {errorMessage ? <span className="ml-1 text-red-200/70">({errorMessage})</span> : null}
    </Alert>
  );
}
