import type { Database } from "@/db/database.types";

export type CardRow = Database["public"]["Tables"]["cards"]["Row"];

export interface CreateCardParams {
  question: string;
  answer: string;
  source?: "ai" | "manual";
}

export class CreateCardError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function createCard({ question, answer, source = "ai" }: CreateCardParams): Promise<CardRow> {
  const response = await fetch("/api/cards", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question, answer, source }),
  });

  if (!response.ok) {
    let message = `Save failed (${response.status})`;
    try {
      const body: { error?: string } = await response.json();
      if (body.error) message = body.error;
    } catch {
      // Ignore JSON parse errors on non-2xx bodies.
    }
    throw new CreateCardError(message, response.status);
  }

  const body: { card: CardRow } = await response.json();
  return body.card;
}
