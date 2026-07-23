# UX Improvements (S-06) Implementation Plan

## Overview

Trzy niezależne polish-changes dla flow'ów, które już działają end-to-end po S-01/S-02/S-03: (1) bulk accept/reject wszystkich pending propozycji AI na candidate review, (2) reset sesji powtórki bez opuszczania `/review`, (3) prymitywy `Spinner`/`EmptyState`/`Alert` w `src/components/ui/` + ujednolicenie stanów loading/empty/error w Generate, Review, Deck. Brak zmian schemy, brak nowych endpointów, brak nowych zależności. Wszystkie nowe stringi żyją w `messages/{pl,en}.json` i są wywoływane przez istniejący runtime Paraglide (`m.<klucz>()`).

## Current State Analysis

**Candidate review** (`src/components/generate/GeneratePanel.tsx`, `ProposalCard.tsx`, `ProposalsList.tsx`) — flow per-item przez `useReducer` z akcjami `saveStart` / `saveSuccess` / `saveError` / `reject` w `proposalsReducer.ts`. Każdy accept woła `createCard()` synchronicznie (jedna karta = jeden POST `/api/cards`). Brak wielo-selekcji, brak "accept all". Deck plan (`context/archive/2026-07-14-deck-management-crud/plan.md:50`) explicit odsyła bulk actions do S-06.

**Review session** (`src/components/review/ReviewSession.tsx`) — 4-fazowy state machine (`loading | question | answer | submitting | error`), server-driven queue: każde `loadNext()` to niezależny GET `/api/review/next`, brak persystencji sesji po stronie klienta. Rating (Again/Hard/Good/Easy) POSTuje do `/api/review/{card_id}/rate` i wywołuje `loadNext()`. Reducer NIE MA jeszcze akcji `reset` — trzeba dodać. Brak "start over" w UI.

**Loading/empty/error** — każdy z trzech flow'ów ma osobne, ad-hoc rozwiązania:
- Spinnery: inline SVG w `SubmitButton` (auth) vs `Loader2` z `lucide-react` w `ProposalCard.tsx:106`.
- Empty states: teksty inline (`m.review_session_complete`, `m.deck_empty`, `m.deck_search_no_results`), różna typografia i wyrównanie; `ProposalsList.tsx:29` zwraca `null` (brak empty state po zakończeniu streamu z 0 propozycjami).
- Error banery: różne kombinacje `border-red-400/40 bg-red-500/10 p-4 text-sm text-red-100` w `DeckPanel.tsx:148`, `ProposalCard.tsx:132`, `StreamBanner.tsx`; brak jednolitego prymityw'u.
- Wszystkie stringi już przechodzą przez `import { m } from "@/paraglide/messages.js"` — konwencja Paraglide 2.x jest ustalona przez S-07 (archived `2026-07-23-i18n-pl-en-toggle`).

**shadcn ui inventory** (`src/components/ui/`): `button.tsx`, `card.tsx`, `dialog.tsx`, `alert-dialog.tsx`, `input.tsx`, `textarea.tsx`. **Brak**: `Spinner`, `EmptyState`, `Alert`.

## Desired End State

Po wdrożeniu wszystkich faz:

1. Na `/generate`, po zakończeniu streamowania listy propozycji, w headerze listy widoczne są dwa przyciski: **"Zaakceptuj wszystkie oczekujące"** i **"Odrzuć wszystkie oczekujące"**. Akceptacja fires immediately, iteruje po wszystkich propozycjach ze statusem `pending` z limitem 4 in-flight requestów i uaktualnia per-card status jak w single-item flow (spinner na karcie → badge "Dodano" lub inline error). Odrzucenie pokazuje `alert-dialog` z liczbą propozycji do odrzucenia; po potwierdzeniu wszystkie pending status'y są przełączone na `rejected` (znikają z widoku).

2. Na `/review`, w headerze `SessionShell`, dodatkowy przycisk **"Zacznij od nowa"** (link/button variant "ghost"). Kliknięcie: reducer dispatch'uje nową akcję `reset`, state wraca do `initialState`, useEffect (albo direct call) wywołuje `loadNext()`, użytkownik widzi pierwszą due card zamiast bieżącej. Zero backendu — server nie ma stanu sesji, więc "reset" to lokalny rerun tego samego zapytania.

3. Wszystkie trzy flow'y (Generate, Review, Deck) używają jednolitych prymitywów `<Spinner />`, `<EmptyState />`, `<Alert variant="error" />`. Copy i typografia są spójne. `ProposalsList` ma widoczny empty state po zakończeniu streamu bez propozycji (dziś zwraca `null`).

**Verify by:** kliknięcie "Zaakceptuj wszystkie" po wygenerowaniu 5 propozycji zapisuje wszystkie w talii bez pojedynczego klikania; kliknięcie "Zacznij od nowa" w trakcie sesji powtórki odświeża do pierwszej due card; ekrany Generate/Review/Deck w stanie loading pokazują ten sam Spinner, w stanie error ten sam Alert.

