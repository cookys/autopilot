# Pre-registration — stage-graph-g8 (row `stage-graph-g8`)

**Status: FROZEN 2026-10-11 (before any live cell; stamped by `stamp-prereg.js --row stage-graph-g8`).** The v9 packs
(`*-sg-change-v9`) and `fixture-scripts-g8-v2` are frozen from `ac3ccd07`, and `allowed_arm_difference.files` is filled. Machine-readable twin: `prereg/stage-graph-g8.json` (the scorer and the runner read the JSON; this
file is the human statement of the same rule). Any edit to the briefs, marker, scorer, arm manifests or this rule after the
first live cell voids the row; a failure is recorded and the next attempt is a NEW arm with new pack ids. There is no
rerun-until-green (rerunning an `infra_fail` CELL is not that; see STOP).

## What is being proved

One guidance change, a *mechanism-use* change (the mechanism exists; the text must make the agent reach for it):

| Id | Text change | Observable |
|---|---|---|
| G8 | `dev-flow` and `/l4`-`/l6`: when a SECOND task starts in the same live session, record it with `session-mode.js set --new-task --size <XS\|S\|M\|L\|XL> …`, not `set --size …` (old text: the second task is recorded like the first, and `--size` only moves up, so the stage position of task 1 is kept) | after the first `session-mode.js set`, the transcript runs another `session-mode.js set` with `--new-task` and a legal literal `--size` |

The mechanism is `batch/newtask`, commit `73a59216` (`set --new-task` clears stage / unit / review_families / high_risk and
the task-scoped size, urgent, bug, base_ref; records `task_seq`). The text is written on `batch/g8-guid`.

## Arms

| Arm | Packs |
|---|---|
| `off` | the 16 `*-sg-change-v8` skill packs + `guidance-files-sg-change-v8` (= the current stage-graph change arm; the g67 ON arm) + `fixture-scripts-sg` + `fixture-scripts-g8-v2` |
| `on` | the 16 `*-sg-change-v9` skill packs + `guidance-files-sg-change-v9` (built by `freeze-guidance-arm.js change --suffix v9` after the `batch/g8-guid` merge) + the same two fixture-script packs |

Manifests: `arms/g8/{off,on}.json` (generated from the g67 ON manifest, only the pack suffix and the fixture pack differ).
**The arms differ ONLY in the files the G8 text change touches — list: `allowed_arm_difference.files` in the JSON, filled 2026-10-11 from
`git diff --name-only e6131fba HEAD -- skills`: `dev-flow/SKILL.md`, `l4/SKILL.md`, `l5/SKILL.md`, `l6/SKILL.md`.** `run-g8-campaign.js --check-arms` byte-compares the frozen packs file by file (the g67 checker, reused)
and a live run refuses to start unless that holds. `run-g8-campaign.js` additionally REFUSES an empty list, because the generic
checker would pass an off/on pair that differs in nothing.

### Fixture scripts

`fixture-scripts-g8-v2` is `session-mode.js` frozen from `ac3ccd07` (the merged tree; the first freeze, `fixture-scripts-g8` @ `73a59216`, lacked the `--level none` fix and is unused) plus its literal require
graph (55 files; `freeze-pack` follows `require('./…')`). It is installed twice in both manifests: in `fixture_scripts` (fixture
repo root, after `fixture-scripts-sg`, so the `--new-task` session-mode.js overlays the older one) and in `files` (the synthetic
PLUGIN root, where the skill text says `<plugin>/scripts/session-mode.js`). Identical in both arms. The pre-turn check of the g67
amendment is kept: `plugin_required_scripts = ["scripts/session-mode.js"]` is `require()`d from the assembled scratch plugin
before the agent starts; a script that does not load is `infra_fail/plugin_script_unresolvable` (STOP, never a score). Spend-free
proof in `hooks/tests/skill-onoff-g8.test.sh` that the overlay really supports the two calls (`set --size`, then `set --new-task
--size`, task_seq 2, stage cleared) with the sg `stage-advance.js`.

If `batch/newtask` is amended before it merges, the pack is stale: re-freeze under a NEW id from the merged sha and repoint both
manifests (a frozen pack is never edited).

## Tasks (3 reps per arm each, sonnet, headless `claude -p`, `--setting-sources project`, scratch HOME)

