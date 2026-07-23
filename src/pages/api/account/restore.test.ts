import { describe, expect, it, vi, beforeEach } from "vitest";

const { createClientMock, rpcMock } = vi.hoisted(() => {
  const rpc = vi.fn();
  const client = { rpc };
  return {
    createClientMock: vi.fn(() => client),
    rpcMock: rpc,
  };
});

vi.mock("@/lib/supabase", () => ({
  createClient: createClientMock,
}));

import { POST } from "./restore";

interface MockUser {
  id: string;
}

function buildContext({ user }: { user?: MockUser | null } = {}) {
  const request = new Request("http://localhost/api/account/restore", { method: "POST" });
  return {
    request,
    locals: { user: user ?? null },
    cookies: {} as never,
    url: new URL(request.url),
    redirect: vi.fn(
      (location: string, status?: number) =>
        new Response(null, {
          status: status ?? 302,
          headers: { location },
        }),
    ),
  } as never;
}

describe("POST /api/account/restore", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createClientMock.mockReturnValue({ rpc: rpcMock });
    rpcMock.mockReset();
  });

  it("returns 401 when the user is missing", async () => {
    const res = await POST(buildContext({ user: null }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("redirects to /auth/restore-account with error when supabase client is null", async () => {
    createClientMock.mockReturnValueOnce(null as never);
    const res = await POST(buildContext({ user: { id: "u1" } }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/auth/restore-account?error=");
  });

  it("redirects to /auth/restore-account with error when restore_account RPC fails", async () => {
    rpcMock.mockResolvedValueOnce({ error: { code: "P0001", message: "boom" } });
    const res = await POST(buildContext({ user: { id: "u1" } }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/auth/restore-account?error=");
  });

  it("redirects to /dashboard with 303 on success", async () => {
    rpcMock.mockResolvedValueOnce({ error: null });

    const res = await POST(buildContext({ user: { id: "u1" } }));

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/dashboard");
    expect(rpcMock).toHaveBeenCalledWith("restore_account");
  });
});
