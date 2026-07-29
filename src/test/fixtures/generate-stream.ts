/**
 * Wire-level fixtures for the endpoint↔client stream contract used by
 * `useProposalStream.ts` and its callers. The client contract is a plain
 * `text/plain` body whose payload is a **growing JSON object** produced by
 * Vercel AI SDK's `toTextStream`; the browser parses partial slices via
 * `parsePartialJson`. Fixtures reproduce that shape as `ReadableStream<Uint8Array>`.
 *
 * The five factories map to `test-plan.md §2` row 1 "Risk Response Guidance"
 * for Risk #1 (silent AI-generation drift), covering full-success, truncation,
 * malformed suffix, HTTP 5xx pre-body, and HTTP 5xx after partial body.
 */

export interface FixtureProposal {
  question: string;
  answer: string;
}

/**
 * Serialise proposals to the exact JSON envelope the endpoint emits.
 */
function proposalsPayload(proposals: FixtureProposal[]): string {
  return JSON.stringify({ proposals });
}

/**
 * Split a string into `chunkSize` byte-slices and enqueue them into a
 * `ReadableStream<Uint8Array>`. Exercises the client's `parsePartialJson`
 * loop across multiple decoder reads rather than a single monolithic chunk.
 */
function chunkedStream(body: string, chunkSize = 32): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(body);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) {
        controller.enqueue(bytes.slice(i, i + chunkSize));
      }
      controller.close();
    },
  });
}

/**
 * Full happy-path response with a well-formed JSON envelope. The hook should
 * dispatch every proposal via `stream/chunk` and terminate with `stream/done`.
 */
export function successResponse(proposals: FixtureProposal[]): Response {
  return new Response(chunkedStream(proposalsPayload(proposals)), {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}

/**
 * Response whose body is cut mid-JSON at `cutAfterBytes`. Reproduces the
 * silent-loss face: `parsePartialJson` returns whatever prefix parses cleanly
 * and the hook fires `stream/done` regardless (no truncation detection).
 */
export function truncatedResponse(proposals: FixtureProposal[], cutAfterBytes: number): Response {
  const body = proposalsPayload(proposals).slice(0, cutAfterBytes);
  return new Response(chunkedStream(body), {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}

/**
 * Well-formed prefix followed by garbage bytes. `parsePartialJson` should
 * still surface the leading well-formed proposals; garbage tail is ignored.
 */
export function malformedSuffixResponse(proposals: FixtureProposal[]): Response {
  const body = proposalsPayload(proposals) + "###GARBAGE###";
  return new Response(chunkedStream(body), {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}

/**
 * HTTP error before the streaming body starts — endpoint returned JSON like
 * `{ "error": "GENERATION_FAILED" }`. The hook should read the JSON body and
 * dispatch `stream/abort` with the exact code (routed to i18n via the
 * error-messages registry).
 */
export function errorResponse(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/**
 * HTTP 200 followed by a valid prefix followed by a mid-stream error at
 * `errorAfterBytes`. Simulates a provider 5xx or network drop after partial
 * body was already sent. The hook should catch the reader error and dispatch
 * `stream/abort` with the JS error message (no `GENERATION_*` code — the
 * response headers already indicated 200 so parseErrorBody is not called).
 */
export function partialThenErrorResponse(proposals: FixtureProposal[], errorAfterBytes: number): Response {
  const encoder = new TextEncoder();
  const prefix = encoder.encode(proposalsPayload(proposals).slice(0, errorAfterBytes));
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(prefix);
        // Delay the error to the next microtask so the initial chunk is
        // handed to the reader before the stream faults.
        queueMicrotask(() => {
          controller.error(new Error("network error mid-stream"));
        });
      },
    }),
    { status: 200, headers: { "content-type": "text/plain" } },
  );
}
