# P2-0 probe: result

Date 2026-10-24 (Taipei). Plan: `docs/plans/2026-10-24-per-turn-gate-phase2.md` section 5 (P2-0); owner approval d-15c0364c (O5, at most 1 USD). Expected readings were committed first (`expected.md`, commit 0890a9c9a). CLI 2.1.309 on every call (`init` lines in `readings.txt`), alias claude-haiku-4-5.

## Method

`trial.sh` (this directory) runs one `claude -p` call per invocation: config dir holds only a copy of `.credentials.json` (never the real `~/.claude`), HOME is a per-trial scratch dir, cwd is a scratch project whose `.claude/settings.json` defines only the probe Stop hook (`probe-hook.js`, the P0 throwaway hook: blocks while `remaining` in a counter file is above 0, logs the full stdin). Trace: `--output-format stream-json --verbose --include-hook-events --debug hooks`. Every call ran with `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID`. Raw logs stay in scratch; `sums.txt` lists their sha256. `readings.txt` is the de-identified summary (session and prompt ids replaced by labels); `block-in-stream.txt` counts the block reason in the stream; `verifier-wall.txt` is (d).

Commands (see `trial.sh` arguments: name, setting-sources, plugin 0/1, resume id or `-`, prompt):
- t1 turn 1: `trial.sh t1 project 0 - "Reply with exactly: OK"` (counter remaining=1)
- t1 turn 2: `REMAIN=1 trial.sh t1 project 0 <session id of turn 1> "Reply with exactly: DONE"`
- t2: `trial.sh t2 user 0 - "Reply with exactly: OK"` (negative control for b)
- t3: `trial.sh t3 project 1 - "Reply with exactly: OK"` (adds `--plugin-dir /home/cookys/projects/autopilot`)
- (d): `node gate/verify-turn.js --turn 5 --repo repo --json` in `evals/orchestration/tasks/t14-constraint-horizon`, timed with `/usr/bin/time`, five runs.

## Results

| Item | Label | Reading |
|---|---|---|
| (a) multi-turn `--resume` | produced | Hook log of t1 (4 calls): call 1 block, `stop_hook_active` false (turn 1 first Stop); call 2 allow, flag true (re-entry after the block); after `--resume`: call 3 block, flag **false** (turn 2 first Stop); call 4 allow, flag true. `session_id` identical in all four calls and in both `init`/`result` objects. A second field, `prompt_id`, is the same within a turn (calls 1-2, calls 3-4) and differs between turns. |
| (b) `--setting-sources project` | produced | The project-level Stop hook ran (t1, t3: hook log present, hook execution lines in the debug log). Negative control t2 (`--setting-sources user`, same project dir): no `hook.log`, no Stop hook lines: the project hook is not loaded, so the project source is what carried it. |
| (c) coexistence with the five plugin Stop hooks | produced | t3 debug log lists 6 Stop hooks on each of the 2 Stop events (cost-tracker, dirty-protected-paths, opt-in-multiplexer, owner-question-guard, awaiting-owner, plus the probe), all finished status 0. The probe blocked on call 1 while the five plugin hooks allowed: the block was honored (the model produced ALPHA, call 2 had the flag true). The plugin hooks were not short-circuited by the block: all six ran again on re-entry. Limit: the five plugin hooks never blocked in this trial, so "any one blocks" is shown for the probe blocking among allowers; the reverse (a plugin hook blocking among allowers) was not exercised. |
| (d) verifier wall time | produced | `verify-turn.js --turn 5` on the t14 repo, 5 runs: 0.16, 0.09, 0.11, 0.15, 0.16 s; max 0.16 s (earlier single runs: turn 1 0.07 s, turn 3 0.10 s, turn 5 0.17 s). The pristine repo state (no violations, six feature gaps) was measured; a repo in the middle of a model run was not. Internal per-command timeout is 10 s, so the worst case is bounded above by that rather than measured. |
| (e) probe NC6 | produced | t3: one `decision: block` record in the hook log and the block reason appears in the stream (`block-in-stream.txt`); t1: one block per turn, the reason text for turn 1 present. Probe grade only: the probe hook has no knob and is not the gating NC6 of P2-1. |

## Rules

Turn-boundary rule: **a Stop call with `stop_hook_active` false is the first Stop of a turn, including the first Stop after `--resume`; true means re-entry within the same turn.** Confirmed on 2.1.309 for `-p` + `--resume` with block-once hooks. Confirmed alternative signal: `prompt_id` is constant within a turn and changes per turn, so the turn index can also be derived from it; the transcript-counting fallback in the plan is not needed. Caveat: the multi-block case across a turn (A2 in P0, flag true on every re-entry) was not repeated; a re-entry always carries true, so a turn that is blocked twice does not look like two turns.

Coexistence rule: **the Stop hooks of a session all run (none skipped) and a block from the gate hook blocks the stop even when the five plugin Stop hooks allow.** The plugin hooks are called again on re-entry as well.

## Contradictions with the plan

None with section 2.1 (turn boundary) or 2.3 (coexistence, timing: 0.16 s against any plausible hook timeout). Two refinements for the plan text: (1) `session_id` is the stdin field name (P0 excerpts show it de-identified as `sid`); (2) `prompt_id` is available as a second turn key. Not covered, stated plainly: an interactive (non-`-p`) session, a plugin hook that blocks, a repo mid-run for the verifier time.

## Cost

Result-object `total_cost_usd`: 0.0195 (t1 turn 1), 0.0251 (t1 turn 2), 0.0166 (t2), 0.0526 (t3); sum 0.1138 USD (counting every result object in full; the resume object may include turn 1, so the true spend is at most this). Cap 1 USD, no run retried.
