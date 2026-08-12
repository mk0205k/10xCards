---
title: Domain Distillation — 10xCards
created: 2026-08-09
type: domain-distillation
---

# Domain Distillation — 10xCards

Mapa (nie kod) domeny, wyprowadzona z dokumentów źródłowych i zweryfikowana
kodem. Cel: pokazać kandydatów na agregaty, ich niezmienniki, oraz rozjazdy
między tym, co dokument obiecuje, a tym, co kod egzekwuje.

Źródła:
- `context/foundation/prd.md` (v2, 2026-07-27)
- `context/foundation/shape-notes.md`
- `context/foundation/roadmap.md`
- `context/foundation/tech-stack.md`
- `supabase/migrations/*.sql` (3 pliki)
- `src/pages/api/**`, `src/lib/**`, `src/components/**`, `src/middleware.ts`

---

## Krok 0 — Kontekst produktu (streszczenie)

Aplikacja webowa dla dorosłego profesjonalisty przygotowującego się do
certyfikacji. Persona zna wartość spaced repetition, ale odrzuca metodę z
powodu godzin potrzebnych na ręczne pisanie fiszek (PRD §Vision, §User &
Persona). Produkt podejmuje **dwie decyzje w imieniu użytkownika** (PRD
§Business Logic):

1. **Ekstrakcja fiszek z tekstu** — wejście: wklejony fragment; wyjście:
   propozycje par pytanie–odpowiedź.
2. **Harmonogram powtórek** — wejście: historia ocen trudności; wyjście:
   kolejność i data następnego pokazania każdej fiszki.

Reguła spinająca (PRD §Business Logic, cyt.): *"user provides text and
ratings; the application provides cards and a schedule"*.

Model dostępu: płaski, single-tenant per user; granica własności = granica
dostępu (PRD §Access Control).

---

## Krok 1 — Odkryty słownik ubikwitalny

| Termin | Znaczenie | Ślad w kodzie |
| --- | --- | --- |
| **Card / Flashcard** | Zapisana para Q/A z pełnym stanem FSRS; należy do jednego użytkownika. | `public.cards` w `supabase/migrations/20260707200908_initial_schema.sql:20-28` + kolumny FSRS w `20260709120000_fsrs_state_and_review_log.sql:27-38` |
| **Source** (`ai` \| `manual`) | Pochodzenie fiszki; determinuje metrykę "75 % AI". | enum w `20260707200908_initial_schema.sql:16`; wartość ustawiana raz przy POST — `src/pages/api/cards.ts:82` (default `"ai"`) i `src/components/deck/CardFormDialog.tsx:51` (`"manual"`) |
| **Proposal** | Kandydat na fiszkę, wygenerowany z tekstu; ma status `pending → editing → rejected/saving → saved/error`. Żyje wyłącznie w reducerze przeglądarki. | `src/components/generate/proposalsReducer.ts:3-48`; nigdy nie ląduje w DB — do DB trafia dopiero po `saveStart` przez `POST /api/cards` (linia 46) |
| **Rating** | Ocena trudności 1..4 (Again/Hard/Good/Easy — FSRS). | zod literalny 1..4 w `src/pages/api/review/[card_id]/rate.ts:10`; check `rating between 1 and 4` w `20260709120000_fsrs_state_and_review_log.sql:54` |
| **ReviewLog** | Niezmienny fakt oceny: `(card_id, user_id, rating, state, due, stability, difficulty, elapsed_days, last_elapsed_days, scheduled_days, learning_steps, review)`. | tabela `public.review_history` w `20260709120000_fsrs_state_and_review_log.sql:50-65`; grant tylko `select, insert` — linia 77 |
| **Review session** | Ciąg "next-due → reveal → rate → next" w UI. Brak identyfikatora sesji po stronie serwera. | UI: `src/components/review/ReviewSession.tsx`; reset jako `useRef` counter — linia 76 i 99–103 |
| **Scheduler (FSRS)** | Algorytm powtórek z `ts-fsrs` (FSRS-6), fuzz włączony. | `src/lib/review/scheduler.ts:31-40` (fabryka), `defaultScheduler` — linia 42 |
| **Deck** | Nieformalny zbiór fiszek danego użytkownika. Nie jest odrębną encją; zawsze wywodzony jako `cards WHERE user_id = auth.uid()`. | statystyki w `src/lib/services/deck-stats.ts:14-18` (trzy niezależne COUNT-y) |
| **Profile / Account** | Tożsamość + stan retencji (`deleted_at`, `scheduled_hard_delete_at`). | `public.profiles` w `supabase/migrations/20260723165737_soft_delete_and_retention.sql:36-41` |

