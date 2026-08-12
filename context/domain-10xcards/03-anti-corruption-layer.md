---
title: Anti-Corruption Layer — Vercel AI SDK Containment
created: 2026-08-09
type: refactor-plan
---

# Anti-Corruption Layer — pakiet `ai` (Vercel AI SDK)

> Ten dokument to **plan refaktoru**, nie implementacja. Odkrywa i klasyfikuje
> przeciekającą zależność zewnętrzną, projektuje ACL i wypisuje fazy dojścia
> do stanu, w którym `grep -r "from \"ai\"" src/` zwraca wyłącznie pliki w
> katalogu adaptera.

## Krok 0 — Odkrycie kontekstu

Źródła dokumentowe (zweryfikowane odczytem):

- `context/foundation/prd.md` — dwie decyzje domenowe: ekstrakcja fiszek + harmonogram powtórek (§Business Logic).
- `context/foundation/tech-stack.md:16-18` — `has_ai: true`, brak realtime, Cloudflare Workers.
- `context/domain/01-domain-distillation.md:44-57` — słownik ubikwitalny; `Proposal` żyje tylko w reducerze przeglądarki.
- `context/domain/02-invariant-aggregate-refactor.md` — rdzeń domeny to `Card` + `ReviewLog`, agregat FSRS.

Kandydaci na przeciekającą zależność (`package.json:23-49`):

| Pakiet | Rola | Zasięg wg grep |
| --- | --- | --- |
| `@supabase/ssr`, `@supabase/supabase-js` | DB/Auth SDK | 2 pliki: `src/lib/supabase.ts:1`, `src/lib/services/deck-stats.ts:1` |
| `ts-fsrs` | algorytm powtórek | 2 pliki: `src/lib/review/scheduler.ts:10`, `src/lib/review/scheduler.test.ts:2` |
| `@openrouter/ai-sdk-provider` | dostawca modeli LLM | 1 plik: `src/lib/ai/generate-proposals.ts:2` |
| **`ai` (Vercel AI SDK)** | **streaming LLM + parsing** | **6 miejsc w 3 warstwach — patrz Krok 3** |

Ustalenia z odczytu kodu (plik:linia):

- `src/pages/api/generate.ts:1-104` — endpoint API, `output: server`, `prerender = false`.
- `src/lib/ai/generate-proposals.ts:1-52` — funkcja `generateProposals`; zwraca **wynik `streamText` SDK-a bez opakowania w typ domenowy**.
- `src/lib/ai/generate-proposals-mock.ts:1-47` — mock zmuszony rzutować `as unknown as StreamTextReturn`, bo cały ekosystem ufa kształtowi z `"ai"`.
- `src/components/hooks/useProposalStream.ts:1-121` — hook Reactowy, w warstwie UI, importujący `parsePartialJson` z `"ai"` i dekodujący prywatny format streamu SDK-a.
- `src/components/generate/proposalsReducer.ts:5-8` — `ProposalDraft = { question, answer }`; typ domenowy istnieje po stronie klienta, ale nie w kontrakcie sieciowym.
- `src/test/fixtures/generate-stream.ts:1-115` — fikstury dokumentujące (w komentarzu, linie 5–6) że wire-format to *"growing JSON produced by Vercel AI SDK's `toTextStream`"* — kontrakt zaczyna być spisany po stronie testów, bo brak go w kodzie produkcyjnym.

## Krok 1 — Enumeracja miejsc dotknięcia

Grep `from "ai"` po `src/` (wyniki dosłowne, cite plik:linia):

| # | Plik | Linia | Warstwa | Import z `"ai"` | Legalne? |
| --- | --- | ---: | --- | --- | :---: |
| 1 | `src/lib/ai/generate-proposals.ts` | 1 | Serwis/adapter | `streamText`, `Output` | tak (to jest adapter) |
| 2 | `src/lib/ai/generate-proposals-mock.ts` | 1, 18 | Serwis (test double) | `type streamText`, `ReturnType<typeof streamText>` | wymuszone (patrz D-3) |
| 3 | `src/lib/ai/generate-proposals.test.ts` | 2 | Test serwisu | `toTextStream` | częściowo (patrz D-4) |
| 4 | `src/pages/api/generate.ts` | 3, 67, 89 | **API (HTTP)** | `createTextStreamResponse`, `toTextStream` | **NIE** |
| 5 | `src/components/hooks/useProposalStream.ts` | 2, 85, 93 | **UI / Presentation** | `parsePartialJson` | **NIE** |
| 6 | `src/test/fixtures/generate-stream.ts` | 5–6 (komentarz) | Test | opisuje format SDK-a jako kontrakt | dług dokumentacyjny |

