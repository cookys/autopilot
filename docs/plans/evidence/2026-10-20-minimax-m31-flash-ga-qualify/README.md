# MiniMax-M3.1-Flash GA qualify (2026-10-20)

MiniMax released M3.1 Flash GA on 2026-10-19. The API, the M Plan, and MiniMax Code opened at once. Source: https://www.minimax.io/blog/minimax-m31f

Scorecard event 330 (cc-shim, implementer, effort high, 24/24) was sat that same day under the Preview model name `MiniMax-M3.1-Flash-Preview`. Which weights answered that name cannot be confirmed. Owner decision (card `d-887e4f1d`): sit the GA name as its own seat; leave event 330 under the Preview name, annotated, never deleted or changed.

## Recipe

Roster: `roster-m31.json`. One seat, slug and model `MiniMax-M3.1-Flash` (sent verbatim), runner `cc-shim`, family `minimax`, endpoint `minimax`, effort `high`, `version_source` `operator-asserted`. `harness_version` is `dispatch-hetero:7481ead3`, kept equal to event 330 for comparability.

Sweep:

```
bash scripts/qualification-sweep.sh --roster roster-m31.json --execute --yes
```

The recorded driver is `chain.sh`. It unsets `AUTOPILOT_SESSION_ID` and `CLAUDE_CODE_SESSION_ID`, puts a PATH wrapper ahead of `claude`, and runs that sweep. The wrapper appends every invocation to an absolute log path (`argv/m31ga.log` at exam time, copied here as `argv/MiniMax-M3.1-Flash.log`). The driver was launched detached with `setsid` and `nohup`.

## Argv evidence

`argv/MiniMax-M3.1-Flash.log` has 26 lines. One line is the `claude --version` call. The other 25 are the Stage-0 probe plus the 24 cases. Each of those 25 carries `--effort high` and `--model MiniMax-M3.1-Flash`.

A minimal call to the minimax endpoint with model `MiniMax-M3.1-Flash` returned a response whose `model` field is `MiniMax-M3.1-Flash`. The id and the signature are masked. The masked response is `model-id-probe.txt`.

## Results

Qualified. `corpus_pass` 24/24, `false_pass_critical` 0, `integrity_violations` 0. Scorecard event 331. Evidence-store event 494. Runner version 2.1.303 (Claude Code). Wall time: 665 s for the whole sweep (probe plus 24 cases plus record); 640 s of case wall time (`chain.log` and `record-out.json`).

The sweep progress line printed `row-parse-error` for the seat. This is cosmetic. The sweep builds the bundle path as PWD plus the bundle, and the bundle root was an absolute path outside the repo. The record step itself exited 0 (`record-err.log` begins `RECORD_EXIT=0`) and the row is in the real store as event 331.

## Directory layout

- `roster-m31.json` — the seat roster, with `evidence_root` rewritten to this directory's `implementer/`.
- `chain.sh` — the driver, copied as recorded (absolute scratchpad paths kept).
- `chain.log` — start, end, exit code, and the 665 s wall time.
- `argv/MiniMax-M3.1-Flash.log` — one line per `claude` invocation.
- `model-id-probe.txt` — masked endpoint response showing model `MiniMax-M3.1-Flash`.
- `implementer/MiniMax-M3.1-Flash-qualify/` — the bundle: `qualify-out.json`, `record-out.json`, `probe-receipts.jsonl`, error logs, and `raw/`.

No credentials are included.
