import { streamText, Output } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";

export const proposalSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
});

export const proposalsSchema = z.object({
  proposals: z.array(proposalSchema).min(1).max(15),
});

export type Proposal = z.infer<typeof proposalSchema>;
export type ProposalsPayload = z.infer<typeof proposalsSchema>;

const SYSTEM_PROMPT = [
  "You extract standalone question/answer flashcards from a source passage.",
  "Rules:",
  "- Ground every proposal STRICTLY in the provided text. Do not invent facts.",
  "- Each question must be self-contained (no 'this', 'that', 'the above').",
  "- Each answer is at most 3 sentences.",
  "- Skip trivia that is not present in the text.",
  "- Emit at most 15 proposals; fewer is fine if the text is short.",
].join("\n");

export interface GenerateProposalsParams {
  text: string;
  apiKey: string;
  model: string;
}

export function generateProposals({ text, apiKey, model }: GenerateProposalsParams) {
  const openrouter = createOpenRouter({ apiKey });

  return streamText({
    model: openrouter.chat(model),
    system: SYSTEM_PROMPT,
    prompt: text,
    output: Output.object({ schema: proposalsSchema }),
  });
}
