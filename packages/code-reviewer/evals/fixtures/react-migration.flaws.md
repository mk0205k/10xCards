# Ground truth — `react-migration.diff`

The fixture migrates a `UserCard` component from a React 16 class component to a
React 19 function component (hooks + `createRoot`). The migration is otherwise
clean and idiomatic; **three** flaws are planted deliberately, each targeting a
distinct scored criterion. A correct review must name each one. These three are
the source of truth for the Phase 4 `llm-rubric` assertions.

## Flaw 1 — XSS via `dangerouslySetInnerHTML` (criterion: `securitySafety`)

- **Location**: `src/components/UserCard.jsx`, the bio render.
- **Before**: `<p className="bio">{profile.bio}</p>` — React escapes `profile.bio`, rendering it as inert text.
- **After**: `<div className="bio" dangerouslySetInnerHTML={{ __html: profile.bio }} />` — `profile.bio` comes straight from the `/api/users/:id` response (untrusted, user-controlled profile data) and is now injected as raw HTML.
- **Why it's a defect**: a user who sets their bio to `<img src=x onerror=…>` (or any script-bearing markup) gets it executed in every viewer's session — a stored XSS sink introduced by the refactor. There is no sanitization (no DOMPurify, etc.).
- **Correct identification**: names the `dangerouslySetInnerHTML` sink **and** that the injected `bio` is untrusted/user-controlled input. Generic "watch out for security" does not count.

## Flaw 2 — Stale-closure `useEffect` with empty deps (criterion: `implementationCorrectness`)

- **Location**: `src/components/UserCard.jsx`, the `useEffect`.
- **Before**: `componentDidMount` fetched on mount **and** `componentDidUpdate` refetched whenever `prevProps.userId !== this.props.userId`.
- **After**: `useEffect(() => { … fetch(`/api/users/${userId}`) … }, [])` — the dependency array is empty while the effect body reads the `userId` prop.
- **Why it's a defect**: the effect captures the first `userId` and never re-runs, so the card never refetches when the `userId` prop changes. This silently drops the `componentDidUpdate` behavior — a real regression from the pre-migration code. The dep array should be `[userId]`.
- **Correct identification**: names the empty dependency array (`[]`) and that the component will not refetch when `userId` changes (stale closure / lost `componentDidUpdate` behavior). Generic "check your hooks" does not count.

## Flaw 3 — `defaultProps` on a function component (criterion: `idiomaticity`)

- **Location**: `src/components/UserCard.jsx`, `UserCard.defaultProps = { fallbackRole: "Member" }`.
- **Why it's a defect**: React 19 **removed** support for `defaultProps` on function components (deprecated in 18, ignored in 19). The intended default `fallbackRole = "Member"` therefore never applies; when a parent omits `fallbackRole`, it is `undefined` and the role line renders blank instead of "Member". The idiomatic React 19 fix is an ES default parameter: `function UserCard({ userId, fallbackRole = "Member" })`.
- **Correct identification**: names that `defaultProps` on a function component is ignored/removed in React 19 (a genuine breaking change on the target version) and that the default no longer applies. Merely noting "you could use default params" without tying it to the React 19 breakage is weaker but acceptable; crediting the `defaultProps` block as correct is wrong.

## Expected verdict

`fail` — three impactful defects spanning security, correctness, and idiomatic
React 19, so the overall verdict must be `fail` and the affected criteria must
score low.
