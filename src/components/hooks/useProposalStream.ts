import { useCallback, useEffect, useRef } from "react";
import { parsePartialJson } from "ai";
import type { ProposalDraft, ProposalsAction } from "@/components/generate/proposalsReducer";

type Dispatch = (action: ProposalsAction) => void;

interface PartialProposals {
  proposals?: Partial<ProposalDraft>[];
}

function extractCompleteProposals(value: unknown): ProposalDraft[] {
  if (!value || typeof value !== "object") return [];
  const items = (value as PartialProposals).proposals;
  if (!Array.isArray(items)) return [];
  const complete: ProposalDraft[] = [];
  for (const item of items) {
    if (
      typeof item.question === "string" &&
      typeof item.answer === "string" &&
      item.question.length > 0 &&
      item.answer.length > 0
    ) {
      complete.push({ question: item.question, answer: item.answer });
    } else {
      break;
    }
  }
  return complete;
}

export function useProposalStream(dispatch: Dispatch) {
  const abortRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const start = useCallback(
    async (text: string) => {
      abort();
      const controller = new AbortController();
      abortRef.current = controller;
      dispatch({ type: "stream/start", text });

      try {
        const response = await fetch("/api/generate", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const message = `Generation failed (${response.status})`;
          dispatch({ type: "stream/abort", reason: message });
          return;
        }

        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        let lastCount = 0;

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          const { value: parsed } = await parsePartialJson(buffer);
          const complete = extractCompleteProposals(parsed);
          if (complete.length !== lastCount) {
            lastCount = complete.length;
            dispatch({ type: "stream/chunk", proposals: complete });
          }
        }

        const { value: finalParsed } = await parsePartialJson(buffer);
        const finalProposals = extractCompleteProposals(finalParsed);
        if (finalProposals.length !== lastCount) {
          dispatch({ type: "stream/chunk", proposals: finalProposals });
        }
        dispatch({ type: "stream/done" });
      } catch (error) {
        if (controller.signal.aborted) {
          dispatch({ type: "stream/abort", reason: "Generation cancelled." });
          return;
        }
        const message = error instanceof Error ? error.message : "Unknown stream error";
        dispatch({ type: "stream/abort", reason: message });
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [abort, dispatch],
  );

  useEffect(() => () => abortRef.current?.abort(), []);

  return { start, abort };
}
