---
project: 10xCards
version: 1
status: active
created: 2026-07-07
updated: 2026-07-07
tracker: github-issues
repo: mk0205k/10xCards
milestone_url: https://github.com/mk0205k/10xCards/milestone/1
source_of_truth: context/foundation/roadmap.md
---

# Backlog na GitHub — mapowanie roadmap → issues

Ten dokument opisuje **jednorazową migrację** `context/foundation/roadmap.md` (v1) do GitHub Issues wykonaną 2026-07-07 oraz **konwencję** dla przyszłych zmian w backlogu. Kanoniczne "co budujemy" żyje nadal w `roadmap.md`; GitHub Issues to warstwa operacyjna (trigger dla `/10x-plan`, tracking pracy w toku).

## System zadaniowy

**GitHub Issues** na repo [`mk0205k/10xCards`](https://github.com/mk0205k/10xCards). Wybór podyktowany tym, że repo już tam żyje i jest jedynym trackerem wspomnianym w kodzie (`git remote -v`). Wszystkie pozycje roadmapy MVP są w milestone [`MVP`](https://github.com/mk0205k/10xCards/milestone/1).

## Co zostało utworzone

### Milestone

| # | Tytuł | Opis                                                                                                     |
| - | ----- | -------------------------------------------------------------------------------------------------------- |
| 1 | MVP   | Minimum viable product — 5 roadmap items z `roadmap.md` v1 (F-01 + S-01..S-04). North star: S-02.        |

### Labele (8)

| Nazwa              | Kolor     | Zastosowanie                                                    |
| ------------------ | --------- | --------------------------------------------------------------- |
| `kind:foundation`  | `#1D76DB` | Foundation change (odblokowuje slice'y, sam nie jest user-visible) — F-01 |
| `kind:slice`       | `#0E8A16` | Wertykalny slice (user-visible outcome) — S-01..S-04            |
| `status:ready`     | `#0E8A16` | Ready for `/10x-plan` — F-01                                    |
| `status:proposed`  | `#FBCA04` | Proposed — nie zaplanowany szczegółowo — S-01, S-04             |
| `status:blocked`   | `#B60205` | Blocked na nierozstrzygniętym pytaniu lub upstream item — S-02, S-03 |
| `stream:A`         | `#5319E7` | Stream A — critical path do north star — F-01, S-01, S-02       |
| `stream:B`         | `#BFD4F2` | Stream B — deck management + account extras — S-03, S-04        |
| `north-star`       | `#FFD700` | Gwiazda przewodnia MVP — S-02                                   |

### Issues (5)

| Issue | Roadmap ID | Change ID                      | Status           | Zależności             | Uwaga                              |
| ----- | ---------- | ------------------------------ | ---------------- | ---------------------- | ---------------------------------- |
| [#1](https://github.com/mk0205k/10xCards/issues/1) | F-01 | `data-schema-and-rls`            | `status:ready`   | —                      | Odpal `/10x-plan data-schema-and-rls` od razu. |
| [#2](https://github.com/mk0205k/10xCards/issues/2) | S-01 | `first-ai-generation-and-accept` | `status:proposed`| Depends on #1          | Po zamknięciu #1.                  |
| [#3](https://github.com/mk0205k/10xCards/issues/3) | S-02 | `first-review-session`           | `status:blocked` | Depends on #1, #2      | ⭐ North star. Blokada: Open Q1 (algorytm SR). |
| [#4](https://github.com/mk0205k/10xCards/issues/4) | S-03 | `deck-management-crud`           | `status:blocked` | Depends on #1          | Blokada: Open Q3 (edit vs harmonogram). |
| [#5](https://github.com/mk0205k/10xCards/issues/5) | S-04 | `password-reset-flow`            | `status:proposed`| Depends on #1          | Po zamknięciu #1.                  |

## Konwencja

### Tytuł issue

`[<Roadmap ID>] <sugerowany tytuł z §Backlog Handoff>` — kolumna `Sugerowany tytuł issue` w `roadmap.md` jest wiążąca. Przykład: `[S-02] Pierwsza pełna sesja powtórki (north star)`.

Prefix `[<ID>]` daje stabilny anchor, pod który można linkować z PR-ów, commitów i `/10x-plan`-ów bez zależności od numeru issue.

### Body issue

Struktura mirror `roadmap.md` — angielskie nagłówki, polska narracja:

```markdown
> Źródło: `context/foundation/roadmap.md` · Change ID: `<change-id>` · Status: `<status>`

## Outcome
<verbatim z roadmapy>

## PRD refs
<verbatim>

## Prerequisites
<verbatim>  ← plus "Depends on #N" gdy prereq istnieje

## Parallel with
<verbatim>

## Unlocks     ← tylko dla foundations
<lista slice'ów które odblokowuje>

## Blockers / Unknowns
<verbatim, z flagami Owner/Block>

## Risk
<verbatim>

---
_Handoff:_ uruchom `/10x-plan <change-id>` gdy Prerequisites zielone i Unknowns/Blockers rozstrzygnięte.
```

### Zależności

Kodowane w body jako `Depends on #N` (GitHub auto-linkuje krzyżowo i pokazuje w "Referenced from" na docelowym issue). Nie używamy sub-issues ani task-list; graf zależności jest wąski (jeden foundation, cztery slice'y) i tekstowa forma jest wystarczająca.

### Assignees

Puste — repo jest single-user, przypisanie robi user w UI przed rozpoczęciem pracy.

## Cykl życia issue

Stan `status:*` w `roadmap.md` i etykieta `status:*` na issue muszą być zgodne. Kiedy zmienia się status roadmapy, **oba miejsca aktualizujemy w jednym commit'cie / PR** (raz w roadmap.md, raz przez `gh issue edit`).

Transitions:

- `status:proposed` → `status:ready` — gdy wszystkie Prerequisites zamknięte i Unknowns rozstrzygnięte.
- `status:blocked` → `status:proposed` — gdy blokujący Open Question został rozstrzygnięty w `roadmap.md` §Open Roadmap Questions.
- `status:ready` → issue closed — gdy powiązana zmiana `context/changes/<change-id>/` została zarchiwizowana przez `/10x-archive`. Zamknięcie issue dopisujemy w linku PR mergującym zmianę.

## Jak dodać nową pozycję

1. Zaktualizuj `roadmap.md` — nowy wiersz w §At a glance, pełny opis w §Foundations lub §Slices, wiersz w §Backlog Handoff.
2. Utwórz issue: `gh issue create --title "[<ID>] <tytuł>" --body-file <plik> --label "kind:<...>" --label "status:<...>" --label "stream:<...>" --milestone "MVP"`.
3. Wpisz numer issue z powrotem do §Backlog Handoff w kolumnie `Issue` (`[#N](URL)`).
4. Commit + push (`context/foundation/roadmap.md` w tym samym commit'cie co utworzenie issue).

## Jak odtworzyć / zregenerować

Cała migracja jest **idempotentna po labelach i milestone** (`--force` dla labeli, milestone tworzony raz — kolejne wywołanie zwróci 422). Issues **nie są idempotentne** — powtórne uruchomienie utworzy duplikaty. Jeśli musisz odtworzyć od zera:

1. `gh issue list --repo mk0205k/10xCards --milestone MVP --json number --jq '.[].number' | xargs -I {} gh issue delete {} --yes`
2. Ponownie odpal utworzenie 5 issues zgodnie z body-template powyżej i kolejnością `F-01 → S-01 → S-02 → S-03 → S-04`.
3. Zaktualizuj `#N` w `roadmap.md` §Backlog Handoff (numery pójdą wyżej niż `#1..#5` bo GitHub nie recyklinguje).

## Referencje

- `context/foundation/roadmap.md` — źródło prawdy. Pole `backlog_tracker: github-issues` we frontmatterze wskazuje na to repozytorium.
- `context/foundation/prd.md` — pochodzenie PRD refs cytowanych w issues.
- Milestone MVP: <https://github.com/mk0205k/10xCards/milestone/1>
- Wszystkie issues: `gh issue list --repo mk0205k/10xCards --milestone MVP` lub filtr `is:open milestone:MVP` w UI.

## Commit historii tej migracji

- `4d543b2 docs(roadmap): back-annotate with GitHub issue references` — dodanie kolumny `Issue` i frontmatter `backlog_tracker` / `backlog_url` do `roadmap.md`. Sama utworzenie labeli / milestone / issues nie ma śladu w git — to stan po stronie GitHub, weryfikowalny przez `gh`.