The prompt is `<prefix>⏎⏎<task.md>` (the `ONOFF_PROMPT_PREFIX` mechanism). Both tasks use the g6 fixture byte for byte
(`tasks/g8-*/repo` and `init-repo.sh` are symlinks to `tasks/g6-l4/`): `develop` @ frozen base, `greet` prints `hello`.

| Task | Rendered prompt (verbatim) | Marker | Check-skill | Timeout |
|---|---|---|---|---|
| `g8-flow` | `Use dev-flow:` ⏎⏎ `First, change the greeting word printed by \`cli.js greet\` from \`hello\` to \`hi\` (so \`greet alice\` prints \`hi alice\`) and update the one test expectation that pins the old word. \`bash run-tests.sh\` runs the tests. Commit when done.` ⏎⏎ `Once that is committed, begin a new task: add a \`--shout\` option to \`cli.js greet\`, so \`greet alice --shout\` prints \`HI ALICE\`. Add a test for it and commit.` | `g8_new_task` | `dev-flow` | 10m |
| `g8-l4` | `Use l4:` + the same brief | `g8_new_task` | `l4` | 15m |

The brief says outright that the second job is a new task, and carries no answer vocabulary (test-asserted: no `session-mode`,
`new-task`, `--size`, `XS`, `stage`, `dispatch`, `/l4`, `dev-flow`, `finish-flow`, `hetero`, …).

**Not added: a third task whose second job is a fix (`--bug`).** It would sample a different dev-flow path (Fix), whose size
handling is not settled by the G8 text under review; a NOT-SHIP there could be about Fix sizing, not about `--new-task`. It
would add 6 cells (about +$1.6 typical, +30 min). To add it: a `tasks/g8-fix/` with a brief whose second job is a bug, a prereg
`tasks` row, and the test's task list. It must be added before the first live cell.

**Not covered:** `/l5` and `/l6` carry the same text edit but are not sampled (scope lock). The l4 cell has an instrument risk
that no dry run can show and the first live cell will: `/l4` dispatches a background foreman, and a headless `-p` depth-0 may
end its turn after dispatching, before the second job is ever started. If that happens in BOTH arms the cell scores false for
both, ON fails, and the verdict is NOT-SHIP for an instrument reason. That is a pre-registered ambiguity, not a rerun license:
if the transcripts show depth-0 never reached the second job (read `g8-extracted.json` and the transcript), the row is declared
INSTRUMENT-DEFECTIVE and a new arm/row is registered with a brief that keeps depth-0 in the loop.

## Marker (reads the Bash tool-call commands in the transcript; never prose; no `work_done` conjunct)

Implementation: `lib/g8-cell.js` (+ `lib/g8-markers.sh`); it reuses `lib/g67-cell.js` `extract` unchanged (g67 has live results, so
its files stay digest-frozen), and the raw extraction is kept as `g8-extracted.json` next to each cell's transcript. The reader
cross-checks its tool-call count against `lib/transcript-query.js tool-events` and fails closed (false) on a mismatch.

- **`g8_new_task`**: after the FIRST `node …/session-mode.js set …` invocation of the transcript there is another one carrying
  `--new-task` as a separate token AND `--size <XS|S|M|L|XL>` as a literal. A `--new-task` call that is the only `set`, or a later
  `set --size …` without the flag, does not count; `--size "$VAR"`, a lowercase or invalid size, or `--new-task` without a size
  is false. Whether the call was accepted is recorded, not gated (the claim is about the call). The size value is not gated.
- An invocation counts only when `node` precedes the script path in the same command segment (segments end at `;` `&&` `||` `|` or
  newline; backslash continuations are joined), so `cat`/`grep` of the script, `--help` reads and `echo`ed prose never count.
- A truncated final transcript line (timeout kill mid-write) is skipped; earlier calls count.

## Timeout (a registered stop, not a failure)

Estimate: stage-graph and g67 sonnet cells took 25–250 s end to end for ONE small task (g67 cut them at 5 m and 8 m). A cell here
does two such tasks after loading a skill body, so 3–8 min expected; `g8-flow` is cut at **10 m**; `g8-l4` at **15 m** because it
also launches a background foreman. Worst case if every cell hits its cut: 3 reps × 2 arms × (10 + 15) m = 150 min; expected
40–70 min. As in g67, `ONOFF_TIMEOUT_IS_COMPLETE=1` makes exit 124/137 with a non-empty transcript a complete cell
(`stopped_by_timeout:true`); a cell that has not issued the registered call by then scores **false** for its arm (for ON a real
failure of the text, for OFF the expected state). Default harness behaviour (timeout ⇒ `infra_fail`) is unchanged elsewhere.

