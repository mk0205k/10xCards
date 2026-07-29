import { describe, expect, it, vi, beforeEach } from "vitest";

const { createClientMock, rpcMock, signUpMock } = vi.hoisted(() => {
  const rpc = vi.fn();
  const signUp = vi.fn();
  const client = {
    rpc,
    auth: { signUp },
  };
  return {
    createClientMock: vi.fn(() => client),
    rpcMock: rpc,
    signUpMock: signUp,
  };
});

vi.mock("@/lib/supabase", () => ({
  createClient: createClientMock,
}));

import { POST } from "./signup";

function buildContext({ email, password }: { email: string; password: string }) {
  const body = new URLSearchParams();
  body.set("email", email);
  body.set("password", password);
  const request = new Request("http://localhost/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  return {
    request,
    locals: { user: null },
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

describe("POST /api/auth/signup", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    createClientMock.mockReturnValue({
      rpc: rpcMock,
      auth: { signUp: signUpMock },
    });
    rpcMock.mockReset();
    signUpMock.mockReset();
  });

  it("redirects to signup with ACCOUNT_PENDING_DELETION when email is in retention window", async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null });

    const res = await POST(buildContext({ email: "soft@test.local", password: "password123" }));

    expect(res.headers.get("location")).toBe("/auth/signup?error=ACCOUNT_PENDING_DELETION");
    expect(rpcMock).toHaveBeenCalledWith("email_pending_deletion", { p_email: "soft@test.local" });
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("proceeds to signUp when email is clean (RPC returns false)", async () => {
    rpcMock.mockResolvedValueOnce({ data: false, error: null });
    signUpMock.mockResolvedValueOnce({ error: null });

    const res = await POST(buildContext({ email: "fresh@test.local", password: "password123" }));

    expect(signUpMock).toHaveBeenCalledWith({ email: "fresh@test.local", password: "password123" });
    expect(res.headers.get("location")).toBe("/auth/confirm-email");
  });

  it("fails open — proceeds to signUp when the guard RPC errors", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "not found" } });
    signUpMock.mockResolvedValueOnce({ error: null });

    const res = await POST(buildContext({ email: "fresh@test.local", password: "password123" }));

    expect(signUpMock).toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("/auth/confirm-email");
  });

  it("redirects to signup with UNKNOWN when signUp fails (vendor detail collapsed via error-messages registry)", async () => {
    rpcMock.mockResolvedValueOnce({ data: false, error: null });
    signUpMock.mockResolvedValueOnce({ error: { message: "email already in use" } });

    const res = await POST(buildContext({ email: "dup@test.local", password: "password123" }));

    expect(res.headers.get("location")).toBe("/auth/signup?error=UNKNOWN");
  });
});