---

## Krok 2 — Kandydaci na agregaty

### Agregat A: **Card** (root)

Sercem produktu. Trzyma treść (Q/A), pochodzenie (`source`) i cały stan FSRS.
Dziecko: **ReviewLog** — dołącza zawsze i tylko przez `commit_review` RPC w
jednej transakcji z UPDATE karty. Bez tej atomiczności historia ratingów
mogłaby rozjechać się z kolumną `due` i harmonogram byłby stale przekłamany.

### Agregat B: **Account / Profile** (root)

Trzyma cykl życia konta i okno retencji. Nie zawiera fiszek jako dziecka —
`cards.user_id` referuje `auth.users`, a `profiles.user_id` jest 1:1 z tym
samym `auth.users`. Aggregate boundary Account trzyma jedynie stan
soft-delete; sam nie kaskaduje modyfikacji na Card, natomiast **RLS EXISTS
gate** na `cards` czyta profile, tworząc twardą zależność w kierunku
odczytu.

### Nie-agregaty

- **Proposal** — ulotny obiekt UI, nie persystowany. Nie jest agregatem
  (żadnego niezmiennika po stronie serwera).
- **ReviewLog** — child entity w agregacie Card; nie ma cyklu życia
  niezależnego od karty (cascade delete w `20260709120000_..:52`).
- **Deck** — pojęcie z dokumentów, nie encja; brak niezmienników
  deck-level.
- **Review session** — pojęcie UX, nieobecne po stronie serwera.

---

## Krok 3 — Niezmienniki (z cytatem i statusem egzekucji)

### Agregat Card

| # | Niezmiennik | Cytat ze źródła | Egzekucja w kodzie |
| --- | --- | --- | --- |
| C-1 | Każda karta ma dokładnie jednego właściciela (użytkownika). | PRD §Access Control: *"Each user owns their own deck of cards; no sharing"*. | **Egzekwuje.** `cards.user_id NOT NULL references auth.users on delete cascade` — `20260707200908_initial_schema.sql:22`. RLS SELECT/INSERT/UPDATE/DELETE `auth.uid() = user_id` — `20260707200908_initial_schema.sql:79-102`. Migracja S-05 utwardza dodatkowo EXISTS gate na `profiles` — `20260723165737_soft_delete_and_retention.sql:111-164`. |
| C-2 | Aktualizacja stanu FSRS karty **i** wpisanie do `review_history` dzieją się atomowo. | PRD §Business Logic: *"Review scheduling. Input: the user's history of difficulty ratings … Output: the order and date of the next showing of each card"* — spójny obraz historii i harmonogramu wymaga atomowości. | **Egzekwuje.** RPC `commit_review` — pojedyncze `UPDATE cards … RETURNING * INTO v_card` + `INSERT INTO review_history` w jednym ciele funkcji plpgsql (`20260709120000_fsrs_state_and_review_log.sql:106-160`). Endpoint wywołuje wyłącznie RPC — `src/pages/api/review/[card_id]/rate.ts:79-85`. |
| C-3 | Ocena, raz zapisana, jest faktem: brak UPDATE/DELETE. | Komentarz migracji: *"review_history is append-only: no UPDATE/DELETE grant to authenticated"*. | **Egzekwuje (dla authenticated).** `grant select, insert on public.review_history to authenticated` — `20260709120000_fsrs_state_and_review_log.sql:77`. Uwaga: `service_role` też ma tylko `select, insert` (linia 78), ale jako superuser postgres może obejść — polityki są egzekucją, nie gwarancją. |
| C-4 | Question i answer są niepuste. | FR-008/FR-010 implicit; `proposalSchema` przy generacji wymaga `min(1)` — `src/lib/ai/generate-proposals.ts:8-10`. | **Egzekwuje częściowo.** Zod na endpointach: `src/pages/api/cards.ts:9-14` (`z.string().min(1)`) i `src/pages/api/cards/[card_id].ts:11-16`. **Brak** CHECK-a w DB przy `create table cards` (`20260707200908_initial_schema.sql:20-28`) — dowolny bypass zod (nowy endpoint, migracja seedowa, service_role) może wstawić pusty string. |
| C-5 | `source` należy do zbioru `{ai, manual}`. | FR-016/017: *"total flashcard count, split by source (AI vs manual)"*. | **Egzekwuje.** Enum `card_source` — `20260707200908_initial_schema.sql:16`; zod `z.enum(["ai", "manual"]).default("ai")` — `src/pages/api/cards.ts:12`. |
| C-6 | Stan FSRS `state` mieści się w `{0, 1, 2, 3}`. | Ograniczenie biblioteki `ts-fsrs`. | **Egzekwuje.** `check (state between 0 and 3)` — `20260709120000_fsrs_state_and_review_log.sql:37`. |
| C-7 | `source` jest ustawiane raz przy tworzeniu i nie zmienia się przez cały cykl życia karty. | Metryka wtórna *"75% of all flashcards in a user's deck are created using AI"* (PRD §Success Criteria) traci sens, jeśli można flipnąć source po fakcie. | **Deklaruje, częściowo egzekwuje.** PATCH endpoint `src/pages/api/cards/[card_id].ts:11-16` ma `strict()` zod tylko z `question`/`answer` — nie da się zmienić `source` tą drogą. **Brak** DB-owego triggera / policy zabraniającej `UPDATE cards SET source = …` z RLS-friendly wywołania; kolumnowego GRANT-u też nie ma. |

