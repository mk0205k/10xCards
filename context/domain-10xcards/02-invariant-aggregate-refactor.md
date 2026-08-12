---
title: Invariant + Aggregate Refactor — Learning-Schedule Consistency
created: 2026-08-09
type: refactor-plan
---

# Plan refaktoru — domenowa spójność harmonogramu nauki (I-CORE)

> Nie modyfikujemy kodu produkcyjnego. Ten dokument opisuje **co** musi być
> zabezpieczone, **gdzie** dziś przecieka i **jak** rozłożyć refactor na fazy.

## 0. Odkrycie kontekstu

Zweryfikowane źródła (plik:linia):
- `context/foundation/prd.md:145-155` — „Business Logic" precyzuje dwie decyzje
  produktu: (a) ekstrakcja kart z tekstu, (b) harmonogram powtórek. To jedyne
  domenowe decyzje, jakie system podejmuje za użytkownika.
- `context/foundation/prd.md:161-162` — model dostępu: „The access boundary
  equals the card-ownership boundary." → *ownership* jest granicą agregatu.
- `context/foundation/prd.md:178-180` — Open Questions #3 („edit vs review
  schedule") nadal nierozstrzygnięte w PRD; implementacja domyślnie NIE
  resetuje harmonogramu przy edycji Q/A.
- `context/foundation/tech-stack.md:9-20` — Supabase (Postgres+RLS) + Astro
  SSR + Cloudflare; **has_ai: true**, **has_realtime: false**.
- `src/lib/review/scheduler.ts:31-73` — FSRS scheduler + `emptyCardState()`,
  odzwierciedla `createEmptyCard()`; math żyje **klient-po-stronie-DB**.
- `src/pages/api/review/[card_id]/rate.ts:71-85` — endpoint liczy
  `defaultScheduler.next(card, now, rating)` i przekazuje pełny payload do
  RPC `commit_review`.
- `supabase/migrations/20260709120000_fsrs_state_and_review_log.sql:27-38` —
  kolumny FSRS na `cards`, jedyny CHECK: `state between 0 and 3`.
- `supabase/migrations/20260709120000_fsrs_state_and_review_log.sql:106-160` —
  `commit_review` (SECURITY INVOKER) atomowo UPDATE cards + INSERT
  review_history w jednej transakcji.
- `supabase/migrations/20260709120000_fsrs_state_and_review_log.sql:50-65` —
  `review_history`: append-only (brak GRANT UPDATE/DELETE, `rating check
  between 1 and 4`, `state check between 0 and 3`).
- `supabase/migrations/20260723165737_soft_delete_and_retention.sql:104-197`
  — RLS z EXISTS-gate przez `profiles.deleted_at is null`.
- `src/pages/api/cards.ts:52-99` — POST `/api/cards` wypełnia FSRS state
  DRUGIM źródłem (`emptyCardState()`), obok DB DEFAULT-ów w migracji.
- `src/pages/api/cards/[card_id].ts:56-64` — PATCH nadpisuje wyłącznie
  question/answer, `.strict()` blokuje pola FSRS.

Testy istniejące: `src/lib/review/scheduler.test.ts`,
`src/pages/api/review/[card_id]/rate.test.ts`,
`src/pages/api/cards.test.ts` — pokrywają szczęśliwą ścieżkę i błędy
wejścia, ale **nie** pokrywają współbieżności, wstecznego zapisu FSRS
state i integralności `card ↔ review_history`.

## 1. Zidentyfikowane niezmienniki (kandydaci)

