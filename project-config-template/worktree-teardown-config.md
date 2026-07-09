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

## Field reference

| Key | Values | Meaning |
|-----|--------|---------|
| `teardown_hook` | path (empty = none) | Project script invoked as `timeout 120 <hook> <worktree_path>` **before** `git worktree remove --force` on the success path and on `--gc`. Must realpath-resolve **inside the consuming repo root**, be a regular executable file. Outside-repo paths are refused (no override bypass). Hook failure/timeout is **fail-open** (remove still attempted). Not run from the INT/TERM abort trap. |
| `stale_reaper_age_days` | non-negative integer | Age threshold for `dispatch-hetero.sh --gc`. **`0` = disabled** (default — the reaper logs and exits 0 without enumerating). Age is measured from the marker's `created_at` epoch, not filesystem mtime. Negative age (clock skew) is treated as eligible. |
| `reaper_scope` | `marker-only` | Only worktrees bearing `$WT/.autopilot-worktree` are eligible for routine `--gc`. Unmarked recovery is a separate CLI escape hatch (`--gc --reap-unmarked --yes`, basename `hetero-*` only, still flock-gated). |

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
```

The hook receives the absolute worktree path as `$1` and should reclaim project-owned
resources (root-owned `target/`, named volumes, …) best-effort, then exit 0. See
`docs/plans/2026-07-09-worktree-teardown-seam.md` §4 for a reference implementation.

## Safety rails (harness-enforced; not configurable)

- Per-worktree liveness = `flock -n` on `$WT/.autopilot-worktree.lock` (no pid checks).
- `--gc` never runs `git branch -D` (branch-delete only in the INT/TERM abort trap).
- Global `--gc` serialization via `$TMPDIR/.autopilot-gc.lock`.
- Hook argv-exec only; `$WT` with control characters is refused.
