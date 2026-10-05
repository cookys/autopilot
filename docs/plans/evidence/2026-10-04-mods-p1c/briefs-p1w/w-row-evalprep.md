# P1W hand — EVAL-PREP: change texts, packs, smoke (no batches)

Read `w-common.md` first, then `eval-design-guidance-rows.md` (§2 common pre-registration, §3 rows W2a-g, W2b-g, W1b trigger 2, §4 batch plan) and the EVALX report `$P/run-w/evalx/REPORT.md` ("Contracts other rows will consume", "Run commands once a row's helper lands"). Guidance rows are the only place SKILL.md/reference text may change (CLAUDE.md scorecard-first): the text you draft IS the change under test.

Worktree `$P/wt-eval`, branch `w/eval`, created by depth-0 at `w/int3` (297ab2e0: all mechanism rows incl. `open-decision.js` (WATCH-A), `session-mode.js set --phase` + plain markers (PHASE, MARKER), `write-task-status-input.js` (W1b)).

## 1. Change texts — one commit per row, smallest possible edit, boy-scout net lines ≤ 0 elsewhere
- **W2a-g** (`skills/ceo-agent/references/level-front-door.md` "Mid-run question discipline", per design §3 item 1): before depth-0 puts a DOA-boundary question to the owner, it runs `node scripts/open-decision.js open --question … --option … --option … --not-authorized "<why this is beyond DOA>" [--root-run-id …]`, and `close` once answered. One canonical statement; SKILL.md keeps only its pointer.
- **W2b-g** (`skills/dev-flow/SKILL.md`, per design §3: ONE canonical place listing phase names, step headers reference it): call `session-mode.js set --phase <L-n>` at L-1, L-3, L-4, L-5. MARKER semantics (plan R5.6): `set --phase` updates the session's marker and exits 2 when there is none; a plain session in an opted-in repo gets a `level: null` marker at SessionStart; bare `set --level none` is refused while an l3–l6 marker is live. The text must work in all three cases (plain with marker, plain without marker, under /l3–/l6) without the model seeing an error it has to interpret — prove each case with a stub run of the exact command sequence (no model), output under `$P/run-w/eval/stub-*.txt`. S/Fix paths are out of scope (design: undecided) — say so in the commit body.
- **W1b trigger 2** (`skills/finish-flow/…`, per design §3 W1b): after the merge step, run `node scripts/write-task-status-input.js …` (read its usage). Writes only identity + pointers (W1b contract).
Each commit message `docs(<skill>): <what> (mods P1W <row> — guidance under eval)`.

## 2. Packs (per EVALX REPORT commands; `<sha>` = the commit carrying the row's text, helpers already present)
Freeze `ceo-agent-change`, `fixture-scripts-w2a` (open-decision.js + its schema + validate-json-schema.js + decision-ledger.js closure), `dev-flow-change`, `fixture-scripts-w2b` (session-mode.js closure), `finish-flow-change`, `fixture-scripts-w1b`. Commit the manifest entries (one commit). Never re-freeze an existing id.
Decision marker wiring: the decision file lives at `<git-common-dir>/autopilot/decisions/<scope>.json`, not under `$AUTOPILOT_LIVE_DIR`; use `ONOFF_DECISION_VALIDATOR` with `open-decision.js show --json` run in the cell repo (WATCH-A contract). If any pre-registered marker in `evals/skill-onoff/prereg/*.json` cannot be scored as frozen (path, field names, phase regex), do NOT edit the frozen prereg: STOP and report exactly which marker and why (a new prereg is an owner decision).

## 3. Smoke only (design §4 step 2): 2 live cells per row, never counted
W2a a1 (1 base + 1 change), W2b d2 (1 + 1; record whether L-5 is reached and the wall time), W1b f1 (1 + 1; record whether the merge step is reached). Model sonnet, harness defaults from EVALX. Before the first cell: `free -g` and `/proc/loadavg` in the report; run cells sequentially (memory). Stop after the smoke — NO batches. Report per cell: arm, wall time, tokens if the harness records them, each marker value, infra errors.

## Verify
`hooks/tests/skill-onoff-*.test.sh` (spend-free), `node scripts/check-reference-sizes.js` (dev-flow line budget), `validate.sh`, codex sync (skills are mirrored) + `--check`, the profiles hash chain if dev-flow/ceo-agent SKILL.md text changed (use the `profiles-hash-repin` procedure; report what was re-pinned), L1.

## Report
`$P/run-w/eval/REPORT.md`: the three diffs quoted, stub-run evidence, pack ids + digests, smoke table, a go/no-go per row for the batch (reachability, marker sanity), estimated batch spend recomputed from the smoke wall times. Final message: report path, commit SHAs, 5-line summary.
