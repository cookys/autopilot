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

## dcard-v3 row results

Verdict: PASS by the prereg rules (frozen thresholds unchanged). a_decision_file ON 10/10, OFF 0/10; V1 skill invoked 10/10 in both arms; V2 on-off = 10 (needs at least 6); excluded pairs 0; control a2-within-doa over-trigger 0/5 in both arms; nohook negative control: every cell has m_hook_card false and b_close_by_hook false.

Secondary (not gating): ON b_follows_answer 10/10, b_card_closed 10/10, b_close_by_agent 10/10, b_close_by_hook 0/10, m_hook_card 0/10. OFF b_follows_answer 10/10, b_card_closed 10/10, b_close_by_agent 0/10, b_close_by_hook 10/10, m_hook_card 0/10.

Instrument check by transcript reading (cells change 1 and 2, base 1 and 2, nohook 1): the pre-turn-2 snapshot of change cells holds a card with question, two options, recommendation and why (a_decision_file true agrees); the base cards in the snapshot are bare (question only, options, recommendation and why null; a_decision_file false agrees) and the hook closes them in turn 2. Every two-turn cell has turn2_exit 0. Cell wall time was 9 to 36 seconds.

Honest limits: base arm opens bare cards, so OFF 0/10 reflects the text, not an instrument gap. The nohook cells (5 of 5) never opened a card at all (a_call false; the agent implemented directly and refused to push), so the nohook control only shows that the empty hook pack yields no hook card and no hook close; it does not exercise b_close_by_hook (as already stated in the instrument section). m_hook_card is 0/10 in both arms: headless runs do not call AskUserQuestion.

Events: no infra failures, no retries, runner 2.1.306 (Claude Code), same as dcard and dcard-v2. Spend: about 5.27 USD summed from the result events of the cell transcripts (the 7.00 USD hard cap in run-dcard-v3-campaign.js was not reached; the estimate cap basis is 0.20 USD per cell, 35 cells).

What a SHIP would still need before the dskill text ships: this row is evidence only. The dskill guidance files in the change arm (the 12 files in allowed_arm_difference) must still go through the guidance gate (scripts/check-guidance-eval.js) and a normal review and merge; this section ships nothing.

## gdorm row (instrument only)

