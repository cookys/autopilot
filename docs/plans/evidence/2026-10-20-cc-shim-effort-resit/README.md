# cc-shim effort re-sit (2026-10-20)

cc-shim only started translating a seat effort into `claude -p --effort` at commit `c313173ca` (merge `6d8e7e77e`, 2026-10-14 12:22Z). Four implementer examinations recorded before that, labelled effort high, actually ran at the CLI default effort:

- claude-haiku-5-5 (scorecard event 203)
- claude-sonnet-5-5 (scorecard event 204)
- claude-opus-5-5 (scorecard event 205)
- MiniMax-M3.1-Flash-Preview (scorecard event 247)

Owner decision 2026-10-20 (card `d-1156e740`): do both things.

## Relabel

The four old rows were relabelled to effort default:

```
node scripts/engine-scorecard.js relabel-effort --to default \
  --event-id 203 --event-id 204 --event-id 205 --event-id 247
```

Reason: effort mislabelled; cc-shim did not forward `--effort` before `c313173ca`; actual effort was the CLI default. Backups sit beside the stores as `.bak-relabel-effort-20261019T182813Z`.

## Re-sit at effort high

The four seats were re-sat at effort high through `scripts/qualification-sweep.sh --execute`, one seat at a time, using the `roster-*.json` files and the `chain.sh` driver in this directory. Identity matches the old records. `harness_version` was kept as in the old record: `dispatch-hetero:aef24416` for the three Claude seats, `dispatch-hetero:7481ead3` for MiniMax. Runner `cc-shim`. Endpoint `anthropic-native` for Claude, `minimax` for MiniMax.

New results (new scorecard event ids; wall time from `chain.log`):

| Seat | Result | Event | Wall |
| --- | --- | --- | --- |
| claude-haiku-5-5 | FAILED 17/24, score 0.708, false_pass_critical 7 | 327 | 525 s |
| claude-sonnet-5-5 | qualified 24/24 | 328 | 485 s |
| claude-opus-5-5 | qualified 24/24 | 329 | 510 s |
| MiniMax-M3.1-Flash-Preview | qualified 24/24 | 330 | 386 s |

Haiku at high failing while the old default-effort row passed is a genuine result.

## Directory layout

- `roster-*.json` — one roster per seat (plus the combined Claude roster) used by the sweep.
- `chain.sh` — driver that sat the seats one at a time.
- `chain.log` — wall-time log for the four runs.
- `argv/claude-wrapper.sh` — a PATH wrapper that logged every `claude` invocation's argv.
- `argv/<seat>.log` — one line per invocation; each line shows `--effort high`.
- `argv/claude-haiku-5-5.early-logs-written-to-cwd.log` — kept because the wrapper first had a bug that wrote part of the haiku log into the working directory. The Stage-0 probe calls of the first seat were not captured.
- `implementer/<seat>-qualify/` — one bundle per seat: `qualify-out.json`, `record-out.json`, error logs, probe receipts, and `raw/` (exchanges, usage, dispatch ledger, seed envelope; MiniMax also has `impl-endpoint.json`).

No credentials are included.