Do tego dochodzi typ zwracany z `generateProposals()` (`src/lib/ai/generate-proposals.ts:44`) — to `ReturnType<typeof streamText>`, więc **każdy wywołujący dziedziczy typ z pakietu `ai`**, nawet jeśli go nie importuje po nazwie. Konsument nr 4 (`api/generate.ts:48-67`) natychmiast pobiera `result.stream` (pole z SDK) i przekazuje do `toTextStream` (funkcji z SDK).

## Krok 2 — Identyfikacja przecieku

**Wybór:** zależność `ai` (Vercel AI SDK) jest jedyną, która przecieka przez **więcej niż jedną warstwę architektoniczną**. Wszystkie pozostałe SDK są zamknięte w 1–2 plikach lub w jednym module usługowym.

Definicja *"przecieku"* użyta w tym dokumencie:

1. **Bezpośredni**: plik warstwy X importuje symbol z pakietu Y, gdzie polityka projektu zabrania warstwie X znać Y.
2. **Pośredni typowy**: publiczny symbol modułu wewnętrznego zwraca / przyjmuje typ z Y, przez co konsument otrzymuje Y w swojej sygnaturze bez `import`-u.
3. **Kontraktowy**: format bajtowy / kształt danych na granicy sieciowej jest zdefiniowany prywatnym kontraktem Y (a nie neutralnym formatem takim jak JSON/NDJSON/SSE).

Pakiet `ai` przecieka **wszystkimi trzema drogami jednocześnie**: (1) do `api/generate.ts` i `components/hooks/useProposalStream.ts`, (2) przez `ReturnType<typeof streamText>` z `generate-proposals.ts:44`, (3) przez odmiana `toTextStream` na drucie, którą klient dekoduje `parsePartialJson`-em.

**Wybór jest wyprowadzony, nie założony.** Kandydaci alternatywni (`ts-fsrs`, `@supabase/*`, `@openrouter/ai-sdk-provider`) zostali odrzuceni dlatego, że każdy z nich mieści się w 1–2 plikach jednego modułu, a ich typy nie wypływają na granice HTTP i UI.

## Krok 3 — Klasyfikacja miejsc przecieku (diagnoza)

**D-1. Kontrakt HTTP jest kontraktem SDK-a.**
`src/pages/api/generate.ts:67, 89` woła `toTextStream` i `createTextStreamResponse` z `"ai"`. Ciało odpowiedzi jest *"growing JSON"* — prywatnym formatem streamu Vercel AI SDK. Aktualizacja pakietu `ai` może zmienić kolejność wywołań `text-delta`/`finish` albo enkoding, i **cała warstwa UI zepsuje się bez testu integracyjnego**, który by to złapał (bo test jednostkowy hooka używa fikstur, które ręcznie odtwarzają to samo założenie — `src/test/fixtures/generate-stream.ts:5-6`).

**D-2. Warstwa prezentacji zna prywatny protokół dostawcy.**
`src/components/hooks/useProposalStream.ts:2, 85, 93` woła `parsePartialJson` z `"ai"`. Hook Reactowy — najdalej w łańcuchu warstw — dziedziczy prywatną semantykę parsera SDK-a (co się dzieje, gdy JSON jest niepełny; co, gdy trailing garbage; jak liczyć postęp). Konsekwencja: żeby zmienić dostawcę LLM (np. przejść z OpenRouter na własny endpoint OpenAI) trzeba **dotknąć plik w `src/components/`**, mimo że to decyzja dostawcy usługi, nie interfejsu użytkownika.

**D-3. Publiczna sygnatura serwisu wypuszcza typ SDK-a.**
`src/lib/ai/generate-proposals.ts:44` zwraca `streamText(...)` — czyli `ReturnType<typeof streamText>`. Nazwa symbolu i lokalizacja pliku sugerują, że to *"serwis domenowy do generowania propozycji"*, ale kontraktowo to pass-through SDK-a. Dowód strukturalny: mock w `generate-proposals-mock.ts:46` musi zrobić `return { stream } as unknown as StreamTextReturn` — rzut `unknown` jest tu **symptomem, nie idiomem**: mock nie mieści się w typie domenowym, bo takiego typu nie ma.

