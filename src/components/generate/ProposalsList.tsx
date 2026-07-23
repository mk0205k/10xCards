import type { Proposal, ProposalDraft, StreamState } from "@/components/generate/proposalsReducer";
import ProposalCard from "@/components/generate/ProposalCard";
import { EmptyState } from "@/components/ui/empty-state";
import { m } from "@/paraglide/messages.js";

interface Props {
  proposals: Proposal[];
  streamState: StreamState;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onEditStart: (id: string) => void;
  onEditChange: (id: string, patch: Partial<ProposalDraft>) => void;
  onEditSave: (id: string) => void;
  onEditCancel: (id: string) => void;
}

export default function ProposalsList({
  proposals,
  streamState,
  onAccept,
  onReject,
  onEditStart,
  onEditChange,
  onEditSave,
  onEditCancel,
}: Props) {
  const visible = proposals.filter((p) => p.status !== "rejected");
  const streaming = streamState === "streaming";
  const streamFinished = streamState === "done" || streamState === "aborted";

  if (!streaming && visible.length === 0) {
    if (streamFinished) {
      return <EmptyState title={m.generate_empty_state_title()} description={m.generate_empty_state_description()} />;
    }
    return null;
  }

  return (
    <div className="space-y-3">
      {visible.map((p) => (
        <ProposalCard
          key={p.id}
          proposal={p}
          onAccept={onAccept}
          onReject={onReject}
          onEditStart={onEditStart}
          onEditChange={onEditChange}
          onEditSave={onEditSave}
          onEditCancel={onEditCancel}
        />
      ))}
      {streaming && <p className="text-center text-sm text-white/60">{m.generate_proposals_streaming()}</p>}
    </div>
  );
}
