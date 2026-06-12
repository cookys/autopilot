# Handoff — Task-Tree Engine v1 execution (fresh session entry point)

> Written 2026-06-12 at the end of the design arc. You (the fresh session) are the first
> dogfood of the philosophy this project implements: rehydrate from these files, not from
> the prior conversation.

## Start here (in order)

1. `git checkout feat/task-tree-engine` (exists on origin; tracks it).
2. Read [`docs/plans/2026-06-12-task-tree-engine.md`](../../plans/2026-06-12-task-tree-engine.md) — **the R1 Amendments section is binding and overrides the phase text where they conflict** (esp. 1, 3, 5, 11).
3. Skim the spec only if rationale is needed: `docs/plans/2026-06-12-task-tree-engine-design-spec.md`.
4. Invoke `autopilot:dev-flow` — this is L-size mid-flight: project dir + INDEX row exist; create the L-1.5 scope-audit, phase TaskCreates (P0–P7) and the L-5 finish-flow parent task before any code.

## First work unit: P0 ∥ P1

- **P0 spikes** (S, do empirically, record in `references/multi-agent-portability.md` §7):
  - CC native task persistence: create tasks headless, list from a second fresh session — yes/no with transcript evidence.
  - `agy -p` judge mode: role-prompt + a diff → structured verdict (reuse `scripts/dispatch-hetero.sh` plumbing or raw `agy -p`; `.opencode/agent-bodies/reviewer.body.md` is an engine-neutral role prompt). Fallback if unusable: two Claude sessions from independent conversation roots — record as family-internal decorrelation.
- **P1 tree substrate** (L): `scripts/tree.sh` per plan §4-P1 + amendment 1 (truncated-tail tombstone in torture matrix; `index.json` gitignored; auto-rebuild on every read subcommand). Follow the repo test pattern: `hooks/tests/*.test.sh` with `lib.sh` (`finalize_test`, not `pass_test`); PATH-stub external binaries.

## Model routing (Board directive, amendment 11)

Fable-class = manager only (you), never dispatched. Delegates: sonnet (planner/researcher/implementer/sub-orch), flash-class cross-family for QC judges, haiku+script for synthesis. Per-tier token spend goes into the calibration report.

## Standing context (not in the plan docs)

- **Repo state**: develop = v2.15.3, all pushed. Unrelated branch `fix/scope-creep-gate-forcing-function` (3 commits incl. the original BACKLOG entry dd1676b) is still unmerged — do not entangle.
- **Untracked intentionally**: `.claude/agents/nest-probe.md` (nesting re-test fixture), `doc/` (user's own dir).
- **This week's relevant shipped tools**: `scripts/dispatch-hetero.sh` (hetero implementer dispatch, worktree-hard-railed), `scripts/agy-shell-guard.zsh`, `scripts/install-antigravity.sh` (preflight + export-then-install). agy ≤1.0.7 has a confirmed data-loss bug on symlinked plugin dests — never `agy plugin install` outside the guarded script (`references/multi-agent-portability.md` § agy spike has mechanism + recovery recipe).
- **Pending, user-gated (not yours to start)**: upstream agy bug report (draft at `/tmp/agy-issue-draft.md` + prefilled URL at `/tmp/agy-issue-url.txt` — /tmp may not survive reboot; regenerate from the BACKLOG entry + portability doc if gone; user files it under their account, then backfill the issue URL into BACKLOG + portability doc). twgs-dev fleet check (needs SSH address from user): `find ~/.gemini/config/plugins -maxdepth 1 -type l` + repo pull.
- **Memory rule status**: `feedback_verify-reviewer-claims` still stands as-is until P5 shadow data exists (plan P7).

## Definition of done for your session (suggested)

P0 both spikes recorded + P1 shipped through quality-pipeline (reviewer round per code-review.md, S/L route) and merged to develop behind the project branch flow — or an honest blocker escalated. Graduation/authority questions are Board-only; don't touch verification authority in P0/P1.
