# worktree-teardown-config — per-project hetero-worktree cleanup seam

> Copy to `.claude/worktree-teardown-config.md` in the consuming project to override.
> Resolved by [`scripts/resolve-worktree-teardown.sh`](../scripts/resolve-worktree-teardown.sh),
> which `scripts/dispatch-hetero.sh` consults on the success-path `reap_worktree` and on
> standalone `--gc`. Sibling of [`qc-gate-config.md`](qc-gate-config.md): qc-gate governs
> merge/push review evidence; this config governs *how* throwaway worktrees (and any
> project-owned external resources keyed to them) are reclaimed.

**Default is all-off**: no project hook, age reaper disabled. The harness still attempts
`git worktree remove --force` on clean success and surfaces failures loudly
(`orphan_worktree` JSON + stderr WARN). Opt in per project when you leave root-owned
build artifacts or named Docker volumes inside hetero worktrees.

## Settings (one `key: value` per line; first match wins)

- teardown_hook:
- stale_reaper_age_days: 0
- reaper_scope: marker-only
- max_leaf_worktrees_per_root: 4

## Field reference

| Key | Values | Meaning |
|-----|--------|---------|
| `teardown_hook` | path (empty = none) | Project script invoked as `timeout 120 <hook> <worktree_path>` **before** `git worktree remove --force` on the success path and on `--gc`. Must realpath-resolve **inside the consuming repo root**, be a regular executable file. Outside-repo paths are refused (no override bypass). Hook failure/timeout is **fail-open** (remove still attempted). Not run from the INT/TERM abort trap. |
| `stale_reaper_age_days` | non-negative integer | Age threshold for `dispatch-hetero.sh --gc`. **`0` = disabled** (default — the reaper logs and exits 0 without enumerating). Age is measured from the marker's `created_at` epoch, not filesystem mtime. Negative age (clock skew) is treated as eligible. |
| `reaper_scope` | `marker-only` | Only worktrees bearing `$WT/.autopilot-worktree` are eligible for routine `--gc`. Unmarked recovery is a separate CLI escape hatch (`--gc --reap-unmarked --yes`, basename `hetero-*` only, still flock-gated). |
| `max_leaf_worktrees_per_root` | integer `1..32` | Maximum simultaneously retained schema-2 worktrees for one managed root run. Invalid or missing values fail closed to `4`. Direct one-shot dispatches without inherited lineage are not budgeted. |

## Managed root-run lifecycle

The resource identity is the canonical Git common directory plus the campaign's
stable `root_run_id`. The canonical campaign controller derives it from the
sealed `campaign_id` and injects it into initial, repair, and resumed
implementation dispatches as `AUTOPILOT_WORKTREE_ROOT_RUN_ID`. The separate
`AUTOPILOT_ROOT_RUN_ID` remains the foreman/watcher trace root. Every schema-2
implementation descendant must inherit the worktree id unchanged; a foreman
id, stage id, leaf run id, branch name, or worktree path is not a replacement.
The dispatcher admits an explicit managed root before publishing its first
pending record or creating a branch/worktree. Direct one-shot dispatches with
no explicit worktree root retain legacy cleanup and create no lifecycle
authority.
Leaf creation and lifecycle disposition share the repository lifecycle lock, so
the occupancy observation and destructive action cannot pass each other.

After depth 0 has inspected a retained outcome, disposition it immediately:

1. `reap-dispatch-worktrees.sh reap --repo <repo> --root-run-id <id> --yes`
   removes only exact clean/dead schema-2 leaves and persists their branch/tip
   inventory before removal.
2. `reap-dispatch-branches.sh reap --repo <repo> --into <branch>
   --inventory-file <worktree-result.json> --yes` bundle-reaps contained tips.
   An uncontained tip is emitted as an unacknowledged blocker; after an
   external exact-tip preservation handoff, rerun with
   `--ack-preserved <branch@tip>`.
