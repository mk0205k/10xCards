import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useProposalStream } from "@/components/hooks/useProposalStream";
import type { ProposalsAction } from "@/components/generate/proposalsReducer";
import {
  successResponse,
  malformedSuffixResponse,
  errorResponse,
  partialThenErrorResponse,
} from "@/test/fixtures/generate-stream";

/**
 * Client-hook contract tests for Risk #1 Face-B (endpoint↔client wire).
 * Oracle: research §Two faces of Risk #1 + test-plan.md §2 row 1.
 *
 * Mocking strategy per plan Phase 2 §7: stub `global.fetch` with a Response
 * whose body is a hand-crafted `ReadableStream<Uint8Array>` (see fixtures).
 * The reducer's terminal state is derived from dispatched actions captured
 * via a spy dispatch function.
 */

describe("useProposalStream", () => {
  let dispatched: ProposalsAction[];
  let dispatch: (action: ProposalsAction) => void;

  beforeEach(() => {
    dispatched = [];
    dispatch = vi.fn((action: ProposalsAction) => {
      dispatched.push(action);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dispatches stream/chunk then stream/done on a full-success response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        successResponse([
          { question: "What is spaced repetition?", answer: "A learning technique." },
          { question: "Who coined it?", answer: "Ebbinghaus is a common attribution." },
        ]),
      ),
    );

    const { result } = renderHook(() => useProposalStream(dispatch));
    await act(async () => {
      await result.current.start("some text");
    });

    await waitFor(() => {
      expect(dispatched.some((a) => a.type === "stream/done")).toBe(true);
    });

    const chunks = dispatched.filter(
      (a): a is Extract<ProposalsAction, { type: "stream/chunk" }> => a.type === "stream/chunk",
    );
    expect(chunks.length).toBeGreaterThan(0);
    const finalChunk = chunks[chunks.length - 1];
    expect(finalChunk.proposals).toEqual([
      { question: "What is spaced repetition?", answer: "A learning technique." },
      { question: "Who coined it?", answer: "Ebbinghaus is a common attribution." },
    ]);
  });

  // PHASE 1 LIMITATION: `useProposalStream.ts:65-82` does not detect truncation;
  // when GENERATION_TRUNCATED lands (research Q5 deferred), this test flips
  // from an `it.todo` to a real `it` asserting `stream/abort` with the code.
  // Source: research §"Silent-loss gap".
  it.todo("mid-JSON truncation should dispatch stream/abort with GENERATION_TRUNCATED");

  it("dispatches stream/done with the leading well-formed proposals when body has malformed suffix", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(malformedSuffixResponse([{ question: "Q1", answer: "A1" }])));

    const { result } = renderHook(() => useProposalStream(dispatch));
    await act(async () => {
      await result.current.start("some text");
    });

    await waitFor(() => {
      expect(dispatched.some((a) => a.type === "stream/done")).toBe(true);
    });

    const chunks = dispatched.filter(
      (a): a is Extract<ProposalsAction, { type: "stream/chunk" }> => a.type === "stream/chunk",
    );
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[chunks.length - 1].proposals).toEqual([{ question: "Q1", answer: "A1" }]);
  });

  it("dispatches stream/abort with the endpoint's error code when response is 502 with a JSON error body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errorResponse(502, "GENERATION_FAILED")));

    const { result } = renderHook(() => useProposalStream(dispatch));
    await act(async () => {
      await result.current.start("some text");
    });

    await waitFor(() => {
      const abort = dispatched.find(
        (a): a is Extract<ProposalsAction, { type: "stream/abort" }> => a.type === "stream/abort",
      );
      expect(abort).toBeDefined();
      expect(abort?.reason).toBe("GENERATION_FAILED");
    });
    expect(dispatched.some((a) => a.type === "stream/done")).toBe(false);
  });

  it("dispatches stream/abort when the stream errors mid-body after a valid prefix", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(partialThenErrorResponse([{ question: "Q1", answer: "A1" }], 20)));

    const { result } = renderHook(() => useProposalStream(dispatch));
    await act(async () => {
      await result.current.start("some text");
    });

    await waitFor(() => {
      expect(dispatched.some((a) => a.type === "stream/abort")).toBe(true);
    });
    // stream/done must NOT fire when the reader errored mid-body.
    expect(dispatched.some((a) => a.type === "stream/done")).toBe(false);
  });
});
