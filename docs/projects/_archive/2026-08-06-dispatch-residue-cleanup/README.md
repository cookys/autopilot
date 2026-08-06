# dispatch-residue-cleanup

**Status**: Complete · **Version**: v2.34.5 · **Branch**: local merge on `develop`

Reclaim accumulated dispatch residue, and close the gap that let evidence die with it.

## What triggered it

A routine "is the worktree clean?" check found 22 worktrees (4.4 GB), 20 local branches, 885 `/tmp`
entries (3.5 GB), and a `mission-routing-admission` gate returning `MISSION_EVIDENCE_AMBIGUOUS`.

## Outcome

| | Before | After |
|---|---|---|
| worktrees | 22 | 1 |
| local branches | 20 | 1 (`develop`) |
| `/tmp` | 6.9 GB | 5.0 GB |
| evidence anchors | 0 (namespace did not exist) | 78 |

## The finding that mattered

Mission receipts under `.git/autopilot/` bind evidence to **commit SHAs**, and a receipt is JSON —
Git cannot see that reference. A commit whose only ref was a dispatch branch becomes unreachable
the moment that branch is reaped, and `gc` reclaims it. The receipt survives, still claiming
"verified", naming a SHA that no longer resolves.

Four commits were already lost this way before the cleanup began: `af5fe9b4`, `3fb64596`,
`6f8e7d0d`, `92ebff99` — receipts present, objects absent. A further 72 were unreachable and
counting down. All 72 were pinned; the four are unrecoverable.

Two reasoning errors are worth recording because both looked well-evidenced:

- **"No references in the repo, so the branches are safe to delete."** The scan used
  `grep -r --exclude-dir=.git`, and the authoritative references live inside `.git/autopilot/`.
  Content equivalence is not the safety criterion — receipts bind commits, not content. The sound
  criterion is *objects still reachable + content absorbed*.
- **"No process holds these worktrees."** Checked via `/proc/*/cwd`, which a worker holding a lock
  with its cwd elsewhere defeats. `flock` on the marker is the authority, and each marked directory
  resolves against **its own** git common dir, not the main repo's.

## Three tools that existed and were not working

| Tool | State found | Resolution |
|---|---|---|
| orphan worktree reaper (`dispatch-hetero.sh --gc`) | `stale_reaper_age_days: 0` — never enabled here | repo-local override set to 14 days |
| pre-commit drift gates | `core.hooksPath` unset; hook never installed | `install-hooks.sh` run; blocking verified by injecting a real drift |
| `reap-dispatch-branches.sh --reap-superseded` | functional, but `scan` keys on `root_run_id` and this residue carries none, so it always returned an empty inventory | recorded; `scan --all` remains open |

## Mission re-admission: recorded, not fixed

Re-admitting the archived next-touch graph is blocked in two layers. The ambiguity (six same-graph
adoptions from retries, five carrying a valid ready terminal) is already expressible via an explicit
terminal receipt. The second layer is not: admission then requires that terminal's exact controller
Work Order, and for the canonical final adoption `fcca6ea6…` that Work Order does not exist.
Synthesizing one is not an option — the requirement *is* the replay protection.

So a generic rollover must additionally express "this route is closed, its Work Order requirement no
longer applies", which changes a fail-closed safety gate. Not urgent: a different graph digest is
filtered at the lineage/policy/graph checks, so a new mission proceeds as a first run. Findings are
recorded in the `scripts/mission-terminal-reconcile.js` header, where anyone generalizing it will
read them.

## Still open

- `reap-dispatch-branches.sh scan --all` for refs carrying no `root_run_id`
- `prune-tmp-residue.sh` owns no test-fixture residue (the largest byte source)
- `finish-flow` / `session-mode.js` close: require zero owned worktrees and zero unattributed refs
- Mission adoption retirement in `src/mission/runtime.js` (the upstream root cause)
## CLAUDE.md structural relief (done)

The inventory table was 78% of a file the harness loads in full every session, and adding one row
put it at exactly 40000/40000. Descriptions moved to `references/scripts-inventory.md`; CLAUDE.md
keeps a grouped name list, so a session still learns what exists without loading 30 KB to do it.
40000 → 13803 bytes, all 146 scripts still named.

## Evidence

- Bundles: `~/.local/state/autopilot/archives/autopilot/2026-08-06-g8b/` (7 refs / 4 unique OIDs,
  restore-verified into a disposable bare repo) and `.../2026-07-27-reap-bundles/` (19 bundles
  rescued from `/tmp`, each `bundle verify` clean, checksums matched)
- `hooks/tests/pin-evidence-anchors.test.sh` — 10 assertions
- `hooks/tests/reap-dispatch-branches.test.sh` — 135 assertions, unchanged by the integration