| ID | Niezmiennik | Źródło (plik:linia) |
| --- | --- | --- |
| I-1 | Karta należy do dokładnie jednego użytkownika; wszystkie mutacje wymagają zgodności `auth.uid() = user_id`. | `supabase/migrations/20260707200908_initial_schema.sql:79-102`, `20260723165737_soft_delete_and_retention.sql:111-164` |
| I-2 | `review_history.user_id = cards.user_id` dla tej samej `card_id` (spójność referencyjna po użytkowniku). | `supabase/migrations/20260709120000_fsrs_state_and_review_log.sql:141-146` (przypisanie w RPC) |
| I-3 | Konto miękko-usunięte (profiles.deleted_at ≠ NULL) nie widzi i nie mutuje żadnej karty ani logu. | `supabase/migrations/20260723165737_soft_delete_and_retention.sql:111-197` |
| **I-CORE** | **Stan FSRS karty (`due, stability, difficulty, reps, lapses, state, last_review, learning_steps, scheduled_days, elapsed_days`) jest deterministyczną funkcją: `createEmptyCard()` + posortowana wg czasu sekwencja wpisów `review_history` tej karty. Każde ocenienie produkuje DOKŁADNIE JEDEN wpis logu ORAZ jedną atomową aktualizację karty — łącznie albo wcale.** | `src/pages/api/review/[card_id]/rate.ts:71-100`, `supabase/migrations/20260709120000_fsrs_state_and_review_log.sql:106-160` |
| I-5 | Wpis `review_history`, raz zapisany, jest niemutowalny (append-only). | `supabase/migrations/20260709120000_fsrs_state_and_review_log.sql:77-78` (brak UPDATE/DELETE grant) |
| I-6 | `rating ∈ {1,2,3,4}`; `state ∈ {0,1,2,3}` (FSRS-6). | `20260709120000_...:37, 54, 55`; `rate.ts:10` |
| I-7 | Karta ma niepuste `question` i niepuste `answer`; `source ∈ {'ai','manual'}`. | `cards.ts:9-14`, `20260707200908_...:16, 20-27` |
| I-8 | Nowa karta startuje ze stanu `createEmptyCard()` niezależnie od ścieżki insertu. | `scheduler.ts:58-74`, `20260709120000_...:27-38` (defaulty DB) |
| I-9 | Twarde usunięcie użytkownika kaskaduje po wszystkich kartach i logach; watchdog krzyczy, gdy >1 dzień zaległości. | `20260723165737_...:36-37, 260-320` |
| I-10 | Ocena karty nieznanej / cudzej / miękko-usuniętego właściciela zwraca 404, a nie 500/403. | `rate.ts:96-98` |

## 2. Klasyfikacja i wybór rdzenia

**Rdzeń (core):** I-CORE — spójność harmonogramu nauki.
**Uzasadnienie:** cała wartość produktu ("provides cards and a schedule",
PRD:155) opiera się na tym, że kolejny termin powtórki wynika z historii
ocen. Jeśli `cards.reps` nie równa się długości `review_history` dla tej
karty, lub `cards.last_review ≠ MAX(review_history.review)`, to metoda
spaced repetition przestaje być mierzalna — algorytm dostaje wejście,
które nie odpowiada realnej historii nauki. Wszystkie inne niezmienniki
są *wspierające* (ownership, append-only, defaulty), ale nie stanowią
istoty domeny.

**Wspierające (defend, nie refaktorujemy):** I-1, I-2, I-3, I-5, I-6,
I-7, I-9, I-10 — bronione przez RLS/GRANT/CHECK/enum/middleware,
stan dziś **dostateczny**.

**Trywialne / operacyjne:** I-8 (start-state) jest częścią I-CORE
(single source of truth zostanie skonsolidowane w kroku 2 refactoru).

## 3. Agregat i granica

**Aggregate root:** `Card` (jedna karta danego użytkownika).
**Aggregate boundary:** `Card` + append-only kolekcja `ReviewLog[]` dla
tej karty.
**Reguła zapisu:** **jedno wejście do mutacji stanu FSRS** — RPC
`commit_review`. Endpoint `rate` **przekazuje** wynik obliczeń, ale
autorytatywne wpięcie do bazy przechodzi przez agregat.
**Reguła odczytu:** `Card.hydrate(row)` konstruuje agregat z wiersza
`cards` (Supabase); `ReviewLog[]` może być pobrana leniwie, ale **nie
jest potrzebna** do wykonania `rate()` — FSRS operuje wyłącznie na
bieżącym stanie karty (właściwość FSRS-6, walidowana przez
`hydrateCard` w `scheduler.ts:78-91`).

## 4. Diagnoza I-CORE — gdzie dziś przecieka

