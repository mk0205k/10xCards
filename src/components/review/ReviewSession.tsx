import { useCallback, useEffect, useReducer } from "react";
import { Button } from "@/components/ui/button";
import { fetchNext, rateCard, ReviewApiError, type NextResponse, type PreviewMap, type Rating } from "@/lib/api/review";

type Phase = "loading" | "question" | "answer" | "submitting" | "error";

interface State {
  phase: Phase;
  data: NextResponse | null;
  errorMessage: string | null;
}

type Action =
  | { type: "loaded"; data: NextResponse }
  | { type: "error"; message: string }
  | { type: "reveal" }
  | { type: "submitting" };

const initialState: State = {
  phase: "loading",
  data: null,
  errorMessage: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "loaded":
      return {
        phase: action.data.card ? "question" : "loading",
        data: action.data,
        errorMessage: null,
      };
    case "error":
      return { ...state, phase: "error", errorMessage: action.message };
    case "reveal":
      return state.phase === "question" ? { ...state, phase: "answer" } : state;
    case "submitting":
      return { ...state, phase: "submitting" };
  }
}

function formatRelativeDate(iso: string, now: Date): string {
  const target = new Date(iso).getTime();
  const diffMs = target - now.getTime();
  if (diffMs <= 0) return "za chwilę";
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `za ${minutes} min`;
  const hours = Math.round(diffMs / 3_600_000);
  if (hours < 24) return `za ${hours} h`;
  const days = Math.round(diffMs / 86_400_000);
  if (days === 1) return "jutro";
  if (days < 7) return `za ${days} dni`;
  return new Date(iso).toLocaleDateString();
}

const RATING_ORDER = [
  { rating: 1 as Rating, key: "again" as const, label: "Again", variant: "destructive" as const },
  { rating: 2 as Rating, key: "hard" as const, label: "Hard", variant: "outline" as const },
  { rating: 3 as Rating, key: "good" as const, label: "Good", variant: "default" as const },
  { rating: 4 as Rating, key: "easy" as const, label: "Easy", variant: "secondary" as const },
];

export default function ReviewSession() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const loadNext = useCallback(async () => {
    try {
      const data = await fetchNext();
      dispatch({ type: "loaded", data });
    } catch (error) {
      const message = error instanceof ReviewApiError ? error.message : "Nie udało się pobrać kolejnej fiszki";
      dispatch({ type: "error", message });
    }
  }, []);

  useEffect(() => {
    void loadNext();
  }, [loadNext]);

  const onReveal = useCallback(() => {
    dispatch({ type: "reveal" });
  }, []);

  const onRate = useCallback(
    async (rating: Rating) => {
      const card = state.data?.card ?? null;
      if (!card) return;
      dispatch({ type: "submitting" });
      try {
        await rateCard(card.id, rating);
        await loadNext();
      } catch (error) {
        const message = error instanceof ReviewApiError ? error.message : "Nie udało się zapisać oceny";
        dispatch({ type: "error", message });
      }
    },
    [state.data, loadNext],
  );

  if (state.phase === "loading" && !state.data) {
    return <SessionShell>Ładowanie…</SessionShell>;
  }

  if (state.phase === "error") {
    return (
      <SessionShell>
        <p className="text-red-300">{state.errorMessage ?? "Coś poszło nie tak"}</p>
        <div className="mt-4">
          <Button
            variant="outline"
            onClick={() => {
              void loadNext();
            }}
          >
            Spróbuj ponownie
          </Button>
        </div>
      </SessionShell>
    );
  }

  const data = state.data;
  if (data && !data.card) {
    return <EmptyQueue nextDueAt={data.nextDueAt} />;
  }

  if (!data?.card) {
    return <SessionShell>Ładowanie…</SessionShell>;
  }

  const { card, preview } = data;
  const submitting = state.phase === "submitting";

  return (
    <SessionShell>
      <div className="space-y-6">
        <section>
          <h2 className="mb-2 text-sm tracking-wide text-blue-200/70 uppercase">Pytanie</h2>
          <p className="text-lg whitespace-pre-wrap">{card.question}</p>
        </section>

        {state.phase === "answer" || submitting ? (
          <>
            <section>
              <h2 className="mb-2 text-sm tracking-wide text-blue-200/70 uppercase">Odpowiedź</h2>
              <p className="text-lg whitespace-pre-wrap text-white">{card.answer}</p>
            </section>
            <RatingRow preview={preview} submitting={submitting} onRate={onRate} />
          </>
        ) : (
          <Button size="lg" onClick={onReveal} disabled={submitting}>
            Pokaż odpowiedź
          </Button>
        )}
      </div>
    </SessionShell>
  );
}

function RatingRow({
  preview,
  submitting,
  onRate,
}: {
  preview: PreviewMap;
  submitting: boolean;
  onRate: (rating: Rating) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {RATING_ORDER.map(({ rating, key, label, variant }) => (
        <Button
          key={key}
          variant={variant}
          disabled={submitting}
          onClick={() => {
            onRate(rating);
          }}
          className="flex-col py-6 text-base"
        >
          <span>{label}</span>
          <span className="text-xs opacity-80">→ {preview[key].interval}</span>
        </Button>
      ))}
    </div>
  );
}

function EmptyQueue({ nextDueAt }: { nextDueAt: string | null }) {
  const now = new Date();
  return (
    <SessionShell>
      <div className="space-y-3 text-center">
        <p className="text-lg">Sesja zakończona 🎉</p>
        <p className="text-blue-100/70">
          {nextDueAt === null
            ? "Brak fiszek w talii."
            : `Następna karta do powtórki: ${formatRelativeDate(nextDueAt, now)}.`}
        </p>
      </div>
    </SessionShell>
  );
}

function SessionShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/10 p-6 text-white backdrop-blur-xl">{children}</div>
  );
}