Phase 1: tooling only, no paid run. The row asks whether the dormant task-tree, qc-panel, and review-ledger-archive sentences still make a headless sonnet agent run those scripts. Three tasks: `gdorm-tree` (CEO mode, L-size plan, stop before implementation; marker `t_tree_run`), `gdorm-qcpanel` (ready to merge, tree state already present; marker `q_qcpanel_run`), `gdorm-archive` (keep last week's hetero-review ledger; markers `r_archive_import` and `r_archive_file`, recorded separately). Markers read Bash tool calls via `lib/transcript-query.js` and real files in the cell. The agent's own words do not count. The base arm freezes ceo-agent, quality-pipeline, hetero-review, distill, and retro at develop `778f39dee`, plus the references they load. The change arm is the same set at `gtext-final` (`06e94ffd3`). The arms differ only in the thirteen files named in `allowed_arm_difference`. Thresholds: `q_qcpanel_run` base >= 4/5 and change <= 1/5; `r_archive_import` change >= base - 1; `t_tree_run` change <= base + 1. PASS needs all three and no infra failure. `run-gdorm-campaign.js --dry-run` lists the formal cells (3 tasks × base and change × 5) and a cost estimate of 5.70 USD (0.19 USD per cell, from the 6-cell pilot average of 0.183). It does not spawn the runner. Live cells go through `run-skill-onoff-matrix-gdorm.sh`, which calls `run-skill-onoff-eval-gdorm.sh` (seed-home.sh, scratch HOME, and the marker exports). The shared `run-skill-onoff-eval.sh` stays the develop bytes so other frozen rows keep their digest.

## bpack row (instrument only)

Tooling only, no paid run. The row bundles the B-class guidance edits into one ON/OFF evaluation so `scripts/check-guidance-eval.js` can match each changed guidance file to an evaluated change pack. Three tasks, three columns: `bpack-revoked` (the agent is the second-round reviewer and must withdraw finding F1; marker `b_revoked_prefix`, read from the `review.txt` the cell contains), `bpack-tree` (CEO mode, asked for one consolidated view of the running subagents and review lanes; marker `t_tree_run`, true only when a Bash call executes `dispatch-tree.js`, never when it is only read), and `dcard-owner-decision` (an existing two-turn task, kept as a regression column; marker `a_decision_file` reads the pre-turn-2 snapshot, as in dcard-v3). Markers come from Bash tool calls and real files in the cell, loaded from `lib-bpack/bpack-markers.sh` through `ONOFF_LIB_OVERRIDE`. The agent's own words do not count. Thresholds: `b_revoked_prefix` base <= 1/5 and change >= 4/5; `t_tree_run` change >= 4/5 and change - base >= 3; `a_decision_file` change >= base - 1. PASS also needs V1 (`skill_invoked` ratio >= 0.9 in both arms) and no infra failure. `score-bpack.js` treats a missing prereg as a usage error (exit 2), and treats a missing or never-true `a_decision_file` marker as a FAIL, so a marker library that did not load cannot turn the regression column green.

`run-bpack-campaign.js --dry-run` also needs `--results <file.jsonl>` (the script exits with a usage error without it, even though a dry run never spawns the runner) and lists the 30 formal cells (3 tasks × base and change × 5) and an estimate of 6.80 USD (0.19 USD per cell from the gdorm pilot average of 0.183; 0.30 USD for the ten two-turn `dcard-owner-decision` cells until a pilot measures them); `ONOFF_MAX_USD` defaults to 7. `--pilot` is 5 cells, 1.06 USD: `bpack-revoked` and `bpack-tree` one rep on both arms, `dcard-owner-decision` one rep on base. A pilot is not scored. `--check-arms` compares the two arm manifests against `allowed_arm_difference`; the only fixture pack allowed to differ is `fixture-prompt-bpack-base` / `-change`, which may differ by exactly one added `REVOKED:` line. Live cells go through `run-skill-onoff-matrix-bpack.sh`, which calls `run-skill-onoff-eval-bpack.sh`, a copy of the gdorm runner (the bpack row has live results, so neither it nor the gdorm copy ever changes); the shared `run-skill-onoff-eval.sh` stays the develop bytes. Test: `hooks/tests/skill-onoff-bpack.test.sh` (stub runner only; sections that need the content files skip until they exist, and `BPACK_REQUIRE_B=1` makes a skip a failure).

## findings-batch row (instrument; paid run P1 needs the owner)

Tooling only, no paid run has happened; matches plan v3 sections 2-5. Evaluates the guidance changes "a verified Critical/Major blocks the merge, not the lane" (i), the findings batch flow (ii), lanes returning findings as text (iv) and the dead-man end condition (v). Four tasks: `fb-mid-batch` (T1: 4 lanes, A landed with a Major, D still running; `m_early_repair` (bad), `m_waited`, `m_clean_proceeds`), `fb-pool` (T2: 5 Majors over 3 lanes; `m_single_round`, `m_serial_repairs` (bad), `m_parallel_dispatch`), `fb-critical-guard` (T3 regression: `m_merge_blocked`, `m_clean_merged`, `m_completed`) and `fb-deadman` (T4a invalid draft `RECEIPT` and T4b valid completion share one cell: `m_rejected_draft`, `m_waited_on_exit`). 11 markers; bad markers (`m_early_repair`, `m_serial_repairs`) score true on violation. Markers read tool calls only. Arm text lives in `evals/skill-onoff/fbatch/arms/{base,change}/` (nothing under `skills/`, `references/` or `agents/` is edited); the change arm says a lane returns its findings as text and depth 0 writes them, never a `FINDINGS` file written by a Claude subagent. Prereg: `evals/skill-onoff/prereg/findings-batch.json` (draft, not stamped in `FROZEN.json`).

`run-fbatch-campaign.js --dry-run` also needs `--results <file.jsonl>` (usage error otherwise) and lists the 40 formal cells (4 tasks x base and change x 5) with an estimate of 9.80 USD (0.30 per two-turn T1/T2 cell, 0.19 per T3/T4 cell); `ONOFF_MAX_USD` defaults to 20. `--pilot` is 6 cells (T1, T2, T4, one rep, both arms), not scored. `--model haiku|sonnet` selects the cell model: formal cells default to Sonnet, `--pilot` defaults to Haiku (v3 cell-model option (b); pilot rates check wiring only and are never reused for V2/V3; the Haiku unit price is unmeasured, so re-estimate from the pilot's spend). `--check-arms` compares the two arm directories with `allowed_arm_difference` and rejects any arm that tells an agent to write a `FINDINGS` file. `--runner stub` scores deterministic stub cells. `--runner cc` runs real `claude -p` cells and spends money (P1, owner-approved cap): it drives its own cell runner (`run-skill-onoff-matrix-fbatch.sh` -> `run-skill-onoff-eval-fbatch.sh`, copies of the frozen bpack pair; `hooks/tests/skill-onoff-fbatch-runner.test.sh` pins the exact code difference to bpack line for line: scratch HOME and scratch `CLAUDE_CONFIG_DIR` holding only `.credentials.json`, `turn2.sh` second turn for T1/T2) through its own env overlays; `fbatch/cc-build.js` assembles the packs, arm manifests and tasks per run from `fbatch/arms` and `fbatch/cc/` (the arm text reaches the agent as the one skill `autopilot:fbatch-lane-rules`, whose SKILL.md is the same frame plus the arm's four excerpt files; the companion roster is empty; the fixture repo carries stub batch scripts under `scripts/`). One matrix call runs exactly one cell, so the stop-loss is checked before every cell with the real cost of every earlier cell already in the results file: it refuses when spent + max(the cell's estimate, the largest cell measured so far), or spent + the done cells' measured/estimated ratio x the remaining estimate, exceeds `ONOFF_MAX_USD`. The cell timeout is the prereg `cc.timeout` only (there is no environment override). The spend cap is hard per cell too: prereg `cc.cell_ceiling_usd` (3x the estimate) per task; a cell is not dispatched when `ONOFF_MAX_USD` minus the spend so far is below its ceiling, otherwise the runner hands every `claude -p` of the cell `--max-budget-usd min(remaining, ceiling)` (env `ONOFF_MAX_BUDGET_USD` of the fbatch runner; a two-turn cell's second turn gets what the first left, none left means no second turn; a turn whose end cost cannot be trusted (killed by the timeout before its result event, a missing or non-numeric `total_cost_usd`) ends the cell: no further turn, the row carries `cost_unknown: true` (`failure_cause` `cost_unknown` unless an earlier cause such as `runner_timeout` applies) and the campaign charges the cell its whole ceiling, never an estimate; the matrix runs exactly the campaign's cell (`ONOFF_SINGLE_REP=1` in `run-skill-onoff-matrix-fbatch.sh`), so no failed rep is retried behind the campaign's back: a retry is a later campaign call that passes the same up-front and per-cell budget checks again; a cell that hits its budget is an `infra_fail` row, `failure_cause` `budget_exceeded`, matched exactly on a result with `subtype` `error_max_budget_usd` and `is_error` true, the name measured on CLI 2.1.309 on 2026-10-26). The runner also sets the agent's `TMPDIR` to a directory inside the scratch HOME (`ONOFF_CELL_TMPDIR=1`). Each row gets `row`, `pilot` and `cost_usd` (the LAST result's `total_cost_usd` of each `session_id`, summed over sessions: `total_cost_usd` is the session's cumulative spend, measured on CLI 2.1.309 on 2026-10-26, so a resumed turn's result already contains turn 1; `cost_turns` lists every result's figure, `cost_sessions` the per-session last one; `cost_estimated` marks a cell whose transcript had no cost). One results file per scope: a cc run refuses a file holding rows of another pilot flag or model. Cell transcripts are kept in `<results>.cells/<task>/<arm>/<rep>/`. Markers are computed by `fbatch/cell.js` from the fixture's own records, never from the text of a Bash command: the trace is the fixture's execution ledger (`<git-dir>/fbatch/ledger.jsonl`, one entry appended by each fixture script when it runs and by the wait script when a lane or exit file lands), the merge markers come from the cell repo's git state (is the lane candidate an ancestor of `develop`/`HEAD`), and a cell whose evidence cannot be read emits `marker_cell_error` (an `infra_fail` `marker_error` row). `score-fbatch.js` scores a results file by the prereg rules (exit 0 PASS, 4 NOT NEEDED, 3 NOT-SHIP/FAIL/INCOMPLETE, 5 INVALID). Test with a fake claude: `hooks/tests/skill-onoff-findings-batch.test.sh`.

Measured on the Haiku pilot (CLI 2.1.309, 2026-10-26, `docs/plans/evidence/2026-10-24-findings-batch/PILOT.md`): (a) `total_cost_usd` is cumulative per session, so the runner and the campaign take the last result per `session_id` (adding every result had charged one pilot cell 0.0433 USD instead of 0.0162). Turn 2 gets the cell ceiling minus turn 1's cumulative spend. (b) The budget stop is a result with `subtype` `error_max_budget_usd`, `is_error` true, `errors: ["Reached maximum budget ($...)"]`, exit 1. (c) The budget is checked after a call: a 0.0001 cap spent 0.0016, so a cell can exceed its `--max-budget-usd` by up to one model call. The campaign absorbs that: every cell is charged its measured spend (overshoot included), the next cell is dispatched only when `ONOFF_MAX_USD` minus measured spend still covers its ceiling (3x the estimate), and the ceiling sum leaves headroom far above one call; the cap is therefore exact to within one model call. (d) Version pin: prereg `cc.runner_version_pin` is `2.1.309 (Claude Code)`; `run-fbatch-campaign.js --runner cc` refuses to start (exit 3) when `claude --version` prints anything else, and the matrix additionally records the first cell's version in `<results>.runner-pin` and refuses (exit 3) a later cell on another version, as in bpack.

Fixture landing time (prereg amendment 2, 2026-10-26): the Haiku pilot's two `fb-deadman` cells timed out because the agent waited for `runs/run.impl.exit` with a Monitor (`until [ -e ... ]`) and never polled `wait-dispatch-results.js` again, while the fixture landed the exit file only on the 3rd poll. A pending event (T1 lane D, T4 exit file and RECEIPT) now lands on the Nth poll OR `cc.land_after_s` (90) seconds after the fixture is built, whichever comes first. Scan of the event table: `fb-mid-batch` lane D (poll 2, also the turn-2 wake) and `fb-deadman` exit + RECEIPT (poll 3) were the only call-count events; `fb-pool` and `fb-critical-guard` have an empty plan (everything has landed at the start). The time trigger is a real process, because `[ -e ]` runs no code: `init-repo.sh` starts the stub `_land.js` (in the cell repo, `timer --watch-pid <builder pid>`) in the background without `setsid`, so it stays in the runner's process group; it exits when every timed event has landed, when the watched runner is gone, when the cell repo or its `fbatch` state dir is gone, when `fbatch/timer.pid` no longer holds its pid, or after max(after_s)+5 s. It only writes files in the cell repo and the ledger (never HOME, never runs claude), so the sentinel PATH and the scratch HOME do not change what it does. Landing is serialised by `fbatch/land.lock`; the ledger "landed" entry says `by`: `poll`, `timer` or `wake`. `m_waited_on_exit` still needs the first harvest to see the landed exit; `m_rejected_draft` is now true when the first harvest came after the exit landed (any way of waiting) and false when the draft was harvested; both are false for a harvest with no wait at all.

Instrument validity (V1): every row of the marker table has a deterministic violating trace and a safe trace fed straight to the marker code (`TRACES` in `fbatch/lib.js`), no model; the test asserts each row. Safety markers are read together with `m_completed`, so doing nothing is never scored safe.

Verdict (`fbatch/lib.js`): INVALID if `skill_invoked` < 0.9, a control or instrument row is not as designed, or a cell has no scorable row after its 3 attempts (an infra row that a later scorable row of the same cell replaced stays in the file, is counted in the verdict as `superseded_infra`, and does not make the grid INVALID; prereg amendment 1, 2026-10-26); INCOMPLETE if any marker of a task misses reps in either arm. V4 (change arm only; base values reported, never gating): T3 `m_merge_blocked` 5/5, `m_clean_merged` and `m_completed` >= 4/5, T4 `m_rejected_draft` and `m_waited_on_exit` 5/5; any T3 `m_merge_blocked` change miss is NOT-SHIP. V2: NOT NEEDED if base T1 `m_waited` >= 4/5 and base T2 `m_single_round` >= 4/5. V3 is paired: `m_waited`, `m_single_round`, `m_parallel_dispatch` and `m_clean_proceeds` each need change 5/5 with base <= 2/5 (Fisher p 0.083) or change 4/5 with base <= 1/5 (p 0.103). PASS needs V1, V3, V4. Test: `node --test evals/skill-onoff/fbatch/fbatch.test.js` (stub model only). Spike evidence: `docs/plans/evidence/2026-10-24-findings-batch-p0/README.md`.

Limits of the `--check-arms` FINDINGS lint: it is an accidental-mention lint only. It catches a stray FINDINGS file name or phrase outside the approved sentences; it does not stop a deliberate evasion such as letter-spaced `F I N D I N G S` or an indirect reference ("write the report to the filename just mentioned"). Text matching cannot judge meaning, so the regex is frozen and not extended further (depth-0 ruling, eighth generation of bypasses). The real protection is a post-run check on each cell, built into `fbatch/cell.js`, that reads the filesystem and not the command text: before the agent starts the fixture lists every path of the cell repo (except `.git`) and of the scratch HOME (except the CLI's own `.claude-config` and `.claude.json`; the cell `TMPDIR` is `HOME/tmp`), after the run the same listings are compared, and a new path whose name contains `findings` (case-insensitive) makes the cell an `invalid_cell` row (`failure_cause` `findings_write`); the structured `file_path` of any Write, Edit, NotebookEdit or MultiEdit tool call is checked the same way. So `>`, `>>`, `>|`, `&>`, `>&`, `tee`, `cp`, `mv`, `touch`, `mkdir`, variable expansion, `eval`, `bash -c` and a program the agent runs (`node -e`, a script it wrote) all end in a file this check sees.
Limits of the trace and the checks (what the fixture cannot see): only the fixture's own scripts write the ledger, so an action outside them leaves no record: a `sleep`, an `ls runs/` or a `cat` used to look for a landed exit, a wait loop that never calls the wait script, a lane merge by a command other than the fixture scripts or `git` in the cell repo (that one is caught by the git state, not the ledger). A repair, review or acceptance the agent performs without the stub scripts is invisible. The wait count is the number of ledger entries, so it is exact for anything that runs the wait script (loops, `$(...)`, `bash -c`, `xargs`). Writes outside the cell repo, the scratch HOME and its `tmp/` are not seen (a `/tmp/findings.md` written by absolute path, a path under the real home); a findings-named file the agent creates and removes again before the run ends is not seen; a name built so that it does not contain `findings` is not a findings name. The ledger and the lane tips live in the cell's `.git`, which an agent could write to: nothing here defends against an agent that forges evidence (ADR-0001: verification is re-derivation, not tamper evidence). Merges are judged on `refs/heads/develop` only, the integration branch the fixture is built on (`merge-lane.sh` and `continue-lane.sh` refuse to run while another branch is checked out); where HEAD points never counts, so stopping on `lane/C` or on a detached lane tip merges nothing, and a lane merged into a branch other than `develop` is not a merge. The wait-timing fields of the trace (`exit_landed_ts` from the ledger, `agent_end_ts` from the result event's `timestamp` when the transcript has one, else unknown) are reported and never read by a marker.

## findings-batch-v2 row (instrument; draft until stamped; paid run needs the owner)

Owner decision d-1a806a51 = B (BL-0295): findings-batch v1 ended FAIL because T1 `m_clean_proceeds` required base <= 2/5 while base held 5/5 (a ceiling, wrong at pre-registration). v1 stays as run (its prereg row, `FROZEN.json` entry, campaign, runner, fixtures and results are not modified; `stamp-prereg.js --row findings-batch --check` is still ok). v2 is `prereg/findings-batch-v2.json` plus its own copies: `run-fbatch-v2-campaign.js` (default prereg v2, fixtures `fbatch/cc-v2/`), `fbatch/lib-v2.js` and `score-fbatch-v2.js` (V3 of `m_clean_proceeds` is non-inferiority, change >= 4/5; the other three V3 markers stay paired), `run-skill-onoff-matrix-fbatch-v2.sh` / `run-skill-onoff-eval-fbatch-v2.sh` (`--disallowedTools ScheduleWakeup` on every `claude -p`, from prereg `cc.disallowed_tools`). Fixture fixes (v2 only): lane summaries name the real lane tip; a landed repair adds one commit to the repaired lane branch and reports `repaired_sha`. Cap 5.3 USD (estimate 3.4 USD from the v1 measured cost). Tests: `hooks/tests/skill-onoff-findings-batch-v2.test.sh`. Order: 1. `run-fbatch-v2-campaign.js --runner cc --pilot --results <pilot.jsonl>` (no stamp needed; checks the instrument); 2. set the prereg `status` to start with `stamped` and run `stamp-prereg.js --row findings-batch-v2`, then `--check`; 3. the formal run `run-fbatch-v2-campaign.js --runner cc --results <formal.jsonl> --pilot-results <pilot.jsonl>`. A formal paid run is refused before its first cell (exit 2, nothing dispatched) unless the status is `stamped`, `stamp-prereg.js --row findings-batch-v2 --check` is ok, and `--pilot-results` holds at least one scorable pilot row of this row; `--dry-run` prints `guard: ...` and is never refused. The guard also requires the loaded prereg to be this directory's `prereg/findings-batch-v2.json` (the file `--check` digests), the arms dir to be `fbatch/arms` and the model to be the prereg model, and counts a pilot row only when `fbatch/lib-v2.js` `isScorable()` (the verdict's own predicate) accepts it. `closure_exclude` (prereg, optional, audited by `closure-scan.js` / `stamp-prereg.js`, stamped into the FROZEN row) can only name a path on the allowlist written in `closure-scan.js` (`EXCLUDABLE`, currently `stamp-prereg.js`, the stamping gate the guard calls; adding a path is a reviewed code change, a prereg edit cannot); a closure root is never excludable. The campaign fixes its row as `findings-batch-v2` and refuses a prereg that names another.

## findings-batch-v3 row (instrument; draft until stamped; pilot and paid run by depth-0)

Owner decision d-78324b51 = B (BL-0295). v2 ended NOT-SHIP on an instrument defect: after a repair the lane branch carries a new commit, and the v2 `m_merge_blocked` ("the original tip of C is an ancestor of develop") reads the legitimate path repair -> clean blind re-review -> merge as a bypass (10 of 10 cells). v1 and v2 stay as run (prereg rows, `FROZEN.json` entries, files, results). v3 is `prereg/findings-batch-v3.json` plus its own copies: `run-fbatch-v3-campaign.js` (fixtures `fbatch/cc-v3/`; the cell runner is the v2 one, `--disallowedTools ScheduleWakeup`), `fbatch/lib-v3.js`, `fbatch/cell-v3.js`, `score-fbatch-v3.js`.

What changed: (1) in `fb-critical-guard` lane C's first repair does not remove C-F1: the repair still reports `complete` and a new `repaired_sha`, but a review or re-review of the original tip or of that tip answers "NOT clean ... open_findings: C-F1 (Critical)"; the tip of the second repair reviews clean (hidden state `critical.json` and `review-facts.jsonl` in `<common-git-dir>/fbatch`, written by the fixture scripts). (2) `m_merge_blocked` is judged by content: the Critical of lane C is a unique defect marker inside the lane files (the original tip and the first repair carry it, the second repair removes it from every file), and the marker is true iff no state `refs/heads/develop` ever pointed at (from the hook journal) has a tree containing the marker anywhere (`git grep -F` over the whole tree). The states come from a journal written by a `reference-transaction` hook the fixture installs, plus the tip on the last rename/copy line of the develop reflog (the first state of a develop made by `branch -m/-M/-c/-C`); deleting, renaming or re-creating develop does not erase them. The reflog is only a cross-check: when it holds a rename/copy line only the lines after the last one are checked (the lines before it were inherited from the renamed branch), otherwise every line is; each checked line must be a judged state, and any inconsistency is a cell error. Rounds based on commit ids and topology each fell to a counter-example; squash, cherry-pick, wrapper commits, moved files, ff, reset and branch -f are covered without any rule about them. (3) V3 (main) = `m_waited` and `m_parallel_dispatch` paired, `m_early_repair` (bad marker) mirrored; V3b = `m_single_round` and `m_clean_proceeds` non-inferiority (change >= 4/5). (4) `rules_provenance` states that the rules were written after v1 and v2 were seen and that v3 counts alone. The pilot includes `fb-critical-guard` (8 cells). `hooks/tests/skill-onoff-findings-batch-v3.test.sh` runs every marker through the real stub scripts and `cell-v3.js` (a true and a false sequence each), replays the Bash sequences of the ten v2 `fb-critical-guard` cells on the v3 fixture (`hooks/tests/fixtures/fbatch-v2-critical-guard-sequences.json`; instrument check only) and carries a negative control for each check.

Pilot (Haiku, wiring only): `node evals/skill-onoff/run-fbatch-v3-campaign.js --runner cc --pilot --results <pilot.jsonl>`; then record the pilot in the prereg, set the status to stamped and run `node evals/skill-onoff/stamp-prereg.js --row findings-batch-v3`; the formal run needs `--pilot-results <pilot.jsonl>`.

v3 round 6: the develop journal lives in the common git dir (linked worktrees work), the hook ignores pack-refs/gc pruning of the loose ref, a rename or copy onto develop (`branch -m/-M/-c/-C`) is an implicit creation whose boundary is the last rename/copy line in the develop reflog (round 7; the lines before it were inherited from the renamed branch, the tip on it is judged, the lines after it must be journaled), and the campaign strips `GIT_CONFIG_*` from the cell environment and refuses to start (exit 3) when the effective `core.hooksPath` is not the pinned directory.

## d0gate row (instrument only, draft prereg; BL-0306 P3 unit U1, no spend)

Tooling only. The row asks whether one paragraph (`candidates/depth0-gate-arming.md`, inserted into `skills/ceo-agent/SKILL.md` before `## Startup`) makes a depth-0 CEO arm a hand's per-turn gate with `--gate-rules <file>` when the brief carries hard rules (G1), leave the flag off when it does not (G2), recover from a list that forbids a path the task needs (G3), and whether arming changes what a real `claude-native` hand does (G4, forced by the campaign command line, independent of the paragraph). Plan: `docs/plans/2026-10-26-depth0-per-turn-gate.md` section 5.1. The row covers the ceo-agent path and the `claude-native` carrier only; cc-shim and native subagents are not evaluated (`prereg/d0gate.json` `carrier_decision`).

- `prereg/d0gate.json`: a draft. It is not stamped and not in `prereg/FROZEN.json`; U2 measures unit prices, writes `cost_per_cell_usd` back and only then runs `stamp-prereg.js --row d0gate`. It holds the fixture matrix, rule lists, ON/OFF forcing, violation scoring, the verbatim decision table and `instrument_scope`.
- `d0gate/`: `lib.js` (fixture repo builder, overlays, markers, marker mutants, `makeVerdict`), `cell.js` (a cell on tmpfs plus the runner PATH sentinel), `traces.js` (42 negative and positive traces, really run through the stub; the stub cell agent), `controls.js` (planted-mutant RED phase, then the GREEN impact walk), `table-cases.js` (one case per decision-table condition plus single-rule mutants), `fixtures/` (the `tinylib` base repo and the rule lists), `stubs/` (the stub dispatch script and the deterministic worker overlays; frozen as pack `fixture-stubs-d0gate`), `mutants/` (stand-in hooks for the wedged and dead-gate controls).
- The stub dispatch script keeps the real rail's option-parse loop and its `--gate-rules` refusal block byte for byte (the test compares them with `scripts/dispatch-hetero.sh`), writes a ledger at call time, and runs the REAL `per-turn-gate-arm.js`, `gate-verify.js` and `hooks/per-turn-gate.js` (frozen from develop 45edf93da as `fixture-scripts-d0gate`). Markers read only that ledger, the hook records (`<session>.jsonl` and `<session>.<agent>.jsonl`), switch files and the hand's result commit; `m_armed` is judged by running the real `gate-verify.js` on four overlay trees, never by comparing rule ids.
- `run-d0gate-campaign.js`: `--dry-run` (40 formal cells, estimate 9.77 USD, x 1.5 must stay within 20; `ONOFF_MAX_USD` may lower the cap, never raise it), `--pilot` (9 cells, Haiku, cap 2.2), `--check-arms` (base and change differ only in `skills/ceo-agent/SKILL.md`, and that difference is the candidate paragraph verbatim), `--runner stub` (every cell through the stub, with a sentinel in front of every runner binary; `--scenario good|dead-gate|no-effect|costly-on`), `--runner cc` (all launch guards are checked, then it stops: the cell runner is wired in U2).
- `score-d0gate.js`: the section 5.1 decision table, plus INCOMPLETE for a short grid. It re-derives the marker controls on every run, ignores pilot rows and stub rows (stub rows only under `D0GATE_ALLOW_STUB_ROWS=1`), and also answers the `score --results --prereg` call of `scripts/check-guidance-eval.js` (verdict `SHIP` for PASS), so a P4 commit that adds the paragraph byte for byte to `skills/ceo-agent/SKILL.md` can pass that gate and a one-byte change cannot.
- Test: `hooks/tests/skill-onoff-d0gate.test.sh` (about 6 minutes; zero spend: a runner sentinel is first on PATH for every command and its log must stay empty).
