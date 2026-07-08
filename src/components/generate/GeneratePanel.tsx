import { useCallback, useReducer } from "react";
import { initialState, proposalsReducer } from "@/components/generate/proposalsReducer";
import type { ProposalDraft } from "@/components/generate/proposalsReducer";
import { useProposalStream } from "@/components/hooks/useProposalStream";
import GenerateForm from "@/components/generate/GenerateForm";
import ProposalsList from "@/components/generate/ProposalsList";
import StreamBanner from "@/components/generate/StreamBanner";

export default function GeneratePanel() {
  const [state, dispatch] = useReducer(proposalsReducer, initialState);
  const { start, abort } = useProposalStream(dispatch);

  const onSubmit = useCallback((text: string) => void start(text), [start]);
  const onRetry = useCallback(() => {
    if (state.lastSubmittedText) {
      void start(state.lastSubmittedText);
    }
  }, [start, state.lastSubmittedText]);

  const onAccept = useCallback((_id: string) => {
    // Phase 3 wires this to POST /api/cards.
  }, []);
  const onReject = useCallback((id: string) => {
    dispatch({ type: "reject", id });
  }, []);
  const onEditStart = useCallback((id: string) => {
    dispatch({ type: "editStart", id });
  }, []);
  const onEditChange = useCallback((id: string, patch: Partial<ProposalDraft>) => {
    dispatch({ type: "editChange", id, patch });
  }, []);
  const onEditSave = useCallback((id: string) => {
    dispatch({ type: "editSave", id });
  }, []);
  const onEditCancel = useCallback((id: string) => {
    dispatch({ type: "editCancel", id });
  }, []);

  return (
    <div className="space-y-4">
      <GenerateForm streamState={state.streamState} onSubmit={onSubmit} onAbort={abort} />
      <StreamBanner streamState={state.streamState} errorMessage={state.errorMessage} onRetry={onRetry} />
      <ProposalsList
        proposals={state.proposals}
        streamState={state.streamState}
        onAccept={onAccept}
        onReject={onReject}
        onEditStart={onEditStart}
        onEditChange={onEditChange}
        onEditSave={onEditSave}
        onEditCancel={onEditCancel}
      />
    </div>
  );
}
