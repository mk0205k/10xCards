import { describe, expect, it, vi, beforeEach } from "vitest";

const { createClientMock, chain } = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const limit = vi.fn(() => ({ maybeSingle }));
  const order = vi.fn(() => ({ limit }));
  const lte = vi.fn(() => ({ order }));
  const gt = vi.fn(() => ({ order }));
  const eq = vi.fn((_col: string, _val: string) => ({ lte, gt }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const client = { from };
  return {
    createClientMock: vi.fn(() => client),
    chain: { from, select, eq, lte, gt, order, limit, maybeSingle },
  };
});

vi.mock("@/lib/supabase", () => ({
  createClient: createClientMock,
}));

import { GET, ALL } from "./next";

interface MockUser {
  id: string;
}

function buildContext({ method = "GET", user }: { method?: string; user?: MockUser | null } = {}) {
  const request = new Request("http://localhost/api/review/next", { method });
  return {
    request,
    locals: { user: user ?? null },
    cookies: {} as never,
    url: new URL(request.url),
  } as never;
}

const CARD_ROW = {
  id: "card-1",
  user_id: "u1",
  question: "q",
  answer: "a",
  source: "ai",
  created_at: "2026-07-09T00:00:00.000Z",
  updated_at: "2026-07-09T00:00:00.000Z",
  due: "2026-07-08T00:00:00.000Z",
  stability: 0,
  difficulty: 0,
  elapsed_days: 0,
  scheduled_days: 0,
  learning_steps: 0,
  reps: 0,
  lapses: 0,
  state: 0,
  last_review: null,
};

describe("GET /api/review/next", () => {
  beforeEach(() => {
    createClientMock.mockClear();
    chain.from.mockClear();
    chain.select.mockClear();
    chain.eq.mockClear();
    chain.lte.mockClear();
    chain.gt.mockClear();
    chain.order.mockClear();
    chain.limit.mockClear();
    chain.maybeSingle.mockReset();
  });

  it("returns 401 when the user is missing", async () => {
    const res = await GET(buildContext({ user: null }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("returns 500 when the supabase client is not configured", async () => {
    createClientMock.mockReturnValueOnce(null as never);
    const res = await GET(buildContext({ user: { id: "u1" } }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "supabase not configured" });
  });

  it("returns 200 with card + preview when a card is due", async () => {
    chain.maybeSingle.mockResolvedValueOnce({ data: CARD_ROW, error: null });
    const res = await GET(buildContext({ user: { id: "u1" } }));
    expect(res.status).toBe(200);
    const body: { card: { id: string }; preview: Record<string, { due: string; interval: string }> } = await res.json();
    expect(body.card.id).toBe("card-1");
    expect(Object.keys(body.preview).sort()).toEqual(["again", "easy", "good", "hard"]);
    for (const key of ["again", "hard", "good", "easy"] as const) {
      expect(typeof body.preview[key].due).toBe("string");
      expect(body.preview[key].interval.length).toBeGreaterThan(0);
    }
  });

  it("returns 200 with { card: null, nextDueAt: <iso> } when queue empty but upcoming exists", async () => {
    chain.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null }) // no due card
      .mockResolvedValueOnce({ data: { due: "2026-07-10T00:00:00.000Z" }, error: null });
    const res = await GET(buildContext({ user: { id: "u1" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ card: null, nextDueAt: "2026-07-10T00:00:00.000Z" });
  });

  it("returns 200 with { card: null, nextDueAt: null } when the user has no cards at all", async () => {
    chain.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    const res = await GET(buildContext({ user: { id: "u1" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ card: null, nextDueAt: null });
  });

  it("returns 500 when the due-card select errors", async () => {
    chain.maybeSingle.mockResolvedValueOnce({ data: null, error: { code: "XX", message: "boom" } });
    const res = await GET(buildContext({ user: { id: "u1" } }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "select failed" });
  });

  it("returns 405 for non-GET methods", async () => {
    const res = await ALL(buildContext({ method: "POST", user: { id: "u1" } }));
    expect(res.status).toBe(405);
  });
});
