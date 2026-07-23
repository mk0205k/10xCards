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
          Usuń konto
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Usuń konto trwale</AlertDialogTitle>
          <AlertDialogDescription>
            Konto zostanie oznaczone do usunięcia. Przez 30 dni możesz je przywrócić, logując się ponownie. Po tym
            czasie fiszki i historia powtórek są kasowane nieodwracalnie. Aby potwierdzić, wpisz swój email:{" "}
            <span className="font-semibold">{userEmail}</span>.
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
            aria-label="Wpisz swój email, aby potwierdzić"
          />
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Anuluj</AlertDialogCancel>
            <AlertDialogAction type="submit" disabled={!canSubmit}>
              Usuń konto
            </AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
