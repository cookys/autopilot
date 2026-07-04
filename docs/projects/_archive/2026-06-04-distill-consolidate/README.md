# distill cross-machine consolidate — v2.11.0

**Shipped**: 2026-06-04 · **Plan**: [`docs/plans/2026-06-04-distill-consolidate.md`](../../plans/2026-06-04-distill-consolidate.md)

## OKR
**Objective**: when two fleet machines distil the *same* recurring procedure, converge them
automatically (human-gated) instead of stopping on a raw git conflict — without regressing Claude Code
skill loading or holding a git transaction open across an LLM call.

- **KR1 — convergence key**: a deterministic slug normalizer makes independent namings of one procedure
  collide on one path (`fix-git-identity`/`git-identity-fix`/`ensure-git-identity` → `git-identity`)
  while keeping antonyms distinct. ✅
- **KR2 — proactive divergence detection**: `compare` against the pack's `@{u}` *before* committing the
  push (no merge-conflict state ever entered). ✅
- **KR3 — human-gated merge in a clean tree**: the LLM merge + lint + approve/reject happen on the clean
  working tree; a crash mid-gate loses nothing. ✅
- **KR4 — rollback**: consolidation is a normal commit → `git revert` works; fleet-revert runbook
  documents the peer-descendant case. ✅
- **KR5 — deterministic tests**: 26 assertions (`hooks/tests/distill-consolidate.test.sh`); LLM merge
  quality is explicitly human-gated, not test-gated. ✅

## What shipped
- `scripts/distill-consolidate.sh` — `normalize-slug` / `migrate` / `compare` (deterministic, no LLM).
- `skills/distill/SKILL.md` — Step 4 normalizes the slug; Step 5 proactive `compare` → human-gated
  LLM-merge → normal commit; "Deferred" section un-deferred; one-time `migrate` note.
- `references/sync-setup.md` — migration steps + fleet-rollback runbook.

## Process note (why this is worth recording)
Drove autopilot's own methodology on itself: **CEO plan → 2-round Architect/Ops/Skeptic dialectic →
dev-flow**. R1 cut a held-rebase design (inverted git `:2:`/`:3:` stages; could wedge the pack's
source-of-truth). R2 cut the resulting reactive-merge design in favor of **proactive fetch+compare**
(deletes the transaction-crash risk class entirely) and surfaced that the **slug-normalizer is the
precondition** that makes the engine fire at all (without it, near-zero hit rate). The Board overrode the
panel's "stay-deferred" recommendation and chose to build; the dialectic still shaped *what* got built.
Full review log in the plan doc.

## Deliberately out of scope
Slug-alias/near-duplicate matching (only exact normalized-slug collisions consolidate); ≥3-machine
single-pass accumulation (converges over multiple sync cycles); pack locks (git push-reject self-heal).
