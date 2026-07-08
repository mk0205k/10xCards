import { useCallback, useReducer } from "react";
import { initialState, proposalsReducer } from "@/components/generate/proposalsReducer";
import type { ProposalDraft, ProposalsState } from "@/components/generate/proposalsReducer";
import { useProposalStream } from "@/components/hooks/useProposalStream";
import { createCard, CreateCardError } from "@/lib/api/cards";
import GenerateForm from "@/components/generate/GenerateForm";
import ProposalsList from "@/components/generate/ProposalsList";
import StreamBanner from "@/components/generate/StreamBanner";

function findProposal(state: ProposalsState, id: string) {
  return state.proposals.find((p) => p.id === id);
}

export default function GeneratePanel() {
  const [state, dispatch] = useReducer(proposalsReducer, initialState);
  const { start, abort } = useProposalStream(dispatch);

  const onSubmit = useCallback(
    (text: string) => {
      void start(text);
    },
    [start],
  );
  const onRetry = useCallback(() => {
    if (state.lastSubmittedText) {
      void start(state.lastSubmittedText);
    }
  }, [start, state.lastSubmittedText]);

  const persist = useCallback(async (id: string, question: string, answer: string) => {
    dispatch({ type: "saveStart", id });
    try {
      const saved = await createCard({ question, answer, source: "ai" });
      dispatch({ type: "saveSuccess", id, savedCardId: saved.id });
    } catch (error) {
      const message = error instanceof CreateCardError ? error.message : "Save failed";
      dispatch({ type: "saveError", id, message });
    }
  }, []);

  const onAccept = useCallback(
    (id: string) => {
      const proposal = findProposal(state, id);
      if (!proposal) return;
      void persist(id, proposal.question, proposal.answer);
    },
    [persist, state],
  );

  const onEditSave = useCallback(
    (id: string) => {
      const proposal = findProposal(state, id);
      if (!proposal?.draft) return;
      const { question, answer } = proposal.draft;
      dispatch({ type: "editSave", id });
      void persist(id, question, answer);
    },
    [persist, state],
  );

  const onReject = useCallback((id: string) => {
    dispatch({ type: "reject", id });
  }, []);
  const onEditStart = useCallback((id: string) => {
    dispatch({ type: "editStart", id });
  }, []);
  const onEditChange = useCallback((id: string, patch: Partial<ProposalDraft>) => {
    dispatch({ type: "editChange", id, patch });
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
