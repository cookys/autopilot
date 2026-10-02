# Evidence — test suite repo write containment (v2.36.105, release `a8e4045c`)

Plan (archived): `docs/plans/_archive/2026/10/2026-10-02-test-suite-repo-write-containment.md` — G1/G2 artifacts and dispositions beside it.

## Incident that started it
Main clone on cookys-aimax395 carried local `user.name=Test User`/`user.email=test@example.com` from 2026-09-04 20:36 (reflog: second merge of `worktree-agent-a0b646e…`, D5-integration pass 2) to 2026-10-02; 632 commits on develop. Vector: `GIT_DIR` exported to hooks in a linked worktree + a test's bare `git config`. v2.36.103 unset the env but its guard trusted the polluted baseline (`c99e2a16` still shipped as Test User). Cleared by hand 2026-10-02 with operator approval.

## Probes (depth-0)
- bwrap read-only `.git`: works one level, but `kernel.apparmor_restrict_unprivileged_userns=1` forbids nested bwrap, and 10 suites + the reviewer sandbox use bwrap → kernel isolation rejected; pivot to a disposable snapshot.
- Full suite in a fresh clone (`probe/baseline-clone-summary.txt`): 6/383 red, all classified — 2 load timeouts, 3 caused by a stray empty `/tmp/.git` (created 2026-09-30 10:11; removed with operator approval), 1 genuine (`check-canonical-invariants`, fixed as row 0). Zero clone-induced.
- Same run dirtied `.opencode/package.json` + lock (working-tree write) → BACKLOG row.

## Pipeline
- Implement foreman (`implement/`): 13 hand commits, cursor-grok-4.6-low hands, per-row fable review; 6/7 rows FIX-THEN-SHIP on first pass. Catches: a hand's own test wrote a stray `tracked.txt` into its worktree (the bug class itself); `--parallel` silently bypassed the snapshot; flock-missing hard-failed (depth-0 catch, macOS); P2 round 1 `boundary_rejected` (unattributed clone ref change).
- Landing (`landing/`): full suite twice (snapshot on / off) — same single known timeout; real-repo state identical in snapshot mode; in-place mode re-dirtied `.opencode/*` and the new guard warned. `test-snapshot` solo 6× green (`ts-rcs.txt`).
- Combined review round 1 (`trwc.review.json`): two 🟠 a per-row review never saw — pre-push range not remote-scoped (would refuse branches carrying the 632 historical commits; silent pass on unknown old tip) and no child-group shutdown on normal exit/HUP. Repaired by one sonnet hand (`hand-landfix.md`); round 2 (`trwc-r2.review.json`) SHIP-AS-IS, trailer id `sgz8VH` (raw_log suffix).

Wall time: implement 14:42–17:28, landing to 20:5x. Lesson recorded in operator memory: size the pipeline before dispatch (parallel independent rows, sonnet hands for large/signal-heavy rows).