### Agregat Account / Profile

| # | Niezmiennik | Cytat ze źródła | Egzekucja w kodzie |
| --- | --- | --- | --- |
| A-1 | Użytkownik soft-deleted nie ma dostępu do własnych fiszek. | Roadmap S-05 outcome: *"konto natychmiast staje się niedostępne (brak możliwości logowania, dane niewidoczne w aplikacji)"*. | **Egzekwuje.** EXISTS gate `p.user_id = auth.uid() and p.deleted_at is null` w każdej z 6 polityk RLS na `cards`/`review_history` — `20260723165737_soft_delete_and_retention.sql:111-197`. Middleware dodatkowo przekierowuje na `/auth/restore-account` — `src/middleware.ts:29-40`. |
| A-2 | Hard-delete nie może nastąpić przed `scheduled_hard_delete_at`. | Roadmap S-05 outcome: *"po 30 dniach są nieodwracalnie usuwane"*. | **Egzekwuje.** `where scheduled_hard_delete_at <= now()` w `execute_hard_delete` — `20260723165737_soft_delete_and_retention.sql:270-276`. Cron `0 3 * * *` — linia 357–361. Watchdog `retention_watchdog` (04:00 UTC) rzuca `EXCEPTION` jeśli któraś retencja przekroczyła cutoff o >1 dzień — linie 302–319. |
| A-3 | Email w oknie retencji nie może być użyty do rejestracji. | Roadmap S-05 rozstrzygnięcie *"blokada"*. | **Egzekwuje.** RPC `email_pending_deletion` — `20260723165737_soft_delete_and_retention.sql:331-347` (SECURITY DEFINER, `stable`, lower-case normalizacja). Endpoint `src/pages/api/auth/signup.ts:29-37` woła RPC i redirectuje z `ACCOUNT_PENDING_DELETION`. Uwaga: fail-open przy błędzie RPC (linia 30–33). |
| A-4 | `enqueue_hard_delete` jest idempotentne. | Komentarz migracji: *"Idempotent: no-op when already deleted_at IS NOT NULL"*. | **Egzekwuje.** `update … where user_id = p_user_id and deleted_at is null` — `20260723165737_soft_delete_and_retention.sql:219-224`. |

---

## Krok 4 — Rozjazdy MODEL vs KOD