### Key Discoveries:

- `proposalsReducer.ts:44` ma już akcję `saveStart` / `saveSuccess` / `saveError` per-card — bulk accept iteruje i dispatch'uje po kolei, żaden nowy per-card state nie jest potrzebny.
- `proposalsReducer.ts:47` ma akcję `reset` która wraca cały state do `initialState` — używana do restartu formularza generacji, NIE mylić z bulk-reject. Bulk-reject to nowa akcja `bulkRejectPending` która przełącza tylko pending → rejected, zachowując pozostałe.
- `ReviewSession.tsx` reducer (`src/components/review/ReviewSession.tsx:27`) brak akcji `reset` — trzeba dodać do union `Action` i case w `reducer`.
- Server dla review nie trzyma sesji: każde `/api/review/next` (`src/lib/api/review.ts`, endpoint `src/pages/api/review/next.ts`) zwraca aktualną najbliższą due card zgodnie z FSRS. "Reset" = refetch. Brak konieczności zmian po stronie API.
- shadcn `alert-dialog.tsx` już zainstalowany — użyty w `DeleteConfirmDialog.tsx` i `DeleteAccountDialog.tsx`, zgodny wzorzec do zaadaptowania w bulk-reject confirm.
- Paraglide strict mode (S-07 plan.md decyzja) wywala build gdy klucz istnieje w PL a brakuje w EN (lub odwrotnie) — każdy nowy klucz musi być dodany do OBU plików `messages/pl.json` i `messages/en.json` w tym samym commit'cie.
- Konwencja nazewnictwa kluczy: `<obszar>_<akcja>[_detal]`, np. `review_reset_button`, `generate_bulk_accept_all_button`, `generate_bulk_reject_confirm_title`. Obszary już w użyciu: `generate_*`, `review_*`, `deck_*`, `common_*` (dla współdzielonych).

## What We're NOT Doing

- **Multi-select checkboxami** na candidate review — pytanie decyzyjne: user wybrał "dwa header buttony" zamiast pełnego selection UI. Cherry-pick pozostaje przez per-card accept/reject.
- **Batch endpoint `POST /api/cards/batch`** — bulk accept iteruje po istniejącym `POST /api/cards` z concurrency cap 4. Zero zmian po stronie backendu.
- **Toast / sonner** — brak globalnego toast library. Feedback bulk operacji pokazujemy w headerze przez `aria-live` region (`m.generate_bulk_progress`), success/error zostaje w istniejących per-card statusach.
- **Undo dla bulk reject** — po potwierdzeniu w dialog'u nie ma undo. Confirm dialog jest jedynym safety net.
- **Skeleton screens** — Spinner wystarczy w tym scope. Skeleton na liście talii i propozycji to osobny slice po S-06.
- **Cofnij ostatnią ocenę** w sesji powtórki — semantyka "reset" ograniczona do "zacznij sesję od nowa" (odrzuca lokalny stan, refetch pierwszej due card). Cofnięcie oceny wymagałoby snapshotu FSRS state i nowego endpointu — osobny slice.
- **Keyboard shortcuts** dla accept/reject/edit propozycji — nie w scope.
- **Redesign formularzy** (`CardFormDialog`, `GenerateForm`) — poza podmianą inline spinnerów na `<Spinner />` nic nie ruszamy.
- **Nowe animacje / transitions** — CSS focus tylko na spójności prymitywów, bez animacji.

## Implementation Approach

Cztery fazy w kolejności zależności: (1) prymitywy same w sobie, (2) refactor istniejących stanów żeby ich używały, (3) reset sesji, (4) bulk actions. Fazy 3 i 4 dodają nowe feature'y i mogą być teoretycznie zamienione kolejnością, ale ustawiam 3 → 4 bo bulk actions to najbardziej złożona zmiana (nowa akcja reducer'a + confirm dialog + concurrency loop + aria-live) i pierwsza korzysta z prymitywów Fazy 1. Każda faza kończy się przechodzącym `npm run lint`, `npm run build`, i ręczną weryfikacją odpowiedniego flow w przeglądarce (dev server, oba locale PL/EN).

## Critical Implementation Details

### Concurrency dla bulk accept

Bulk accept iteruje po propozycjach `pending`, z limitem 4 równoległych requestów. Prosty pattern: partycjonowanie na chunki 4-elementowe + `Promise.allSettled` per chunk. `Promise.allSettled` (nie `Promise.all`) — jedna nieudana karta nie może zablokować pozostałych; per-card status uaktualnia się przez `dispatch({ type: "saveSuccess" | "saveError", ... })` na miejscu. Bez `AbortController` — pojedynczy request `POST /api/cards` jest krótki (<1s zwykle), a przerywanie w połowie bulk operacji miałoby niejasną semantykę (część zapisana, część nie). Pasek postępu przez `aria-live="polite"` w headerze listy: `m.generate_bulk_progress({ done, total })`.

