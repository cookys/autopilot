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
`scripts/check-guidance-eval.js`. Always pass an explicit `--tasks` list (the 12 ids in the prereg) to the
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
  `base` writes the base arm manifest; `red` builds the planted-red arm. Frozen packs are never mutated; a re-freeze needs `--suffix`.
- **Red arm**: `freeze-guidance-arm.js red [--require-text]` rotates XS<->L, S<->XL (M kept) in (1) the
  `references/stage-graph.json` of every fixture pack (`fixture-scripts-sg-red`): the `base` + `bug` rules swap while `unit_kind` and
  `bump_limits` stay, so the red agent's `stage-graph.js` / `stage-advance.js` serve rotated walks for the size it recorded (re-queried
  and asserted at build time); and (2) best-effort prose in the change packs: size-table stage cells and `- XS: a → b` list lines
  (`-sg-red` packs).
- **Campaign**: `node evals/skill-onoff/run-stage-graph-campaign.js --results evals/skill-onoff/results/stage-graph.jsonl`
  (`--dry-run` prints the cell list + cost estimate; resumable; ends with `score-stage-graph.js`). Generic regression cells
  (7 tasks x base/change) run under the conditions of their original rows (fixture pack, prompt prefix, marker lib) with the sg scripts overlaid.
