---
project: "10xCards"
version: 1
status: draft
created: 2026-06-10
context_type: greenfield
product_type: web-app
target_scale:
  users: medium
  qps: "# TODO: qps — see Open Questions"
  data_volume: "# TODO: data_volume — see Open Questions"
timeline_budget:
  mvp_weeks: 3
  hard_deadline: 2026-07-01
  after_hours_only: true
---

# PRD — 10xCards

## Vision & Problem Statement

Manually creating high-quality educational flashcards is time-consuming — hours of work before reaching the real value of the method. This is workflow friction: a way exists, but it is laborious enough that most people give up before reaping the benefits of spaced repetition.

Existing tools in this category have a solid repetition algorithm but lack content-creation automation — the user has to write every card by hand. LLMs are now good enough to extract meaningful question–answer pairs from raw text, which was not possible before. Combining AI-driven card generation with a ready-made spaced-repetition algorithm removes the main barrier to entry for a method that is itself a proven learning technology.

## User & Persona

**Primary persona:** A professional preparing for a vocational certification — for example, a doctor before a specialist exam, a programmer pursuing a cloud certification, a lawyer studying for the bar.

Profile:
- Large amounts of specialised material (handouts, notes, textbooks) to master
- A concrete deadline (the exam date) — internal motivation reinforced by an external date
- An adult with limited time (job, family) — hours spent hand-writing cards are a real blocker
- Knows and values spaced repetition, but is discouraged by the friction of producing cards

## Success Criteria

### Primary

The MVP end-to-end flow works from start to finish:

1. The user registers an account (email + password) and logs in.
2. They paste a fragment of text (e.g. from a handout or textbook).
3. The application generates a list of proposed flashcards (question–answer pairs).
4. The user accepts, rejects, or edits each proposal.
5. Accepted cards land in their deck.
6. The user starts a review session driven by the spaced-repetition algorithm.
7. The algorithm schedules the next review of each card based on the user's rating.

Success = this flow can be completed in a single session with no errors or dead-ends.

### Secondary

- 75% of AI-generated flashcards are accepted by the user (measures generation quality)
- 75% of all flashcards in a user's deck are created using AI (measures the real shift from manual to AI workflow)
- The user returns to the application at least 3 times in the first week after registration (measures whether spaced repetition actually drives repeat sessions)

### Guardrails

- Generating flashcard proposals from pasted text returns results in under 30 seconds. Exceeding this threshold = the user abandons the process.

## User Stories

### US-01: Generating the first deck from pasted text

- **Given** a logged-in user with an empty deck,
- **When** they paste a fragment of text (e.g. two pages of a handout) and click "generate proposals",
- **Then** in under 30 seconds they see a list of generated flashcard proposals (question + answer),
- **And** they can accept, reject, or edit each one individually,
- **And** the accepted proposals appear in their deck ready to be reviewed.

### US-02: First review session

- **Given** a user with a deck containing at least one flashcard due for review,
- **When** they start a review session,
- **Then** the application shows the question, waits for the user's mental answer, then reveals the answer,
- **And** the user rates the difficulty on the scale required by the algorithm,
- **And** the algorithm schedules the next review date for that card based on the rating.

## Functional Requirements

### Account & access

- FR-001: The user can register an account using email and password. Priority: must-have
  > Socratic: Counter-argument considered — none. Email + password is the industry standard, familiar to every user and supported by every backend library. Stays.
- FR-002: The user can log in with the credentials from registration. Priority: must-have
  > Socratic: Counter-argument considered — none. Login is the foundation that separates individual users' decks. Stays.
- FR-003: The user can reset their password via email. Priority: must-have
  > Socratic: Counter-argument considered — none. The persona is an adult returning after a week or a month; without reset = losing all cards on the first forgotten password. Must exist.
- FR-004: The user can log out. Priority: must-have
  > Socratic: Counter-argument considered — none. Logout is basic hygiene. Stays.

### AI generation

- FR-005: The user can paste text and request the generation of flashcard proposals. Priority: must-have
  > Socratic: Counter-argument considered — none. This is the pupil of the MVP; without it the product has no point. API-cost control (input character limit) is deferred to Open Questions / NFRs.
- FR-006: The user sees the list of generated proposals (question + answer) before they are added to the deck. Priority: must-have
  > Socratic: Counter-argument considered — none. Without the review step it is impossible to measure the "75% AI acceptance" metric, which is the product's primary success indicator. The review step is forced by the success criteria.
- FR-007: The user can accept, reject, or edit each proposal individually. Priority: must-have
  > Socratic: Counter-argument considered — none. Inline editing saves a step compared with the "accept-then-edit-in-deck" flow. Stays.

### Flashcard management

- FR-008: The user can manually create a flashcard (entering question and answer by hand). Priority: must-have
  > Socratic: Counter-argument considered — none. Manual creation is the fallback for the moments when the user has a card in their head with no source text. It is also required by the success metric "75% of cards from AI" — without manual cards there is no baseline for comparison.
- FR-009: The user can browse all of their flashcards in a single view. Priority: must-have
  > Socratic: Counter-argument considered — none. The list is the entry point to editing (FR-010) and deletion (FR-011); without it those features have no navigation.
