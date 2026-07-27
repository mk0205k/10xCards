<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Panel użytkownika na /dashboard z metrykami talii

- **Plan**: `context/changes/dashboard-user-panel-metrics/plan.md`
- **Scope**: Full plan (Phase 1-3, all `[x]`, 24/24 rows checked)
- **Date**: 2026-07-27
- **Verdict**: APPROVED
- **Findings**: 0 critical / 1 warning / 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated gates re-verified fresh: lint 0 errors + 25 warnings (24 baseline + 1 same-class `no-console` na dashboard.astro:20), prebuild i18n-parity OK 199 keys, build 15.05s, astro check 2 baseline errors w rate.ts. Plan drift agent: 3 informational drifts (all documented adaptations), zero MISSING, zero unplanned EXTRA. Safety/pattern agent: XSS clean, RLS reasoning sound, `.astro` await-safety per lessons.md OK, S-05 middleware redirect verified.

## Findings

### F1 — Silent zero-state when Supabase is unconfigured

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: `src/pages/dashboard.astro:15-22`
- **Detail**: Kiedy `createClient(...)` zwraca `null` (Supabase nie skonfigurowany), kod wchodzi w path `stats = { total: 0, ai: 0, manual: 0, dueToday: 0 }`, `loadError` pozostaje `false`, żaden banner błędu nie renderuje się. Misconfigured environment prezentuje się jako valid empty deck. User widzi 0/0/0 + akcentowane CTA do `/generate` (empty-state path), ale w rzeczywistości nie może wygenerować fiszek bo Supabase nie działa. Middleware chroni tylko trasy z sesją; jeśli config brakuje, dashboard renderuje mylące zero state.
- **Fix**: Ustaw `loadError = true` w `else` branch po `if (supabase)` (linia 15). Dodatkowa opcja: renderuj istniejący `config_supabase_missing` banner z `m.config_supabase_missing()` (już zlokalizowany w obu plikach, używany przez `Banner` z Layout gdy `missingConfigs` niepusty — mechanizm może się redundantnie odpalić, sprawdź).
- **Decision**: FIXED — dodano `} else { loadError = true; }` po `if (supabase) { ... }` w dashboard.astro:22-24. Banner błędu (`col-span-full` red) renderuje się gdy Supabase brak configu; Layout Banner z `missingConfigs` też się pokazuje na górze redundantnie, ale to dobrze — dwa niezależne sygnały.

### F2 — Brak defensywnego `.eq('user_id', userId)` filtra (defense-in-depth)

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency / Safety (defense-in-depth)
- **Location**: `src/lib/services/deck-stats.ts:14-18`
- **Detail**: `getDeckStats` polega wyłącznie na RLS filtering przez `auth.uid()`. Sibling patterns w `src/pages/api/review/next.ts:31` i `src/pages/api/cards.ts` dodają `.eq('user_id', user.id)` obok RLS — belt-and-suspenders. Ryzyko RLS-drift: jeśli policy zostanie źle zmodyfikowana lub `EXISTS (profiles.deleted_at IS NULL)` clause z S-05 zostanie zremovowany, count queries zwrócą globalne aggregate — nie wycieku contentu, ale wyciek metadanych (ile jest wszystkich fiszek w systemie). Roadmap S-09 Risk explicite flagował "RLS spójność na 3 tabelach" jako główne ryzyko slice'a.
- **Fix A ⭐ Recommended**: Rozszerz sygnaturę o `userId`
  - Approach: Zmień `getDeckStats(supabase)` na `getDeckStats(supabase, userId)` i dodaj `.eq('user_id', userId)` do wszystkich 3 queries. Wywołanie w dashboard.astro dostaje `Astro.locals.user.id` (dostępne bo middleware zapewnia auth).
  - Strength: Matches sibling pattern (next.ts, cards.ts); defense-in-depth; jasne z sygnatury że query jest user-scoped. Naprawia S-09 Risk item.
  - Tradeoff: Marginalny — jeden dodatkowy parametr + `Astro.locals.user.id` typing (już `User | null` per env.d.ts, więc `user!.id` po middleware guard).
  - Confidence: HIGH — pattern już ustalony w 2 innych plikach; zero funkcjonalnego ryzyka.
  - Blind spot: None significant.
- **Fix B**: Zostaw jak jest (trust RLS)
  - Approach: Nie ruszać. RLS na `cards` ma `auth.uid() = user_id AND EXISTS (profile deleted_at IS NULL)` — theoretically sufficient.
  - Strength: Minimal code; RLS jest source of truth.
  - Tradeoff: Divergencja od repo pattern; jeśli w przyszłości ktoś zmodyfikuje RLS policies i wprowadzi bug, nie ma drugiej warstwy obrony. Roadmap Risk item pozostaje aktywny.
  - Confidence: MED — RLS jest solidne dziś, ale pattern-drift boli przy code review nowych osób.
  - Blind spot: None.
- **Decision**: FIXED via Fix A — `getDeckStats(supabase, userId)` signature; wszystkie 3 queries dostały `.eq('user_id', userId)`; dashboard.astro guard rozszerzony na `if (supabase && user)` żeby zapewnić typowy string userId dla getDeckStats. Lint + tscheck green.

## Informational drifts (no fix needed, documented adaptations)

Poniższe zostały zidentyfikowane przez plan drift agent jako minor deviations, ale wszystkie są uzasadnione i nie wymagają akcji:

1. **`DeckStats` interface exported** (nie purely local jak plan mówił) — konieczne bo `dashboard.astro:7` importuje `type DeckStats` dla typowania `let stats: DeckStats`. Bez exportu type by nie był dostępny. Adaptacja spójna z intent'em ("declared locally in same file").
2. **Ring/shadow opacity `/60` `/25` vs planned `/50` `/20`** — cosmetic. Silniejszy accent, ale wciąż w duchu "wyraźnie akcentowany CTA". Nie wpływa na plan intent.
3. **`loadError` banner używa `m.error_unknown()` zamiast dedicated key** — prudent reuse istniejącego generic error message. Uniknięto dodania kolejnego niepotrzebnego i18n klucza.
