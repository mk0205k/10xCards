import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { Proposal, ProposalDraft } from "@/components/generate/proposalsReducer";

interface Props {
  proposal: Proposal;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onEditStart: (id: string) => void;
  onEditChange: (id: string, patch: Partial<ProposalDraft>) => void;
  onEditSave: (id: string) => void;
  onEditCancel: (id: string) => void;
}

export default function ProposalCard({
  proposal,
  onAccept,
  onReject,
  onEditStart,
  onEditChange,
  onEditSave,
  onEditCancel,
}: Props) {
  if (proposal.status === "editing" && proposal.draft) {
    const canSave = proposal.draft.question.trim().length > 0 && proposal.draft.answer.trim().length > 0;
    return (
      <Card>
        <CardHeader>
          <label className="text-xs font-medium tracking-wide text-white/60 uppercase">Question</label>
          <Textarea
            value={proposal.draft.question}
            onChange={(e) => {
              onEditChange(proposal.id, { question: e.target.value });
            }}
            rows={2}
            className="border-white/10 bg-black/20 text-white"
          />
        </CardHeader>
        <CardContent>
          <label className="text-xs font-medium tracking-wide text-white/60 uppercase">Answer</label>
          <Textarea
            value={proposal.draft.answer}
            onChange={(e) => {
              onEditChange(proposal.id, { answer: e.target.value });
            }}
            rows={4}
            className="mt-1 border-white/10 bg-black/20 text-white"
          />
        </CardContent>
        <CardFooter>
          <Button
            size="sm"
            onClick={() => {
              if (canSave) onEditSave(proposal.id);
            }}
            disabled={!canSave}
          >
            Save
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              onEditCancel(proposal.id);
            }}
          >
            Cancel
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-white">{proposal.question}</CardTitle>
      </CardHeader>
      <CardContent className="whitespace-pre-wrap text-white/85">{proposal.answer}</CardContent>
      <CardFooter>
        <Button
          size="sm"
          onClick={() => {
            onAccept(proposal.id);
          }}
        >
          Accept
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            onEditStart(proposal.id);
          }}
        >
          Edit
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={() => {
            onReject(proposal.id);
          }}
        >
          Reject
        </Button>
      </CardFooter>
    </Card>
  );
}
