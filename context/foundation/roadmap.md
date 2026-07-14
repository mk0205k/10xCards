---
project: 10xCards
version: 1
status: draft
created: 2026-07-07
updated: 2026-07-08
backlog_tracker: github-issues
backlog_url: https://github.com/mk0205k/10xCards/milestone/1
prd_version: 1
main_goal: speed
top_blocker: time
---

# Roadmap: 10xCards

> Wywiedziona z `context/foundation/prd.md` (v1) + auto-badany baseline kodu.
> Edytuj w miejscu; archiwizuj przy pełnej regeneracji.
> Poniższe pozycje są ułożone w kolejności zależności. Tabela "W skrócie" jest indeksem.

## Vision recap

Ręczne tworzenie fiszek edukacyjnych to godziny pracy, zanim użytkownik dotknie właściwej wartości metody powtórek. LLM-y są dziś na tyle dobre, że potrafią wyciągać sensowne pary pytanie–odpowiedź z surowego tekstu, co usuwa główną barierę wejścia w powtórki interwałowe. Produkt łączy generację fiszek przez AI z gotowym algorytmem powtórek (spaced repetition) — użytkownik dostarcza tekst i oceny trudności, aplikacja dostarcza fiszki i harmonogram.

Klinem produktu (wedge — jedna cecha, która odróżnia produkt od generycznego narzędzia AI; jej usunięcie sprawia, że pozostaje kolejny AI-wrapper lub kolejne Anki) jest to, że fiszki muszą być **jednocześnie ugruntowane w tekście użytkownika (AI z inputu) i przepuszczone przez decyzję człowieka (accept/reject/edit)** zanim wejdą do talii — bez tego produkt jest generatorem szumu.

## North star

**S-02: Pierwsza pełna sesja powtórki (paste → cards → review)** — user przechodzi cały flow zdefiniowany w PRD §Success Criteria (kroki 1–7); dopiero domknięcie tego łańcucha waliduje hipotezę AI + spaced repetition.

> Gwiazda przewodnia (north star) — najmniejszy end-to-end flow, którego pomyślne dostarczenie udowadnia sedno hipotezy produktu. Sekwencjonowana tak wcześnie, jak pozwalają Prerequisites, bo wszystko dalej ma sens tylko wtedy, gdy to zadziała.

## At a glance

| ID    | Change ID                     | Outcome (user can …)                                        | Prerequisites | PRD refs                                | Status   |
| ----- | ----------------------------- | ----------------------------------------------------------- | ------------- | --------------------------------------- | -------- |
| F-01  | data-schema-and-rls           | (foundation) schemat cards + review_history, RLS, typy Database, RLS wpięte w istniejący auth | —             | FR-001, FR-002, FR-004, NFR Privacy, Access Control | done     |
| S-01  | first-ai-generation-and-accept | wygenerować pierwsze fiszki AI z wklejonego tekstu i zaakceptować/edytować/odrzucić każdą propozycję | F-01          | US-01, FR-005, FR-006, FR-007          | done     |
| S-02  | first-review-session          | przejść pełną sesję powtórki: pytanie → odpowiedź → ocena trudności → nowa data powtórki | F-01, S-01    | US-02, FR-012, FR-013, FR-014, FR-015  | done     |
| S-03  | deck-management-crud          | ręcznie utworzyć fiszkę, przeglądać wszystkie fiszki, edytować i usuwać istniejące | F-01          | FR-008, FR-009, FR-010, FR-011         | blocked  |
| S-04  | password-reset-flow           | zresetować hasło poprzez wiadomość email                    | F-01          | FR-003                                  | proposed |

## Streams

Pomoc nawigacyjna — grupuje pozycje, które dzielą łańcuch Prerequisites. Kanoniczna kolejność żyje w grafie zależności poniżej; ta tabela to proponowany porządek czytania po równoległych torach.

