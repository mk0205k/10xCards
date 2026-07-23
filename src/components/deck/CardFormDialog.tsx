import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createCard, updateCard, CardApiError, type CardRow } from "@/lib/api/cards";
import { m } from "@/paraglide/messages.js";

export type CardFormMode = "create" | "edit";

interface CardFormDialogProps {
  mode: CardFormMode;
  card?: CardRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (card: CardRow) => void;
}

interface CardFormBodyProps {
  mode: CardFormMode;
  card?: CardRow;
  onOpenChange: (open: boolean) => void;
  onSaved: (card: CardRow) => void;
}

function CardFormBody({ mode, card, onOpenChange, onSaved }: CardFormBodyProps) {
  const [question, setQuestion] = useState(mode === "edit" && card ? card.question : "");
  const [answer, setAnswer] = useState(mode === "edit" && card ? card.answer : "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = question.trim();
    const a = answer.trim();
    if (!q || !a) {
      setError(m.deck_form_validation_empty());
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const saved =
        mode === "create" || !card
          ? await createCard({ question: q, answer: a, source: "manual" })
          : await updateCard(card.id, { question: q, answer: a });
      onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof CardApiError ? err.message : m.deck_form_save_failed();
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{mode === "create" ? m.deck_dialog_new_title() : m.deck_dialog_edit_title()}</DialogTitle>
        <DialogDescription>
          {mode === "create" ? m.deck_dialog_new_description() : m.deck_dialog_edit_description()}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="card-question" className="text-sm font-medium">
            {m.deck_form_question_label()}
          </label>
          <Textarea
            id="card-question"
            value={question}
            onChange={(e) => {
              setQuestion(e.target.value);
            }}
            rows={3}
            disabled={submitting}
            required
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="card-answer" className="text-sm font-medium">
            {m.deck_form_answer_label()}
          </label>
          <Textarea
            id="card-answer"
            value={answer}
            onChange={(e) => {
              setAnswer(e.target.value);
            }}
            rows={4}
            disabled={submitting}
            required
          />
        </div>
        {error && (
          <div className="rounded-md border border-red-400/40 bg-red-500/10 p-2 text-sm text-red-100" role="alert">
            {error}
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
            disabled={submitting}
          >
            {m.deck_form_cancel()}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? m.deck_form_saving() : m.deck_form_submit()}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

export default function CardFormDialog({ mode, card, open, onOpenChange, onSaved }: CardFormDialogProps) {
  const bodyKey = open ? `${mode}-${card?.id ?? "new"}` : "closed";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && <CardFormBody key={bodyKey} mode={mode} card={card} onOpenChange={onOpenChange} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  );
}