Najcenniejsza część mapy: tam, gdzie dokument opisuje regułę, a kod nie w
pełni odwzorowuje ją modelem.

| # | Dokument mówi | Kod robi | Dowód (plik:linia) |
| --- | --- | --- | --- |
| D-1 | *"The algorithm updates the review schedule based on the user's rating"* (FR-015) — jeden autorytatywny obliczeniowy. | Autorytet obliczenia FSRS jest **rozdwojony** między Workera i Postgresa. Worker liczy `defaultScheduler.next(card, now, rating)` i serializuje wynik jako JSONB do RPC `commit_review`, która przyjmuje payload i tylko rzutuje pola. Postgres **nie weryfikuje** wyniku FSRS — ufa Workerowi. | Worker: `src/pages/api/review/[card_id]/rate.ts:73` (`defaultScheduler.next(...)`) i linie 79–85 (payload → RPC). Postgres: `supabase/migrations/20260709120000_fsrs_state_and_review_log.sql:120-156` (`UPDATE … = (p_updated_card->>'due')::timestamptz` itd.). Komentarz migracji: *"Callers … pass the already-computed FSRS output as jsonb; the function does no scheduling"* (linia 15–16). |
| D-2 | UI obiecuje użytkownikowi konkretny interwał dla każdej z 4 opcji ratingu (Again/Hard/Good/Easy). Zobowiązanie: "Rate → dostaniesz to, co przycisk zapowiada". | Preview liczony w oderwaniu od commitu. `computePreview` uruchamia `scheduler.repeat(card, now)`, a przy kliknięciu `scheduler.next(...)` startuje **niezależnie**. Fuzz jest włączony (`enable_fuzz: true`), więc dwa wywołania na tym samym wejściu dają **losowo różne** `due`. Obietnica z UI ≠ zapisany harmonogram. | Preview: `src/lib/review/scheduler.ts:93-101` (`scheduler.repeat`). Commit: `src/pages/api/review/[card_id]/rate.ts:73` (`scheduler.next`). Fuzz: `src/lib/review/scheduler.ts:34` (`enable_fuzz: opts.enableFuzz ?? true`). Preview i commit nawet nie dzielą tego samego wywołania — commit re-runuje pełne planowanie. |
| D-3 | PRD Open Question 3: *"When a user edits an existing card (FR-010) that already has a review history, does the schedule reset to 'new card' or persist? — Owner: user. By: before review-session implementation."* Otwarte pytanie oznaczone jako blockujące. | Rozstrzygnięcie zapadło "milczeniem" — PATCH `question`/`answer` **nie dotyka** kolumn FSRS, więc schedule persystuje. Brak komentarza, testu, wpisu w PRD ani nawet ADR utrwalającego decyzję. | `src/pages/api/cards/[card_id].ts:56-64` — UPDATE tylko `question` + `answer`. Open Q3 pozostaje formalnie otwarte w `context/foundation/prd.md:180`. |
| D-4 | Sekundarna metryka sukcesu: *"75% of AI-generated flashcards are accepted by the user"* (PRD §Success Criteria). | Akceptacja/odrzucenie propozycji żyje **wyłącznie w reducerze przeglądarki**; serwer widzi tylko zapisane karty (`POST /api/cards`). Zero zdarzeń "rejected"/"generated_total" nie leci do backendu → metryki fundamentalnie nie da się policzyć z posiadanych danych. | Reducer: `src/components/generate/proposalsReducer.ts:33-48` (akcje `reject`, `saveStart`, `saveSuccess` czysto klientowe). Endpoint POST karty widzi tylko finalny `question`+`answer`+`source` — `src/pages/api/cards.ts:75-86`. Brak endpointu `POST /api/proposals` lub telemetrii. |
| D-5 | *"Review session"* to first-class pojęcie w PRD/US-02/S-02/S-06 (start sesji, reset sesji, sesja domknięta). | Serwer nie ma pojęcia sesji: żadnego `session_id`, żadnego "session start/end". `/api/review/next` traktuje każde wywołanie niezależnie; reset sesji to `useRef` counter po stronie klienta. Nie da się odtworzyć "user zrobił 12 kart w jednej sesji" z danych. | Endpoint: `src/pages/api/review/next.ts:14-70` (bezstanowe wybieranie następnej due card). Reset klientowy: `src/components/review/ReviewSession.tsx:76` (`generationRef = useRef(0)`) i linie 99–103. |
| D-6 | *"Deck"* jest w PRD §Vision, US-01, S-09 (dashboard: liczba fiszek, split AI vs manual, due today) — całościowy obiekt "moja talia". | Deck nie istnieje jako model. Dashboard woła 3 niezależne COUNT-y na `cards` z filtrem `user_id`. Brak inwariantów deck-level (np. limit rozmiaru, "min. 1 fiszka przed sesją"). Nazewnictwo w dokumentach ("talia") vs. w kodzie ("cards filtered by user_id") tworzy leksykalną lukę. | `src/lib/services/deck-stats.ts:14-18` — 3× `.from("cards")…{ count: "exact", head: true }`. Nazwa modułu `deck-stats.ts` udaje agregat, ale nie ma go w domenie. |
| D-7 | Metryka *"75% of all flashcards … created using AI"* (PRD §Success Criteria) — trzyma się tylko gdy `source` jest ustalone raz przy tworzeniu. | Immutability `source` jest wymuszona **wyłącznie przez zod `strict()` na PATCH-u kart**. Brak DB-owego trigera lub GRANT column-level. Nowy endpoint lub service_role może flipnąć `source`. | PATCH: `src/pages/api/cards/[card_id].ts:11-16` — zod `strict()`, brak `source`. RLS UPDATE cards: `supabase/migrations/20260723165737_soft_delete_and_retention.sql:135-152` — z klauzulą `with check (auth.uid() = user_id and exists…)`, ale bez ograniczenia zbioru kolumn. |
| D-8 | FR-005/FR-008/FR-010 implicit: fiszka ma niepustą treść. | Wymóg niepustości egzekwowany tylko w warstwie API (zod). Brak `check (length(question) > 0)` / `check (length(answer) > 0)` w DDL. | `src/pages/api/cards.ts:9-14` i `src/pages/api/cards/[card_id].ts:11-16` (`z.string().min(1)`). DDL: `supabase/migrations/20260707200908_initial_schema.sql:20-28` — same `not null`, brak CHECK-ów długości. |
| D-9 | NFR *"p95 of click-to-result time < 30s"* (PRD §Non-Functional). | Traktowane jako **hard timeout**, nie jako pomiar. Brak p95 collectora, brak histogramu, brak korelacji request→result. Timeout wyzwala 504, ale nie wiemy nic o dystrybucji dla żądań, które się zmieściły. | `src/pages/api/generate.ts:10,52` (`GENERATION_TIMEOUT_MS = 30_000`, `AbortSignal.timeout(...)`). Brak middleware czasomierzy poza `console.error`. |

