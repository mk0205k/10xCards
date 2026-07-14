import type { Database } from "@/db/database.types";
import type { PreviewMap } from "@/lib/review/scheduler";

export type CardRow = Database["public"]["Tables"]["cards"]["Row"];

export type NextResponse =
  | { card: CardRow; preview: PreviewMap; nextDueAt?: undefined }
  | { card: null; nextDueAt: string | null; preview?: undefined };

export type Rating = 1 | 2 | 3 | 4;

export class ReviewApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body: { error?: string } = await response.json();
    if (body.error) return body.error;
  } catch {
    // Ignore JSON parse errors on non-2xx bodies.
  }
  return fallback;
}

export async function fetchNext(): Promise<NextResponse> {
  const response = await fetch("/api/review/next", {
    method: "GET",
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new ReviewApiError(await readError(response, `Fetch next failed (${response.status})`), response.status);
  }
  const body: NextResponse = await response.json();
  return body;
}

export async function rateCard(cardId: string, rating: Rating): Promise<CardRow> {
  const response = await fetch(`/api/review/${cardId}/rate`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rating }),
  });
  if (!response.ok) {
    throw new ReviewApiError(await readError(response, `Rate failed (${response.status})`), response.status);
  }
  const body: { card: CardRow } = await response.json();
  return body.card;
}

export type { PreviewMap };