**D-1. Brak optimistic concurrency locka w `commit_review`.**
Dwa równoległe POST-y do `/api/review/{id}/rate`:
1. Oba czytają ten sam `cards` wiersz (`rate.ts:52-56`).
2. Oba liczą `defaultScheduler.next(card, now, rating)` — na tym samym
   wejściu.
3. Oba wywołują `commit_review` — Postgres zaseriaslizuje UPDATE-y na
   poziomie wiersza, ale nie sprawdzi, czy wejście do 2. wywołania było
   *aktualne*.
Efekt: dwa wpisy w `review_history`, ale `cards.reps = 1` zamiast 2, bo
drugi UPDATE nadpisał pierwszy stanem policzonym z pre-first-state.
`I-CORE` łamie się bez wyjątku, po cichu. `rate.ts:73` liczy math i
`commit_review` mu wierzy.

**D-2. `commit_review` nie waliduje spójności payloadu.**
`p_updated_card` i `p_log` są jsonb, castowane wprost do kolumn
(`20260709120000_...:120-155`). Nic nie sprawdza:
- czy `p_updated_card.reps == old.reps + 1` (albo == old.reps dla wczesnych faz FSRS),
- czy `p_updated_card.last_review == p_now`,
- czy `p_log.rating == p_rating`,
- czy `p_log.review >= card.last_review` (monotoniczność czasu).
Endpoint jest jedynym callerem *dziś* — ale RPC to load-bearing
publiczna powierzchnia (GRANT do `authenticated`); każdy przyszły
klient (skrypt migracji, testy pgTAP, JavaScript admin console) może
napisać niespójny payload i baza go przyjmie.

**D-3. Kolumny FSRS można zmutować pisaniem wprost do `cards`, omijając
`commit_review`.** Nic w migracji nie zabrania `update cards set due =
'2099-01-01' where id = ...`. RLS pozwala właścicielowi, GRANT UPDATE
jest globalny. Aktualny endpoint PATCH cardu (`cards/[card_id].ts:56-64`)
tego nie robi (Zod .strict + jawnie tylko `question/answer`), ale
kontrakt nie jest wymuszony w bazie — wystarczy jeden nowy endpoint
z copy-paste'em, żeby I-CORE runęło.

**D-4. Anemiczny model — brak reprezentacji agregatu w kodzie.**
`Card` istnieje wyłącznie jako `CardRow` (`database.types.ts:38-56`) i
jako `ts-fsrs.Card` (`scheduler.ts:78`). Nie ma warstwy, która narzuca
**"jedyna droga do zmiany stanu FSRS to `Card.rate()`"**. Endpoint
`rate` importuje `defaultScheduler` bezpośrednio z biblioteki i sam
składa payload RPC.

**D-5. Podwójne źródło stanu początkowego karty.**
`emptyCardState()` (`scheduler.ts:58-73`) i DEFAULT-y w migracji
(`20260709120000_...:27-38`) niezależnie deklarują ten sam kontrakt.
Wersja biblioteki `ts-fsrs` się zmieni → jedno z dwóch pójdzie do
przodu, drugie zostanie. I-8 pęka bez ostrzeżenia.

**D-6. Ograniczenia sanityczne kolumn FSRS istnieją tylko dla `state`.**
Brak CHECK: `reps >= 0`, `lapses >= 0`, `lapses <= reps`, `stability >=
0`, `difficulty between 0 and 10`, `learning_steps >= 0`,
`scheduled_days >= 0`, `elapsed_days >= 0`. Bug w scheduler.ts lub
przypadkowy negatywny cast (`(p_updated_card->>'reps')::integer` przy
`"reps": "-1"`) zostanie zapisany.

**D-7. Otwarta decyzja o edycji Q/A.** PRD Open Q #3 nadal otwarte;
implementacja domyśla „nie resetuje", ale to jest wybór **produktowy**
zakopany w Zodowym schemacie. Musi zostać eskalowany do jawnej
domenowej metody `Card.editContent()` z komentarzem „Policy:
non-resetting" i wpisem w `context/foundation/lessons.md`.

