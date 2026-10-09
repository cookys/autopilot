# Pre-registration — stage-graph-g67 (row `stage-graph-g67`)

**Status: DRAFT FOR REVIEW. Not frozen.** No `FROZEN.json` entry exists, the two arm-manifest shas are unset, the v7 packs
and `fixture-scripts-g67` are not built. Machine-readable twin: `prereg/stage-graph-g67.json` (the scorer and the campaign
runner read the JSON; this file is the human statement of the same rule). Any edit to the briefs, markers, scorer, arm
manifests or this rule after the first live cell voids the row; a failure is recorded and the next attempt is a NEW arm
with new pack ids — there is no rerun-until-green (a rerun of an `infra_fail` CELL is not that; see STOP).

## What is being proved

Two guidance changes of branch `guidance-v7` (194e2ecc; the v7 change set is five files, see Arms), each a *mechanism* change (an already-stated step actually
happening), not a new demand:

| Id | Text change | Observable |
|---|---|---|
| G6 | `/l4`, `/l5`, `/l6` entry: `session-mode.js set --level lN --size <XS\|S\|M\|L\|XL> …` (old text: no `--size`) | the entry call carries `--size` |
| G7 | finish-flow close-out: a `Dispatch-branch close-out` row runs `repo-residue-sweep.js close-session --session "$CLAUDE_CODE_SESSION_ID" … --yes` unconditionally (old text: no such row) | the transcript runs it with a session and `--yes` |

## Arms

| Arm | Packs |
|---|---|
| `off` | the 16 `*-sg-change-v6` skill packs + `guidance-files-sg-change-v6` (= the stage-graph change arm as of 71fac023; byte-equal to `skills/` at that commit for l4/l5/l6/finish-flow) + `fixture-scripts-sg` + `fixture-scripts-g67` |
| `on` | the 16 `*-sg-change-v7` skill packs + `guidance-files-sg-change-v7` (built by `freeze-guidance-arm.js change --suffix v7` after the guidance-v7 merge) + the same two fixture-script packs |

Manifests: `arms/g67/{off,on}.json`. They are hand-written (the stage-graph `change.json` is not reused as-is because the
fixture packs differ). **The arms differ ONLY in five files: `l4/SKILL.md`, `l5/SKILL.md`, `l5/references/hetero-impl-loop.md`, `l6/SKILL.md`, `finish-flow/SKILL.md`** (the l5 reference adds the size to the l5 entry and degrade commands) — `run-g67-campaign.js
--check-arms` byte-compares the frozen packs file by file and a live run refuses to start unless that holds (a v7 freeze that dragged in
any other guidance edit would otherwise be a silent confound; every other file of every skill pack, the guidance-files pack and both fixture
packs must be identical across the arms).

### Fixture scripts — the exact step (G7 needs them)

At 71fac023 `scripts/repo-residue-sweep.js` has no `close-session`; the merged tree (release-3.0.0 @ 29938656) has it. The
v7 freeze must therefore take fixture scripts from the merged tree, not from `fixture-scripts-sg`:

```
node evals/skill-onoff/freeze-pack.js --id fixture-scripts-g67 \
  --scripts scripts/repo-residue-sweep.js,scripts/pin-evidence-anchors.js,scripts/reap-dispatch-branches.sh,scripts/lib/json-emit.sh,scripts/lib/worktree-reap.sh \
  --ref <merged develop sha: contains close-session AND the guidance-v7 merge>
```

- The explicit list is load-bearing: `repo-residue-sweep.js` spawns `pin-evidence-anchors.js` through
  `path.join(__dirname, …)`, and finish-flow runs `reap-dispatch-branches.sh` (which sources the two shell libs); `freeze-pack`
  follows only literal relative JS `require`s, so these would otherwise be missing. Dry-checked 2026-10-10 against 29938656:
  13 files; `close-session --session s --repo <g7-close fixture> --integration-ref develop --yes` exits 0 with an empty result.
