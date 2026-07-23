import { useEffect, useReducer } from "react";
import { listCards, CardApiError, type CardRow } from "@/lib/api/cards";
import CardListItem from "@/components/deck/CardListItem";

type Phase = "loading" | "ready" | "error";

interface State {
  phase: Phase;
  cards: CardRow[];
  error: string | null;
}

type Action =
  | { type: "loadStart" }
  | { type: "loadSuccess"; cards: CardRow[] }
  | { type: "loadError"; message: string };

const initialState: State = { phase: "loading", cards: [], error: null };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "loadStart":
      return { phase: "loading", cards: [], error: null };
    case "loadSuccess":
      return { phase: "ready", cards: action.cards, error: null };
    case "loadError":
      return { phase: "error", cards: [], error: action.message };
    default:
      return state;
  }
}

export default function DeckPanel() {
  const [state, dispatch] = useReducer(reducer, initialState);

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

  if (state.cards.length === 0) {
    return (
      <p className="text-sm text-blue-100/70">Twoja talia jest pusta. Wygeneruj fiszki przez AI albo dodaj ręcznie.</p>
    );
  }

  return (
    <div className="space-y-3">
      {state.cards.map((card) => (
        <CardListItem key={card.id} card={card} />
      ))}
    </div>
  );
}
