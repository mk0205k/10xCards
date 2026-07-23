# UX Improvements (S-06) — Plan Brief

> Full plan: `context/changes/ux-improvements/plan.md`
> Roadmap slice: `context/foundation/roadmap.md` — S-06

## What & Why

Trzy niezależne polish-changes dla flow'ów które już działają end-to-end (S-01/S-02/S-03), a które użytkownik odczuwa jako friction: (1) klikanie 12 razy "Zaakceptuj" po każdym paste tekstu do generacji, (2) pomyłka w ratingach powtórki wymusza wyjście z sesji bez możliwości "zacznij od nowa", (3) każdy ekran ma własny spinner i własny error box — feel niespójny. Bez tego S-06 produkt jest "działający ale surowy" — gate'uje polish launchu, nie waliduje żadnej hipotezy.

## Starting Point

Aplikacja po S-01–S-05 + S-07: candidate review to per-item flow (`GeneratePanel.tsx` + `ProposalCard.tsx`, każdy accept = jeden POST `/api/cards`), review session to 4-fazowy state machine z server-driven queue (`ReviewSession.tsx`, każde `loadNext()` to niezależny GET — brak stanu sesji po stronie serwera), CRUD talii to standardowy list + dialog (`DeckPanel.tsx`). Wszystkie 3 flow'y mają loading / empty / error state'y, ale każde ad-hoc: dwie różne implementacje spinnera (inline SVG w auth, `Loader2` z lucide w generate), trzy różne markup'y error banera, empty state'y jako `<p>` inline. Zero prior-art dla multi-select / bulk actions. Paraglide + `messages/{pl,en}.json` już wdrożone przez S-07 — nowe stringi żyją tam z konwencją `<obszar>_<akcja>` i wywołaniem `m.<klucz>()`.

## Desired End State

Na `/generate` po streamie propozycji widoczny header z licznikiem "N do przejrzenia" i dwoma przyciskami — "Zaakceptuj wszystkie oczekujące" (fires immediately, iteruje z concurrency cap 4, per-card status uaktualnia się jak w single-item) i "Odrzuć wszystkie oczekujące" (confirm dialog z licznikiem, po potwierdzeniu wszystkie pending → rejected). Na `/review` w headerze sesji przycisk "Zacznij od nowa" — dispatch'uje `reset` w reducer'ze i refetchuje pierwszą due card. Wszystkie 3 flow'y (Generate, Review, Deck) używają jednolitych prymitywów `<Spinner>`, `<EmptyState>`, `<Alert>` w `src/components/ui/`, spójne typografia i copy. `ProposalsList` po streamie z 0 propozycjami pokazuje sensowny empty state (dziś zwraca `null`).

## Key Decisions Made

