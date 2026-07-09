import { describe, expect, it, vi, beforeEach } from "vitest";

const { createClientMock, chain } = vi.hoisted(() => {
  const selectMaybeSingle = vi.fn();
  const eq = vi.fn(() => ({ maybeSingle: selectMaybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const rpc = vi.fn();
  const client = { from, rpc };
  return {
    createClientMock: vi.fn(() => client),
    chain: { from, select, eq, selectMaybeSingle, rpc },
  };
});

vi.mock("@/lib/supabase", () => ({
  createClient: createClientMock,
}));

import { POST, ALL } from "./rate";

interface MockUser {
  id: string;
}

const VALID_CARD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function buildContext({
  method = "POST",
  body,
  user,
  cardId = VALID_CARD_ID,
}: {
  method?: string;
  body?: unknown;
  user?: MockUser | null;
  cardId?: string;
} = {}) {
  const request = new Request(`http://localhost/api/review/${cardId}/rate`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    request,
    locals: { user: user ?? null },
    cookies: {} as never,
    url: new URL(request.url),
    params: { card_id: cardId },
  } as never;
}

const CARD_ROW = {
  id: VALID_CARD_ID,
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

describe("POST /api/review/[card_id]/rate", () => {
  beforeEach(() => {
    createClientMock.mockClear();
    chain.from.mockClear();
    chain.select.mockClear();
    chain.eq.mockClear();
    chain.selectMaybeSingle.mockReset();
    chain.rpc.mockReset();
  });

  it("returns 401 when the user is missing", async () => {
    const res = await POST(buildContext({ user: null, body: { rating: 3 } }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-uuid card_id", async () => {
    const res = await POST(buildContext({ user: { id: "u1" }, body: { rating: 3 }, cardId: "not-a-uuid" }));
    expect(res.status).toBe(400);
    const body: { error: string } = await res.json();
    expect(body.error).toBe("invalid card_id");
  });

  it("returns 400 for invalid json", async () => {
    const request = new Request(`http://localhost/api/review/${VALID_CARD_ID}/rate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const ctx = {
      request,
      locals: { user: { id: "u1" } },
      cookies: {} as never,
      url: new URL(request.url),
      params: { card_id: VALID_CARD_ID },
    } as never;
    const res = await POST(ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid json" });
  });

  it("returns 400 for out-of-range rating", async () => {
    const res = await POST(buildContext({ user: { id: "u1" }, body: { rating: 5 } }));
    expect(res.status).toBe(400);
    const body: { error: string } = await res.json();
    expect(body.error).toBe("invalid input");
  });

  it("returns 404 when the card is not found", async () => {
    chain.selectMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const res = await POST(buildContext({ user: { id: "u1" }, body: { rating: 3 } }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "card not found" });
    expect(chain.rpc).not.toHaveBeenCalled();
  });

  it("returns 200 with the updated card on happy path (RPC called with payload)", async () => {
    chain.selectMaybeSingle.mockResolvedValueOnce({ data: CARD_ROW, error: null });
    const updatedRow = { ...CARD_ROW, reps: 1, state: 1, due: "2026-07-09T00:10:00.000Z" };
    chain.rpc.mockResolvedValueOnce({ data: updatedRow, error: null });

    const res = await POST(buildContext({ user: { id: "u1" }, body: { rating: 3 } }));
    expect(res.status).toBe(200);
    const body: { card: { id: string; reps: number } } = await res.json();
    expect(body.card.id).toBe(VALID_CARD_ID);
    expect(body.card.reps).toBe(1);

    expect(chain.rpc).toHaveBeenCalledWith(
      "commit_review",
      expect.objectContaining({
        p_card_id: VALID_CARD_ID,
        p_rating: 3,
      }),
    );
  });

  it("returns 404 when the RPC returns 42501 (cross-user attempt)", async () => {
    chain.selectMaybeSingle.mockResolvedValueOnce({ data: CARD_ROW, error: null });
    chain.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "insufficient_privilege" } });

    const res = await POST(buildContext({ user: { id: "u1" }, body: { rating: 3 } }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "card not found" });
  });

  it("returns 500 when the RPC errors with a non-42501 code", async () => {
    chain.selectMaybeSingle.mockResolvedValueOnce({ data: CARD_ROW, error: null });
    chain.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX", message: "boom" } });

    const res = await POST(buildContext({ user: { id: "u1" }, body: { rating: 3 } }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "commit failed" });
  });

  it("returns 405 for non-POST methods", async () => {
    const res = await ALL(buildContext({ method: "PUT", user: { id: "u1" } }));
    expect(res.status).toBe(405);
  });
});
