import { useCallback, useReducer, useState } from "react";
import { initialState, proposalsReducer } from "@/components/generate/proposalsReducer";
import type { ProposalDraft, ProposalsState } from "@/components/generate/proposalsReducer";
import { useProposalStream } from "@/components/hooks/useProposalStream";
import { createCard, CreateCardError } from "@/lib/api/cards";
import GenerateForm from "@/components/generate/GenerateForm";
import ProposalsList from "@/components/generate/ProposalsList";
import StreamBanner from "@/components/generate/StreamBanner";
import BulkRejectConfirmDialog from "@/components/generate/BulkRejectConfirmDialog";
import { Button } from "@/components/ui/button";
import { m } from "@/paraglide/messages.js";

const BULK_ACCEPT_CONCURRENCY = 4;

function findProposal(state: ProposalsState, id: string) {
  return state.proposals.find((p) => p.id === id);
}

interface BulkProgress {
  done: number;
  total: number;
}

export default function GeneratePanel() {
  const [state, dispatch] = useReducer(proposalsReducer, initialState);
  const { start, abort } = useProposalStream(dispatch);
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [bulkAcceptInProgress, setBulkAcceptInProgress] = useState<BulkProgress | null>(null);

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
      const message = error instanceof CreateCardError ? error.message : m.generate_save_failed();
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

  const onBulkAccept = useCallback(async () => {
    const pending = state.proposals.filter((p) => p.status === "pending");
    if (pending.length === 0) return;
    setBulkAcceptInProgress({ done: 0, total: pending.length });
    for (let i = 0; i < pending.length; i += BULK_ACCEPT_CONCURRENCY) {
      const chunk = pending.slice(i, i + BULK_ACCEPT_CONCURRENCY);
      await Promise.allSettled(chunk.map((p) => persist(p.id, p.question, p.answer)));
      setBulkAcceptInProgress((prev) => (prev ? { ...prev, done: prev.done + chunk.length } : null));
    }
    setBulkAcceptInProgress(null);
  }, [state.proposals, persist]);

  const onBulkReject = useCallback(() => {
    setBulkRejectOpen(true);
  }, []);
  const onBulkRejectConfirm = useCallback(() => {
    dispatch({ type: "bulkRejectPending" });
    setBulkRejectOpen(false);
  }, []);

  const pendingCount = state.proposals.filter((p) => p.status === "pending").length;
  const bulkDisabled = bulkAcceptInProgress !== null;
  const showBulkBar = pendingCount > 0 || bulkAcceptInProgress !== null;

  return (
    <div className="space-y-4">
      <GenerateForm streamState={state.streamState} onSubmit={onSubmit} onAbort={abort} />
      <StreamBanner streamState={state.streamState} errorMessage={state.errorMessage} onRetry={onRetry} />
      {showBulkBar && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-3 backdrop-blur-md">
          <span className="text-sm text-white/80">
            {pendingCount > 0 ? m.generate_bulk_pending_count({ n: pendingCount }) : null}
          </span>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void onBulkAccept()} disabled={bulkDisabled || pendingCount === 0}>
              {m.generate_bulk_accept_all_button()}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={onBulkReject}
              disabled={bulkDisabled || pendingCount === 0}
            >
              {m.generate_bulk_reject_all_button()}
            </Button>
          </div>
        </div>
      )}
      {/* Persistent live region — hoisted out of showBulkBar so screen readers observe it before the first progress update. */}
      <div aria-live="polite" role="status" className="sr-only">
        {bulkAcceptInProgress
          ? m.generate_bulk_progress({ done: bulkAcceptInProgress.done, total: bulkAcceptInProgress.total })
          : ""}
      </div>
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
      <BulkRejectConfirmDialog
        open={bulkRejectOpen}
        onOpenChange={setBulkRejectOpen}
        pendingCount={pendingCount}
        onConfirm={onBulkRejectConfirm}
      />
    </div>
  );
}