| Decyzja                              | Wybór                                            | Dlaczego (1 zdanie)                                                                                          | Źródło |
| ------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------ |
| Kształt bulk actions                 | Dwa header buttony (Accept all / Reject all pending) | Zero nowego selection UI, precyzyjnie targetuje pain point ("nie chcę klikać 12 razy"), asymetria z per-item cherry-pick zachowana. | Plan   |
| Bulk API                             | Loop istniejącego per-card POST z concurrency cap 4 | Zero zmian backendu, reużycie proven'ego `POST /api/cards`, partial failure naturalnie per-card.             | Plan   |
| Confirm dialog                       | Tylko dla bulk reject (nie dla accept)           | Asymetria pasuje do realnego risk profilu — accept-all można cofnąć per-card, reject-all jest destruktywny bez undo. | Plan   |
| Semantyka "reset sesji"              | "Zacznij od nowa" — czyści lokalny state, refetch pierwszej due card | Server-driven queue już tak działa, zero backendu; cofanie ostatniej oceny wymagałoby snapshotu FSRS state i nowego endpointu (out of scope). | Plan   |
| Prymitywy UI                         | Spinner + EmptyState + Alert (bez toast/skeleton) | Konkretne prymitywy przeciw ad-hoc, zgodne z konwencją shadcn, bez nowej biblioteki (sonner defer'ed).       | Plan   |
| Sekwencjonowanie względem S-07 (i18n) | S-07 done → S-06 pisze nowe stringi bezpośrednio w konwencji Paraglide | S-07 archived 2026-07-23 (`context/archive/2026-07-23-i18n-pl-en-toggle/`), konwencja `m.<key>()` + strict-mode już aktywna. | Roadmap |
| Nowe klucze i18n                     | Dodawane atomowo do `messages/pl.json` + `messages/en.json` w tym samym commit'cie | Paraglide strict-mode wywala build gdy klucz istnieje tylko w jednym języku.                                 | Plan   |

## Scope

**In scope:**
- Nowe prymitywy `src/components/ui/spinner.tsx`, `empty-state.tsx`, `alert.tsx`
- Refactor `GeneratePanel` / `ProposalsList` / `StreamBanner` / `ReviewSession` / `EmptyQueue` / `DeckPanel` na prymitywy
- Nowy przycisk + akcja `reset` w reducer'ze `ReviewSession`
- Dwa header buttony bulk + akcja `bulkRejectPending` w `proposalsReducer` + confirm dialog + concurrency loop dla bulk accept
- `aria-live` progress region podczas bulk accept
- Nowe klucze do `messages/{pl,en}.json` w konwencji `<obszar>_<akcja>`
- Empty state w `ProposalsList` gdy stream zakończony z 0 propozycjami

**Out of scope:**
- Multi-select checkboxami na candidate review
- Batch endpoint `POST /api/cards/batch`
- Toast / sonner / skeleton screens
- Undo dla bulk reject (confirm dialog jest jedynym safety net)
- Cofnij ostatnią ocenę w sesji powtórki (wymaga snapshotu FSRS state)
- Keyboard shortcuts dla accept/reject/edit
- Redesign formularzy (`CardFormDialog`, `GenerateForm` — poza podmianą spinnerów)
- Nowe animacje / transitions
- Playwright / E2E setup

## Architecture / Approach

Cztery fazy w kolejności zależności. Faza 1 dodaje samodzielne prymitywy w `src/components/ui/` bez integracji — testowalne w izolacji, gotowe do konsumpcji. Faza 2 refaktoryzuje 3 istniejące flow'y żeby ich używały (czysta substytucja, zero zmian semantyki). Faza 3 dodaje reset sesji: nowa akcja `reset` w `ReviewSession` reducer + przycisk w headerze + imperatywne `loadNext()` po dispatch (nie useEffect — bo `initialState.phase === "loading"` nie zmienia się przy reset). Faza 4 dodaje bulk actions: `bulkRejectPending` w `proposalsReducer` (mapuje pending → rejected zachowując editing/saving/saved/error), dla bulk accept iteracja w `GeneratePanel` przez `Promise.allSettled` na chunki 4-elementowe (istniejąca funkcja `persist()` dispatch'uje per-card `saveStart`/`saveSuccess`/`saveError` — zero nowej logiki reducer'a), confirm dialog na wzorzec istniejącego `DeleteConfirmDialog.tsx`. Wszystkie 4 fazy respektują Paraglide strict-mode (klucze dodawane atomowo do obu plików JSON).

## Phases at a Glance

| Faza                                              | Co dostarcza                                                                              | Główne ryzyko                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1. Prymitywy UI                                   | `<Spinner>`, `<EmptyState>`, `<Alert>` w `src/components/ui/` bez integracji.             | Klasy tailwind niespójne z istniejącym glassmorph — wymaga QA na tle.            |
| 2. Ujednolicenie loading/empty/error              | 3 flow'y (Generate, Review, Deck) na nowych prymitywach; dodany empty state ProposalsList. | Missed occurrence któregoś inline spinnera / error boxa; regression na copy.     |
| 3. Reset sesji powtórki                           | Przycisk "Zacznij od nowa" w `ReviewSession` + akcja `reset` w reducer'ze.                 | Reset w trakcie `submitting` może zostawić inflight request bez UI feedback'u — mitigujemy przez disabled state. |
| 4. Bulk actions na candidate review               | Dwa header buttony, confirm dialog dla reject, concurrency loop dla accept, aria-live progress. | `Promise.all` zamiast `Promise.allSettled` blokowałby na 1 failed karcie — explicit w Critical Implementation Details. |

**Prerequisites:** F-01 (schemat + RLS) — spełniony; S-01 (candidate review), S-02 (review session), S-03 (deck CRUD), S-07 (i18n / Paraglide) — wszystkie archived. Brak nowych migracji, brak nowych zależności npm.

**Estimated effort:** 4 fazy w jednym change'u; realistycznie 2–3 sesje `/10x-implement` (Faza 1 osobno; Faza 2 osobno lub razem z Fazą 3; Faza 4 osobno z pełnym sweep'em na końcu).

## Open Risks & Assumptions

- **Concurrency cap 4** — bezpieczny na Cloudflare Workers (limit 50 subrequestów per invocation), ale na wolnym łączu klienta bulk accept 20 propozycji ~5s. Assumption: taki czas jest OK bez przerywania (brak `AbortController`). Jeśli okaże się problematyczny, dodać abort do wewnętrznej pętli (semantyka "część zapisana" jest wtedy widoczna per-card).
- **Reset sesji vs inflight rate** — użytkownik może kliknąć reset w trakcie `submitting`. Mitigation: przycisk disabled gdy `state.phase === "submitting"`. Ryzyko szczątkowe: race gdzie klik trafia w moment przełączenia phase — akceptowalne bo cofa się do loading tak czy inaczej.
- **A11y `aria-live` region** — `polite` powinno wystarczyć, ale użytkownicy screen reader'ów mogą się skarżyć na częstotliwość aktualizacji (chunk co ~1-2s). Do weryfikacji podczas manual testing.
- **Copy w EN** — tłumaczenia proponowane w planie są rozsądne, ale wymagają review'a przez native speaker'a jeśli launch EN jest w bliskim horyzoncie. Nie blokuje merge S-06.
- **Assumption**: `lucide-react` już w projekcie (`ProposalCard.tsx:1` importuje `Loader2`), więc `<Spinner>` może zbudować się na tej samej bibliotece bez nowej zależności.

## Success Criteria (Summary)

- Bulk accept zapisuje N pending propozycji jednym kliknięciem, per-card status i pasek postępu widoczny; padnięta karta nie blokuje pozostałych.
- "Zacznij od nowa" w sesji powtórki wraca do pierwszej due card w oby locale, bez błędów w konsoli.
- Wszystkie 3 flow'y (Generate, Review, Deck) mają wizualnie i tekstowo spójne stany loading / empty / error; żaden nie używa ad-hoc markup'u.