## 5. Projekt refactoru — fazy

Kolejność ma znaczenie: najpierw DB (fail-fast na zapisie), potem TS
(fail-fast w kompilatorze), potem testy pgTAP + Vitest, potem rejestr
nazw. Fazy test-first oznaczam `[TDD]`.

### Faza R1 — hardening bazy danych (fail-fast po stronie danych)

Nowa migracja `YYYYMMDDHHmmss_card_aggregate_integrity.sql`. Bez
zmian schemy widocznych dla API. Wprowadza:

1. **CHECK constraints na `cards`** (te, których brakuje):
   - `reps >= 0`
   - `lapses >= 0`
   - `lapses <= reps`
   - `stability >= 0`
   - `difficulty >= 0`
   - `learning_steps >= 0`
   - `scheduled_days >= 0`
   - `elapsed_days >= 0`
2. **Trigger BEFORE UPDATE na `cards`** (nazwa: `cards_fsrs_write_guard`)
   — jeśli którakolwiek z kolumn FSRS zmienia wartość, a bieżące
   wywołanie nie pochodzi z `commit_review` (marker: local GUC
   `app.commit_review_running = 'on'` ustawiany na początku RPC,
   resetowany na końcu; alternatywa: `pg_trigger_depth() > 0` +
   whitelisting `TG_OP`), wtedy `raise exception ... errcode = '42501'`.
   `commit_review` musi być wyłącznym pisarzem FSRS-state.
3. **`commit_review` — optimistic-lock parameter + walidacja payloadu**:
   - Nowy parametr: `p_expected_last_review timestamptz` (NULL dla
     nowej karty).
   - Klauzula `where id = p_card_id and last_review is not distinct
     from p_expected_last_review`; jeśli 0 wierszy → `raise exception
     ... errcode = '40001'` (serialization_failure).
   - Explicit `if p_rating not between 1 and 4 then raise ...`.
   - Sanity: `if (p_log->>'rating')::smallint <> p_rating then raise ...`.
   - Sanity: `if (p_updated_card->>'last_review')::timestamptz < old.last_review then raise ...`
     (monotoniczność czasu ostatniej powtórki).
4. **Rewoke GRANT UPDATE na FSRS-state kolumnach z roli `authenticated`.**
   `authenticated` zachowuje UPDATE tylko na `question, answer,
   updated_at` (poprzez column-level GRANT). Wszystkie inne kolumny
   ruszają się wyłącznie przez `commit_review`. To domyka D-3 nawet
   gdyby trigger padł.
5. **DEFAULT-y kolumn FSRS pozostają** — I-8 dalej broniony w DB. Kod
   TS może przestać wysyłać `emptyCardState()` (patrz R2).

Ryzyko: `authenticated` traci UPDATE na `updated_at` z triggera; to
działa, bo trigger `trigger_set_updated_at` wykonuje się z uprawnieniami
tabeli (właściciel = postgres), nie z uprawnieniami wywołującego. Do
zweryfikowania w pgTAP.

### Faza R2 — warstwa domenowa TS (`src/lib/domain/card.ts`) `[TDD]`

Pliki: `src/lib/domain/card.ts`, `src/lib/domain/card.test.ts`.
Wnętrze:

```
export type Rating = 1 | 2 | 3 | 4;
export const ratingSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

export interface Card { /* dokładnie kolumny cards */ }
export interface CardRating { card: Card; log: ReviewLogPayload; expectedLastReview: string | null; }

export const Card = {
  newFor(userId: string, content: { question: string; answer: string; source: "ai" | "manual" }): Card;
  hydrate(row: CardRow): Card;
  rate(card: Card, rating: Rating, now: Date): CardRating;
  editContent(card: Card, patch: { question: string; answer: string }): Card;  // Policy: NON-RESETTING
  canBeRatedBy(card: Card, userId: string): boolean;
};
```

- Reeksportuje `emptyCardState()` z jednego miejsca (usuwa D-5).
- `rate()` opakowuje `defaultScheduler.next()` i zwraca również
  `expectedLastReview = card.last_review` — to jest wartość, którą
  endpoint przekaże jako `p_expected_last_review` do RPC.
