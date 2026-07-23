import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { m } from "@/paraglide/messages.js";

interface BulkRejectConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingCount: number;
  onConfirm: () => void;
}

export default function BulkRejectConfirmDialog({
  open,
  onOpenChange,
  pendingCount,
  onConfirm,
}: BulkRejectConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{m.generate_bulk_reject_confirm_title()}</AlertDialogTitle>
          <AlertDialogDescription>
            {m.generate_bulk_reject_confirm_description({ n: pendingCount })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel type="button">{m.generate_bulk_reject_confirm_cancel()}</AlertDialogCancel>
          <AlertDialogAction type="button" onClick={onConfirm}>
            {m.generate_bulk_reject_confirm_confirm()}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
