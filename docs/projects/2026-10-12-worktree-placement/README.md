# worktree-placement — one rule for where worktrees and handoffs go

Source: [`docs/backlog/worktree-and-handoff-placement-has-no-rule.md`](../../backlog/worktree-and-handoff-placement-has-no-rule.md) (owner question 2026-10-12, gaps 1–8).
Spike: [`docs/plans/evidence/2026-10-12-worktree-placement/spike-native-worktree.md`](../../plans/evidence/2026-10-12-worktree-placement/spike-native-worktree.md).
Plan: [`docs/plans/2026-10-12-worktree-placement.md`](../../plans/2026-10-12-worktree-placement.md).
Direction: C — decision `intent-17-2` in the decision ledger (owner's answer; supersedes `intent-17-1`, which had recorded A on the owner's behalf).

## Project Goal

> **Final goal**: every worktree of a repo lives under one root, `<main checkout>/.claude/worktrees/`, whoever creates it (a person, Claude Code, or a dispatch rail); a handoff for a repo goes to one predictable place on both routes; and the session-mode marker measures the worktree the session actually works in.
>
> **Success criteria** (each with its verification):
> 1. A marker created in the main checkout and then used from a worktree of the same repo measures E1 in that worktree — a test that creates the marker in repo A's main checkout, commits N files on a branch in a linked worktree and runs `stage-advance` there reports `files = N`, and fails on the current code (red at base).
> 2. `base_ref` defaults to the newer of `develop` / `origin/develop` (then main/master) — a test with local `develop` behind `origin/develop` stores the remote sha; red at base.
> 3. `session-mode.js set --new-task` prints one advisory line when the worktree directory name and the branch name share no task token, and none when they match — two-case test; exit code unchanged (advisory, never blocks).
> 4. Both handoff routes take their path from one resolver: the manual fallback is keyed by repo identity (two repos with the same basename get different files; two worktrees of one repo share one), the `/clear` route stays keyed per worktree (its existing pinned tests pass unchanged) — resolver tests plus the unchanged hook tests (plan D8).
> 5. The hetero, foreman and batch rails create their worktrees under `<main checkout>/.claude/worktrees/` (also when invoked from a linked worktree), through one placement resolver; every reaper, the residue registry and `repo-residue-sweep` still find and reclaim them — the rail, reaper and registry suites stay green with assertions moved to the new root, and a new resolver test pins the path for a call from the main checkout and from a linked worktree.
> 6. No repo-tree walker the rails or gates run from the main checkout descends into `.claude/worktrees/` — a test per walker found in the plan's inventory, or a named walker shown to skip it already.
> 7. The written rule exists in one place (`references/worktree-placement.md`) and the backlog file's gaps are each marked fixed or explicitly deferred.
>
> **Scope boundary**: includes the marker, base_ref, new-task advisory, handoff keying, rail relocation into `<main checkout>/.claude/worktrees/` with one resolver, walker/reaper/registry follow-through, one reference doc. Excludes taking over native worktree creation (`WorktreeCreate` hook — option B), the verify-red-green and test-integrity-L1 scratch worktrees (short-lived, removed by their own script — stay in temp unless the plan shows they are free to move), and cross-repo dispatch rules (gap 5 — deferred).

## Deliverables

| # | Deliverable | Status |
|---|---|---|
| 1 | worktree placement rule (marker follow, base_ref, new-task advisory, handoff keying, rail relocation, reference) | implement (P1 ✅, P2 in review) |

## Progress

| Date | Step |
|---|---|
| 2026-10-12 | intent: spike done (U2 receipt in `ladder.jsonl`), direction A recorded on the owner's behalf |
| 2026-10-12 | owner chose C (`intent-17-2`); sweep follow-up added to the spike: Claude Code's periodic sweep keeps worktrees without its own marker, so rail worktrees under `.claude/worktrees/` are safe from it |
| 2026-10-12 | plan-review G1 (opus chair): CONDITIONAL, 9 non-blocking findings all folded (`2ce98cf4`); receipt check passes against the reviewed bytes — evidence `docs/plans/evidence/2026-10-12-worktree-placement/plan-review/` |
| 2026-10-12 | P1 (marker follows the session, base_ref pairs): red `7ba74598` → green `d9aa4210`, `202211ce`; hetero review g2 SHIP-AS-IS, receipt `receipt-P1.json` (`5f5292cc`) |
| 2026-10-12 | P2 (rail placement): lists `5534f2e5`; red `28ab4d92` (resolver + rails repointed + red tests, `p2-red-A.txt`); green `c90c3e3b` (D3, D11, D7, D10, P2.5 walkers, `p2-green-B.txt`); verify-red-green A..B VALIDATED (`p2-red-green.json`); P2.6 suites green. Deviations: D9 allowlist moved into the red commit (the pre-commit registry gate refuses the new allocation sites; gate metadata only, no runtime effect); D7 plan wording corrected (a marked nested worktree is a dispatch worktree, so depth-0 is gated there as in the temp dir; an unmarked one is allowed by the `.claude/` allowlist as today); `dispatch-hetero.test.sh` case 4 moved its first-placement check to a fresh sandbox (case 3d already places a worktree in `$SBX`, so the old precondition could never hold — the replacement is strictly stronger). P2.4: no foreman-guard change (`p2-4-foreman-guard.md`). Finder check: every reaper enumerates with `git worktree list --porcelain` or markers; no temp-root glob finds rail worktrees |