### Reset sesji powtórki nie może wywoływać stale loadNext

Po dispatch'u `reset` reducer wraca do `phase: "loading"`. Trzeba wywołać `loadNext()` **imperatywnie** przy kliknięciu przycisku (nie polegać na useEffect, bo initialState.phase === "loading" nie zmienia się przy reset). Wzorzec: `onReset` callback dispatches `reset` AND `await loadNext()` w jednym handlerze. Alternatywa (React 18 useEffect + phase depend) zadziała, ale imperatywne wywołanie jest jednoznaczne i unika race'ów z pending `submitting` request'ami.

## Phase 1: Prymitywy UI

### Overview

Trzy nowe komponenty w `src/components/ui/` zgodne z konwencją shadcn: `Spinner`, `EmptyState`, `Alert`. Bez integracji z istniejącym kodem — samodzielne, testowalne w izolacji, gotowe do konsumpcji w Fazie 2. Zero stringów wewnątrz prymitywów — copy przekazywane propsami.

### Changes Required:

#### 1. Spinner

**File**: `src/components/ui/spinner.tsx` (new)

**Intent**: Prosty, jednolity spinner do użycia w loading states w całej aplikacji. Zastępuje dwie obecne implementacje (inline SVG w `SubmitButton`, `Loader2` z lucide w `ProposalCard`).

**Contract**: Funkcja komponentu z propsami `{ size?: "sm" | "md" | "lg"; className?: string; label?: string }`. `label` renderuje jako `<span className="sr-only">` dla a11y (jeśli nie ma widocznego kontekstu) LUB pomijamy jeśli parent już mówi "Ładowanie…" tekstem. Wewnętrznie używa `<Loader2 className="animate-spin" />` z `lucide-react` (zależność już w projekcie, `ProposalCard.tsx:1`). Klasy przez `cn()`. Rozmiary: `sm=size-4`, `md=size-6`, `lg=size-8`.

#### 2. EmptyState

**File**: `src/components/ui/empty-state.tsx` (new)

**Intent**: Ujednolicony wygląd i struktura empty state'ów (brak wyników, pusta talia, sesja zakończona). Zastępuje ad-hoc `<p className="text-sm text-blue-100/70">…</p>` w `DeckPanel.tsx:176` i strukturę `EmptyQueue` w `ReviewSession.tsx:191`.

**Contract**: `interface EmptyStateProps { title: string; description?: string; icon?: React.ReactNode; action?: React.ReactNode; className?: string }`. Layout: centrowany, padding, tytuł `text-lg`, description `text-sm text-white/60`, opcjonalna ikona nad tytułem, opcjonalny `action` (np. przycisk "Wygeneruj fiszki") pod description. Klasy przez `cn()`.

#### 3. Alert

**File**: `src/components/ui/alert.tsx` (new)

**Intent**: Ujednolicony inline banner dla error / warning / info state'ów. Zastępuje ad-hoc `<div className="rounded-lg border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-100">…</div>` w `DeckPanel.tsx:148`, `ProposalCard.tsx:132`, `StreamBanner.tsx`.