- Endpoint `POST /api/review/[card_id]/rate` i endpointy `cards.ts`
  przestają importować `ts-fsrs` bezpośrednio; wszystkie operacje idą
  przez `Card.*`.

### Faza R3 — endpointy staja się cienkie `[TDD]`

- `rate.ts`: parse → `Card.hydrate` → `Card.rate` → `supabase.rpc(
  'commit_review', { p_expected_last_review, ... })` → 200 / 404 / 409.
- Nowy kod błędu klienta: `409 Conflict` gdy RPC zwraca `40001`;
  klient odświeża kartę i pozwala użytkownikowi zdecydować ponownie
  (albo automatycznie retry ×1).
- `cards.ts` POST: przestaje wywoływać `emptyCardState()` — DB
  DEFAULT-y są jedynym źródłem stanu (I-8 broniony w jednym miejscu).
  Alternatywnie: `Card.newFor()` jawnie ustawia stan i endpoint wysyła
  cały payload — DO WYBORU w Fazie R3, zależy które jest bardziej
  przejrzyste. Kryterium: tylko JEDNO miejsce może być autorytatywne.
- `cards/[card_id].ts` PATCH: pod spodem woła `Card.editContent()`,
  aby uwypuklić „NON-RESETTING policy" (D-7).

### Faza R4 — testy pgTAP + Vitest `[TDD]`

pgTAP (`supabase/tests/card_aggregate.test.sql`), przypadki:

Legalne:
- `commit_review(card_of_u1, 3, now, updated, log, expected_last_review=null)`
  na świeżej karcie → wraca wiersz, `review_history` dostaje 1 wpis.
- Sekwencja 3 ocen → `reps = 3`, `count(review_history) = 3`,
  `cards.last_review = MAX(review_history.review)`.
- `update cards set question = 'x' where id = ...` z roli
  `authenticated` → OK.

Nielegalne (każdy zatrzymuje transakcję konkretnym errcode):
- `rating = 5` w RPC → `raise exception 22023` (lub własny).
- Drugie wywołanie `commit_review` z tym samym `p_expected_last_review`
  po pierwszym → `40001`.
- `update cards set reps = 999 where id = ...` z `authenticated` →
  column-level GRANT odmawia (`42501`).
- `update cards set due = '2099-01-01'` z bypass GRANT (rola z
  UPDATE-em) → trigger `cards_fsrs_write_guard` raise `42501`.
- `update review_history set rating = 4 where id = ...` z
  `authenticated` → grant-denied (już bronione, regression test).
- `delete from review_history where id = ...` → grant-denied.
- `insert into cards ... reps = -1` → CHECK raise.
- `commit_review` z `p_updated_card.last_review < old.last_review` →
  monotoniczność raise.

Vitest (`src/lib/domain/card.test.ts`):
- `Card.newFor()` → state=New, reps=0, last_review=null.
- `Card.rate(card, 3, now)` → reps+1, last_review=now, expectedLastReview
  = wartość pre-rate.
- `Card.editContent()` nie zmienia żadnej kolumny FSRS.
- `ratingSchema` odrzuca 0, 5, "3", null, undefined.
- Idempotencja: `Card.rate` nie mutuje wejściowego obiektu (immutable).

### Faza R5 — rejestr load-bearing nazw

Aktualizacja `docs/reference/contract-surfaces.md` (rejestr istnieje
zgodnie z `.claude/CLAUDE.md:110-115`). Nowe wpisy:

- `Card` (aggregate root), `Card.rate`, `Card.editContent`, `Card.newFor`,
  `Card.hydrate` — `src/lib/domain/card.ts`.
- `Rating` (branded 1|2|3|4) — `src/lib/domain/card.ts`.
- `commit_review.p_expected_last_review` — `supabase/migrations/<new>.sql`.
- `cards_fsrs_write_guard` (trigger) — jedyny legalny pisarz FSRS-state.
- `app.commit_review_running` (GUC marker) — używany przez trigger.
- Kod błędu HTTP `409 CARD_STALE` — kontrakt endpointu `/api/review/.../rate`.