| Stream | Motyw                                | Chain                                | Uwaga                                                                        |
| ------ | ------------------------------------ | ------------------------------------ | ---------------------------------------------------------------------------- |
| A      | Klin i gwiazda                       | `F-01` → `S-01` → `S-02`             | Ścieżka must-have (sekwencja slice'ów niezbędnych do dostarczenia MVP) prowadząca do north star; wszystko poza nią do Parked lub późniejszych iteracji. |
| B      | Zarządzanie talią i uzupełnienia konta | `S-03` / `S-04` (parallel)         | Obie pozycje dołączają do Stream A przy `F-01`; wykonalne po zamknięciu F-01, niezależnie od siebie. |

## Baseline

Co jest już wpięte w kodzie na dzień `2026-07-07` (auto-badane + potwierdzone przez usera). Foundations poniżej zakładają obecność poniższych warstw i ich nie re-scaffoldują.

- **Frontend:** obecny — Astro 6.3 + React 19 (`astro.config.mjs`), Tailwind 4, shadcn/ui w `src/components/ui/`.
- **Backend / API:** obecny — `output: "server"` w `astro.config.mjs:11`, adapter `cloudflare()` na `astro.config.mjs:17`, endpointy `src/pages/api/auth/{signin,signup,signout}.ts`.
- **Data:** częściowy — klient Supabase w `src/lib/supabase.ts` i `supabase/config.toml`, ale **brak** katalogu `supabase/migrations/`, **brak** typów `Database`, **brak** wpisanych migracji SQL.
- **Auth:** częściowy — `src/middleware.ts` z `PROTECTED_ROUTES = ["/dashboard"]` i `supabase.auth.getUser()`, strony `src/pages/auth/{signin,signup,confirm-email}.astro`, endpointy signin/signup/signout. **Brak** flow reset password (FR-003), **brak** RLS policies w migracjach.
- **Deploy / infra:** obecny — `wrangler.jsonc`, workflow `.github/workflows/ci.yml` uruchamia `wrangler deploy` na push do master, `.dev.vars.example` z `SUPABASE_URL` / `SUPABASE_KEY`.
- **Observability:** częściowy — `observability.enabled = true` w `wrangler.jsonc:12-14` (`wrangler tail` + Cloudflare Observability MCP dostępne); **brak** Sentry / structured logging w kodzie aplikacji.

## Foundations

### F-01: Schemat danych + RLS + typy Database

- **Outcome:** (foundation) tabele `cards` i `review_history` istnieją w migracji SQL, RLS jest włączone i skonfigurowane per-user-owns-own-rows, typy `Database` są wygenerowane z Supabase i importowalne z kodu; istniejące endpointy auth (signin/signup/signout) egzekwują RLS na tabelach użytkowych.
- **Change ID:** data-schema-and-rls
- **PRD refs:** FR-001, FR-002, FR-004, NFR Privacy (per-user isolation), Access Control (flat role, single-tenant per user)
- **Unlocks:** S-01 (wymaga tabeli `cards` z RLS do zapisu zaakceptowanych fiszek), S-02 (wymaga `review_history` do zapisu ocen i harmonogramu), S-03 (wymaga `cards` do CRUD), S-04 (wymaga wpięcia flow reset password w istniejący auth z RLS)
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Jeśli RLS zostanie źle skonfigurowany na starcie, wypływ danych między użytkownikami jest cichą awarią bez zewnętrznego sygnału (Privacy NFR to gate na launch). Ryzyko mitiguje: enforcement RLS na poziomie DB + test integracyjny "user A nie widzi wierszy user B" przed każdym slice'em konsumującym.
- **Status:** done

## Slices

### S-01: Pierwsza generacja AI + akceptacja fiszek

- **Outcome:** user wkleja fragment tekstu, klika "generuj propozycje", w ciągu <30s widzi listę par pytanie–odpowiedź, akceptuje / edytuje / odrzuca każdą osobno, zaakceptowane trafiają do jego talii.
- **Change ID:** first-ai-generation-and-accept
- **PRD refs:** US-01, FR-005, FR-006, FR-007, NFR Response time (p95 < 30s)
- **Prerequisites:** F-01
- **Parallel with:** S-03, S-04 (po dostarczeniu F-01 wszystkie trzy mogą pójść równolegle na osobnych agent runach; przy blockerze `time`/kapacytaż i tak sekwencyjne, ale opcja istnieje)
- **Blockers:** —
- **Unknowns:**
  - Limit kosztów API na użytkownika (PRD Open Q2). Owner: user. Block: no (można zdeployować bez twardego limitu i dodać po walidacji; brak limitu nie blokuje planowania).
- **Risk:** Sedno klina produktu — jeśli jakość generacji jest słaba (accept rate <75% z metryk wtórnych), cała hipoteza upada. Ryzyko mitiguje: streaming OpenRouter zgodny z Risk Register `infrastructure.md`, test end-to-end po każdym bumpie SDK.
- **Status:** done

### S-02: Pierwsza pełna sesja powtórki

- **Outcome:** user startuje sesję powtórki, aplikacja pokazuje pytanie, czeka na odpowiedź w głowie, odsłania odpowiedź, user ocenia trudność w skali wymaganej przez algorytm, algorytm zapisuje nową datę następnej powtórki dla tej fiszki.
- **Change ID:** first-review-session
- **PRD refs:** US-02, FR-012, FR-013, FR-014, FR-015
- **Prerequisites:** F-01, S-01 (musi istnieć zapisana fiszka w talii żeby ją powtarzać)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Wybór algorytmu SR — binary vs SM-2 vs FSRS vs inny (PRD Open Q1). Owner: user. Block: yes — kształtuje UI ratingu (FR-014), schemat `review_history`, wybór biblioteki. Bez tego S-02 nie da się zaplanować.
- **Risk:** Domyka pełny flow — dopóki S-02 nie zejdzie, hipoteza AI + spaced repetition nie jest zwalidowana end-to-end (Success Criteria kroki 6–7). Ryzyko mitiguje: rozstrzygnięcie Open Q1 z premedytacją przed `/10x-plan`, nie w trakcie.
- **Status:** done

### S-03: Zarządzanie talią (CRUD manualny)

- **Outcome:** user ręcznie tworzy fiszkę (wpisując pytanie i odpowiedź), przegląda wszystkie swoje fiszki w jednej liście, edytuje istniejącą fiszkę, usuwa fiszkę.
- **Change ID:** deck-management-crud
- **PRD refs:** FR-008, FR-009, FR-010, FR-011
- **Prerequisites:** F-01
- **Parallel with:** S-01, S-04
- **Blockers:** —
- **Unknowns:**
  - Edit vs harmonogram powtórek (PRD Open Q3) — czy edycja fiszki z istniejącą historią review resetuje harmonogram czy zachowuje. Owner: user. Block: yes — decyduje o semantyce FR-010 (edit); bez tego endpoint edit ma niedomkniętą specyfikację.
- **Risk:** Bez CRUD talia gromadzi śmieci (brak delete) i traci wartość — ale to nie ryzyko blokujące walidację hipotezy, tylko higienę produktu. Przy `main_goal=speed` można temu slice'owi dać niższy priorytet po S-02, jeśli deadline naciska.
- **Status:** blocked

### S-04: Reset hasła emailem

- **Outcome:** user, który zapomniał hasła, uruchamia flow "przypomnij hasło", dostaje email z linkiem, ustawia nowe hasło, loguje się nowym hasłem.
- **Change ID:** password-reset-flow
- **PRD refs:** FR-003
- **Prerequisites:** F-01
- **Parallel with:** S-01, S-03
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Bez reset password persona (dorosły wracający po tygodniu/miesiącu, PRD §User & Persona) traci dostęp do talii przy pierwszym zapomnianym haśle — cichy koszt retention. Ryzyko mitiguje: standardowy Supabase Auth reset flow, brak własnego kodu kryptografii; niewielki slice, ale must-have z PRD.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                      | Issue | Sugerowany tytuł issue                                                | Ready for `/10x-plan` | Uwagi                                                        |
| ---------- | ------------------------------ | ----- | --------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------ |
| F-01       | data-schema-and-rls            | [#1](https://github.com/mk0205k/10xCards/issues/1) | [F-01] Schemat danych + RLS + typy Database                           | yes                   | Run `/10x-plan data-schema-and-rls`                          |
| S-01       | first-ai-generation-and-accept | [#2](https://github.com/mk0205k/10xCards/issues/2) | [S-01] Pierwsza generacja AI + akceptacja fiszek                      | no                    | Po zakończeniu F-01                                          |
| S-02       | first-review-session           | [#3](https://github.com/mk0205k/10xCards/issues/3) | [S-02] Pierwsza pełna sesja powtórki (north star)                     | no                    | Blocked na wyborze algorytmu SR (Open Q1)                    |
| S-03       | deck-management-crud           | [#4](https://github.com/mk0205k/10xCards/issues/4) | [S-03] Zarządzanie talią (CRUD manualny)                              | no                    | Blocked na decyzji edit-vs-schedule (Open Q3)                |
| S-04       | password-reset-flow            | [#5](https://github.com/mk0205k/10xCards/issues/5) | [S-04] Reset hasła emailem                                            | no                    | Po zakończeniu F-01                                          |

## Open Roadmap Questions

1. **Wybór algorytmu spaced-repetition** (binary vs SM-2 vs FSRS vs inny). Kształtuje FR-014 rating UI, schemat `review_history`, wybór biblioteki. — Owner: user. Block: S-02 (north star).
2. **Limit kosztów API na użytkownika** (dzienny cap znaków na endpoint generacji). Bez tego cost runaway ze strony jednego użytkownika. — Owner: user. Block: —. Nie blokuje żadnego slice'u, ale musi być rozstrzygnięte przed launchem.
3. **Edit vs harmonogram powtórek** — czy edycja fiszki z historią review resetuje harmonogram czy zachowuje. — Owner: user. Block: S-03.
4. **Target QPS** — nie sprecyzowany w `target_scale.qps`. Potrzebne do sizingu throughput generacji i concurrency sesji review. — Owner: user. Block: —. Nie blokuje planowania, ale wpływa na `/10x-plan` sizing.
5. **Data volume** — nie sprecyzowany w `target_scale.data_volume`. Potrzebne do budżetowania storage i AI-cost. — Owner: user. Block: —.

## Parked

- **Custom algorytm spaced-repetition** — Why parked: PRD §Non-Goals — używamy gotowej biblioteki; własny algorytm nie mieści się w 3-tygodniowym budżecie.
- **Import PDF / DOCX / innych formatów** — Why parked: PRD §Non-Goals — input tylko plain text z clipboardu.
- **Współdzielenie talii między użytkownikami** — Why parked: PRD §Non-Goals — model single-tenant per user.
- **Natywne aplikacje mobilne** — Why parked: PRD §Non-Goals — tylko web (responsywnie mobile-friendly, bez app-store).
- **Integracje z platformami edukacyjnymi (Anki, LMS, Google Classroom)** — Why parked: PRD §Non-Goals — produkt self-contained.
- **Notyfikacje push / email o zaplanowanych powtórkach** — Why parked: PRD §Non-Goals — user pamięta sam; fiszki czekają na jego inicjatywę.
- **Statystyki uczenia się / dashboard postępów** — Why parked: PRD §Non-Goals — MVP to fiszki + algorytm, nic więcej.
- **Multimedia w fiszkach (obrazy, audio, wzory, code blocks)** — Why parked: PRD §Non-Goals — tylko text.

## Done

- **F-01: (foundation) tabele `cards` i `review_history` istnieją w migracji SQL, RLS jest włączone i skonfigurowane per-user-owns-own-rows, typy `Database` są wygenerowane z Supabase i importowalne z kodu; istniejące endpointy auth (signin/signup/signout) egzekwują RLS na tabelach użytkowych.** — Archived 2026-07-07 → `context/archive/2026-07-07-data-schema-and-rls/`. Lesson: —.
- **S-01: user wkleja fragment tekstu, klika "generuj propozycje", w ciągu <30s widzi listę par pytanie–odpowiedź, akceptuje / edytuje / odrzuca każdą osobno, zaakceptowane trafiają do jego talii.** — Archived 2026-07-08 → `context/archive/2026-07-07-first-ai-generation-and-accept/`. Lesson: —.
- **S-02: user startuje sesję powtórki, aplikacja pokazuje pytanie, czeka na odpowiedź w głowie, odsłania odpowiedź, user ocenia trudność w skali wymaganej przez algorytm (FSRS via ts-fsrs, 4-button Again/Hard/Good/Easy), algorytm zapisuje nową datę następnej powtórki dla tej fiszki.** — Done 2026-07-14 (pending archive → `context/archive/YYYY-MM-DD-first-review-session/`, run `/10x-archive first-review-session`). Lesson: —.
