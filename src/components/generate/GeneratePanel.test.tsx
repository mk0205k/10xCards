import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { m } from "@/paraglide/messages.js";
import { successResponse, type FixtureProposal } from "@/test/fixtures/generate-stream";
import GeneratePanel from "@/components/generate/GeneratePanel";

/**
 * Component contract tests for Risk #2 Face-B (accept/reject/edit UI wiring).
 * Oracle: PRD FR-007 + roadmap §Vision recap (human-decision layer IS the product).
 *
 * Mount level: `GeneratePanel` end-to-end. Stub `global.fetch` per test to
 * respond for both `/api/generate` (success response with fixture proposals)
 * and `/api/cards` (JSON `{ card: { id } }`).
 *
 * Assertions target visible UI state (roles, text) and outbound fetch payloads
 * — never dispatch spies, snapshots, or internal reducer state. Refactoring
 * the reducer shape must not break these tests.
 */

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function setupFetchStub(proposals: FixtureProposal[]) {
  const calls: FetchCall[] = [];
  let cardCounter = 0;
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    let body: unknown = null;
    if (init?.body != null) {
      const raw = init.body as string;
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    calls.push({ url, method, body });

    if (url.includes("/api/generate")) {
      return Promise.resolve(successResponse(proposals));
    }
    if (url.includes("/api/cards")) {
      cardCounter += 1;
      return Promise.resolve(jsonResponse({ card: { id: `card-${cardCounter}` } }));
    }
    return Promise.reject(new Error(`Unexpected fetch call: ${method} ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls };
}

async function driveGenerate(user: ReturnType<typeof userEvent.setup>) {
  const textarea = screen.getByLabelText(m.generate_form_label());
  await user.type(textarea, "source text for tests");
  await user.click(screen.getByRole("button", { name: new RegExp(m.generate_form_generate()) }));
}

function cardPosts(calls: FetchCall[]): FetchCall[] {
  return calls.filter((c) => c.url.includes("/api/cards") && c.method === "POST");
}

describe("GeneratePanel", () => {
  beforeEach(() => {
    // Clean slate for global.fetch stub per test.
  });

  afterEach(() => {
    // RTL auto-cleanup only runs when Vitest globals are enabled; this project
    // uses explicit imports, so unmount every render manually before the next test.
    cleanup();
    vi.unstubAllGlobals();
  });

  it("accepting a pending proposal POSTs { question, answer, source: 'ai' } to /api/cards and shows the saved-badge in the UI", async () => {
    const { calls } = setupFetchStub([{ question: "What is A?", answer: "A is a letter." }]);
    const user = userEvent.setup();
    render(<GeneratePanel />);

    await driveGenerate(user);
    await screen.findByText("What is A?");

    await user.click(screen.getByRole("button", { name: m.generate_proposal_accept() }));

    await waitFor(() => {
      expect(cardPosts(calls)).toHaveLength(1);
      expect(cardPosts(calls)[0].body).toEqual({
        question: "What is A?",
        answer: "A is a letter.",
        source: "ai",
      });
    });
    await screen.findByText(m.generate_proposal_added());
  });

  it("rejecting a proposal hides it from the visible list and it never appears in a subsequent /api/cards POST", async () => {
    const { calls } = setupFetchStub([
      { question: "Q keep", answer: "A keep." },
      { question: "Q reject", answer: "A reject." },
    ]);
    const user = userEvent.setup();
    render(<GeneratePanel />);

    await driveGenerate(user);
    await screen.findByText("Q keep");
    await screen.findByText("Q reject");

    // Reject the second card.
    const rejectButtons = screen.getAllByRole("button", { name: m.generate_proposal_reject() });
    await user.click(rejectButtons[1]);

    await waitFor(() => {
      expect(screen.queryByText("Q reject")).toBeNull();
    });
    expect(screen.getByText("Q keep")).toBeTruthy();

    // Accept the remaining one to verify the rejected proposal never leaks into the POST.
    await user.click(screen.getByRole("button", { name: m.generate_proposal_accept() }));

    await waitFor(() => {
      expect(cardPosts(calls)).toHaveLength(1);
    });
    const posted = cardPosts(calls)[0].body as { question: string; answer: string };
    expect(posted.question).toBe("Q keep");
    expect(posted.answer).toBe("A keep.");
    // Additionally: no POST ever carried the rejected proposal.
    for (const post of cardPosts(calls)) {
      expect((post.body as { question: string }).question).not.toBe("Q reject");
    }
  });

  it("editing a proposal then accepting POSTs the edited content (not the original)", async () => {
    const { calls } = setupFetchStub([{ question: "Original Q", answer: "Original A." }]);
    const user = userEvent.setup();
    render(<GeneratePanel />);

    await driveGenerate(user);
    await screen.findByText("Original Q");

    // Enter edit mode.
    await user.click(screen.getByRole("button", { name: m.generate_proposal_edit() }));

    // Textareas now shown; find them via the labels inside the editing card.
    const questionField = screen.getByDisplayValue("Original Q");
    const answerField = screen.getByDisplayValue("Original A.");
    await user.clear(questionField);
    await user.type(questionField, "Edited Q");
    await user.clear(answerField);
    await user.type(answerField, "Edited A.");

    // Save the edit — the panel dispatches editSave and immediately persist()s.
    await user.click(screen.getByRole("button", { name: m.generate_proposal_save() }));

    await waitFor(() => {
      expect(cardPosts(calls)).toHaveLength(1);
      expect(cardPosts(calls)[0].body).toEqual({
        question: "Edited Q",
        answer: "Edited A.",
        source: "ai",
      });
    });
    await screen.findByText(m.generate_proposal_added());
  });

  it("bulk-accept POSTs every pending proposal to /api/cards and each transitions to the saved-badge", async () => {
    const { calls } = setupFetchStub([
      { question: "B1 Q", answer: "B1 A." },
      { question: "B2 Q", answer: "B2 A." },
      { question: "B3 Q", answer: "B3 A." },
    ]);
    const user = userEvent.setup();
    render(<GeneratePanel />);

    await driveGenerate(user);
    await screen.findByText("B1 Q");
    await screen.findByText("B2 Q");
    await screen.findByText("B3 Q");

    await user.click(screen.getByRole("button", { name: m.generate_bulk_accept_all_button() }));

    await waitFor(() => {
      expect(cardPosts(calls)).toHaveLength(3);
    });
    const postedQuestions = cardPosts(calls).map((p) => (p.body as { question: string }).question);
    expect(postedQuestions).toEqual(expect.arrayContaining(["B1 Q", "B2 Q", "B3 Q"]));

    // Each proposal now shows the saved badge (3× "Dodano do talii" / "Added to deck").
    await waitFor(() => {
      expect(screen.getAllByText(m.generate_proposal_added())).toHaveLength(3);
    });
  });

  it("bulk-reject opens a confirmation dialog and, on confirm, hides every pending proposal without any /api/cards POST", async () => {
    const { calls } = setupFetchStub([
      { question: "R1 Q", answer: "R1 A." },
      { question: "R2 Q", answer: "R2 A." },
    ]);
    const user = userEvent.setup();
    render(<GeneratePanel />);

    await driveGenerate(user);
    await screen.findByText("R1 Q");
    await screen.findByText("R2 Q");

    await user.click(screen.getByRole("button", { name: m.generate_bulk_reject_all_button() }));

    // Radix AlertDialog renders in a portal; find it and confirm.
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: m.generate_bulk_reject_confirm_confirm() }));

    await waitFor(() => {
      expect(screen.queryByText("R1 Q")).toBeNull();
      expect(screen.queryByText("R2 Q")).toBeNull();
    });
    // No card POSTs on bulk-reject.
    expect(cardPosts(calls)).toHaveLength(0);
  });
});
