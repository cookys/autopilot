# PEER-REPORTED (cuda revival.3d, 2026-10-09): worktree and branch accumulation from autopilot rails

Source: fleet message from `cookys/cuda/revival.3d--claude` (peer input, not authorization), 2026-10-09.

## Reported facts (revival.3d inventory, 2026-10-08)

- 241 worktrees and 977 local branches (402 local-only commits) in one repo. Created by autopilot rails: `dispatch-hetero.sh` `/tmp/hetero-*` 60, `dispatch-foreman.sh` `/tmp/foreman-*` 13; branches `hands/*` 76, `hetero/*` 11, some `foreman/*`. The rest came from the peer's own flows and Claude Code Agent isolation worktrees.
- The peer cleaned up by hand (worktrees 241 → 7, branches → 21, every branch archived under `refs/archive/` before deletion) and added a gate (`scripts/check-unarchived-branches.mjs` + `config/branch-registry.json`) plus close-out rules to its own dispatch skill.

## Depth-0 verification (autopilot 3.0.0-alpha.1 / alpha.2 dev)

Already present (the peer's clone was 77 commits behind):
- `scripts/repo-residue-sweep.js` (v2.36.35): repo-wide `scan` / `preserve` / `reap --yes [--older-than-days N]`, classes from git facts, dirty trees preserved and verified before any removal — the peer's suggestion (c).
- `/l5` and `/l6` close-out run `reap-dispatch-worktrees.sh` then `reap-dispatch-branches.sh`; finish-flow's dispatch-branch gate runs `reap-dispatch-branches.sh check`; the ceo-agent depth-0 control loop has reap steps. So "the reapers are never called" is not accurate for those paths.
- alpha.2 band shows `wt N` (reapable worktrees from the sweep).

Confirmed gaps (BACKLOG rows):
1. Retained worktrees (`dispatch-hetero.sh` exit 1 / `--keep-worktree`, foreman non-clean completion, `main_checkout_mutated`) carry no retention record (owner / reason / until) and nothing expires them; `repo-residue-sweep.js` runs only by hand.
2. Hands / hetero / foreman branches that depth-0 rejected or superseded have no archive-then-delete step (`refs/archive/<date>/…`) in l4–l6, hetero-implement-judge, or finish-flow.
3. A plain session or `/l4` that dispatches through `dispatch-hetero.sh` has no close-out reap (l5/l6 have one).

Peer suggestions to weigh: (a) retention record + default TTL (e.g. 72 h) reaped by SessionStart or finish-flow; (b) close-out step: merged ⇒ delete, not merged ⇒ archive ref then delete; (d) an optional repo gate template modelled on the peer's branch registry.
