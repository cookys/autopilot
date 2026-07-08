# `verify_strength` as a review-density axis — ordered precursors

**Status**: precursor (1) shipped 2026-07-09 (v2.32.11); (2) and (3) BACKLOG'd.
**Source**: `docs/BACKLOG.md` § "`verify_strength` as the third density input" (Effort L) + `docs/plans/2026-07-08-observation-first-skills.md` § Non-goals / Scope C.
**Evidence anchor**: the escape cliff where `t2 × medium` verification produced **100% escapes** (pipeline-bench archive report) — verification QUALITY is currently invisible to `resolve-review-loop.sh`'s density/risk routing, so a weak suite buys the same review depth as a strong one.

## Why this is decomposed, not done in one shot

The full milestone — `resolve-review-loop.sh` treating verification QUALITY as a first-class density input alongside diff size / source-trust / protected-path — needs two things that do not exist yet:
1. a deterministic way to know a change's tests actually exercise the change (a red-green instrument), and
2. a way to SCORE the strength of a real project's test suite (not just a synthetic weak/medium/strong fixture).

Shipping the density axis before those exist would route on a number nobody can compute. So the work is three ordered segments; each is independently useful.

---

## Segment 1 — red-green validation instrument ✅ (this ship, v2.32.11)

**What**: `scripts/verify-red-green.sh` — proves a change's tests are RED at `base+tests` and GREEN at `head`, i.e. they detect the absence of the production change rather than being constant-green.
**Why**: this is the atomic "is this test worth anything?" signal. It is the BACKLOG's explicitly-named minimal precursor. On its own it is a usable pre-merge / `/l5` `/l6` check (does a delegated implementer's new test actually test the change?).
**Delivered**: the script + `hooks/tests/verify-red-green.test.sh` (VALIDATED / NOT_RED_ON_BASE / NOT_GREEN_ON_HEAD / INCONCLUSIVE + help/invalid/missing-arg + a nested-test-path regression), wired into `skills/quality-pipeline/references/test-policy.md`, the quality-pipeline SKILL scripts table, and the CLAUDE.md inventory.
**Mechanism reuse**: `git worktree add --detach` isolation (shared with the `check-test-integrity.sh` L1 collector), NOT the in-place `git stash`/`checkout` of `verify-preexisting.sh` — so it never mutates the live tree and base+head coexist.
**Effort**: S (done).

## Segment 2 — real test-suite "verification strength" scorer 🔜 (BACKLOG, next)

**What**: an instrument that assigns a strength score to a REAL project's test suite for a given change — not the synthetic weak/medium/strong fixtures of the pipeline bench. Candidate signals (to be designed, not prescribed here): red-green pass rate over the changed surface (Segment 1 applied per test), assertion density / mutation-survival on the diff, coverage delta on changed lines, presence-of-oracle. The output must be a small ordinal (e.g. `weak | medium | strong`) with a documented, deterministic derivation.
**Why it's separate**: Segment 1 answers "does THIS test exercise THIS change" (binary, per-test). Segment 2 answers "how strong is the suite guarding this change overall" (graded, per-change) — a strictly harder instrument that must run against arbitrary real repos and real runners, and must not depend on synthetic fixtures. Building it needs its own calibration (what score correlates with the observed escape cliff?).
**Depends on**: Segment 1 (a per-test red-green signal is one input); a calibration corpus tying scores to real escape outcomes.
**Effort**: L.

## Segment 3 — `resolve-review-loop.sh` consumes `verify_strength` as the third density axis 🔜 (BACKLOG, after 2)

**What**: `resolve-review-loop.sh` reads a `verify_strength` signal (from Segment 2, or an explicit `--verify-strength` / config key) and folds it into the same risk/density machinery that already consumes diff-lines / source-trust / protected-path — a weak suite RAISES required review depth (more families, higher effort, `l1_required`), a strong suite may LOWER it. Must be **additive** to the current schema (byte-identical prefix, new keys appended — same discipline as the `--domain` / `min_panel_size` additions) and **fail-safe** (unknown/absent strength ⇒ treat as weakest ⇒ most review, never least).
**Why last**: it's the consumer; routing on a score is meaningless until Segment 2 can produce one, and dangerous unless fail-closed.
**Depends on**: Segment 2 (the score) + the existing risk-tiered-review policy (`docs/plans/2026-06-26-trust-tiered-review-policy.md`).
**Effort**: M.

---

## Non-goals (this ship)

- ❌ No scoring instrument (Segment 2) — Segment 1 is binary red-green only.
- ❌ No `resolve-review-loop.sh` change — no `verify_strength` key, no routing on it (Segment 3).
- ❌ Segment 1 does NOT classify test files beyond a git-pathspec glob heuristic; it certifies red-green for the tests it's pointed at, it does not judge whether the RIGHT tests exist (that stays reviewer judgment).