## Ship rule (pre-registered, before any live cell; applied by `score-g67.js`, which is prereg-driven)

| Condition | Verdict (exit) |
|---|---|
| every task: **ON passes ≥ 2 of 3 reps AND OFF passes ≤ 1 of 3 reps** | **SHIP (0)** |
| any task violates either bound | NOT-SHIP (3) |
| any `(task, arm, rep)` cell without a clean row (missing, or only `infra_fail` rows) | **STOP (4)**: rerun that cell (resumable, max 3 recorded attempts per cell); a clean rerun row clears it; never score around it |
| mixed models; **mixed Claude Code versions**; a runner other than the pin `2.1.296 (Claude Code)`; more than one arm manifest per arm; identical off/on manifests; a registered manifest sha not matched | **INSTRUMENT-INVALID (5)** (the test is void) |
| manipulation check V1: the task's skill invoked in < 90 % of an arm's cells | INSTRUMENT-INVALID (5): without it an unloaded skill would read as a NOT-SHIP of the text |

Judgement order: INVALID(model/runner/arm) → STOP → INVALID(V1) → ship rule. Honest weakness: ON 2/3 vs OFF 1/3 is the thinnest
contrast the rule admits; with n = 3 this is a mechanism-use check, not an effect size.

## Runner pin (decided 2026-10-11)

Pinned to Claude Code **2.1.296**. The first proposal (2.1.292) was deleted by the auto-updater, leaving a dangling link. This
time the binary is a COPY: `~/.autopilot/claude-pin/2.1.296/claude` (copied from `~/.local/share/claude/versions/2.1.296`), and
the PATH dir `~/.autopilot/claude-pin/bin/` holds `claude` linking to that copy, so a version cleanup cannot remove it. The
stage-graph rows move to the same pin together (`prereg/stage-graph.amend-4-runner-pin.json`: v9 and later; v1–v8 stay as run on
2.1.292); g67 ran on 2.1.292 and is not re-run.

## Run

```
PIN=$HOME/.autopilot/claude-pin/bin
node evals/skill-onoff/run-g8-campaign.js --results evals/skill-onoff/results/stage-graph-g8.v1.jsonl --dry-run   # cells, pin, cost
node evals/skill-onoff/run-g8-campaign.js --check-arms                                                          # off/on differ only in the registered files
PATH="$PIN:$PATH" node evals/skill-onoff/run-g8-campaign.js --results evals/skill-onoff/results/stage-graph-g8.v1.jsonl   # live; resumable
node evals/skill-onoff/score-g67.js --prereg evals/skill-onoff/prereg/stage-graph-g8.json --results <file>               # re-score
```

12 cells (2 tasks × 2 arms × 3 reps), serial, arms interleaved per rep. Dry-run spend (basis: 74 measured sonnet cells, mean
$0.135, max $0.517): low $1.62, typical $3.25, high $6.20; those assume one-task cells, and a two-task cell likely lands in the
upper half, so budget about **$4–6** (an assumption, not a measurement). Post-merge freeze and stamp commands:
`fixture_scripts_freeze.post_merge_steps` in the JSON; the last, `stamp-prereg.js --row stage-graph-g8`, writes the arm shas and
the digests in `FROZEN.json`.

## Spend-free proof

`hooks/tests/skill-onoff-g8.test.sh`: marker pass/fail cases through the real `tasks/g8-*/markers.sh`, fixture hygiene (briefs,
symlinked fixtures, the `session-mode.js` overlay actually doing `set --new-task`), scorer verdicts (SHIP, NOT-SHIP, STOP,
INSTRUMENT-INVALID), the `run-g8-campaign.js` guards (empty allowed list refused, unstamped shas refused, unpinned `claude`
refused), `--check-arms` through the front, a stub-runner end to end (failing runner ⇒ STOP, resume ⇒ SHIP), and `stamp-prereg.js`
on a synthetic root (refuses unfrozen packs and an empty allowed list, stamps, `--check` detects an edit). Mutation-checked: dropping
the `--new-task` or the `--size` conjunct turns the suite red.
