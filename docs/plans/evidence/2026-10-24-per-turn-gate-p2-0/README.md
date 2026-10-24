# P2-0 probe: result

Date 2026-10-24 (Taipei). Plan: `docs/plans/2026-10-24-per-turn-gate-phase2.md` section 5 (P2-0); owner approval d-15c0364c (O5, at most 1 USD). Expected readings were committed first (`expected.md`, commit 0890a9c9a). CLI 2.1.309 on every call (`init` lines in `readings.txt`), alias claude-haiku-4-5.

## Method

`trial-v1.sh` (this directory) is the runner that produced t1-t3; `trial.sh` is its v2 (used for t4 and any rerun): same call, but all state lives under a `mktemp -d` root outside the repo, the hook command is generated per `<label>:<remaining>` spec (so several project Stop hooks can run with independent counters), and it refuses to run when the root is inside a git work tree (negative control: the first v2 draft checked a not-yet-existing directory, ran and copied credentials into the checkout; that copy was deleted at once, never staged or committed, and the check was fixed to create the directory first; second draft refused with rc=3). Both runners run one `claude -p` call per invocation: config dir holds only a copy of `.credentials.json` (never the real `~/.claude`; in t1-t3 the dirs were under the scratch directory outside the repo tree, in v2 under mktemp), HOME is a per-trial scratch dir, cwd is a scratch project whose `.claude/settings.json` defines only the probe Stop hook (t1-t3 ran `p20run/bin/hook.js`; its sha256 equals the committed `probe-hook.js`, both listed in `sums.txt`; the P0 throwaway hook: blocks while `remaining` in a counter file is above 0, logs the full stdin). Trace: `--output-format stream-json --verbose --include-hook-events --debug hooks`. Every call ran with `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID`. Raw logs stay in scratch; `sums.txt` lists their sha256. `readings.txt` is the de-identified summary (ids replaced by globally unique labels `<tN.sidK>` / `<tN.pidK>`, numbered per trial, so equal labels mean equal ids within a trial); `block-in-stream.txt` counts the block reason in the stream; `verifier-wall.txt` is (d).

Commands. `trial.sh` arguments: name, setting-sources, plugin 0/1, resume id or `-`, prompt, then one `<label>:<remaining blocks>` per project Stop hook.

v1 historical commands (`trial-v1.sh`, not executable, now also refuses to run inside a work tree; do not run). They produced t1-t3 and relied on v1 behaviour: one hard-wired hook, one shared `counter.json`/`hook.log` whose call count carried across turns, and an optional `REMAIN` variable:
- t1 turn 1: `trial-v1.sh t1 project 0 - "Reply with exactly: OK"` (counter remaining=1)
- t1 turn 2: `REMAIN=1 trial-v1.sh t1 project 0 <session id of turn 1> "Reply with exactly: DONE"`
- t2: `trial-v1.sh t2 user 0 - "Reply with exactly: OK"` (negative control for b)
- t3: `AUTOPILOT_REPO=<REPO> trial-v1.sh t3 project 1 - "Reply with exactly: OK"` (adds `--plugin-dir $AUTOPILOT_REPO`; both runners now take the checkout path from `AUTOPILOT_REPO` and exit 2 when it is unset, instead of the original hard-coded path)

Equivalent reruns with v2 `trial.sh` (it makes its own `mktemp -d` root and prints it as `root=`; set `P20_ROOT=<dir outside the repo>` to reuse one root across the two turns of t1). The v2 counter is created only when absent, so resetting it between turns means deleting the counter file; the call number in the hook log then restarts at 1 (v1 kept counting 3, 4):
- t1 turn 1: `P20_ROOT=$ROOT trial.sh t1 project 0 - "Reply with exactly: OK" gate:1`
- t1 turn 2: `rm $ROOT/trials/t1/gate.counter.json; P20_ROOT=$ROOT trial.sh t1 project 0 <session id from the RESULT line of turn 1> "Reply with exactly: DONE" gate:1`
- t2: `trial.sh t2 user 0 - "Reply with exactly: OK" gate:1`
- t3: `AUTOPILOT_REPO=<REPO> trial.sh t3 project 1 - "Reply with exactly: OK" gate:1`
- t4 (v2 as run):
`AUTOPILOT_REPO=<REPO> trial.sh t4 project 1 - "Reply with exactly: OK" gate:0 plugsim:1` (two project Stop hooks, both `probe-hook.js`: `gate` allows, `plugsim` blocks once, simulating a plugin hook that blocks; plus the five real plugin hooks)
- (d): `node gate/verify-turn.js --turn 5 --repo repo --json` in `evals/orchestration/tasks/t14-constraint-horizon`, timed with `/usr/bin/time`, five runs.

