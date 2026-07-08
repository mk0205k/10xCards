import { describe, expect, it, vi, beforeEach } from "vitest";

const { generateProposalsMock } = vi.hoisted(() => ({
  generateProposalsMock: vi.fn(),
}));

vi.mock("astro:env/server", () => ({
  OPENROUTER_API_KEY: "test-key",
  OPENROUTER_MODEL: "test/model",
}));

vi.mock("@/lib/ai/generate-proposals", () => ({
  generateProposals: generateProposalsMock,
}));

import { POST, ALL } from "./generate";

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
  const request = new Request("http://localhost/api/generate", {
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

function stubStreamResult() {
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "text-delta", id: "0", text: "data-stream" });
        controller.close();
      },
    }),
  };
}

describe("POST /api/generate", () => {
  beforeEach(() => {
    generateProposalsMock.mockReset();
  });

  it("returns 401 when the user is missing", async () => {
    const res = await POST(buildContext({ user: null, body: { text: "hello" } }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(generateProposalsMock).not.toHaveBeenCalled();
  });

  it("returns 405 for non-POST methods via ALL handler", async () => {
    const res = await ALL(buildContext({ method: "PUT", user: { id: "u1" } }));
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: "method not allowed" });
  });

  it("returns 400 when text is empty", async () => {
    const res = await POST(buildContext({ user: { id: "u1" }, body: { text: "" } }));
    expect(res.status).toBe(400);
    const body: { error: string; issues: unknown[] } = await res.json();
    expect(body.error).toBe("invalid input");
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it("returns 400 when text exceeds 10 000 characters", async () => {
    const res = await POST(buildContext({ user: { id: "u1" }, body: { text: "x".repeat(10_001) } }));
    expect(res.status).toBe(400);
    const body: { error: string } = await res.json();
    expect(body.error).toBe("invalid input");
  });

  it("returns 400 when body is not JSON", async () => {
    const request = new Request("http://localhost/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });
    const ctx = {
      request,
      locals: { user: { id: "u1" } },
      cookies: {} as never,
      url: new URL(request.url),
    } as never;
    const res = await POST(ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid json" });
  });

  it("returns the AI SDK stream response on valid input", async () => {
    generateProposalsMock.mockReturnValue(stubStreamResult());
    const res = await POST(buildContext({ user: { id: "u1" }, body: { text: "hello world" } }));
    expect(res.status).toBe(200);
    expect(generateProposalsMock).toHaveBeenCalledWith({
      text: "hello world",
      apiKey: "test-key",
      model: "test/model",
    });
    expect(await res.text()).toBe("data-stream");
  });
});
