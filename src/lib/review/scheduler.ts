import { fsrs, createEmptyCard, Rating, TypeConvert, generatorParameters, type Card, type FSRS } from "ts-fsrs";
import type { Database } from "@/db/database.types";

type CardRow = Database["public"]["Tables"]["cards"]["Row"];

export interface PreviewEntry {
  due: string;
  interval: string;
}

export interface PreviewMap {
  again: PreviewEntry;
  hard: PreviewEntry;
  good: PreviewEntry;
  easy: PreviewEntry;
}

export interface CreateSchedulerOptions {
  enableFuzz?: boolean;
}

export function createScheduler(opts: CreateSchedulerOptions = {}): FSRS {
  return fsrs(
    generatorParameters({
      enable_fuzz: opts.enableFuzz ?? true,
      request_retention: 0.9,
      maximum_interval: 36500,
      enable_short_term: true,
    }),
  );
}

export const defaultScheduler: FSRS = createScheduler({ enableFuzz: true });

export interface EmptyCardState {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
}

// FSRS state keys added to POST /api/cards inserts. Mirrors createEmptyCard().
export function emptyCardState(): EmptyCardState {
  const empty = createEmptyCard();
  return {
    due: empty.due.toISOString(),
    stability: empty.stability,
    difficulty: empty.difficulty,
    // ts-fsrs 6.0 will drop elapsed_days; we persist it for DB round-trip fidelity until then.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    elapsed_days: empty.elapsed_days,
    scheduled_days: empty.scheduled_days,
    learning_steps: empty.learning_steps,
    reps: empty.reps,
    lapses: empty.lapses,
    state: empty.state,
    last_review: null,
  };
}

// Convert a DB row into an in-memory ts-fsrs Card (Dates + State enum).
// Supabase returns timestamptz as ISO string; ts-fsrs schedulers require Date.
export function hydrateCard(row: CardRow): Card {
  return TypeConvert.card({
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    last_review: row.last_review ?? undefined,
  });
}

export function computePreview(scheduler: FSRS, card: Card, now: Date): PreviewMap {
  const preview = scheduler.repeat(card, now);
  return {
    again: buildEntry(preview[Rating.Again].card.due, now),
    hard: buildEntry(preview[Rating.Hard].card.due, now),
    good: buildEntry(preview[Rating.Good].card.due, now),
    easy: buildEntry(preview[Rating.Easy].card.due, now),
  };
}

function buildEntry(due: Date, now: Date): PreviewEntry {
  return {
    due: due.toISOString(),
    interval: formatInterval(due.getTime() - now.getTime()),
  };
}

// Human-readable interval for rating-button hints. Input is milliseconds.
export function formatInterval(ms: number): string {
  if (ms <= 0) return "now";
  const minutes = ms / 60_000;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = ms / 3_600_000;
  if (hours < 48) return `${Math.round(hours)}h`;
  const days = ms / 86_400_000;
  if (days < 30) return `${Math.round(days)}d`;
  const months = days / 30;
  if (months < 12) return `${Math.round(months)}mo`;
  return `${Math.round(days / 365)}y`;
}