3. `lifecycle-residue-receipt.js issue ...` followed by `check ...` emits and
   freshness-checks the `LifecycleResidueReceipt`.

A caller-owned durable artifact directory must hold all three JSON files; do
not place them inside a leaf that will be removed. Bind `root_run_id` from the
admitted sealed `campaign_id`, validate
`campaign-v1-<64 lowercase hexadecimal characters>`, and use a new mode-0700
`root-<root_run_id>.<unique>` subdirectory for every attempt. A failed attempt
then cannot expose a stale receipt. Every command fails fast. `check` exit 0 proves
freshness, not absence: consumers must separately require
`zero_residue: true`. Dirty/live/unknown states are resolved and the same
exact-root sequence is rerun; they are never force-removed past the controller.

A receipt reports lifecycle residue only. It never authorizes generation
advance, task completion, merge, or session finish.

## Defaults & safe fallback

Unknown / missing / unparseable config → **`teardown_hook: ""`**, **`stale_reaper_age_days: 0`**,
**`reaper_scope: marker-only`** (seam present, destructive reaper off). Set a positive age
and/or a repo-local hook when the project provisions external resources or builds as a
different uid inside the worktree.

## Example (PEACE-style)

```
- teardown_hook: .claude/hooks/worktree-teardown.sh
- stale_reaper_age_days: 3
- reaper_scope: marker-only
- max_leaf_worktrees_per_root: 4
```

The hook receives the absolute worktree path as `$1` and should reclaim project-owned
resources (root-owned `target/`, named volumes, …) best-effort, then exit 0. See
`docs/plans/2026-07-09-worktree-teardown-seam.md` §4 for a reference implementation.

## Safety rails (harness-enforced; not configurable)

- Per-worktree liveness = `flock -n` on `$WT/.autopilot-worktree.lock` (no pid checks).
- `--gc` never runs `git branch -D` (only unmanaged one-shot abort may use the
  legacy branch-delete trap).
- Global `--gc` serialization via `$TMPDIR/.autopilot-gc.lock`.
- Managed leaf creation is serialized by `$GIT_COMMON_DIR/autopilot-worktree-budget.lock`.
- Exact root-run disposition uses that same repository lifecycle lock.
- Exact branch disposition holds the verified lifecycle lock across its
  canonical controller rescan, validation, and destructive action.
- Automatic success cleanup targets only its completing leaf. Explicit
  `--keep-worktree` leaves carry `retention=inspect` and consume budget until
  depth 0 dispositions them.
- Managed signal aborts journal before removal and never delete their branch in
  the trap. Targeted reap is pinned to the pre-hook tip; tip drift preserves the
  leaf for explicit disposition.
- A private repo-level registry admits each lifecycle root before anchor
  creation. Active roots cannot be reinitialized after evidence loss.
- A random nonce plus journal directory birth-time/device/inode are cross-bound between a
  separate durable root anchor and the private branch-inventory sentinel.
  Immutable records are mirrored byte-for-byte and committed by key+digest to
  a Git-blob authority that also permanently binds the original journal
  nonce/birth-time/device/inode and advances through compare-and-swap under
  `refs/autopilot/lifecycle-roots/`. Anchor and registry are forward-repairable
  views, so their rollback, directory replacement, sentinel replay, or loss of
  one or both record copies fails closed.
- Record-copy publication has a mode-0600 write-ahead intent. Recovery may roll
  back pre-authority copies or clear a trailing intent only while both
  authority-committed copies match; missing, malformed, or extra evidence is
  never promoted during load.
- Crash recovery covers process death/SIGKILL, not host power loss without
  filesystem fsync guarantees. Ambiguous host-crash state fails closed.
- Managed successful leaves commit exact branch evidence through the lifecycle
  controller before automatic worktree removal.
- Pre-anchor journals migrate only from owner-private mode-0700 directories
  whose imported records are owner-owned mode 0600.
- Hook argv-exec only; `$WT` with control characters is refused.
