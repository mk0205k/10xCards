import { describe, expect, it } from "vitest";
import { State } from "ts-fsrs";
import { computePreview, createScheduler, emptyCardState, formatInterval, hydrateCard } from "./scheduler";
import type { Database } from "@/db/database.types";

type CardRow = Database["public"]["Tables"]["cards"]["Row"];

function newCardRow(overrides: Partial<CardRow> = {}): CardRow {
  return {
    id: "c1",
    user_id: "u1",
    question: "q",
    answer: "a",
    source: "ai",
    created_at: "2026-07-09T00:00:00.000Z",
    updated_at: "2026-07-09T00:00:00.000Z",
    due: "2026-07-09T00:00:00.000Z",
    stability: 0,
    difficulty: 0,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: 0,
    lapses: 0,
    state: 0,
    last_review: null,
    ...overrides,
  };
}

describe("emptyCardState", () => {
  it("produces createEmptyCard-shaped defaults", () => {
    const state = emptyCardState();
    expect(state.state).toBe(State.New); // 0
    expect(state.reps).toBe(0);
    expect(state.lapses).toBe(0);
    expect(state.stability).toBe(0);
    expect(state.difficulty).toBe(0);
    expect(state.last_review).toBeNull();
    expect(new Date(state.due).toISOString()).toBe(state.due);
  });
});

describe("hydrateCard", () => {
  it("normalizes ISO string due into a Date and int state into State enum", () => {
    const row = newCardRow({
      due: "2026-07-13T00:00:00.000Z",
      state: 2,
      stability: 4.5,
      difficulty: 5.0,
      scheduled_days: 4,
    });
    const card = hydrateCard(row);
    expect(card.due).toBeInstanceOf(Date);
    expect(card.due.toISOString()).toBe(row.due);
    expect(card.state).toBe(State.Review);
    expect(card.last_review).toBeUndefined();
  });

  it("maps last_review = null into undefined", () => {
    const card = hydrateCard(newCardRow({ last_review: null }));
    expect(card.last_review).toBeUndefined();
  });
});

describe("computePreview", () => {
  it("returns 4 rating keys with monotonically non-decreasing due dates for a new card", () => {
    const scheduler = createScheduler({ enableFuzz: false });
    const card = hydrateCard(newCardRow());
    const now = new Date("2026-07-09T00:00:00.000Z");
    const preview = computePreview(scheduler, card, now);

    expect(Object.keys(preview).sort()).toEqual(["again", "easy", "good", "hard"]);

    const t = (iso: string) => new Date(iso).getTime();
    expect(t(preview.again.due)).toBeLessThanOrEqual(t(preview.hard.due));
    expect(t(preview.hard.due)).toBeLessThanOrEqual(t(preview.good.due));
    expect(t(preview.good.due)).toBeLessThanOrEqual(t(preview.easy.due));

    expect(preview.again.interval.length).toBeGreaterThan(0);
    expect(preview.easy.interval.length).toBeGreaterThan(0);
  });
});

describe("formatInterval", () => {
  it.each<[number, string]>([
    [0, "now"],
    [-1_000, "now"],
    [5 * 60_000, "5m"],
    [2 * 3_600_000, "2h"],
    [4 * 86_400_000, "4d"],
    [45 * 86_400_000, "2mo"],
    [400 * 86_400_000, "1y"],
  ])("formats %ims → %s", (ms, label) => {
    expect(formatInterval(ms)).toBe(label);
  });
});
