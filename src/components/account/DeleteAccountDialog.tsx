import { useState } from "react";
import { Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { m } from "@/paraglide/messages.js";

interface Props {
  userEmail: string;
}

export default function DeleteAccountDialog({ userEmail }: Props) {
  const [confirm, setConfirm] = useState("");
  const canSubmit = confirm.trim() === userEmail && userEmail.length > 0;

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" className="gap-2">
          <Trash2 className="size-4" />
          {m.account_delete_dialog_trigger()}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{m.account_delete_dialog_title()}</AlertDialogTitle>
          <AlertDialogDescription>
            {m.account_delete_dialog_description()} <span className="font-semibold">{userEmail}</span>.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form method="POST" action="/api/account/delete" className="space-y-3">
          <Input
            type="email"
            autoComplete="off"
            placeholder={userEmail}
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
            }}
            aria-label={m.account_delete_dialog_aria_input()}
          />
          <AlertDialogFooter>
            <AlertDialogCancel type="button">{m.account_delete_dialog_cancel()}</AlertDialogCancel>
            <AlertDialogAction type="submit" disabled={!canSubmit}>
              {m.account_delete_dialog_action()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
