# skill-onoff — depth-0 skill presence/content instrument

Measures whether a skill's body, loaded as a REAL plugin skill at depth 0 (`--plugin-dir`
routing + loading — NOT prompt injection), changes orchestrator behavior on micro-tasks with
deterministic markers. Built for the dev-flow contract-card rewrite (成績單前置 evidence);
pre-registered rules and claim scoping live in
`docs/plans/_archive/2026/08/2026-08-18-dev-flow-contract-card.md` §3-§4 (FROZEN R2).

## Arms

| Arm | `skills/dev-flow/` in the synthetic plugin |
|---|---|
| `full` | frozen byte-copy of the 713-line SKILL.md + its references tree |
| `card` | frozen 499-line contract-card draft + the card's references tree |
| `off`  | absent (companion catalog still present — controls for "any skills exist") |

Companion roster (finish-flow / quality-pipeline / learn) is byte-identical across arms
(test-asserted). Prompts are byte-identical across arms and carry NO artifacts contract — the
old orchestration-harness ON-arm confound is removed by construction. All packs are
digest-frozen in `packs/manifest.json`; a mismatch is a fatal harness error. Any card edit
invalidates CARD-arm rows (re-run per the frozen rules).

Since the 2026-08-18 P7 quality-gate fix, `packs/dev-flow-full/` is a **historical** freeze of the
body that was measured — it no longer matches the live `skills/dev-flow/SKILL.md`, and must not be
re-synced. The next campaign re-freezes all three arms from scratch.

## Run

```bash
# one cell
bash evals/skill-onoff/run-skill-onoff-eval.sh \
  --task d3-fix-known-bug --arm full --model sonnet --out /tmp/cell
# campaign (resume-by-cell: re-run the same command after interruption)
bash evals/skill-onoff/run-skill-onoff-matrix.sh \
  --model sonnet --reps 3 --results results/primary-sonnet.jsonl
# score (mechanical verdict per the frozen V1/V2/V3 rules)
node evals/skill-onoff/score-onoff.js --results results/primary-sonnet.jsonl
```

Campaign guards (proof: `hooks/tests/skill-onoff-failfast.test.sh`): a cell failing with `authentication` or `quota` stops the matrix at once (exit 4, reason on stderr); fix the cause and re-run the same command. The runner version is pinned in `<results>.runner-pin` on first run (and `DISABLE_AUTOUPDATER=1` is exported for `--runner cc`); a different version before any cell stops the matrix (exit 3). To move to a new version, start a new results file. A results file that predates the pin (no `.runner-pin`) is pinned to the version current at the first run after this change.

Spend-free regression: `hooks/tests/skill-onoff-{eval,markers,score}.test.sh` (stub runner via
`ONOFF_STUB_BIN`; planted red cases — the vacuous FULL==OFF fixture can never reach
SHIP-GATE-MET).

## Generic arms for any skill (mods P1W EVALX)

The `full|card|off` dev-flow arms above are unchanged (regression-pinned byte-for-byte). For a
base-vs-change comparison of ANY skill text (spend-free harness; no live cell is run by the tests):

```bash
# freeze the arms (a frozen pack is never mutated: a changed arm = a NEW pack id)
node evals/skill-onoff/freeze-pack.js --id ceo-agent-base   --skill ceo-agent --ref <pre-change-sha>
node evals/skill-onoff/freeze-pack.js --id ceo-agent-change --skill ceo-agent --ref <post-edit-sha>
# frozen helper scripts (+ transitive relative requires) copied into BOTH arms' fixture repo
node evals/skill-onoff/freeze-pack.js --id fixture-scripts-<row> --scripts scripts/<helper>.js,… --ref <sha>
# campaign (arms default to base,change; resume-by-cell as above)
bash evals/skill-onoff/run-skill-onoff-matrix.sh --model sonnet --reps 5 --results results/<row>.jsonl \
  --tasks <fixtures> --skill <name> --fixture-scripts fixture-scripts-<row> [--with-pack dev-flow=dev-flow-base]
# mechanical verdict from the FROZEN pre-registration (prereg/<row>.json; digests in prereg/FROZEN.json)
node evals/skill-onoff/score-p1w.js --prereg evals/skill-onoff/prereg/<row>.json --results results/<row>.jsonl
```

