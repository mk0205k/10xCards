import { useEffect, useReducer, useState } from "react";
import { listCards, CardApiError, type CardRow } from "@/lib/api/cards";
import CardListItem from "@/components/deck/CardListItem";
import CardFormDialog, { type CardFormMode } from "@/components/deck/CardFormDialog";
import DeleteConfirmDialog from "@/components/deck/DeleteConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Phase = "loading" | "ready" | "error";

interface DialogState {
  mode: CardFormMode | null;
  card?: CardRow;
}

interface State {
  phase: Phase;
  cards: CardRow[];
  error: string | null;
  dialog: DialogState;
  deleteTarget: CardRow | null;
}

type Action =
  | { type: "loadStart" }
  | { type: "loadSuccess"; cards: CardRow[] }
  | { type: "loadError"; message: string }
  | { type: "openCreate" }
  | { type: "openEdit"; card: CardRow }
  | { type: "closeDialog" }
  | { type: "savedCreate"; card: CardRow }
  | { type: "savedEdit"; card: CardRow }
  | { type: "openDelete"; card: CardRow }
  | { type: "closeDelete" }
  | { type: "deleted"; id: string };

const initialState: State = {
  phase: "loading",
  cards: [],
  error: null,
  dialog: { mode: null },
  deleteTarget: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "loadStart":
      return { ...state, phase: "loading", cards: [], error: null };
    case "loadSuccess":
      return { ...state, phase: "ready", cards: action.cards, error: null };
    case "loadError":
      return { ...state, phase: "error", cards: [], error: action.message };
    case "openCreate":
      return { ...state, dialog: { mode: "create" } };
    case "openEdit":
      return { ...state, dialog: { mode: "edit", card: action.card } };
    case "closeDialog":
      return { ...state, dialog: { mode: null } };
    case "savedCreate":
      return { ...state, cards: [action.card, ...state.cards], dialog: { mode: null } };
    case "savedEdit":
      return {
        ...state,
        cards: state.cards.map((c) => (c.id === action.card.id ? action.card : c)),
        dialog: { mode: null },
      };
    case "openDelete":
      return { ...state, deleteTarget: action.card };
    case "closeDelete":
      return { ...state, deleteTarget: null };
    case "deleted":
      return {
        ...state,
        cards: state.cards.filter((c) => c.id !== action.id),
        deleteTarget: null,
      };
    default:
      return state;
  }
}

export default function DeckPanel() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    dispatch({ type: "loadStart" });
    listCards()
      .then((cards) => {
        if (!cancelled) dispatch({ type: "loadSuccess", cards });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof CardApiError ? error.message : "Nie udało się załadować talii.";
        dispatch({ type: "loadError", message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSaved = (card: CardRow) => {
    if (state.dialog.mode === "create") {
      dispatch({ type: "savedCreate", card });
    } else if (state.dialog.mode === "edit") {
      dispatch({ type: "savedEdit", card });
    }
  };

  const q = search.trim().toLowerCase();
  const filtered =
    q === ""
      ? state.cards
      : state.cards.filter((c) => c.question.toLowerCase().includes(q) || c.answer.toLowerCase().includes(q));

  const dialog = (
    <CardFormDialog
      mode={state.dialog.mode ?? "create"}
      card={state.dialog.card}
      open={state.dialog.mode !== null}
      onOpenChange={(open) => {
        if (!open) dispatch({ type: "closeDialog" });
      }}
      onSaved={handleSaved}
    />
  );

  const deleteDialog = (
    <DeleteConfirmDialog
      card={state.deleteTarget}
      onOpenChange={(open) => {
        if (!open) dispatch({ type: "closeDelete" });
      }}
      onDeleted={(id) => {
        dispatch({ type: "deleted", id });
      }}
    />
  );

  if (state.phase === "loading") {
    return <p className="text-sm text-blue-100/60">Ładowanie…</p>;
  }

  if (state.phase === "error") {
    return (
      <div className="rounded-lg border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-100">
        {state.error ?? "Wystąpił błąd."}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Input
          type="search"
          placeholder="Szukaj w talii…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
          }}
          className="sm:max-w-xs"
          aria-label="Szukaj w talii"
        />
        <Button
          onClick={() => {
            dispatch({ type: "openCreate" });
          }}
        >
          Dodaj fiszkę
        </Button>
      </div>
      {state.cards.length === 0 ? (
        <p className="text-sm text-blue-100/70">
          Twoja talia jest pusta. Wygeneruj fiszki przez AI albo dodaj ręcznie.
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-blue-100/70">Brak wyników</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((card) => (
            <CardListItem
              key={card.id}
              card={card}
              onEditClick={() => {
                dispatch({ type: "openEdit", card });
              }}
              onDeleteClick={() => {
                dispatch({ type: "openDelete", card });
              }}
            />
          ))}
        </div>
      )}
      {dialog}
      {deleteDialog}
    </div>
  );
}
