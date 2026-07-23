import { describe, expect, it, vi, beforeEach } from "vitest";

const { createClientMock, rpcMock, signOutMock } = vi.hoisted(() => {
  const rpc = vi.fn();
  const signOut = vi.fn();
  const client = {
    rpc,
    auth: { signOut },
  };
  return {
    createClientMock: vi.fn(() => client),
    rpcMock: rpc,
    signOutMock: signOut,
  };
});

vi.mock("@/lib/supabase", () => ({
  createClient: createClientMock,
}));

import { POST } from "./delete";

interface MockUser {
  id: string;
}

function buildContext({ user }: { user?: MockUser | null } = {}) {
  const request = new Request("http://localhost/api/account/delete", { method: "POST" });
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

describe("POST /api/account/delete", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createClientMock.mockReturnValue({
      rpc: rpcMock,
      auth: { signOut: signOutMock },
    });
    rpcMock.mockReset();
    signOutMock.mockReset();
  });

  it("returns 401 when the user is missing", async () => {
    const res = await POST(buildContext({ user: null }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("redirects to /account with error when supabase client is null", async () => {
    createClientMock.mockReturnValueOnce(null as never);
    const res = await POST(buildContext({ user: { id: "u1" } }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/account?error=");
  });

  it("redirects to /account with error when enqueue_hard_delete RPC fails", async () => {
    rpcMock.mockResolvedValueOnce({ error: { code: "P0001", message: "boom" } });
    const res = await POST(buildContext({ user: { id: "u1" } }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("/account?error=");
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("redirects to / with 303 on success and calls RPC + global signOut", async () => {
    rpcMock.mockResolvedValueOnce({ error: null });
    signOutMock.mockResolvedValueOnce({ error: null });

    const res = await POST(buildContext({ user: { id: "u1" } }));

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    expect(rpcMock).toHaveBeenCalledWith("enqueue_hard_delete", { p_user_id: "u1" });
    expect(signOutMock).toHaveBeenCalledWith({ scope: "global" });
  });

  it("still redirects to / when global signOut fails (best-effort)", async () => {
    rpcMock.mockResolvedValueOnce({ error: null });
    signOutMock.mockResolvedValueOnce({ error: { message: "network blip" } });

    const res = await POST(buildContext({ user: { id: "u1" } }));

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
  });
});
