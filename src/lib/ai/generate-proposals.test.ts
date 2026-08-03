import { describe, expect, it, vi, beforeEach } from "vitest";
import { toTextStream } from "ai";

const { createOpenRouterMock } = vi.hoisted(() => ({
  createOpenRouterMock: vi.fn(),
}));

const envStub = vi.hoisted(() => ({
  OPENROUTER_MOCK: undefined as string | undefined,
}));

vi.mock("astro:env/server", () => envStub);

vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: createOpenRouterMock,
}));

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    streamText: vi.fn(() => ({
      stream: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    })),
  };
});

import { generateProposals } from "./generate-proposals";

async function readStreamToString(stream: ReadableStream<string>): Promise<string> {
  const reader = stream.getReader();
  let out = "";
  let chunk = await reader.read();
  while (!chunk.done) {
    out += chunk.value;
    chunk = await reader.read();
  }
  return out;
}

describe("generateProposals — OPENROUTER_MOCK branch", () => {
  beforeEach(() => {
    createOpenRouterMock.mockReset();
    createOpenRouterMock.mockReturnValue({
      chat: () => ({}),
    });
    envStub.OPENROUTER_MOCK = undefined;
  });

  it("returns an SDK-shape stream whose text-deltas serialize a valid proposals envelope when OPENROUTER_MOCK=1", async () => {
    envStub.OPENROUTER_MOCK = "1";

    const result = generateProposals({
      text: "irrelevant",
      apiKey: "unused",
      model: "unused/model",
    });

    const textStream = toTextStream({ stream: result.stream });
    const body = await readStreamToString(textStream);
    const parsed = JSON.parse(body) as { proposals: { question: string; answer: string }[] };

    expect(Array.isArray(parsed.proposals)).toBe(true);
    expect(parsed.proposals.length).toBeGreaterThanOrEqual(1);
    for (const proposal of parsed.proposals) {
      expect(typeof proposal.question).toBe("string");
      expect(proposal.question.length).toBeGreaterThan(0);
      expect(typeof proposal.answer).toBe("string");
      expect(proposal.answer.length).toBeGreaterThan(0);
    }
    expect(createOpenRouterMock).not.toHaveBeenCalled();
  });

  it("takes the real SDK path when OPENROUTER_MOCK is unset", () => {
    envStub.OPENROUTER_MOCK = undefined;

    generateProposals({
      text: "hello",
      apiKey: "test-key",
      model: "test/model",
    });

    expect(createOpenRouterMock).toHaveBeenCalledWith({ apiKey: "test-key" });
  });

  it("takes the real SDK path when OPENROUTER_MOCK='0'", () => {
    envStub.OPENROUTER_MOCK = "0";

    generateProposals({
      text: "hello",
      apiKey: "test-key",
      model: "test/model",
    });

    expect(createOpenRouterMock).toHaveBeenCalledWith({ apiKey: "test-key" });
  });
});