- `--skill <name> --arm base|change`: the ONLY variable is `skills/<name>/` = the digest-verified
  pack (`<name>-base` / `<name>-change`, or `--pack-base/--pack-change <packs/ dir name>`; an unlisted
  file in a pack is a hard error). Companions are copied except the target. Live freezes shipped:
  `ceo-agent-base`, `finish-flow-base`, `dev-flow-base` (all @ 4641b5d7; `dev-flow-full` stays the
  historical freeze) and `fixture-scripts-base`.
- Per-cell isolation: `AUTOPILOT_LIVE_DIR` / `AUTOPILOT_TASK_STATUS_DIR`
  point under a per-cell state dir on tmpfs (the live-dir resolver REJECTS a non-tmpfs override and
  silently falls through to the real store, so a cell with no writable tmpfs base exits 2 instead of running; the decision-ledger default lives in each fixture repo's git-common-dir); copied to `$OUT/state/`.
- Manipulation check: rows carry `skill_invoked` + `check_skill` (`--skill` implies it).
- Row markers (`lib/p1w-markers.sh`, three-way probed by `hooks/tests/skill-onoff-p1w-markers.test.sh`):
  `a_decision_file` (a1, a1b; control `a_overtrigger` on a2), `b_phase_seq` (d8; d2 via
  `markers-extra.sh`), `c_status_input` (f1, f1b). The helpers under test do not exist on develop yet:
  freeze them into a fixture-scripts pack when their rows land; the decision-file / bundle locations are
  pluggable env knobs documented in the lib header.

## Honesty rails

- **V2 sensitivity gate**: a family where FULL≈OFF is demoted (not counted); if <4 of 5
  families are load-bearing the whole instrument is INSTRUMENT-INVALID — no card verdict is
  recorded from a vacuous instrument (references/evidence-discipline.md "The one question").
- **work_done conjunction**: every marker is ANDed with a task-owned work-completion predicate,
  so a no-op run scores false everywhere (a marker that passes on no-op measures nothing).
- **Paired exclusion**: a cell missing after 3 infra attempts drops that (task,rep) from ALL
  arms; ≥2 lost pairs in a family invalidates the block. Mixed models / runner-version drift
  invalidate the block.
- **Claim scoping**: single-turn, sonnet-class depth-0, five marker families. NOT measured:
  multi-turn scope-creep, Mission Routing Override, forcing-function TaskCreates (headless `-p`
  has no TaskCreate tool — Phase-0 probe evidence in the plan's evidence dir; those blocks are
  KEEP-verbatim pinned so FULL/CARD are byte-identical on them).

## Stage-graph row (dev-flow stage graph, P0 pre-registration)

Spend-free infrastructure for the guidance eval of `docs/plans/2026-10-06-dev-flow-stage-graph.md`:
12 briefs `tasks/stage-graph-*` (answer key `answer.json` per brief, cells in
`hooks/tests/fixtures/stage-graph/expected.json`), per-cell extractor `lib/stage-graph-cell.js` (via each
brief's `markers.sh` + `lib/stage-graph-markers.sh`), aggregate scorer `score-stage-graph.js`, frozen rule
`prereg/stage-graph.{md,json}`, base packs `*-sg-base` + `guidance-files-sg-base`, and the cut gate
`scripts/check-guidance-eval.js`. A prereg may declare `guidance.out_of_arm` (`path`, shipping `commit`, `reason`) for a manifest file no eval arm loads; the gate re-derives that the commit changed that path inside `base..head` and that no arm loads it. Always pass an explicit `--tasks` list (the 12 ids in the prereg) to the
matrix runner. Proof: `hooks/tests/skill-onoff-stage-graph.test.sh`, `hooks/tests/check-guidance-eval.test.sh`.

### Stage-graph P5 arm builder (multi-pack arms, planted-red builder, campaign command)

Spend-free infrastructure for plan §4 P5 item 7 (proof: `hooks/tests/skill-onoff-arm-builder.test.sh`).

- **Arm manifest** (`arms/stage-graph/{base,change,red}.json`, read by `run-skill-onoff-eval.sh --arm-manifest`):
  `{"schema_version":1,"arm":"base|change|red","skills":{"<skill>":"<pack>",…16},"files":"<pack>"|["<pack>",…],
  "fixture_scripts":["<pack>",…]}`. Skill packs install to `skills/<skill>/`, `files` packs (non-skill guidance:
  `references/*.md`, `project-config-template/*.md`) to the plugin ROOT, `fixture_scripts` onto the cell repo before the
  frozen base commit (after any `--fixture-scripts a,b` list; later wins). Every pack is digest-verified `exact`. The
  matrix takes `--arm-manifests <dir> --arms change,red` (one manifest per arm name). The `--skill` arms are untouched.
- **Fixture scripts**: `packs/fixture-scripts-sg` (frozen from release/3.0.0): `session-mode.js`, `stage-advance.js`,
  `stage-graph.js`, `probe-unknown.js`, `classify-diff-risk.sh`, `resolve-review-loop.sh` + libs, `references/stage-graph.json`, schemas.
- **`freeze-guidance-arm.js change [--extra a,b] [--suffix s]`** freezes `<skill>-sg-change` (base tree + the prereg's
  listed files from the working tree), `guidance-files-sg-change` (+ extras) and `guidance-files-sg-extra-base` (extras from
  `guidance.base_ref`). Run it ONLY once the guidance is final; extras need a prereg amendment (the result prints it).
  `base` writes the base arm manifest only when `base.json` is absent (an existing one is never rewritten; delete it by hand to rebuild); `red` builds the planted-red arm. Frozen packs are never mutated; a re-freeze needs `--suffix`.
- **Red arm**: `freeze-guidance-arm.js red [--require-text]` rotates XS<->L, S<->XL (M kept) in (1) the
  `references/stage-graph.json` of every fixture pack (`fixture-scripts-sg-red`): the `base` + `bug` rules swap while `unit_kind` and
  `bump_limits` stay, so the red agent's `stage-graph.js` / `stage-advance.js` serve rotated walks for the size it recorded (re-queried
  and asserted at build time); and (2) best-effort prose in the change packs: size-table stage cells and `- XS: a → b` list lines
  (`-sg-red` packs).
- **Campaign**: `node evals/skill-onoff/run-stage-graph-campaign.js --results evals/skill-onoff/results/stage-graph.jsonl`
  (`--dry-run` prints the cell list + cost estimate; resumable; ends with `score-stage-graph.js`). Generic regression cells
  (7 tasks x base/change) run under the conditions of their original rows (fixture pack, prompt prefix, marker lib) with the sg scripts overlaid.

## stage-graph-g67 (guidance-v7 G6/G7 ON/OFF suite)

Per-task ship rule (ON >= 2/3, OFF <= 1/3) over `g6-l4|l5|l6` (entry `session-mode set` carries `--size`) and `g7-close`
(finish-flow runs `repo-residue-sweep.js close-session … --yes`): `prereg/stage-graph-g67.{md,json}` (DRAFT until frozen),
`run-g67-campaign.js` (`--dry-run`, `--check-arms`, resumable), `score-g67.js`, `lib/g67-cell.js`, arms `arms/g67/`.
`ONOFF_TIMEOUT_IS_COMPLETE=1` (run-skill-onoff-eval.sh) turns a timeout stop into a complete cell (`stopped_by_timeout`).
Amendment 1 (2026-10-10): v1 is instrument-defective for G6 (session-mode.js was absent from the plugin); v2 is a new arm (v8 packs, `fixture-scripts-g67-v2`) with a per-cell plugin-script self-check (`ONOFF_REQUIRE_PLUGIN_SCRIPTS`); post-merge freeze steps in `prereg/stage-graph-g67.json` `fixture_scripts_freeze.post_merge_steps`, finished by `stamp-g67-amendment.js`.
Spend-free proof: `hooks/tests/skill-onoff-g67.test.sh`.

## dc row (dev-flow contract-card rerun, BL-0044 / BL-0049)

The repaired successor of the 2026-08 `full|card|off` instrument. Everything is multi-pack arm manifests (`arms/dc/{full,card,off,red}.json`):
the arms differ only in `skills/dev-flow/` (live body at `87d3fd29c` / its 483-line contract card `dev-flow-dc-card` / absent / planted-red `dev-flow-dc-red`);
`fixture-scripts-dc` (the stage-graph scripts plus all `schemas/`) is in every arm, because without it FULL fails for a reason that is not its prose.
Tasks `tasks/dc-*` (10), helpers `lib/dc-markers.sh` (anchor = first Edit/Write or first `git commit`; headless sonnet edits through Bash), frozen rules `prereg/dc.json`,
scorer `score-dc.js --prereg prereg/dc.json --results <jsonl> [--arms full,off]` (exit 0 SHIP-GATE-MET or V2-PHASE-PASS, 3 ITERATE-CARD, 4 ABORT-RECORD, 5 INSTRUMENT-INVALID).
Every cell needs `ONOFF_PROMPT_PREFIX="Use dev-flow:"` (identical in all arms) or the skill is never invoked. Evidence, rules and results:
`docs/plans/evidence/2026-10-17-bl0044-skill-onoff-rerun/README.md`. Proof: `hooks/tests/skill-onoff-dc-markers.test.sh`, `hooks/tests/skill-onoff-dc-score.test.sh`.
Family F5 (red before edit), F6 (quality gate on M) and I7 (L gates) are informational: reported, never counted toward V2.

## dcard row (pending-decision card text)

Verdict: INSTRUMENT-INVALID (exit 5): V2 failed, ON 0/10 and OFF 0/10 on a_decision_file, V1 10/10 in both arms (explicit invocation preface), excluded pairs 0, a2-within-doa control no over-trigger. NOT-SHIP: the dskill text (dc1f92fb2) must not ship on this evidence. The reason is lack of evidence, not counter-evidence.

The defect is in `run-skill-onoff-eval.sh`: the markers stage runs after the turn-2 block. The turn-2 block starts at line 346 (`if [ -x "$TASK_DIR/turn2.sh" ]`), and the markers call is line 401 (`bash "$TASK_DIR/markers.sh"`, inside the subshell that begins at line 396). `lib/dcard-markers.sh` function `dcard_has_complete` (line 39), called from `dcard_markers` at line 144 via `dcard_decision_files`, reads the decisions file only after turn 2 has closed the card, which makes `a_decision_file` structurally unable to be true. In the usable cells of the two rows (40 in total) `b_card_closed` is true in every one, so the primary indicator could not be measured. The corrected indicator belongs to dcard-v3 and awaits the owner decision d-27318bdc.

The instrument could not measure the primary indicator, so both rows give no conclusion about the text's effect.

Exploratory observation, not a preregistered verdict: the change arm opens complete cards and closes them itself; the base arm opens bare cards and the hook closes them. Secondary counts (not gating): b_close_by_agent 10/10 in change versus 0/10 in base, b_close_by_hook 10/10 in base versus 0/10 in change, b_follows_answer 10/10 and b_card_closed 10/10 in both arms; m_hook_card 0 in all cells (AskUserQuestion never called in headless mode).

Every nohook cell had turn2 `skipped_no_card`, and `dcard_markers` hard-sets all `b_` indicators to false whenever `DCARD_TURN2` is not `ran` (they stay at the false initializer on line 135 unless the `ran` branch at lines 151-158 runs), so the nohook control proves nothing for `b_close_by_hook`. `b_close_by_hook` is only the remainder `b_closed && !b_agent` (line 157), with no positive detection of a hook close. The frozen prereg dcard-v2 field `v2_basis` overstates the control (it cannot be edited because it is frozen).

Incidents: the first campaign pass lost 20 cells to an expired login (infra_fail); the same command was re-run, the harness re-ran the failed cells (attempt 2), no row was edited by hand; the earlier attempt rows stay in the file. Runner pin 2.1.306 unchanged. Total spend about 6.3 USD (slightly above the 6 USD cap because of the re-run).

## dcard-v2 row (revised pending-decision card text)

Verdict: INSTRUMENT-INVALID (V2: on-off = 0 < 6). a_decision_file ON 0/10, OFF 0/10. V1 10/10 in both arms. Excluded pairs 0. The dcard row result is untouched. NOT-SHIP: this text must not ship on this evidence. The reason is lack of evidence, not counter-evidence.

The defect is in `run-skill-onoff-eval.sh`: the markers stage runs after the turn-2 block. The turn-2 block starts at line 346 (`if [ -x "$TASK_DIR/turn2.sh" ]`), and the markers call is line 401 (`bash "$TASK_DIR/markers.sh"`, inside the subshell that begins at line 396). `lib/dcard-markers.sh` function `dcard_has_complete` (line 39), called from `dcard_markers` at line 144 via `dcard_decision_files`, reads the decisions file only after turn 2 has closed the card, which makes `a_decision_file` structurally unable to be true. In the usable cells of the two rows (40 in total) `b_card_closed` is true in every one, so the primary indicator could not be measured. The corrected indicator belongs to dcard-v3 and awaits the owner decision d-27318bdc.

The instrument could not measure the primary indicator, so both rows give no conclusion about the text's effect. Thresholds and the prereg were not changed after the fact.

Exploratory observation, not a preregistered verdict: the change arm opens complete cards and closes them itself; the base arm opens bare cards and the hook closes them. Sampled v2facts commands (not a verdict): four listed change-arm cells called `open-decision.js open` with `--question`, two `--option` values, `--recommendation`, `--why`, and `--not-authorized`; the one listed base-arm cell passed a single bare `--question`. Secondary counts (from `results/dcard-v2.scored.json`, not gating): OFF b_follows_answer 10/10, b_card_closed 10/10, b_close_by_agent 0/10, b_close_by_hook 10/10, m_hook_card 0/10. ON b_follows_answer 10/10, b_card_closed 10/10, b_close_by_agent 10/10, b_close_by_hook 0/10, m_hook_card 0/10.

Control (a2-within-doa, from the run's v2facts): base n=5 fail=0 over=0; change n=5 fail=0 over=0.

Every nohook cell had turn2 `skipped_no_card`, and `dcard_markers` hard-sets all `b_` indicators to false whenever `DCARD_TURN2` is not `ran` (they stay at the false initializer on line 135 unless the `ran` branch at lines 151-158 runs), so the nohook control proves nothing for `b_close_by_hook`. `b_close_by_hook` is only the remainder `b_closed && !b_agent` (line 157), with no positive detection of a hook close. The frozen prereg dcard-v2 field `v2_basis` overstates the control (it cannot be edited because it is frozen). Spend about 5.75 USD, above the 4 USD cap granted for this phase.

## dcard-v3 row (instrument only)

Phase 1: the instrument is fixed and there is no paid run yet. dcard and dcard-v2 stay INSTRUMENT-INVALID and untouched. v3 changes only how the row is measured. `a_decision_file` is computed from a pre-turn-2 snapshot (`$OUT/decisions-pre-turn2/{live,git}`, exported as `DCARD_DECISIONS_PRE_TURN2`), using the same complete-card rule as the frozen library (question, at least two options, recommendation, and why). If that variable is unset or the directory is missing, `a_decision_file` is false. The other markers still read the post-turn-2 state. Tasks that ship `turn2.sh` also record `turn2_exit` (the `turn2.sh` status, 0 when it ran clean). When turn 2 does not run or is skipped (for example the nohook arm: turn 2 prints no body, state skipped_no_card), the snapshot is still taken, and equals the final state. The nohook control only proves `m_hook_card` is absent without the hook pack. It does not prove `b_close_by_hook`, because every nohook cell has turn 2 `skipped_no_card` and all `b_` markers are hard-false there, and `b_close_by_hook` is only the remainder of `b_card_closed` and not `b_close_by_agent`.