- The pack is installed **twice** in both manifests: in `fixture_scripts` (copied onto the fixture repo root, after
  `fixture-scripts-sg`, so its newer `src/engine/*` files overlay the sg ones identically in both arms; `session-mode set` was
  re-checked on that overlay) **and** in `files` (copied to the synthetic *plugin root*). The second is needed because the
  finish-flow row derives `autopilot_root` from the plugin root and its resolver requires `scripts/reap-dispatch-branches.sh`
  there; the eval plugin has no `scripts/`, so without the pack the G7 row cannot even resolve its script path and ON would
  fail for an instrument reason. Verified: with the pack, `resolve_finish_flow_package_root <plugin>/skills/finish-flow/SKILL.md`
  returns the plugin root and `$autopilot_root/scripts/repo-residue-sweep.js close-session …` runs.
- The OFF arm has the sweep too. The only variable is the guidance text; an OFF cell that runs `close-session` unprompted is a
  legitimate OFF pass (counted against the ≤ 1/3 limit).

## Tasks (3 reps per arm each, sonnet, headless `claude -p`, `--setting-sources project`, scratch HOME)

Invocation preface is the existing `ONOFF_PROMPT_PREFIX` mechanism (stage-graph amend-1 used `Use dev-flow:`); the prompt is
`<prefix>\n\n<task.md>`. Briefs carry no answer vocabulary (test-asserted: no `session-mode`, `close-session`, `--size`,
`XS`, `residue`, `dispatch`, `/l4`, `finish-flow`, `tidy`, …).

| Task | Fixture | Rendered prompt (verbatim) | Marker | Check-skill | Timeout |
|---|---|---|---|---|---|
| `g6-l4` | tiny, clearly-XS change (`greet` word `hello`→`hi`, 1 source line + 1 test line), `develop` @ frozen base | `Use l4:` ⏎⏎ `The greeting word printed by \`cli.js greet\` should be \`hi\` instead of \`hello\` (so \`greet alice\` prints \`hi alice\`). Change it and update the one test expectation that pins the old word. \`bash run-tests.sh\` runs the tests. Commit when done.` | `g6_size` | `l4` | 5m |
| `g6-l5` | same repo, same brief | `Use l5:` + same brief | `g6_size` | `l5` | 5m |
| `g6-l6` | same repo, same brief | `Use l6:` + same brief | `g6_size` | `l6` | 5m |
| `g7-close` | finished change merged into `develop` by a normal merge commit, feature branch deleted, tree clean, `run-tests.sh` green; no dispatch branch, ledger or extra worktree exists | `Use finish-flow:` ⏎⏎ `wrap up this session. The \`feature/greet\` work (an S-size change) is already merged into \`develop\`, and \`bash run-tests.sh\` is green on it.` | `g7_close` | `finish-flow` | 8m |

The g6 brief is the existing `stage-graph-xs-feature` brief, byte for byte (it is the repo's clearest XS), in three task dirs
because the task id is the (skill, marker) key. The g7 brief is your `Use finish-flow: wrap up this session` with the prefix
mechanism splitting the colon from the sentence, plus one context sentence that fixes the size (finish-flow sizes the rows it
runs; the G7 row applies to every size, so the size cannot gate the marker).

**Why three g6 tasks, not two.** The three entry texts changed by the same edit (identical three lines, diff-verified), so two
would sample the pattern and leave the third unmeasured; each skill is a separate body the model reads, so a pass on l4 does not
transfer by construction. l5 costs +6 cells ≈ +$1.6 (typical) / +$3.1 (high) and ~+15–30 min wall; cheap enough to measure than to
argue. Drop it by deleting `g6-l5` from the prereg `tasks`/`changes` (and `reps` arithmetic follows) if you disagree.

## Markers (read the Bash tool-call commands in the transcript; never prose; no `work_done` conjunct)

Implementation: `lib/g67-cell.js` (+ `lib/g67-markers.sh`); the raw extraction is kept as `g67-extracted.json` next to each
cell's transcript. The reader cross-checks its tool-call count against `lib/transcript-query.js tool-events` and fails closed
(all false) on a mismatch.

- **`g6_size`**: the FIRST `node …/session-mode.js set` invocation carrying the task's level (`--level lN`, or `--entry-level lN`
  for the `--solo` form `set --level l3 --entry-level lN`) also carries `--size <XS|S|M|L|XL>` as a literal. A later corrective
  call does not rescue it; `--size "$VAR"` is unreadable ⇒ false; an invalid value or lowercase ⇒ false. Whether the call was
  accepted is recorded but does not gate (the claim is about the entry call). The size *value* is not gated: sonnet may call this
  brief XS or S; the change is that the entry records one.