---

## Krok 5 — Ranking refaktoru

Skala: **Wartość** = jak rdzeniowy jest niezmiennik dla propozycji wartości
produktu; **Ryzyko** = jak słabo egzekwowany dziś. Wynik = wartość × ryzyko.

| Rank | Kandydat | Niezmiennik / rozjazd | Wartość | Ryzyko | Wynik |
| ---: | --- | --- | :---: | :---: | :---: |
| **#1** | Card | D-1 + D-2: **Scheduling authority split + preview ≠ commit z fuzz** | Najwyższa (product wedge = "cards + algorithm") | Wysokie (brak weryfikacji po stronie DB, fuzz sprawia że obietnica z UI jest losowo łamana) | **1** |
| #2 | Card | D-3: **Edit vs schedule** — otwarte PRD Open Q3 rozstrzygnięte milczeniem | Wysoka (semantyka FR-010 jest niekompletna dopóki nie zapiszemy decyzji) | Wysokie (decyzja przez brak kodu; brak testu; brak śladu w dokumentach) | 2 |
| #3 | Proposal → Card | D-4: brak sygnału "acceptance rate" | Wysoka (jedna z 2 metryk sukcesu produktu jest niepoliczalna) | Wysokie (nic w schemacie, nic w API) | 3 |
| #4 | Card | D-7: `source` mutowalne poza PATCH endpointem | Średnia (metryka wtórna) | Średnie (obecne API tego nie pozwala; przyszłe może) | 4 |
| #5 | Card | D-8: brak DB CHECK dla `length(question) > 0` | Średnia | Niskie (zod łapie na jedynym write path) | 5 |
| #6 | Review session | D-5: brak modelu sesji | Średnia (analityka sesji jest poza MVP; NFR nie wymaga) | Wysokie w skali "nie da się dodać po fakcie" | 6 |
| #7 | Deck | D-6: leksykalna luka "deck" vs "cards where user_id=…" | Niska | Niskie (brak deck-level operacji w scope MVP) | 7 |
| #8 | NFR observability | D-9: brak pomiaru p95 | Niska (dziś), Wysoka jak metryka wejdzie w SLO | Wysokie strukturalnie | 8 |
| — | Account | A-1..A-4: soft-delete + retencja + email guard | Wysoka (Privacy NFR + compliance) | **Niskie** — RLS EXISTS + cron + watchdog + fail-loud + email-guard = najsilniej egzekwowany agregat w projekcie | — |

