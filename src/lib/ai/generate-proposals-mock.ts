import type { streamText } from "ai";
import type { FixtureProposal } from "@/test/fixtures/generate-stream";

export type { FixtureProposal };

export const MOCK_PROPOSAL_1: FixtureProposal = {
  question: "Jakie jest stolica Polski?",
  answer: "Warszawa",
};

export const MOCK_PROPOSAL_2: FixtureProposal = {
  question: "Jaka jest najdłuższa rzeka w Polsce?",
  answer: "Wisła.",
};

export const DEFAULT_MOCK_PROPOSALS: readonly FixtureProposal[] = [MOCK_PROPOSAL_1, MOCK_PROPOSAL_2];

type StreamTextReturn = ReturnType<typeof streamText>;

function splitEnvelope(body: string, chunkCount: number): string[] {
  const size = Math.max(1, Math.ceil(body.length / chunkCount));
  const chunks: string[] = [];
  for (let i = 0; i < body.length; i += size) {
    chunks.push(body.slice(i, i + size));
  }
  return chunks;
}

export function makeMockGenerateResult(proposals: readonly FixtureProposal[]): StreamTextReturn {
  const envelope = JSON.stringify({ proposals });
  const chunks = splitEnvelope(envelope, 3);
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue({ type: "text-delta", id: "mock", text: chunk });
      }
      controller.enqueue({
        type: "finish",
        finishReason: "stop",
        rawFinishReason: "stop",
        totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      });
      controller.close();
    },
  });
  return { stream } as unknown as StreamTextReturn;
}
