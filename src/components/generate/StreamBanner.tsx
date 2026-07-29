import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import type { StreamState } from "@/components/generate/proposalsReducer";
import { m } from "@/paraglide/messages.js";
import { errorCodeToMessage } from "@/lib/error-messages";

interface Props {
  streamState: StreamState;
  errorMessage: string | null;
  onRetry: () => void;
}

export default function StreamBanner({ streamState, errorMessage, onRetry }: Props) {
  if (streamState !== "aborted") return null;

  const localized = errorCodeToMessage(errorMessage);

  return (
    <Alert
      variant="error"
      action={
        <Button size="sm" variant="outline" onClick={onRetry}>
          {m.generate_proposal_retry()}
        </Button>
      }
    >
      {localized ?? m.generate_stream_interrupted()}
    </Alert>
  );
}