## Results

| Item | Label | Reading |
|---|---|---|
| (a) multi-turn `--resume` | produced | Hook log of t1 (4 calls): call 1 block, `stop_hook_active` false (turn 1 first Stop); call 2 allow, flag true (re-entry after the block); after `--resume`: call 3 block, flag **false** (turn 2 first Stop); call 4 allow, flag true. `session_id` identical in all four calls and in both `init`/`result` objects. A second field, `prompt_id`, is the same within a turn (calls 1-2, calls 3-4) and differs between turns. |
| (b) `--setting-sources project` | produced | The project-level Stop hook ran (t1, t3: hook log present, hook execution lines in the debug log). Negative control t2 (`--setting-sources user`, same project dir): no `hook.log`, no Stop hook lines: the project hook is not loaded, so the project source is what carried it. |
| (c) coexistence with the five plugin Stop hooks | produced (both directions) | t3: debug log lists 6 Stop hooks on each of the 2 Stop events (cost-tracker, dirty-protected-paths, opt-in-multiplexer, owner-question-guard, awaiting-owner, plus the probe), all status 0. Gate blocked, five plugin hooks allowed: the block was honored (model produced ALPHA, re-entry flag true), all six ran again on re-entry. t4 (reverse): gate hook allowed on both calls, a second project hook (`plugsim`, standing in for a plugin hook) blocked on call 1 and allowed on call 2 (flag true); the model continued (ALPHA) and the reason appears in the stream (`block-in-stream.txt`); 14 Stop hook executions = 7 hooks x 2 events (5 plugin + 2 project). Limit: the blocker in t4 is a project hook simulating a plugin hook, not one of the five real plugin hooks (none of which can be made to block without editing them). |
| (d) verifier wall time | produced | `verify-turn.js --turn 5` on the t14 repo, 5 runs: 0.16, 0.09, 0.11, 0.15, 0.16 s; max 0.16 s (earlier single runs: turn 1 0.07 s, turn 3 0.10 s, turn 5 0.17 s). The pristine repo state (no violations, six feature gaps) was measured; a repo in the middle of a model run was not. `verify-turn.js` may spawn the t14 `cli.py` several times per call, each with a 10 s per-spawn limit (`TIMEOUT_MS`); that worst case (a hanging command) was not measured, only the normal pristine case. |
| (e) probe NC6 | produced | t3: one `decision: block` record in the hook log and the block reason appears in the stream (`block-in-stream.txt`); t1: one block per turn, the reason text for turn 1 present. Probe grade only: the probe hook has no knob and is not the gating NC6 of P2-1. |

## Rules

Turn-boundary rule: **a Stop call with `stop_hook_active` false is the first Stop of a turn, including the first Stop after `--resume`; true means re-entry within the same turn.** Confirmed on 2.1.309 for `-p` + `--resume` with block-once hooks. Confirmed alternative signal: `prompt_id` is constant within a turn and changes per turn, so the turn index can also be derived from it; the transcript-counting fallback in the plan is not needed. Caveat: the multi-block case across a turn (A2 in P0, flag true on every re-entry) was not repeated; a re-entry always carries true, so a turn that is blocked twice does not look like two turns.

Coexistence rule: **the Stop hooks of a session all run (none skipped) and a block from any one hook blocks the stop even when all the others allow (shown for the gate hook among plugin hooks in t3, and for a second project hook among an allowing gate and the plugin hooks in t4).** The plugin hooks are called again on re-entry as well.

## Contradictions with the plan

