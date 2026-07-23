import { useCallback, useEffect, useReducer, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { fetchNext, rateCard, ReviewApiError, type NextResponse, type PreviewMap, type Rating } from "@/lib/api/review";
import { m } from "@/paraglide/messages.js";
import { getLocale } from "@/paraglide/runtime.js";

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
  | { type: "submitting" }
  | { type: "reset" };

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
    case "reset":
      return initialState;
  }
}

function formatRelativeDate(iso: string, now: Date): string {
  const target = new Date(iso).getTime();
  const diffMs = target - now.getTime();
  if (diffMs <= 0) return m.review_when_now();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return m.review_when_minutes({ n: minutes });
  const hours = Math.round(diffMs / 3_600_000);
  if (hours < 24) return m.review_when_hours({ n: hours });
  const days = Math.round(diffMs / 86_400_000);
  if (days === 1) return m.review_when_tomorrow();
  if (days < 7) return m.review_when_days({ n: days });
  return new Date(iso).toLocaleDateString(getLocale());
}

const RATING_ORDER = [
  { rating: 1 as Rating, key: "again" as const, label: m.review_rating_again, variant: "destructive" as const },
  { rating: 2 as Rating, key: "hard" as const, label: m.review_rating_hard, variant: "outline" as const },
  { rating: 3 as Rating, key: "good" as const, label: m.review_rating_good, variant: "default" as const },
  { rating: 4 as Rating, key: "easy" as const, label: m.review_rating_easy, variant: "secondary" as const },
];

export default function ReviewSession() {
  const [state, dispatch] = useReducer(reducer, initialState);
  // Generation counter — every reset (or a fresh call site) bumps it; in-flight
  // requests capture the generation at start and only dispatch when it still
  // matches, so a slow response landing after reset can't overwrite fresh state.
  const generationRef = useRef(0);

  const loadNext = useCallback(async () => {
    const gen = generationRef.current;
    try {
      const data = await fetchNext();
      if (gen !== generationRef.current) return;
      dispatch({ type: "loaded", data });
    } catch (error) {
      if (gen !== generationRef.current) return;
      const message = error instanceof ReviewApiError ? error.message : m.review_error_next();
      dispatch({ type: "error", message });
    }
  }, []);

  useEffect(() => {
    void loadNext();
  }, [loadNext]);

  const onReveal = useCallback(() => {
    dispatch({ type: "reveal" });
  }, []);

  const onReset = useCallback(() => {
    generationRef.current += 1;
    dispatch({ type: "reset" });
    void loadNext();
  }, [loadNext]);

  const onRate = useCallback(
    async (rating: Rating) => {
      const card = state.data?.card ?? null;
      if (!card) return;
      const gen = generationRef.current;
      dispatch({ type: "submitting" });
      try {
        await rateCard(card.id, rating);
        if (gen !== generationRef.current) return;
        await loadNext();
      } catch (error) {
        if (gen !== generationRef.current) return;
        const message = error instanceof ReviewApiError ? error.message : m.review_error_save();
        dispatch({ type: "error", message });
      }
    },
    [state.data, loadNext],
  );

  if (state.phase === "loading" && !state.data) {
    return (
      <SessionShell>
        <div className="flex justify-center">
          <Spinner size="md" label={m.review_loading()} />
        </div>
      </SessionShell>
    );
  }

  if (state.phase === "error") {
    return (
      <SessionShell>
        <div className="mb-4 flex justify-end">
          <ResetButton onReset={onReset} disabled={false} />
        </div>
        <Alert
          variant="error"
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void loadNext();
              }}
            >
              {m.review_retry()}
            </Button>
          }
        >
          {state.errorMessage ?? m.review_error_generic()}
        </Alert>
      </SessionShell>
    );
  }

  const data = state.data;
  if (data && !data.card) {
    return <EmptyQueue nextDueAt={data.nextDueAt} />;
  }

  if (!data?.card) {
    return (
      <SessionShell>
        <div className="flex justify-center">
          <Spinner size="md" label={m.review_loading()} />
        </div>
      </SessionShell>
    );
  }

  const { card, preview } = data;
  const submitting = state.phase === "submitting";

  return (
    <SessionShell>
      <div className="mb-4 flex justify-end">
        <ResetButton onReset={onReset} disabled={submitting} />
      </div>
      <div className="space-y-6">
        <section>
          <h2 className="mb-2 text-sm tracking-wide text-blue-200/70 uppercase">{m.review_question()}</h2>
          <p className="text-lg whitespace-pre-wrap">{card.question}</p>
        </section>

        {state.phase === "answer" || submitting ? (
          <>
            <section>
              <h2 className="mb-2 text-sm tracking-wide text-blue-200/70 uppercase">{m.review_answer()}</h2>
              <p className="text-lg whitespace-pre-wrap text-white">{card.answer}</p>
            </section>
            <RatingRow preview={preview} submitting={submitting} onRate={onRate} />
          </>
        ) : (
          <Button size="lg" onClick={onReveal} disabled={submitting}>
            {m.review_show_answer()}
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
          <span>{label()}</span>
          <span className="text-xs opacity-80">→ {preview[key].interval}</span>
        </Button>
      ))}
    </div>
  );
}

function EmptyQueue({ nextDueAt }: { nextDueAt: string | null }) {
  const now = new Date();
  const description =
    nextDueAt === null ? m.review_empty_deck() : m.review_next_card_at({ when: formatRelativeDate(nextDueAt, now) });
  return (
    <SessionShell>
      <EmptyState
        title={m.review_session_complete()}
        description={description}
        className="border-transparent bg-transparent p-0"
      />
    </SessionShell>
  );
}

function SessionShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/10 p-6 text-white backdrop-blur-xl">{children}</div>
  );
}

function ResetButton({ onReset, disabled }: { onReset: () => void; disabled: boolean }) {
  return (
    <Button variant="ghost" size="sm" onClick={onReset} disabled={disabled} aria-label={m.review_reset_aria()}>
      {m.review_reset_button()}
    </Button>
  );
}
