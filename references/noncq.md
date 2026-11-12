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
- optional `inputs/<basename>` (one file per basename), `diff.patch`, `spec.md`
- after a run: `result.md`, `receipt.json`, plus transient `rail.stdout` /
  `rail.stderr` / `rail.exit`
- after notify: `share/result.md` (`0640`), the copy that was uploaded

`item.json` fields: `id` (`nq-YYYYMMDD-HHMM-<4 hex>`), `lane` (fleet address
`a/b/c`), `kind`, `accept` (non-empty string array), `prefer` (non-empty array
of engine keys from the pool map), `needs_shell` (boolean; true when
`--needs-shell` was passed), `wall_min` (default 20, range 1..60),
`created_at`, `expires_at` (default +72 h), `state`
(`queued|dispatched|done|failed|expired`), `attempts`, `result` (null or
`{status, path, run_id, engine, finished_at}`), `notified`.

Writes go under the queue lock from `scripts/lib/jsonl-store.js`.

## Subcommands

```
scripts/noncq.js add --lane A --kind K --brief F --accept S [--accept S]...
  --prefer k1,k2 [--input F]... [--needs-shell] [--wall 20m] [--expires 72h]
  [--diff F --spec F]
scripts/noncq.js list [--state S] [--json]
scripts/noncq.js drain --pace <pace.v1.json> [--dry-run] [--json]
```

`add` copies files in and prints the id. Exit 2 on bad input.
`review-seat1` requires `--diff` and `--spec`; other kinds refuse them.
Two `--input` paths with the same basename are refused (exit 2); the error
names that basename. Nothing is written for a refused add.

The author prompt is the brief, the acceptance list, and an input list. Each
input is named by its absolute path `items/<id>/inputs/<basename>`, its byte
size and its sha256. The prompt says those files are read-only and must be
opened with the file tools. Input contents are never inlined. At `add`, the
size of that prompt — plus the raw diff and spec bytes for `review-seat1` —
is measured. Over 150000 bytes refuses with exit 2.

`list` prints `needs_shell=true|false`. `--json` includes the field.

## Drain rules

Pace file schema `capacity.pace/1` with `rows[]`. A pool qualifies only when:

1. its `class` is not `claude` or `scarce`
2. `status === 'ALERT_behind'`
3. `hours_to_reset < 24`
4. `stale === false`
5. the pool name maps to an engine key in `scripts/lib/noncq-pools.json`

Rows that share an engine key (aliases) merge. A pool whose map entry has
`model: null` is skipped with a stderr note (not verified — do not guess a
model id). Pool entries may also carry optional `verified_at` (ISO-8601) and
`verified_by` (free text naming the live call) as provenance only; drain does
not read them, and unknown pool keys are not rejected.

Per drain:

1. Expire items past `expires_at`.
2. Reap finished `dispatched` items (parse the rail JSON line).
   - `authored` / `reviewed` → `done` with `result.md` (raw_log content for
     author; findings JSON for review).
   - exit 1/5 or other errors → `attempts+1`, back to `queued`; `failed` at
     2 attempts. Items requeued in this drain are not redispatched until the
     next drain.
   - a failure whose stderr or raw log contains `agy_stdin_ceiling` is
     terminal on that attempt (`failed`, no retry).
3. Per qualifying engine: pick `queued` items whose `prefer` contains the key,
   ordered by prefer rank then `created_at`; respect `max_parallel` counting
   items already `dispatched` for that engine. An item with `needs_shell` is
   not assigned to an engine whose `runner` is `agy`. It stays queued until a
   qualifying non-agy engine from its prefer list has a slot.
4. Dispatch detached: review → `dispatch-review.sh`; other kinds →
   `dispatch-author.sh` with an assembled prompt (brief + acceptance list +
   input path list, not input contents). Before an endpoint runner, the child
   shell sources `scripts/load-endpoints-env.sh` (never read or print tokens
   in noncq).
5. Notify lanes (below).
6. Empty report (below).

`--dry-run` prints what would be dispatched / expired / reported; changes
nothing and spawns nothing.

## Notify and empty messages

After reaping, one fleet message per lane:

```
[noncq-result]
<id> done <result path> ref=<sha256>
<id> failed <result path> upload_failed
```

For each finished item, drain copies `result.md` to
`items/<id>/share/result.md` (mode `0640`) and runs
`<AUTOPILOT_FLEET_BIN> upload <copy> --name <id>-result.md --summary "<id> <outcome>"`.
The printed sha256 becomes `ref=<sha256>` on that line. If the upload fails,
the notice still goes out with the local path and `upload_failed`. Send uses
`spawnSync(AUTOPILOT_FLEET_BIN || 'fleet', ['send', lane, msg])` (30 s timeout,
same pattern as `scripts/profile-health.js`). Items are marked `notified`
only on exit 0; a failed send leaves them for the next drain.

For a qualifying engine with no eligible queued item and nothing in flight,
send once:

```
[noncq-empty] <engine> waste_pct_if_unused=<n>
lane backlog items tagged `noncq-ok`
```

The second line is fixed text naming the suggested source. Drain does not
scan other repos. Recipient is `AUTOPILOT_NONCQ_REPORT_TO` (fallback
`AUTOPILOT_PM_ADDRESS`), at most once per engine per 6 h (stamp file
`empty-stamps.json` in the queue root). No recipient → one stderr line only
(still stamped so the cooldown holds).

## Environment knobs

| Knob | Role |
|------|------|
| `AUTOPILOT_NONCQ_DIR` | Queue root (default `~/.autopilot/noncq`). |
| `AUTOPILOT_NONCQ_REPORT_TO` | Recipient for `[noncq-empty]` (falls back to `AUTOPILOT_PM_ADDRESS`). |
| `AUTOPILOT_FLEET_BIN` | Fleet binary for notify, result upload, and empty reports (default `fleet`). |
| `AUTOPILOT_NONCQ_RAIL_DIR` | Test seam: directory with stub `dispatch-author.sh` / `dispatch-review.sh`. |
| `AUTOPILOT_NOW` | Test seam: ISO clock for ids, expiry, and empty cooldown. |