**Contract**: `interface AlertProps { variant?: "error" | "warning" | "info"; title?: string; children?: React.ReactNode; action?: React.ReactNode; className?: string; role?: "alert" | "status" }`. Variant → mapowanie na klasy tailwind (error: `border-red-400/40 bg-red-500/10 text-red-100`, warning: analogicznie amber, info: blue). Default `role="alert"` gdy variant `error`, `role="status"` gdy `info`. `action` slot dla przycisku retry po prawej stronie. Klasy przez `cn()`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro sync && npx tsc --noEmit`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Utworzono jednorazową stronę testową (np. `/dev/ui-primitives.astro` — pomijana w produkcji lub usunięta na końcu fazy) LUB Storybook-like sanity check: import każdego prymitywu, renderuje się bez błędów w oby locale (PL/EN).
- Spinner animuje się (widoczna rotacja).
- EmptyState renderuje title + description + action.
- Alert renderuje z każdym z 3 wariantów, tekst czytelny na tle glassmorph.

**Implementation Note**: Po zakończeniu tej fazy i przejściu automated verification zatrzymaj się na manualne potwierdzenie od użytkownika, że prymitywy wyglądają OK w obu locale, zanim przejdziesz do Fazy 2.

---

## Phase 2: Ujednolicenie loading/empty/error w istniejących flow'ach

### Overview

Refactor `GeneratePanel`/`ProposalsList`/`StreamBanner`, `ReviewSession`/`EmptyQueue`, `DeckPanel` żeby używały prymitywów z Fazy 1. Bez zmiany semantyki — wyłącznie substytucja ad-hoc kodu na `<Spinner />` / `<EmptyState />` / `<Alert />`. Dodane brakujące empty state'y (`ProposalsList` po zakończeniu streamu z 0 propozycjami). Nowe klucze i18n gdzie potrzebne.

### Changes Required:

#### 1. GeneratePanel + ProposalsList + StreamBanner refactor

**File**: `src/components/generate/GeneratePanel.tsx`, `ProposalsList.tsx`, `StreamBanner.tsx`

**Intent**: Podmienić inline spinner (`Loader2` w `ProposalCard.tsx:106`) na `<Spinner size="sm" />`. Dodać `<EmptyState>` w `ProposalsList` gdy `streamState === "done"` a `visible.length === 0` (dziś zwraca `null` — user nie widzi feedbacku że generacja się zakończyła bez wyników). `StreamBanner` (error banner) używa `<Alert variant="error" action={retryButton}>` zamiast własnego markup'u.

**Contract**: Import `Spinner`, `EmptyState`, `Alert` z `@/components/ui/*`. `ProposalCard` linia 106 → `{isSaving && <Spinner size="sm" />}`. `ProposalsList` linia 29 → zamiast `return null` renderuje `<EmptyState title={m.generate_empty_state_title()} description={m.generate_empty_state_description()} />` gdy `!streaming && visible.length === 0`. `StreamBanner` przeniesiony na `<Alert variant="error" action={<Button onClick={onRetry}>{m.generate_retry()}</Button>}>{errorMessage}</Alert>`.

#### 2. ReviewSession refactor

**File**: `src/components/review/ReviewSession.tsx`

**Intent**: Podmienić inline `<SessionShell>{m.review_loading()}</SessionShell>` na `<SessionShell><Spinner size="md" label={m.review_loading()} /></SessionShell>`. Error branch (linie 106-121) używa `<Alert variant="error">` z `action={<Button onClick={loadNext}>{m.review_retry()}</Button>}`. `EmptyQueue` (linie 191-205) używa `<EmptyState title={m.review_session_complete()} description={...}>`.

**Contract**: Import `Spinner`, `EmptyState`, `Alert`. Zachowaj `<SessionShell>` jako wrapper (spójny styling glassmorph); wewnątrz podmieniaj tylko treść. Zero zmian w reducer'ze w tej fazie.

#### 3. DeckPanel refactor

**File**: `src/components/deck/DeckPanel.tsx`

**Intent**: Linia 143 (`<p className="text-sm text-blue-100/60">{m.deck_loading()}</p>`) → `<Spinner size="md" label={m.deck_loading()} />`. Linie 146-152 (error box) → `<Alert variant="error">{state.error ?? m.deck_error_generic()}</Alert>`. Linie 175-179 (empty state / no search results) → `<EmptyState title={m.deck_empty_title()} description={m.deck_empty_description()} />` i analogicznie dla `deck_search_no_results` (możliwe reużycie istniejących kluczy `deck_empty` / `deck_search_no_results` jako `title`).

**Contract**: Import `Spinner`, `EmptyState`, `Alert`. Nie ruszaj reducer'a ani `useEffect`. Jeśli istniejące klucze `deck_empty` i `deck_search_no_results` pasują jako `title` — reużyj bez tworzenia nowych. Rozważ dodanie `deck_empty_description` jeśli chcesz zachować "Wygeneruj fiszki przez AI albo dodaj ręcznie." jako podtytuł.

#### 4. Nowe klucze i18n

**File**: `messages/pl.json`, `messages/en.json`

**Intent**: Dodać klucze wymagane przez nowe empty state w `ProposalsList` i (opcjonalnie) rozbicie `deck_empty` na title+description.

**Contract**: Dodane pary klucz→wartość w OBU plikach jednocześnie (Paraglide strict-mode inaczej wywala build). Konwencja `<obszar>_<akcja>[_detal]`. Minimalny zestaw:
- `generate_empty_state_title` — PL: "Brak propozycji do przejrzenia" / EN: "No proposals to review"
- `generate_empty_state_description` — PL: "Wygenerowanie zakończyło się bez rezultatów. Spróbuj wkleić inny fragment tekstu." / EN: "Generation finished with no results. Try pasting a different fragment of text."
- (opcjonalnie) `deck_empty_title`, `deck_empty_description` jeśli rozbijasz istniejący `deck_empty`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro sync && npx tsc --noEmit`
- Linting passes: `npm run lint`
- Build passes: `npm run build` (weryfikuje że Paraglide strict-mode nie wywala się na brakujących kluczach)

#### Manual Verification:

- `/generate` w loading state (podczas 30s generacji) pokazuje `Spinner` w miejsce dawnego `Loader2`.
- `/generate` po zakończeniu streamu z 0 propozycjami pokazuje `EmptyState` z nowym copy.
- `/generate` w error state pokazuje `Alert variant="error"` z przyciskiem retry.
- `/review` w loading / error / empty state pokazuje nowe prymitywy.
- `/deck` w loading / error / empty state pokazuje nowe prymitywy.
- Wszystkie ekrany działają identycznie w locale PL i EN (przełącz przez Topbar).

**Implementation Note**: Po tej fazie zatrzymaj się na potwierdzenie że wszystkie 3 flow'y wyglądają spójnie i copy jest sensowne w obu językach, zanim przejdziesz do Fazy 3.

---

## Phase 3: Reset sesji powtórki

### Overview

Nowa akcja `reset` w reducer'ze `ReviewSession`, nowy przycisk "Zacznij od nowa" w UI. Po kliknięciu: state wraca do `initialState`, wywołany zostaje `loadNext()` żeby pobrać pierwszą due card. Zero backendu — server nie ma stanu sesji.

### Changes Required:

#### 1. Reducer: nowa akcja reset

**File**: `src/components/review/ReviewSession.tsx`

**Intent**: Dodać `{ type: "reset" }` do union `Action` (linia 15-19) i case w `reducer` (linia 27-42) który zwraca `initialState`.

**Contract**: Union `Action` rozszerzone o `{ type: "reset" }`. `reducer` ma nowy case `case "reset": return initialState;`. Bez efektów ubocznych w reducer'ze — refetch dispatch'ujemy z komponentu.

#### 2. UI: przycisk "Zacznij od nowa"

**File**: `src/components/review/ReviewSession.tsx`

**Intent**: Dodać przycisk w headerze `SessionShell` (nad question/answer) który jest widoczny gdy jest karta (`state.data?.card`) LUB stan `error`. Handler `onReset` dispatch'uje `reset` i imperatywnie woła `loadNext()`.

**Contract**: Nowy callback `const onReset = useCallback(() => { dispatch({ type: "reset" }); void loadNext(); }, [loadNext]);`. Przycisk `<Button variant="ghost" size="sm" onClick={onReset} disabled={state.phase === "submitting"}>{m.review_reset_button()}</Button>` renderowany w headerze `SessionShell` (dokładna pozycja: nad `<section>` z pytaniem, wyrównany do prawej). Ukryty gdy `state.phase === "loading" && !state.data` (nie ma jeszcze co resetować). Disabled podczas `submitting` — nie można resetować w połowie ratingu.

#### 3. Nowe klucze i18n

**File**: `messages/pl.json`, `messages/en.json`

**Intent**: Dodać klucze dla przycisku reset i jego aria-label.

**Contract**: Nowe klucze w obu plikach:
- `review_reset_button` — PL: "Zacznij od nowa" / EN: "Start over"
- `review_reset_aria` — PL: "Zacznij sesję powtórki od nowa" / EN: "Restart review session"

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro sync && npx tsc --noEmit`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Wejście na `/review`, gdy jest ≥1 due card: przycisk "Zacznij od nowa" widoczny w headerze.
- Ocenienie kilku kart Good, kliknięcie "Zacznij od nowa" — sesja wraca do pierwszej dostępnej due card (nie tej samej co była na ekranie).
- W trakcie `submitting` (kliknięto rating, czeka na API) przycisk jest disabled.
- W stanie error (padnięty rate) przycisk widoczny i działa.
- W stanie empty (0 due cards) przycisk NIE jest widoczny (nic nie da resetować).
- Działa w obu locale.

**Implementation Note**: Po tej fazie zatrzymaj się na potwierdzenie że reset zachowuje się zgodnie z oczekiwaniem (odpala pierwszą due card, nie duplikuje bieżącej).

---

## Phase 4: Bulk actions na candidate review

### Overview

Dwa przyciski w headerze `GeneratePanel` — "Zaakceptuj wszystkie oczekujące" i "Odrzuć wszystkie oczekujące". Nowe akcje reducer'a `bulkRejectPending` (przełącza wszystkie pending na rejected). Bulk accept iteruje po pending, dispatch'uje istniejące `saveStart`/`saveSuccess`/`saveError` per-card z concurrency cap 4 przez `Promise.allSettled`. Bulk reject pokazuje shadcn `alert-dialog` z licznikiem propozycji do odrzucenia. Pasek postępu przez `aria-live` region.

### Changes Required:

#### 1. Reducer: akcja bulkRejectPending

**File**: `src/components/generate/proposalsReducer.ts`

**Intent**: Dodać `{ type: "bulkRejectPending" }` do `ProposalsAction` (linia 34-47) i case w `makeReducer` który mapuje wszystkie propozycje ze statusem `pending` na `rejected`. Propozycje w innych statusach (`editing`, `saving`, `saved`, `error`) pozostają nietknięte.

**Contract**: Union `ProposalsAction` rozszerzone o `{ type: "bulkRejectPending" }`. Nowy case: `case "bulkRejectPending": return { ...state, proposals: state.proposals.map((p) => p.status === "pending" ? { ...p, status: "rejected" } : p) };`. **Nie dodajemy** akcji `bulkAcceptPending` — bulk accept iteruje przez `GeneratePanel` i dispatch'uje istniejące `saveStart`/`saveSuccess`/`saveError` per-card (zero nowej logiki w reducer'ze).

#### 2. GeneratePanel: handler bulk accept + confirm dialog dla bulk reject

**File**: `src/components/generate/GeneratePanel.tsx`

**Intent**: Nowe callbacki `onBulkAccept` (asynchroniczny, iteruje z concurrency cap 4) i `onBulkReject` (otwiera confirm dialog). Handler bulk accept liczy `pending` propozycje, jeśli 0 to no-op; inaczej partycjonuje na chunki 4-elementowe i `await Promise.allSettled(chunk.map(persist))`. Każdy chunk używa istniejącej funkcji `persist(id, question, answer)` (linia 31), która dispatch'uje `saveStart`/`saveSuccess`/`saveError` per-card — więc per-card UI aktualizuje się jak w single-item flow.

**Contract**: Nowy state lokalny `const [bulkRejectOpen, setBulkRejectOpen] = useState(false);` i `const [bulkAcceptInProgress, setBulkAcceptInProgress] = useState<{ done: number; total: number } | null>(null);`. Handler:

```typescript
const onBulkAccept = useCallback(async () => {
  const pending = state.proposals.filter((p) => p.status === "pending");
  if (pending.length === 0) return;
  setBulkAcceptInProgress({ done: 0, total: pending.length });
  const CONCURRENCY = 4;
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const chunk = pending.slice(i, i + CONCURRENCY);
    await Promise.allSettled(chunk.map((p) => persist(p.id, p.question, p.answer)));
    setBulkAcceptInProgress((prev) => prev ? { ...prev, done: Math.min(prev.done + chunk.length, prev.total) } : null);
  }
  setBulkAcceptInProgress(null);
}, [state.proposals, persist]);

const onBulkReject = useCallback(() => setBulkRejectOpen(true), []);
const onBulkRejectConfirm = useCallback(() => {
  dispatch({ type: "bulkRejectPending" });
  setBulkRejectOpen(false);
}, []);
```

To jest przypadek gdzie snippet w Contract'cie jest uzasadniony — concurrency loop przez `Promise.allSettled` z per-chunk progress update to counterintuitive pattern (naiwne `Promise.all` blokuje na jednym failed request; `Promise.allSettled` na pełnej liście `pending` traci concurrency cap). Reszta zmian to routine wiring.

#### 3. GeneratePanel: UI header z przyciskami bulk + aria-live progress

**File**: `src/components/generate/GeneratePanel.tsx` (albo nowy komponent `BulkActionsBar.tsx` jeśli robi się za tłoczno)

**Intent**: Nowy header nad `<ProposalsList>` widoczny gdy istnieje ≥1 propozycja o statusie `pending`. Zawiera: liczba pending, dwa przyciski (`Zaakceptuj wszystkie oczekujące` / `Odrzuć wszystkie oczekujące`), i `aria-live="polite"` region z paskiem postępu podczas bulk accept.

**Contract**: Warunkowy render `{pendingCount > 0 && <div>...</div>}`. Progress region: `<div aria-live="polite" role="status">{bulkAcceptInProgress ? m.generate_bulk_progress({ done: bulkAcceptInProgress.done, total: bulkAcceptInProgress.total }) : null}</div>`. Przyciski disabled podczas `bulkAcceptInProgress !== null`.

#### 4. Confirm dialog dla bulk reject

**File**: `src/components/generate/BulkRejectConfirmDialog.tsx` (new) — analog do istniejącego `DeleteConfirmDialog.tsx`

**Intent**: shadcn `alert-dialog` z tytułem, opisem zawierającym liczbę propozycji do odrzucenia, przyciskami Confirm/Cancel. Wywołuje `onConfirm` z parenta który dispatch'uje `bulkRejectPending`.

**Contract**: `interface BulkRejectConfirmDialogProps { open: boolean; onOpenChange: (open: boolean) => void; pendingCount: number; onConfirm: () => void }`. Layout zgodny z `DeleteConfirmDialog.tsx:*`. Copy z i18n. Confirm button variant `destructive`.

#### 5. Nowe klucze i18n

**File**: `messages/pl.json`, `messages/en.json`

**Intent**: Klucze dla przycisków bulk, confirm dialog'u, i progress region'u.

**Contract**: Nowe klucze w obu plikach:
- `generate_bulk_accept_all_button` — PL: "Zaakceptuj wszystkie oczekujące" / EN: "Accept all pending"
- `generate_bulk_reject_all_button` — PL: "Odrzuć wszystkie oczekujące" / EN: "Reject all pending"
- `generate_bulk_pending_count` (param `{ n }`) — PL: "{n} do przejrzenia" / EN: "{n} to review"
- `generate_bulk_progress` (params `{ done, total }`) — PL: "Zapisywanie: {done} / {total}" / EN: "Saving: {done} / {total}"
- `generate_bulk_reject_confirm_title` — PL: "Odrzucić wszystkie oczekujące propozycje?" / EN: "Reject all pending proposals?"
- `generate_bulk_reject_confirm_description` (param `{ n }`) — PL: "{n} propozycji zostanie odrzuconych. Nie da się tego cofnąć." / EN: "{n} proposals will be rejected. This cannot be undone."
- `generate_bulk_reject_confirm_confirm` — PL: "Odrzuć wszystkie" / EN: "Reject all"
- `generate_bulk_reject_confirm_cancel` — PL: "Anuluj" / EN: "Cancel"

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro sync && npx tsc --noEmit`
- Linting passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Wygeneruj 5-10 propozycji z pastowanego tekstu.
- Header nad listą pokazuje "N do przejrzenia" i dwa przyciski bulk.
- Klik "Zaakceptuj wszystkie oczekujące": każda propozycja przechodzi przez saving → saved (badge "Dodano"), progress region pokazuje `Saving: X / N`, po zakończeniu wszystkie są w talii (weryfikuj na `/deck`).
- Jeśli któraś karta padnie po stronie API — zostaje w statusie `error` z komunikatem, pozostałe idą dalej (`Promise.allSettled`, nie `Promise.all`).
- Klik "Odrzuć wszystkie oczekujące": otwiera się `alert-dialog` z liczbą propozycji, potwierdzenie usuwa wszystkie pending z widoku, `Anuluj` zamyka bez zmian.
- Ręcznie zaakceptowane / edytowane / już rejected propozycje NIE są tknięte przez żaden bulk button.
- Podczas trwania bulk accept — oba bulk buttony disabled, per-card przyciski accept/reject/edit tracą interaktywność (disabled przez per-card `saving` state).
- Wszystko działa w PL i EN.
- A11y: `aria-live` region jest ogłaszany przez screen reader podczas bulk accept (test w NVDA/JAWS lub `axe` DevTools).

**Implementation Note**: Po tej fazie zatrzymaj się na potwierdzenie że bulk actions działają na happy path + na scenariuszu z jedną padniętą kartą (mock 500 z API). Przed archived: pełny sweep wszystkich trzech flow'ów (Generate, Review, Deck) w obu locale.

---

## Testing Strategy

### Unit Tests:

Projekt nie ma jeszcze warstwy testów jednostkowych dla komponentów (widać w `context/archive/2026-07-14-deck-management-crud/plan.md` — testy delegowane do manual + CI build check). Nie wprowadzamy nowej warstwy w S-06 — trzymamy się konwencji projektu. Jeżeli w trakcie implementacji okaże się że `bulkRejectPending` reducer case ma nietrywialną semantykę, dodajemy jeden vitest dla `proposalsReducer.ts` (już vitest dostępny — sprawdź `package.json`, dodaj jeśli brak, ale prawdopodobnie jest po S-01/S-02/S-03).

### Integration Tests:

Manualne, per faza, per locale. E2E (Playwright) nie w scope.

### Manual Testing Steps:

Pełny sweep na końcu Fazy 4 (opisany w Success Criteria każdej fazy):

1. Uruchom dev server (`npm run dev`) i zaloguj się użytkownikiem testowym.
2. **Generate flow**: paste tekst, wygeneruj propozycje, kliknij "Zaakceptuj wszystkie oczekujące" — weryfikuj że wszystkie trafiły do `/deck`. Powtórz z tekstem który generuje 0 propozycji — weryfikuj empty state. Powtórz z force'owanym 500 na `/api/cards` (block temporary) — weryfikuj że pojedyncza padnięta karta nie blokuje pozostałych.
3. **Review flow**: rozpocznij sesję, oceń kilka kart Good, kliknij "Zacznij od nowa" — weryfikuj że sesja wraca do pierwszej due card. Przełącz na 0 due cards (oceń wszystkie Easy z długimi interwałami) — weryfikuj że przycisk reset znika.
4. **Deck flow**: wejdź na `/deck` z pustą talią — weryfikuj empty state. Dodaj karty, force'uj 500 na `/api/cards` list — weryfikuj alert.
5. **i18n sweep**: przełącz język w Topbar na EN, powtórz kroki 2-4 — weryfikuj że wszystkie nowe stringi mają tłumaczenia.

## Performance Considerations

- Concurrency cap 4 dla bulk accept — na średnim inputcie (10-20 propozycji, ~2-5 chunków po 4) całkowity czas ~2-5s przy p95 <30s per request. Bez concurrency cap istnieje ryzyko rate-limit'ów po stronie Supabase / Cloudflare Workers subrequest limit (50 per invocation) — 4 in-flight jest bezpieczne.
- Bulk reject to czysto lokalne dispatch reducer'a — O(n) po propozycjach, nieodczuwalne dla n < 100.
- Reset sesji dispatch'uje 1 akcję + wywołuje 1 fetch — koszt równy nawigacji z/na `/review`.

## Migration Notes

Brak migracji schemy. Brak zmiennych środowiskowych. Brak zależności do dodania (lucide-react, shadcn primitives, Paraglide runtime — wszystko już w projekcie).

## References

- Roadmap slice: `context/foundation/roadmap.md` — S-06 (linia 147-157)
- Change identity: `context/changes/ux-improvements/change.md`
- Upstream i18n konwencja: `context/archive/2026-07-23-i18n-pl-en-toggle/plan-brief.md` (Paraglide `m.<key>()`, `messages/{pl,en}.json`, strict-mode)
- Reducer wzorzec: `src/components/generate/proposalsReducer.ts` (dla akcji `bulkRejectPending`)
- Confirm dialog wzorzec: `src/components/deck/DeleteConfirmDialog.tsx` (dla `BulkRejectConfirmDialog`)
- Server-driven review queue: `src/pages/api/review/next.ts`, `src/components/review/ReviewSession.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Prymitywy UI

#### Automated

- [x] 1.1 Type checking passes: `npx astro sync && npx tsc --noEmit` — 53e9608
- [x] 1.2 Linting passes: `npm run lint` — 53e9608
- [x] 1.3 Build passes: `npm run build` — 53e9608

#### Manual

- [x] 1.4 Spinner / EmptyState / Alert renderują się w obu locale — 53e9608
- [x] 1.5 Spinner animuje (widoczna rotacja) — 53e9608
- [x] 1.6 Alert renderuje z każdym z 3 wariantów, czytelny na tle glassmorph — 53e9608

### Phase 2: Ujednolicenie loading/empty/error w istniejących flow'ach

#### Automated

- [x] 2.1 Type checking passes: `npx astro sync && npx tsc --noEmit` — ae0e98b
- [x] 2.2 Linting passes: `npm run lint` — ae0e98b
- [x] 2.3 Build passes (Paraglide strict-mode nie wywala się na kluczach): `npm run build` — ae0e98b

#### Manual

- [x] 2.4 `/generate` loading pokazuje `<Spinner>` w miejsce dawnego `Loader2` — ae0e98b
- [x] 2.5 `/generate` po streamie z 0 propozycjami pokazuje `<EmptyState>` z nowym copy — ae0e98b
- [x] 2.6 `/generate` error state pokazuje `<Alert variant="error">` z retry — ae0e98b
- [x] 2.7 `/review` loading/error/empty używa nowych prymitywów — ae0e98b
- [x] 2.8 `/deck` loading/error/empty używa nowych prymitywów — ae0e98b
- [x] 2.9 Wszystkie ekrany działają identycznie w PL i EN — ae0e98b

### Phase 3: Reset sesji powtórki

#### Automated

- [x] 3.1 Type checking passes: `npx astro sync && npx tsc --noEmit` — 8ee098a
- [x] 3.2 Linting passes: `npm run lint` — 8ee098a
- [x] 3.3 Build passes: `npm run build` — 8ee098a

#### Manual

- [x] 3.4 Przycisk "Zacznij od nowa" widoczny gdy jest ≥1 due card — 8ee098a
- [x] 3.5 Kliknięcie resetu wraca sesję do pierwszej due card — 8ee098a
- [x] 3.6 Przycisk disabled podczas `submitting` — 8ee098a
- [x] 3.7 Przycisk widoczny i działa w stanie `error` — 8ee098a
- [x] 3.8 Przycisk NIE jest widoczny gdy 0 due cards — 8ee098a
- [x] 3.9 Działa w obu locale — 8ee098a

### Phase 4: Bulk actions na candidate review

#### Automated

- [x] 4.1 Type checking passes: `npx astro sync && npx tsc --noEmit` — 920dcc4
- [x] 4.2 Linting passes: `npm run lint` — 920dcc4
- [x] 4.3 Build passes: `npm run build` — 920dcc4

#### Manual

- [x] 4.4 Header nad listą pokazuje "N do przejrzenia" i dwa bulk buttony — 920dcc4
- [x] 4.5 Bulk accept zapisuje wszystkie pending, progress region pokazuje `Saving: X / N` — 920dcc4
- [x] 4.6 Padnięta karta zostaje w statusie `error`, pozostałe idą dalej — 920dcc4
- [x] 4.7 Bulk reject otwiera confirm dialog z liczbą propozycji — 920dcc4
- [x] 4.8 Confirm bulk reject usuwa wszystkie pending, Anuluj nie zmienia stanu — 920dcc4
- [x] 4.9 Bulk actions nie dotykają edited / saved / już rejected propozycji — 920dcc4
- [x] 4.10 Podczas bulk accept oba bulk buttony i per-card akcje disabled — 920dcc4
- [x] 4.11 Wszystko działa w PL i EN — 920dcc4
- [x] 4.12 A11y: `aria-live` region ogłasza progress — 920dcc4