None with section 2.1 (turn boundary) or 2.3 (coexistence, timing: measured max 0.16 s on a pristine repo; the five plugin Stop hooks in `hooks/hooks.json` set no explicit timeout, the explicit timeouts elsewhere in that file are 5 s and 10 s, so 0.16 s is 3.2 % of the smaller and 1.6 % of the larger; the CLI default for a hook without timeout was not measured here, and P2-1 should set an explicit timeout on the gate hook). Two refinements for the plan text: (1) `session_id` is the stdin field name (P0 excerpts show it de-identified as `sid`); (2) `prompt_id` is available as a second turn key. Not covered, stated plainly: a real plugin hook as the blocker (t4 simulates it); an interactive (non-`-p`) session, a repo mid-run for the verifier time.

## Raw readings, call times, per-hook detail

- `raw-excerpts/<trial>/`: `hook.log` (probe hook stdin and decision per call; masked as described below; t4 has `gate.hook.log` and `plugsim.hook.log`), `stream-excerpt-*.jsonl` (stream-json `init`, `hook_started`/`hook_response` and `result` lines; dropped: assistant/user message bodies, tool lists, skill lists, usage tables, SessionStart hook stdout; the credential copy and `.credentials.json` are not included; a scan for `sk-ant`, token fields, `Bearer` and the account email finds nothing), `debug-stop-lines-*.txt` (the `--debug hooks` lines for Stop executions and decisions plus the first and last debug timestamp). File names keep the original suffixes (`--` = fresh session, `resume` = the resumed second turn of t1; in the scratch originals that suffix was the 36-character session id). `sums.txt` now points at these committed files; the sha256 of the full raw files is kept in its last section for the record (they stay in scratch).
- `call-times.txt`: start of every real call (first `--debug` timestamp) and stream file mtime, against the `expected.md` commit time 00:38:59Z (08:38:59+08:00). All five measured calls started at 00:39:12Z or later (t4 at 00:44:54Z), so none started before the expected readings were committed. The mishap call (see Method) is not listed: its files were deleted with the stray directory; it ran after the expected.md commit as well (it was run while building v2 after t3).
- `stop-events.txt`: per Stop event, each hook (command, exit status, duration, source) and any decision output. Trials t1-t3 only have this aggregate from the debug log and stream hook events (no per-hook decision record was kept at the time; a hook that blocks shows as a `success:` stdout line followed by a `returned permissionDecision: deny` line naming the hook). For t4 the same sources were kept and both probe instances are told apart by their `gate.`/`plugsim.` log paths in the command; the `plugsim` instance is the one with the `deny` line.

## Masking

The committed excerpts and notes are masked deterministically (script not shipped; rules are exact string/regex substitutions): `<SCRATCH>` the scratch directory of the session, `<MKTEMP>` the mktemp root of t4, `<REPO>` the autopilot checkout, `<HOME>` the user's home, `<SCRATCH-ENC>`/`<MKTEMP-ENC>`/`<REPO-ENC>` the dash-encoded forms inside transcript paths, every other UUID `<id>`. Session and prompt ids become `<tN.sidK>` / `<tN.pidK>`, numbered per trial in the order readings.txt uses (hook logs first, then stream sessions), so equality is kept and labels match readings.txt. The full-file sha256 values in the last section of `sums.txt` are of the files before masking. `check-recompute.js` (run in this directory, `node check-recompute.js`) recomputes the decision lines and cost sum of `readings.txt`, the first debug timestamps in `call-times.txt` and the hook-execution count of `stop-events.txt` from the committed excerpts; all pass. The stream file mtimes in `call-times.txt` are not recomputable from the excerpts.

## Credentials check

On branch `hands/ptg-p20/1`: `git ls-files | grep -c '\.credentials\.json'` gives 0, `git diff --name-only origin/develop HEAD` lists only files under this evidence directory, and `git log origin/develop..HEAD --all -- '*.credentials.json'` is empty. (`git log --all -- '*credentials*'` alone matches many unrelated files elsewhere in the repository history, none from this branch.) The one stray copy from the draft guard mishap was removed before any `git add`.

## Cost

Result-object `total_cost_usd`: 0.0195 (t1 turn 1), 0.0251 (t1 turn 2), 0.0166 (t2), 0.0526 (t3), 0.0243 (t4), plus 0.0324 for the guard-mishap call (a real call whose stream is not kept as evidence); sum 0.1705 USD (the resume object may include turn 1, so at most this). Cap 1 USD, no run retried.