**D-4. Test jednostkowy serwisu waliduje własny wynik za pomocą SDK-a.**
`src/lib/ai/generate-proposals.test.ts:2, 63` importuje `toTextStream` z `"ai"`, żeby zdekodować to, co zwrócił nasz kod. To dodatkowy dowód, że kontrakt wyjściowy serwisu nie ma reprezentacji domenowej — sprawdzenie *"czy zwróciliśmy dobrą listę propozycji"* wymaga uruchomienia biblioteki dostawcy.

**D-5. Format sieciowy jest dokumentowany w testach, nie w kodzie.**
`src/test/fixtures/generate-stream.ts:5-6` (komentarz JSDoc) jest **jedynym miejscem w repo, które explicite opisuje kontrakt drutu** między `/api/generate` a hookiem UI. To znak, że po środku dwóch warstw brakuje neutralnego modułu, którego typ i format są tym kontraktem.

**D-6. Podwójny słownik "Proposal".**
`src/lib/ai/generate-proposals.ts:16` eksportuje `type Proposal = z.infer<typeof proposalSchema>`, a `src/components/generate/proposalsReducer.ts:5-8` deklaruje `ProposalDraft` niezależnie. Oba typy są dziś kształtem identyczne (`{ question: string; answer: string }`), ale każdy żyje we własnym pliku. To nie jest przeciek — to **duplikacja spowodowana brakiem ACL**. Po refaktorze jeden typ (z modułu ACL) powinien być importowany przez oba końce.

## Krok 4 — Klasyfikacja: dopuszczalne vs niedopuszczalne po refaktorze

| Miejsce | Stan dziś | Stan docelowy | Uzasadnienie |
| --- | --- | --- | --- |
| `src/lib/ai/generate-proposals.ts` | importuje z `"ai"` i `"@openrouter/ai-sdk-provider"` | pozostaje w ACL (zmiana lokalizacji na `src/lib/ai/adapter/`), API prywatne modułu | To jest adapter — jedyne legalne miejsce styku z SDK. |
| `src/lib/ai/generate-proposals-mock.ts` | rzutuje `as unknown as StreamTextReturn` | zwraca `ProposalStream` (typ domenowy z ACL) — bez `as unknown` | Mock musi mieścić się w typie kontraktu, nie w kształcie SDK-a. |
| `src/lib/ai/generate-proposals.test.ts` | importuje `toTextStream` z `"ai"` | testuje przez neutralny kontrakt ACL (patrz Faza F4) | Test serwisu nie może zależeć od SDK-a, jeśli serwis ma go ukryć. |
| `src/pages/api/generate.ts` | importuje `createTextStreamResponse`, `toTextStream` z `"ai"` | importuje tylko `respondWithProposals(stream)` z ACL | Endpoint tłumaczy kontrakt domenowy → HTTP; **nie odwrotnie**. |
| `src/components/hooks/useProposalStream.ts` | importuje `parsePartialJson` z `"ai"` | importuje `decodeProposalsStream(reader)` z ACL — modułu współdzielonego | UI nie może znać prywatnego formatu SDK-a; ACL definiuje neutralny format drutu. |
| `src/test/fixtures/generate-stream.ts` | dokumentuje "toTextStream shape" w komentarzu | używa typów ACL do konstrukcji fikstur; komentarz odwołuje się do ACL, nie do SDK | Kontrakt musi mieszkać w kodzie, nie w JSDoc-u. |

## Krok 5 — Projekt ACL

**Nazwa modułu (Ubiquitous Language):** *Proposal Generation Anti-Corruption Layer*.
**Lokalizacja:** `src/lib/ai/adapter/` (nowy katalog; scalona granica).
**Pojemność ACL:** wszystko, co dziś zna `"ai"` i `"@openrouter/ai-sdk-provider"`.

### 5.1 Zakres modułu (surfaces)

Publiczny interfejs modułu ACL (nazwy do wprowadzenia — nie kod):

