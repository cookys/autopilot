# Foreman exam harness: spec conformance before landing

**Branch:** `hetero/foreman-phase-5` on `origin`. Not merged.

**Review:** `docs/plans/evidence/2026-09-29-foreman-exam-landing-review/`.
Generation 1 verdict is FIX-THEN-SHIP with 8 verified findings.

**Spec:** `docs/plans/evidence/2026-09-21-foreman-exam-design-consult/claude-fable-5-1-SPEC.md`.

## Work to plan

1. Candidate surface. Run each campaign in a fresh network-off worktree with the
   four spec tools, including `shell`. `.autopilot/` stays candidate-owned.
   Host records come from real git and filesystem state.
2. Stub fidelity. Implement the frozen transition and report tables: row
   `report`, `claimed_check_exit`, F and F-twin capability behaviour, and G's
   out-of-fence X.
3. Budgets. Source per-family limits and token caps from the corpus. Return
   `budget_exhausted` and implement the post-limit verdict window.
4. Grading. Anchor truth, protected blobs, diff paths, and review-tree
   equality to the verdict's `head_sha`.
5. Accounting. Implement `PRIOR_WORK_DISCARDED`. Count a clean false positive
   on any non-done verdict (spec line 110).
6. Conformance. Drive every puppet, restart, write probe, and kill probe
   through the real runner and sandbox.
7. Anti-rerun. Keep a durable evidence log keyed by
   `(engine_id, seat_config_hash)` and load it before each sitting.
8. Wire contracts. Use 40-hex ids and validate the full verdict and envelope.
9. B1_GAP. The spec's own b1 continuation makes §6 FALSE_MET unreachable. The
   generator adds an instruction gate that the spec lacks. Amending the spec is
   the spec author's call. The gap stays pinned by
   `hooks/tests/foreman-eval-b1-gap.test.sh`.

Items 1, 3, and 6 change `harness_hash`. Re-pin the conformance record in the
same change, and treat every sitting run before it as non-conformant.

**Merge mechanics, verified 2026-09-29:** two union conflicts, one hunk each,
in `schemas/capability-evidence.schema.json` and `scripts/engine-qualify.js`.
The codex mirror needs `sync-all.sh`. Squash the merge so the `LOCAL ONLY`
commit and its revert stay out of develop history.