- **`g7_close`**: ANY `node …/repo-residue-sweep.js close-session` invocation carrying `--session <non-empty>` (a literal sid, or
  `$CLAUDE_CODE_SESSION_ID` / `${CLAUDE_CODE_SESSION_ID}`, quoted or not; `--session ""`, no value, or a following flag ⇒ false)
  and `--yes` as a separate token. A dry run followed by a `--yes` run passes; a dry run alone fails.
- An invocation counts only when `node` precedes the script path in the same command segment (segments end at `;` `&&` `||` `|`
  or newline; backslash continuations are joined), so `cat`/`grep`/`sed` of the script, `--help` reads and `echo`ed prose never
  count.
- A truncated final transcript line (timeout kill mid-write) is skipped like `transcript-query.js` does; earlier calls count.

## Timeout (a registered stop, not a failure)

The markers need only the first minutes (stage-graph cells ran 25–250 s end to end), so each cell is cut at 5 min (g6) / 8 min
(g7, whose close-out row sits after the earlier finish-flow rows). Harness amendment: `ONOFF_TIMEOUT_IS_COMPLETE=1` (set by
`run-g67-campaign.js` only) makes exit 124/137 with a non-empty transcript a *complete* cell, and the row carries
`"stopped_by_timeout":true`. Default behaviour (timeout ⇒ `infra_fail`/`runner_timeout`) is unchanged for every other row and
regression-tested. A cell that has not issued the registered call by its timeout scores **false** for its arm — for ON that is a
real failure of the text (the call is supposed to be the first act of /l4–/l6 entry), for OFF it is the expected state.
Residual risk (not measured, disclosed): a cut cell may leave child processes the agent spawned; the cell's temp repo, HOME and
state are removed regardless and the cells run serially.

## Ship rule (pre-registered, before any live cell; applied by `score-g67.js`)

| Condition | Verdict (exit) |
|---|---|
| every task: **ON passes ≥ 2 of 3 reps AND OFF passes ≤ 1 of 3 reps** | **SHIP (0)** |
| any task violates either bound | NOT-SHIP (3); `changes{G6,G7}` says which change holds |
| any `(task, arm, rep)` cell without a clean row (missing, or only `infra_fail` rows) | **STOP (4)** — rerun that cell (`run-g67-campaign.js` resumes, max 3 recorded attempts per cell); a clean rerun row clears it |
| mixed models; **mixed runner versions**; a runner other than the pin `2.1.292 (Claude Code)`; more than one arm manifest per arm; identical off/on manifests; a registered manifest sha not matched | **INSTRUMENT-INVALID (5)** |
| manipulation check V1: the task's skill invoked (Skill tool call) in < 90 % of an arm's cells | INSTRUMENT-INVALID (5) — added by the suite design, not in the brief: without it an unloaded skill would read as a NOT-SHIP of the text |

