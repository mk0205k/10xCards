# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Set a kill date on every feature flag

- **Context**: Any phase that adds a feature flag
- **Problem**: Flags accumulate as zombie code paths
- **Rule**: Feature flags must have a kill date set at introduction.
- **Applies to**: plan, implement, plan-review, impl-review

## Nie włączaj no-misused-promises dla .astro dopóki parser bug nie jest fixed upstream

- **Context**: `eslint.config.js` astroConfig block; dowolna strona `*.astro` której frontmatter awaituje Promise, po czym wykonuje `return Astro.redirect(...)`.
- **Problem**: astro-eslint-parser produkuje AST nodes bez `.parent` w Astro frontmatter, co crashuje `@typescript-eslint/no-misused-promises` z `Non-null Assertion Failed: Expected node to have a parent.` na dowolnym `return Astro.redirect(...)` po `await`. Komentarze `/* eslint-disable */` w frontmatter są cicho droppowane przez parser, więc config-level override to jedyny działający fix.
- **Rule**: `@typescript-eslint/no-misused-promises` musi pozostać wyłączone dla `**/*.astro`. Nie próbuj re-enable'ować bez weryfikacji że astro-eslint-parser fixed parent-linkage bug (issue w upstream repo). Reguła pozostaje aktywna dla `.ts`/`.tsx`.
- **Applies to**: plan, implement, plan-review, impl-review