- FR-010: The user can edit an existing flashcard. Priority: must-have
  > Socratic: Counter-argument considered — none. Open question flagged: should editing reset the card's review schedule — to be resolved in Open Questions.
- FR-011: The user can delete a flashcard. Priority: must-have
  > Socratic: Counter-argument considered — none. Without delete the deck accumulates junk, which devalues the product over time. Stays.

### Reviews

- FR-012: The user can start a review session for their deck. Priority: must-have
  > Socratic: Counter-argument considered — none. System-initiated sessions are a nice-to-have outside MVP scope — captured in Non-Goals.
- FR-013: The application selects which flashcards to review according to the spaced-repetition algorithm. Priority: must-have
  > Socratic: Counter-argument considered — none. Without the spaced-repetition algorithm the product becomes a plain card browser and the core value disappears. Stays.
- FR-014: The user rates the difficulty of their answer after each card (using the scale required by the chosen algorithm). Priority: must-have
  > Socratic: Counter-argument considered — "binary correct/incorrect scale only". Resolution: FR stays as written — the shape of the scale depends on the choice of algorithm. The concrete algorithm and its rating scale is deferred to Open Questions.
- FR-015: The algorithm updates the review schedule based on the user's rating. Priority: must-have
  > Socratic: Counter-argument considered — none. Per-card scheduling is the essence of spaced repetition; per-deck scheduling degrades learning efficiency. Stays.

## Non-Functional Requirements

- **Privacy of user content.** Pasted text and the resulting flashcards do not leak to other users or to publicly available AI training datasets. Measurable: no commits of user content to public fine-tuning destinations; content accessible only to its logged-in owner.
- **Response time from the user's perspective.** Every significant operation (generating proposals, saving a card, rating during a session, editing) ends with visible feedback in under 30 seconds. Measurable: p95 of click-to-result time < 30s.

## Business Logic

Based on text pasted by the user, the application generates proposals of question–answer pairs, and then schedules the dates of their reviews based on the difficulty ratings the user assigns after each card.

The two decisions the product makes on behalf of the user:

1. **Card extraction from text.** Input: raw text (a fragment of a handout, textbook, or notes). Output: a list of proposed question–answer pairs. The product decides which fragments of text deserve a flashcard and how to phrase the question. This is the essence of reducing manual work — without this decision the product would be only a card editor.

2. **Review scheduling.** Input: the user's history of difficulty ratings for each card. Output: the order and date of the next showing of each card. The product decides which card to show and when, in order to maximise knowledge retention. This is the essence of the spaced-repetition method — without this decision the product would be only a random card browser.

The rule joining both decisions: the user provides text and ratings; the application provides cards and a schedule.

## Access Control

**Authentication model:** Email + password login. Classic registration with password reset. No third-party identity providers and no magic links in the MVP — the simplest mechanism that fulfils the requirement of "cards persisted across devices".

**Role model:** Flat — all users equal. Each user owns their own deck of cards; no sharing, no admin panel, no premium/free distinction. The access boundary equals the card-ownership boundary.

## Non-Goals

The MVP consciously does NOT do the following:

- **Custom spaced-repetition algorithm.** We use a ready-made library rather than writing one from scratch — incompatible with the 3-week budget. Concrete algorithm choice deferred to Open Questions.
- **Importing PDF / DOCX / other file formats.** Input is only plain text pasted from the system clipboard. PDF parsing, OCR, DOCX extraction — out of scope.
- **Sharing decks between users.** Each user = their own deck; no sharing, no public decks. The model is explicitly single-tenant per user.
- **Native mobile applications.** Web only. The web app works responsively on mobile, but we do not promise a mobile-optimised UI or app-store presence.
- **Integrations with external educational platforms.** No third-party flashcard-app sync, no learning-management-system integration, no classroom-platform integration. The product is self-contained.
- **Push / email notifications for scheduled reviews.** The user remembers session times themselves. No reminder dispatch; cards wait until the user logs in by their own initiative.
- **Learning statistics / progress dashboard.** No charts, streaks, gamification, or personal-metrics panel. The MVP is cards + the algorithm, nothing more.
- **Multimedia support in flashcards.** Only text-based question–answer pairs. No images, audio, mathematical formulas, or code blocks with syntax highlighting.

## Open Questions

1. **Spaced-repetition algorithm choice.** Concrete algorithm (binary scale vs 4-step SM-2 vs 4-step FSRS, etc.) drives the shape of FR-014's rating UI. To be decided alongside the spaced-repetition library choice. — Owner: user. By: before stack selection.
2. **API cost limit per user.** Bound on input length (e.g. daily character cap for the generation endpoint) to prevent runaway AI-API costs from a single user. — Owner: user. By: before MVP launch.
3. **Edit vs review schedule.** When a user edits an existing card (FR-010) that already has a review history, does the schedule reset to "new card" or persist? — Owner: user. By: before review-session implementation.
4. **Target QPS estimate.** `target_scale.qps` not specified in shape-notes. Needed to size generation throughput and review-session concurrency expectations. — Owner: user. By: before stack selection.
5. **Data volume estimate.** `target_scale.data_volume` not specified in shape-notes. Rough per-user card count and aggregate text-input volume needed to bound storage and AI-cost projections. — Owner: user. By: before stack selection.
