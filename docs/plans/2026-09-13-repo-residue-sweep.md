# Repo-level residue sweep — 308-db item (a)

BACKLOG row "PEER-REPORTED (308 dogfood)" (a): 308 registers 51 worktrees (15 dirty) and 88
branches (65 with commits not in HEAD), most created by foremen through `dispatch-hetero` or by
hand, none inside the managed leaf lifecycle — so `max_leaf_worktrees_per_root` and `zero_residue`
never saw them. Three dirty worktrees held staged-but-never-committed source that existed nowhere
else; the peer exported patches by hand and was explicit that nothing guaranteed it.

## What ships

`scripts/repo-residue-sweep.js` — **repo-wide, not per-run**: every linked worktree and every
local branch, classified from git facts, with the dirty half handled first.

| Command | Effect | Refuses |
|---|---|---|
| `scan --repo <dir> [--integration-ref <ref>]` | read-only classification, JSON | — |
| `preserve --repo <dir> --out <dir> [--worktree <path>]...` | for each dirty worktree: `git diff --binary` (unstaged) + `--cached` (staged) + untracked file archive + manifest (paths, byte sizes, sha256, HEAD, branch); **verified** by `git apply --check` of each patch against the worktree's own HEAD in a scratch index before it is called preserved | an unverifiable patch → `preserved: false`, the worktree stays |
| `reap --repo <dir> --yes [--preserve-dir <dir>] [--older-than-days N]` | removes `clean-integrated` and `missing-dir` worktrees; deletes `integrated` branches that are not checked out, after `pin-evidence-anchors.js apply --exclude-ref` for every branch to be deleted; a dirty worktree is removed ONLY when the sweep's own `preserve` manifest for it exists and verifies | `live` worktrees (lock held), `unintegrated` branches, dirty worktrees without a verified preserve record — always |

Classification (worktrees): `live` (`.autopilot-worktree.lock` held — `flock -n` fails) →
`missing-dir` → `dirty` (any `status --porcelain` line) → `clean-integrated` (tip is an ancestor of
the integration ref) → `clean-unintegrated`. Classification (branches): `checked-out` →
`integrated` → `unintegrated` (with `ahead` commit count and last commit date).

Age is advisory (`--older-than-days` narrows, never widens); disposition is by class.

## Why not extend `reap-dispatch-worktrees.sh`

That controller is a per-root-run lifecycle with journal sentinels and durability anchors; its
contract is "exact schema-2 leaves of THIS root". A repo-wide sweep has a different question —
"what is here at all, and what would be lost if it went" — and mixing them would weaken the
per-run proof. The sweep calls the same primitives (`pin-evidence-anchors.js`, `worktree list
--porcelain`, `for-each-ref`) and emits its own receipt.

## Not in scope

Deciding which unintegrated branches are worth keeping — that is a judgement with evidence, listed
for a human/depth 0, never deleted by the sweep.