Judgement order: INVALID(model/runner/arm) → STOP → INVALID(V1) → ship rule. The ship rule is exactly the one given; note its
weakness honestly: ON 2/3 vs OFF 1/3 is the thinnest contrast it admits, and with n = 3 it is a mechanism-presence check, not an
effect size. Scope lock: sonnet depth-0, headless `-p`, runner 2.1.292, these four briefs, the frozen off/on manifests. It says
nothing about foreman/hands behaviour after entry, opus/fable, or interactive sessions.

## Runner pin

`claude` pinned to Claude Code 2.1.292 via the PATH dir
`/tmp/claude-1000/-home-cookys-projects-autopilot/e041e8fe-15fe-42c4-8214-0b41b1f26a1a/scratchpad/claude-pin/` (symlink to
`~/.local/share/claude/versions/2.1.292`). Checked 2026-10-10: the dir exists, `claude --version` through it prints
`2.1.292 (Claude Code)`. A live `run-g67-campaign.js` refuses to start unless `claude` on PATH reports exactly that string, so run:

```
PATH="/tmp/claude-1000/-home-cookys-projects-autopilot/e041e8fe-15fe-42c4-8214-0b41b1f26a1a/scratchpad/claude-pin:$PATH" \
  node evals/skill-onoff/run-g67-campaign.js --results evals/skill-onoff/results/stage-graph-g67.v1.jsonl
```

The stage-graph v7 run (separate row) must use the same pin so the two rows share an instrument; if the pin dir is gone
(it lives under a session scratchpad in `/tmp`), re-create it as a symlink to a retained `versions/<v>` binary and update both
rows' pin together — 2.1.295 is the proposed alternative for BOTH, never one of them.

## Preconditions

1. **Confirmed.** `claude -p` on 2.1.292 sets `CLAUDE_CODE_SESSION_ID` in the Bash tool environment: a probe from a scratch dir
   with the pinned binary printed `SID=[7b8112a2-7a48-4c59-8d0a-976b7bc3c373]` (coordinator, 2026-10-10). So the finish-flow
   "skip when unset" branch does not apply under this instrument. The g7 extraction still records the sweep's echoed `session`
   (`result_session`) for review.
2. (Not verified live.) Both `g6-l*` ON cells reach `session-mode.js` through the fixture's `scripts/` (as the stage-graph cells already do) — the
   skill text says `<plugin>/scripts/…`; the plugin root has no `session-mode.js`. The marker accepts any path to the script.

## Run

```
node evals/skill-onoff/run-g67-campaign.js --results evals/skill-onoff/results/stage-graph-g67.v1.jsonl --dry-run   # cells, pin, cost
node evals/skill-onoff/run-g67-campaign.js --check-arms                                                             # off/on differ only in the 4 skills
node evals/skill-onoff/run-g67-campaign.js --results evals/skill-onoff/results/stage-graph-g67.v1.jsonl             # live; resumable
node evals/skill-onoff/score-g67.js --prereg evals/skill-onoff/prereg/stage-graph-g67.json --results <file>          # re-score
```

24 cells (4 tasks × 2 arms × 3 reps), serial, arms interleaved per rep. Estimated spend (dry run, basis = 74 measured sonnet
cells, mean $0.135, max $0.517): low $3.25, **typical $6.50** (2× mean, an assumption), high $12.40. Wall clock: worst case
138 min if every cell hits its timeout; expected ~1–2 h at 2–4 min per cell.

## Spend-free proof

`hooks/tests/skill-onoff-g67.test.sh`: marker pass/fail cases through the real `markers.sh`, fixture hygiene, scorer verdicts
(SHIP, NOT-SHIP ×3, STOP ×3 incl. rerun-clears, INSTRUMENT-INVALID ×5), the timeout knob, `--check-arms` (clean + three planted
reds), and a stub-runner end-to-end campaign (failing runner ⇒ STOP, resume ⇒ SHIP, third run adds no rows, unpinned `claude` ⇒
refusal). Mutation-checked: dropping the `--size` or `--yes` conjunct turns the suite red.
