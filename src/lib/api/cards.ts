import type { Database } from "@/db/database.types";

export type CardRow = Database["public"]["Tables"]["cards"]["Row"];

export interface CreateCardParams {
  question: string;
  answer: string;
  source?: "ai" | "manual";
}

export interface UpdateCardParams {
  question: string;
  answer: string;
}

export class CardApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Retained name for backwards compat with any existing imports.
export const CreateCardError = CardApiError;

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body: { error?: string } = await response.json();
    if (body.error) return body.error;
  } catch {
    // Ignore JSON parse errors on non-2xx bodies.
  }
  return fallback;
}

export async function createCard({ question, answer, source = "ai" }: CreateCardParams): Promise<CardRow> {
  const response = await fetch("/api/cards", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question, answer, source }),
  });

  if (!response.ok) {
    const message = await readErrorMessage(response, `Save failed (${response.status})`);
    throw new CardApiError(message, response.status);
  }

  const body: { card: CardRow } = await response.json();
  return body.card;
}

export async function listCards(): Promise<CardRow[]> {
  const response = await fetch("/api/cards", {
    method: "GET",
    credentials: "include",
  });

  if (!response.ok) {
    const message = await readErrorMessage(response, `Load failed (${response.status})`);
    throw new CardApiError(message, response.status);
  }

  const body: { cards: CardRow[] } = await response.json();
  return body.cards;
}

export async function updateCard(id: string, params: UpdateCardParams): Promise<CardRow> {
  const response = await fetch(`/api/cards/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const message = await readErrorMessage(response, `Update failed (${response.status})`);
    throw new CardApiError(message, response.status);
  }

  const body: { card: CardRow } = await response.json();
  return body.card;
}

export async function deleteCard(id: string): Promise<void> {
  const response = await fetch(`/api/cards/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });

  if (!response.ok) {
    const message = await readErrorMessage(response, `Delete failed (${response.status})`);
    throw new CardApiError(message, response.status);
  }
}