### #1 — Uzasadnienie

**Konsoliduj autorytet planowania FSRS wokół agregatu Card.** Dwa
skorelowane rozjazdy (D-1 i D-2) trafiają w to samo miejsce: **agregat Card
nie ma jednego "policzenia następnej daty", tylko trzy**:

1. Preview na kliencie (`computePreview` w `ReviewSession.tsx` → `scheduler.repeat`),
2. Commit na Workerze (`scheduler.next` w `rate.ts`),
3. RPC `commit_review` przyjmująca to bez weryfikacji.

Fuzz (`enable_fuzz: true` — `scheduler.ts:34`) sprawia, że nawet identyczny
input daje różny output; UI obiecuje użytkownikowi interwał A, a system
zapisuje interwał B. To najbardziej rdzeniowa obietnica produktu ("algorytm
wybiera datę następnej powtórki") — dziś złamana strukturalnie.

Refaktor kierunkowy (nie kod — decyzje modelowe):
- Card jako **jedyne miejsce** obliczenia następnego stanu FSRS. Preview i
  commit muszą korzystać z tej samej ścieżki, żeby *co widzisz, to
  dostajesz*. Możliwe drogi:
  - endpoint `POST /api/review/:card_id/rate` zwraca 4 warianty w jednym
    zapytaniu i klient wybiera + commituje (deterministycznie),
  - albo endpoint `GET /api/review/next` zwraca preview obliczone
    dokładnie tym samym seedem fuzz, który będzie użyty przy commicie
    (deterministyczny seed per (card_id, revision)).
- `commit_review` przestaje przyjmować gotowy payload FSRS i sama
  uruchamia scheduling (Postgres nie ma `ts-fsrs`, więc alternatywa: RPC
  akceptuje jeden konkretny wariant z 4 wcześniej wystawionych i logika w
  jednym miejscu jest po stronie Workera + immutable ID wariantu).

### #2 — Uzasadnienie (bliski drugi)

**Zamknij PRD Open Q3 explicite.** Dziś Card ma decyzję domenową (edycja
treści nie resetuje harmonogramu) ukrytą w *braku* kodu w `[card_id].ts:56-64`.
Jedno zdanie w PRD ("edycja treści zachowuje harmonogram, bo pytanie o tę
samą wiedzę pozostaje tą samą wiedzą") + jeden test integracyjny
utrwalający zachowanie zamykają otwarte pytanie i chronią przed regresją.

---

## Ograniczenia mapy

- Cytowane linie kodu były realnie odczytane w tej sesji (Read/Grep). Nie
  wnioskuję o istnieniu plików ani numerów linii, których nie widziałem.
- Mapa nie tworzy kodu produkcyjnego. Wskazuje niezmienniki i rozjazdy,
  które osoba planująca kolejny slice powinna zaadresować.
- Brakujące dane: rzeczywiste liczby użytkowników i wolumen; nie liczyłem
  logów, nie ma p95 do zacytowania. NFR D-9 jest niepoliczalny na dziś.
