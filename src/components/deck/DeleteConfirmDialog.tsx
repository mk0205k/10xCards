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
import { deleteCard, CardApiError, type CardRow } from "@/lib/api/cards";
import { m } from "@/paraglide/messages.js";

interface DeleteConfirmDialogProps {
  card: CardRow | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: (id: string) => void;
}

interface DeleteConfirmBodyProps {
  card: CardRow;
  onOpenChange: (open: boolean) => void;
  onDeleted: (id: string) => void;
}

function DeleteConfirmBody({ card, onOpenChange, onDeleted }: DeleteConfirmBodyProps) {
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleConfirm() {
    setError(null);
    setDeleting(true);
    try {
      await deleteCard(card.id);
      onDeleted(card.id);
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof CardApiError ? err.message : m.deck_delete_confirm_failed();
      setError(message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{m.deck_delete_confirm_title()}</DialogTitle>
        <DialogDescription>{m.deck_delete_confirm_body()}</DialogDescription>
      </DialogHeader>
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
          disabled={deleting}
        >
          {m.deck_delete_confirm_cancel()}
        </Button>
        <Button type="button" variant="destructive" onClick={handleConfirm} disabled={deleting}>
          {deleting ? m.deck_delete_confirm_pending() : m.deck_delete_confirm_action()}
        </Button>
      </DialogFooter>
    </>
  );
}

export default function DeleteConfirmDialog({ card, onOpenChange, onDeleted }: DeleteConfirmDialogProps) {
  const open = card !== null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {card && <DeleteConfirmBody key={card.id} card={card} onOpenChange={onOpenChange} onDeleted={onDeleted} />}
      </DialogContent>
    </Dialog>
  );
}