### Kolejność, przełącznik, rollback

1. R1 wchodzi jako pojedyncza migracja + backfill (istniejące karty
   mają `last_review IS NULL` lub konkretną wartość — obie akceptowane
   przez nowy `p_expected_last_review`).
2. R2 + R3 mergują razem — bez R3 endpointy nie umieją podać
   `p_expected_last_review` i wywołania zaczną wracać `40001`.
   **Ryzyko** = pomiędzy R1 a R3 endpointy zwracają błędy → **R1 i
   R2+R3 razem w jednym PR-ze**.
4. R4 test-first: piszemy pgTAP przed migracją R1, Vitest przed
   `card.ts`.
5. R5 dopisujemy po zielonych testach.

Rollback: migracja R1 ma sekcję `down` (drop CHECK, drop trigger,
przywróć GRANT-y, przywróć starą sygnaturę `commit_review`).

## 6. Legalne / nielegalne przejścia (kontrakt agregatu)

**Legalne operacje na `Card`:**
| Operacja | Warunek | Efekt na stanie |
| --- | --- | --- |
| `Card.newFor(userId, {q,a,source})` | q≠∅, a≠∅, source∈{ai,manual} | state=New, reps=0, last_review=null |
| `Card.rate(card, r, now)` | r∈{1..4}, właściciel = auth.uid(), nie soft-deleted | reps+1 (lub +0 w wewnętrznych fazach FSRS, per bibliotekę), last_review=now, due>=now |
| `Card.editContent(card, {q,a})` | q≠∅, a≠∅, właściciel = auth.uid() | Q/A zmienione, kolumny FSRS niezmienione (POLICY: NON-RESETTING) |
| `delete cards where id=?` | właściciel = auth.uid() | cascade po `review_history` |

**Nielegalne przejścia (muszą zwrócić błąd, nie zapisać):**
- rating poza {1,2,3,4} → 400 na API, 22023 w RPC.
- Concurrent rate (dwa razy z tym samym `expected_last_review`) →
  drugi 409 (40001 w RPC).
- Ocena karty cudzej lub soft-deleted → 404 (RLS + EXISTS-gate).
- Zapis do FSRS-state poza `commit_review` → 42501 (trigger).
- Zapis do `review_history` bez FK do własnej karty → 42501 (RLS).
- Update/Delete istniejącego wpisu `review_history` → grant-denied.
- Insert karty z negatywnym reps/lapses/stability → CHECK raise.
- Cofnięcie `last_review` w czasie → RPC raise (monotoniczność).
- POST /api/cards z polami FSRS w body → 400 (Zod .strict, już
  bronione — regression test).

## 7. Podsumowanie

Rdzeniowy niezmiennik produktu — spójność harmonogramu nauki (I-CORE)
— jest dziś broniony jedną atomową RPC (`commit_review`), ale przecieka
w pięciu miejscach: brak optimistic-locka, brak walidacji payloadu w
RPC, otwarta droga do bezpośredniej mutacji kolumn FSRS, anemiczny
model po stronie TypeScriptu i podwójne źródło stanu początkowego
karty. Plan zamyka te przecieki w kolejności DB → domena → endpointy
→ testy → rejestr, a każde nielegalne przejście fail-fastuje z
konkretnym errcodem (22023, 40001, 42501) zamiast cichego zapisu. Wejściem
domeny do bazy staje się jedna nowa metoda `Card.rate`, wyjściem z
bazy — jedna wzmocniona RPC `commit_review` z `p_expected_last_review`.
Otwarte pytanie PRD #3 (edit vs schedule reset) zostaje jawnie
rozstrzygnięte jako „NON-RESETTING" i zapisane w
`context/foundation/lessons.md`. Testy pgTAP + Vitest są test-first
dla wszystkich pięciu miejsc przecieku, więc regresja I-CORE staje się
mechanicznie niemożliwa. Load-bearing nazwy (`Card`, `Rating`,
`p_expected_last_review`, `cards_fsrs_write_guard`, `CARD_STALE`)
trafiają do rejestru kontraktów w kroku R5.
