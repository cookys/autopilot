# Stage graph — calling the three scripts

> On-demand reference for dev-flow. Rules (sizes, sequences, loop-backs, bump limits, marker fields) live in
> `references/stage-graph.json` and the plan `docs/plans/2026-10-06-dev-flow-stage-graph.md` §2.7 / §2.9; this
> page only says how to call the scripts and what to do with their exits. Never copy a node sequence from here or
> anywhere else — ask `stage-graph.js`.

## Query — `scripts/stage-graph.js`

| Call | Returns |
|------|---------|
| `node scripts/stage-graph.js nodes --size <S> [--bug] [--urgent] [--high-risk] [--research] [--units N]` | `{nodes, walk, entry, terminal, unit_kind}` — the cell's node set and one full walk |
| `node scripts/stage-graph.js next --from <node> --size <S> [same flags]` | Sorted array of legal next nodes; `implement` in it is the repair / next-unit edge |
| `node scripts/stage-graph.js limits --size <S>` | `{size, files, lines}` — the E1 ceiling (`null` = no limit; equal fits) |
| `node scripts/stage-graph.js validate` | `{ok, errors}` — schema + reachability of the graph file |

`--urgent` without `--high-risk` is urgent-low (code-review after `finish`, terminal), so `next` cannot choose the
move out of an urgent session's last `verify` (Urgent placement). From `research`, `next` needs `--research`.

## Record — `scripts/session-mode.js` and `scripts/stage-advance.js`

- Init: `node scripts/session-mode.js set --size <XS|S|M|L|XL> [--urgent] [--bug] [--base-ref <sha>]` creates the
  marker or merges into it (`level` kept). `base_ref` defaults to the merge-base with the default branch. Size only
  moves up. `node scripts/session-mode.js status` prints the marker.
- Advance: `node scripts/stage-advance.js --to <node> [--unit <phase|deliverable>:<i>/<N>[:<label>]]
  [--review-families a,b]`. `--to <current stage>` is a same-node update (keeps `stage_set_at`); review rails use
  it to record `review_families` from completed seats only.

| Exit | Meaning | Do |
|------|---------|----|
| 0 | Written | Do the node's work |
| 2 | No marker | `session-mode.js set --size …`, then repeat the call |
| 3 | Illegal move or unit-rule violation; stdout `{allowed:false, from, to, legal_next, reason}` | Go to a node in `legal_next`. Never force, never retry the refused `--to`. A first write must target the entry node for (size, bug) |
| 4 | E1 bump required; stdout `{bump_to, files, lines}` | Bump protocol below |
| 5 | Marker has no `size` | `session-mode.js set --size …`, then repeat the call |
| 1 | Usage / unwritable marker | Fix the call; the marker is telemetry, so a persistent failure is reported, not worked around |

## Bump protocol (E1)

Entering `verify` or `qc-gate`, `stage-advance.js` measures the working tree plus untracked non-ignored files
against `base_ref` and compares with `stage-graph.js limits`. Over a limit it writes nothing and exits 4:

```
node scripts/session-mode.js set --size <bump_to>
node scripts/stage-graph.js next --from <current stage> --size <bump_to> [flags]
node scripts/stage-advance.js --to <the forward node from that list>
```

Never retry the original `--to`. Earlier nodes of the new size are not owed retroactively; its downstream review
nodes are, because `next` is computed from where you stand.

## Units

`--unit` is passed on each `implement` of a size whose `unit_kind` is not null (`nodes` prints it): `kind` and
`total` are fixed by the first unit write; the same index repairs, index + 1 starts the next unit; leaving the
loop needs index = total.

## Urgent placement

`high_risk` is sampled by `stage-advance.js` (via `classify-diff-risk.sh` → `resolve-review-loop.sh --field
review_risk`) once, when an urgent session leaves its last `verify`; a sampling failure counts as high. For M, L and XL, do not ask
`next` for this move: attempt `--to code-review` first. Exit 0 ⇒ high risk, normal order; exit 3 with `qc-gate` in
`legal_next` ⇒ urgent-low (advance to `qc-gate`; finish-flow runs the code-review after `finish`). This attempt is
the one deliberate probe, not a retry of a refused move. XS/S: urgency is a mark only — take `next` as usual; no
`code-review` before or after `finish`.

## Writers

Rails write their own nodes: `plan-review` (`dispatch-plan-review.js`), `code-review` (`hetero-review-loop.js`),
`implement` at /l5–/l6 (`engine implement-review`); a failed rail write is fail-open with one stderr line
`stage-advance: <exit> <reason>`. Every other node is written by the prose that runs it. The marker is telemetry
(ADR-0001): gates re-derive from artifacts and never trust a recorded stage.

## Vocabulary check — `scripts/check-stage-vocab.js`

`node scripts/check-stage-vocab.js [--summary]` scans shipped text for old stage ids, the old size names and the
removed marker field; `--repo <consumer-dir>` lists every stale line in a consumer's `.claude/*.md` and backlog
files with its replacement. One JSON object on stdout.