- **Typy domenowe** (jedyne prawdziwe źródło):
  - `Proposal` — obiekt `{ question, answer }` po stronie serwera/UI (przenosi się z `generate-proposals.ts:16`, staje się jedynym eksportem).
  - `ProposalStreamEvent` — tagowana unia zdarzeń kontraktu drutu: `{ type: 'proposal'; proposal: Proposal }`, `{ type: 'done' }`, `{ type: 'error'; code: ErrorCode }`.
  - `ProposalStream` — kształt zwracany przez port serwerowy: `{ events: ReadableStream<ProposalStreamEvent> }` (lub `AsyncIterable<ProposalStreamEvent>` — wybór w Fazie F2 po eksperymencie z workerd; **nie należy do decyzji tego dokumentu**).

- **Port serwerowy (in-process):**
  - `startProposalGeneration({ text, apiKey, model, abortSignal, onError }): ProposalStream` — zastępuje `generateProposals` z tym samym wejściem, ale **wyjście jest domenowe**.
  - `respondWithProposals(stream: ProposalStream): Response` — buduje HTTP response w wybranym neutralnym formacie drutu (kandydaci: NDJSON „event per line" albo Server-Sent Events; wybór w Fazie F1 na podstawie limitów Cloudflare Workers).

- **Port kliencki (browser):**
  - `decodeProposalsStream(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncIterable<ProposalStreamEvent>` — hook Reactowy konsumuje tylko to.

- **Mock:**
  - `makeMockProposalStream(proposals: Proposal[]): ProposalStream` — zastępuje `makeMockGenerateResult`; **żadnych `as unknown`**.

### 5.2 Zasady graniczne (kontrakt ACL)

1. `import` z `"ai"` i `"@openrouter/ai-sdk-provider"` dopuszczalny **wyłącznie** w plikach pod `src/lib/ai/adapter/**`. Reguła egzekwowalna lint-em (`no-restricted-imports` z per-path override) — konfiguracja w Fazie F5.
2. Endpoint `POST /api/generate` woła wyłącznie `startProposalGeneration` + `respondWithProposals`; nie wie, co jest w środku.
3. `useProposalStream.ts` woła wyłącznie `decodeProposalsStream`; nie wie, co jest w środku.
4. Format drutu (NDJSON / SSE / inny) jest szczegółem implementacyjnym ACL; **żaden inny plik w projekcie nie może go opisywać ani odtwarzać** (dziś odtwarza go `src/test/fixtures/generate-stream.ts:5-6, 27-41` — po refaktorze fikstury generujemy z ACL).
5. Wybór dostawcy (OpenRouter vs OpenAI vs Anthropic bezpośrednio) mieszka za portem serwerowym. Podmiana dostawcy → jeden plik `provider.ts` wewnątrz ACL. **Nie dotyka `src/pages/**` ani `src/components/**`.**
6. Błędy dostawcy tłumaczone są **w ACL** na `{ type: 'error'; code: ErrorCode }`, gdzie `ErrorCode` mapuje na `src/lib/error-messages.ts` (kontrakt istnieje — `ERROR_CODES.GENERATION_TIMEOUT`, `GENERATION_FAILED`). ACL nie propaguje surowych `Error` obiektów z SDK-a.

### 5.3 Struktura katalogu (docelowa)

```
src/lib/ai/adapter/
  index.ts                 -- re-eksporty publicznego API (typy + porty)
  types.ts                 -- Proposal, ProposalStreamEvent, ProposalStream, ErrorCode
  provider.ts              -- createOpenRouter, streamText — jedyny plik dotykający SDK
  server.ts                -- startProposalGeneration, respondWithProposals
  client.ts                -- decodeProposalsStream (bezpieczny dla przeglądarki)
  mock.ts                  -- makeMockProposalStream
  wire-format.ts           -- serializer/deserializer neutralnego formatu (prywatny)
  __tests__/*              -- testy jednostkowe adapter-a (jedyne, które mogą importować "ai")
```

## Krok 6 — Weryfikacja i plan faz

### 6.1 Kryterium sukcesu (mechaniczne)

Po zakończeniu wszystkich faz:

```bash
grep -rn 'from "ai"' src/ | grep -v 'src/lib/ai/adapter/'
grep -rn 'from "@openrouter/ai-sdk-provider"' src/ | grep -v 'src/lib/ai/adapter/'
```

Oba polecenia zwracają **pustą listę**. Dziś zwracają następujące pliki (poza `src/lib/ai/adapter/`):

- `src/lib/ai/generate-proposals.ts:1` — `import { streamText, Output } from "ai"` (do usunięcia po przeniesieniu logiki do `adapter/provider.ts` + `adapter/server.ts`)
- `src/lib/ai/generate-proposals.ts:2` — `import { createOpenRouter } from "@openrouter/ai-sdk-provider"` (przenosi się do `adapter/provider.ts`)
- `src/lib/ai/generate-proposals-mock.ts:1` — `import type { streamText } from "ai"` (przenosi się do `adapter/mock.ts`; typ znika, bo mock wraca `ProposalStream`)
- `src/lib/ai/generate-proposals.test.ts:2` — `import { toTextStream } from "ai"` (usunięte; test asertuje na `ProposalStreamEvent[]`)
- `src/pages/api/generate.ts:3` — `import { createTextStreamResponse, toTextStream } from "ai"` (usunięte; importuje `respondWithProposals` z ACL)
- `src/components/hooks/useProposalStream.ts:2` — `import { parsePartialJson } from "ai"` (usunięte; importuje `decodeProposalsStream` z ACL)

Po refaktorze `grep -rn 'from "ai"' src/lib/ai/adapter/` zwraca dwa pliki: `provider.ts` i (opcjonalnie) `__tests__/provider.test.ts`.

### 6.2 Fazy refaktoru (kolejność ma znaczenie)

**F1 — Wybór formatu drutu i szkielet ACL (bez zmiany zachowania).**
Decyzja NDJSON vs SSE. Kryteria: budżet CPU workerd (Cloudflare Workers), zachowanie przy zerwaniu połączenia, wsparcie w `ReadableStream` bez SDK. Powstaje `src/lib/ai/adapter/types.ts`, `wire-format.ts`, `provider.ts`. Wynik F1: adapter działa równolegle do istniejącego kodu, nikt jeszcze z niego nie korzysta.

**F2 — Migracja serwera (`src/pages/api/generate.ts`).**
Endpoint zaczyna wołać `startProposalGeneration` + `respondWithProposals`. Format drutu zmienia się jednorazowo z „toTextStream growing JSON" na format wybrany w F1. Ten commit **zmienia kontrakt HTTP**, więc musi iść **razem z F3**.

**F3 — Migracja klienta (`src/components/hooks/useProposalStream.ts`).**
Hook zamienia `parsePartialJson` na `decodeProposalsStream` z ACL. `ProposalDraft` w `proposalsReducer.ts:5-8` jest przemianowywane na `Proposal` importowane z ACL (usunięcie duplikatu typu opisanego w D-6). F2+F3 razem w jednym PR-ze, bo zmieniają wspólny kontrakt drutu.

**F4 — Migracja testów i fixtures.**
`src/lib/ai/generate-proposals.test.ts` → `src/lib/ai/adapter/__tests__/server.test.ts`. Test asertuje na `ProposalStreamEvent[]`, nie na wyniku `toTextStream`. `src/test/fixtures/generate-stream.ts` przepisuje fikstury tak, żeby były konstruowane wyłącznie przez `wire-format.ts` (serializer ACL). Komentarze JSDoc referują ACL, nie SDK. `src/lib/ai/generate-proposals-mock.ts` → `src/lib/ai/adapter/mock.ts`; ginie rzut `as unknown as StreamTextReturn` — jego brak jest testem prawidłowości refaktoru (jeśli mock nadal wymaga `as unknown`, ACL jest źle zaprojektowany, wracamy do F1).

**F5 — Egzekucja granicy przez lint.**
Konfiguracja ESLint `no-restricted-imports` w konfiguracji projektu (`eslint.config.js`): `"ai"` i `"@openrouter/ai-sdk-provider"` są **zabronione dla wszystkich ścieżek**, override dopuszczający je pod `src/lib/ai/adapter/**`. Naruszenie zwraca błąd `error` (nie `warn`) — kompatybilne z projektowym ustawieniem `react-compiler/react-compiler: error` (`AGENTS.md § CI & Pre-commit`).

**F6 — Rejestr load-bearing nazw.**
Aktualizacja `docs/reference/contract-surfaces.md` (rejestr scaffoldowany przez `/10x-init` — `.claude/CLAUDE.md`). Nowe wpisy:

- `startProposalGeneration`, `respondWithProposals`, `decodeProposalsStream`, `makeMockProposalStream` — porty ACL.
- `Proposal`, `ProposalStreamEvent`, `ProposalStream` — typy domenowe.
- Format drutu (nazwa MIME + kształt) — kontrakt sieciowy między `/api/generate` a hookiem UI.

Wpis do `context/foundation/lessons.md` (append-only, per `.claude/CLAUDE.md`): rule *"Zewnętrzne SDK-i streamingowe importujemy wyłącznie w module `src/lib/ai/adapter/**`; endpointy i komponenty konsumują neutralny kontrakt ACL"*.

### 6.3 Rollback

Każda faza jest odwracalna niezależnie:

- F1 — usuwamy katalog `adapter/`, kod istniejący nietknięty.
- F2+F3 — jeden PR, rollback = git revert (kontrakt drutu wraca do „growing JSON").
- F4 — testy w starym kształcie leżą do momentu zielonych testów F4; nie kasujemy do końca F4.
- F5 — reguła ESLint w osobnym commicie, łatwa do wyłączenia.

### 6.4 Ryzyka i granice tego planu

- **Cloudflare Workers**: `ReadableStream` w workerd ma ograniczenia (brak `AsyncIterator.@@asyncIterator` na starych wersjach). Decyzja F1 musi to zweryfikować — plan nie rozstrzyga.
- **`parsePartialJson`** ma nietrywialny algorytm tolerancji błędów. Nasz `decodeProposalsStream` na formacie NDJSON dostaje ten problem za darmo (linia = zdarzenie); na SSE — tak samo. To argument, żeby **nie odtwarzać** semantyki "growing JSON" po naszej stronie.
- **Zmiana kontraktu HTTP** jest widoczna dla testów e2e Playwright (jeśli istnieją zapisane oczekiwania na body). Weryfikacja przed F2/F3.

---

## Podsumowanie (5–8 zdań)

Pakiet **`ai` (Vercel AI SDK) jest jedyną zależnością zewnętrzną, która przecieka przez granice trzech warstw** projektu: adapter serwisowy (`src/lib/ai/generate-proposals.ts`), warstwę HTTP (`src/pages/api/generate.ts`) i warstwę prezentacji (`src/components/hooks/useProposalStream.ts`). Przeciek jest potrójny — bezpośredni (importy w 5 plikach poza modułem adaptera), typowy (`generateProposals` zwraca `ReturnType<typeof streamText>`, co widać po rzucie `as unknown as StreamTextReturn` w mocku), i kontraktowy (format drutu między `/api/generate` a hookiem UI jest prywatnym „growing JSON" z `toTextStream`). Pozostali kandydaci (`ts-fsrs`, `@supabase/*`, `@openrouter/ai-sdk-provider`) są zamknięci w 1–2 plikach i nie wypływają na granice HTTP/UI. Plan wprowadza *Proposal Generation Anti-Corruption Layer* w `src/lib/ai/adapter/`, publikujący cztery porty (`startProposalGeneration`, `respondWithProposals`, `decodeProposalsStream`, `makeMockProposalStream`) i trzy typy domenowe (`Proposal`, `ProposalStreamEvent`, `ProposalStream`), z neutralnym formatem drutu (NDJSON lub SSE — decyzja F1). Refaktor przechodzi przez sześć faz: szkielet ACL → migracja endpointu → migracja hooka (F2+F3 razem, bo zmieniają wspólny kontrakt HTTP) → testy i fikstury → egzekwowanie granicy przez `eslint no-restricted-imports` → wpis do rejestru kontraktów i `lessons.md`. Kryterium sukcesu jest mechaniczne i weryfikowalne: `grep -rn 'from "ai"' src/` po refaktorze zwraca wyłącznie pliki pod `src/lib/ai/adapter/**`. Rollback każdej fazy jest niezależny, a znikający rzut `as unknown as StreamTextReturn` z pliku mocka jest strukturalnym testem poprawności ACL — jeśli po F4 rzut jest wciąż potrzebny, adapter jest źle zaprojektowany i wracamy do F1.
