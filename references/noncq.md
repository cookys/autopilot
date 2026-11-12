# noncq — non-Claude work queue

Lanes put work any engine can do into a per-account queue. When a capacity
pacing file shows a non-Claude pool behind pace and resetting within 24 h, a
drain dispatches queued items to that pool's engine through the existing
read-only rails and returns results to the lane that filed them. An empty
queue is reported; it is never filled with busy-work.

Script: [`scripts/noncq.js`](../scripts/noncq.js). Pool map:
[`scripts/lib/noncq-pools.json`](../scripts/lib/noncq-pools.json).

## Scope of kinds

| kind | Rail | Notes |
|------|------|-------|
| `review-seat1` | `dispatch-review.sh` | Requires `--diff` and `--spec`. Result is findings JSON. |
| `research` | `dispatch-author.sh` | Assembled prompt from brief + accept + inputs. |
| `replay` | `dispatch-author.sh` | Same author path. |
| `data` | `dispatch-author.sh` | Same author path. |
| `draft` | `dispatch-author.sh` | Same author path. |

**No repo mutation.** Drain only invokes the read-only rails
(`dispatch-review.sh` / `dispatch-author.sh`). It never runs
`dispatch-hetero.sh`, never checks out a worktree, and never writes the
consuming repo. Children run with `DISPATCH_DETACH=0` into per-item capture
files so a later drain can reap them.

## Item format

Queue root: `AUTOPILOT_NONCQ_DIR` or `~/.autopilot/noncq` (created `0700`).
Each item lives at `items/<id>/`:

- `item.json` (`0600`, schema `noncq/1`)
- `brief.md`
- optional `inputs/`, `diff.patch`, `spec.md`
- after a run: `result.md`, `receipt.json`, plus transient `rail.stdout` /
  `rail.stderr` / `rail.exit`

`item.json` fields: `id` (`nq-YYYYMMDD-HHMM-<4 hex>`), `lane` (fleet address
`a/b/c`), `kind`, `accept` (non-empty string array), `prefer` (non-empty array
of engine keys from the pool map), `wall_min` (default 20, range 1..60),
`created_at`, `expires_at` (default +72 h), `state`
(`queued|dispatched|done|failed|expired`), `attempts`, `result` (null or
`{status, path, run_id, engine, finished_at}`), `notified`.

Writes go under the queue lock from `scripts/lib/jsonl-store.js`.

## Subcommands

```
scripts/noncq.js add --lane A --kind K --brief F --accept S [--accept S]...
  --prefer k1,k2 [--input F]... [--wall 20m] [--expires 72h]
  [--diff F --spec F]
scripts/noncq.js list [--state S] [--json]
scripts/noncq.js drain --pace <pace.v1.json> [--dry-run] [--json]
```

`add` copies files in and prints the id. Exit 2 on bad input.
`review-seat1` requires `--diff` and `--spec`; other kinds refuse them.

## Drain rules

Pace file schema `capacity.pace/1` with `rows[]`. A pool qualifies only when:

1. its `class` is not `claude` or `scarce`
2. `status === 'ALERT_behind'`
3. `hours_to_reset < 24`
4. `stale === false`
5. the pool name maps to an engine key in `scripts/lib/noncq-pools.json`

Rows that share an engine key (aliases) merge. A pool whose map entry has
`model: null` is skipped with a stderr note (not verified — do not guess a
model id).

Per drain:

1. Expire items past `expires_at`.
2. Reap finished `dispatched` items (parse the rail JSON line).
   - `authored` / `reviewed` → `done` with `result.md` (raw_log content for
     author; findings JSON for review).
   - exit 1/5 or other errors → `attempts+1`, back to `queued`; `failed` at
     2 attempts. Items requeued in this drain are not redispatched until the
     next drain.
3. Per qualifying engine: pick `queued` items whose `prefer` contains the key,
   ordered by prefer rank then `created_at`; respect `max_parallel` counting
   items already `dispatched` for that engine.
4. Dispatch detached: review → `dispatch-review.sh`; other kinds →
   `dispatch-author.sh` with an assembled prompt (brief + acceptance list +
   inlined inputs). Before an endpoint runner, the child shell sources
   `scripts/load-endpoints-env.sh` (never read or print tokens in noncq).
5. Notify lanes (below).
6. Empty report (below).

`--dry-run` prints what would be dispatched / expired / reported; changes
nothing and spawns nothing.

## Notify and empty messages

After reaping, one fleet message per lane:

```
[noncq-result]
<id> done <result path>
<id> failed <result path>
```

Sent with `spawnSync(AUTOPILOT_FLEET_BIN || 'fleet', ['send', lane, msg])`
(30 s timeout, same pattern as `scripts/profile-health.js`). Items are marked
`notified` only on exit 0; a failed send leaves them for the next drain.

For a qualifying engine with no eligible queued item and nothing in flight,
send once:

```
[noncq-empty] <engine> waste_pct_if_unused=<n>
```

to `AUTOPILOT_NONCQ_REPORT_TO` (fallback `AUTOPILOT_PM_ADDRESS`), at most once
per engine per 6 h (stamp file `empty-stamps.json` in the queue root). No
recipient → one stderr line only (still stamped so the cooldown holds).

## Environment knobs

| Knob | Role |
|------|------|
| `AUTOPILOT_NONCQ_DIR` | Queue root (default `~/.autopilot/noncq`). |
| `AUTOPILOT_NONCQ_REPORT_TO` | Recipient for `[noncq-empty]` (falls back to `AUTOPILOT_PM_ADDRESS`). |
| `AUTOPILOT_FLEET_BIN` | Fleet binary for notify / empty (default `fleet`). |
| `AUTOPILOT_NONCQ_RAIL_DIR` | Test seam: directory with stub `dispatch-author.sh` / `dispatch-review.sh`. |
| `AUTOPILOT_NOW` | Test seam: ISO clock for ids, expiry, and empty cooldown. |
