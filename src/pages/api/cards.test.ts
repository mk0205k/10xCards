import { describe, expect, it, vi, beforeEach } from "vitest";

const { createClientMock, insertBuilder } = vi.hoisted(() => {
  const single = vi.fn();
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ insert }));
  const client = { from };
  return {
    createClientMock: vi.fn(() => client),
    insertBuilder: { from, insert, select, single },
  };
});

vi.mock("@/lib/supabase", () => ({
  createClient: createClientMock,
}));

import { POST, ALL } from "./cards";

interface MockUser {
  id: string;
}

function buildContext({
  method = "POST",
  body,
  user,
}: {
  method?: string;
  body?: unknown;
  user?: MockUser | null;
} = {}) {
  const request = new Request("http://localhost/api/cards", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    request,
    locals: { user: user ?? null },
    cookies: {} as never,
    url: new URL(request.url),
  } as never;
}

describe("POST /api/cards", () => {
  beforeEach(() => {
    createClientMock.mockClear();
    insertBuilder.from.mockClear();
    insertBuilder.insert.mockClear();
    insertBuilder.select.mockClear();
    insertBuilder.single.mockReset();
  });

  it("returns 401 when the user is missing", async () => {
    const res = await POST(buildContext({ user: null, body: { question: "q", answer: "a" } }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("returns 400 when question is empty", async () => {
    const res = await POST(buildContext({ user: { id: "u1" }, body: { question: "", answer: "a" } }));
    expect(res.status).toBe(400);
    const body: { error: string } = await res.json();
    expect(body.error).toBe("invalid input");
  });

  it("returns 400 when answer is empty", async () => {
    const res = await POST(buildContext({ user: { id: "u1" }, body: { question: "q", answer: "" } }));
    expect(res.status).toBe(400);
    const body: { error: string } = await res.json();
    expect(body.error).toBe("invalid input");
  });

  it("returns 405 for non-POST methods", async () => {
    const res = await ALL(buildContext({ method: "PUT", user: { id: "u1" } }));
    expect(res.status).toBe(405);
  });

  it("returns 201 with the inserted row on success", async () => {
    insertBuilder.single.mockResolvedValue({
      data: {
        id: "card-1",
        user_id: "u1",
        question: "q",
        answer: "a",
        source: "ai",
        created_at: "2026-07-08T00:00:00Z",
        updated_at: "2026-07-08T00:00:00Z",
      },
      error: null,
    });

    const res = await POST(buildContext({ user: { id: "u1" }, body: { question: "q", answer: "a", source: "ai" } }));

    expect(res.status).toBe(201);
    const body: { card: { id: string; user_id: string; source: string } } = await res.json();
    expect(body.card.id).toBe("card-1");
    expect(body.card.user_id).toBe("u1");
    expect(body.card.source).toBe("ai");
    expect(insertBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "u1",
        question: "q",
        answer: "a",
        source: "ai",
        state: 0,
        reps: 0,
      }),
    );
  });

  it("defaults source to 'ai' when omitted", async () => {
    insertBuilder.single.mockResolvedValue({
      data: {
        id: "card-2",
        user_id: "u1",
        question: "q",
        answer: "a",
        source: "ai",
        created_at: "2026-07-08T00:00:00Z",
        updated_at: "2026-07-08T00:00:00Z",
      },
      error: null,
    });

    const res = await POST(buildContext({ user: { id: "u1" }, body: { question: "q", answer: "a" } }));
    expect(res.status).toBe(201);
    expect(insertBuilder.insert).toHaveBeenCalledWith(expect.objectContaining({ source: "ai" }));
  });

  it("returns 500 when supabase reports an error", async () => {
    insertBuilder.single.mockResolvedValue({ data: null, error: { message: "db error" } });
    const res = await POST(buildContext({ user: { id: "u1" }, body: { question: "q", answer: "a" } }));
    expect(res.status).toBe(500);
    const body: { error: string } = await res.json();
    expect(body.error).toBe("insert failed");
  });
});
