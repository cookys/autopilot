# P2-0 expected readings (written and committed before any real call)

Plan: docs/plans/2026-10-24-per-turn-gate-phase2.md section 5 (P2-0). CLI 2.1.309, alias claude-haiku-4-5, credentials-only config dir, cost cap 1 USD (stop above 0.9).

- (a) Multi-turn resume with a counting Stop hook (blocks once per turn): the first Stop of turn 1 and of turn 2 both carry `stop_hook_active` false; the re-entry after the block carries true; `session_id` is unchanged after `--resume`. Expected rule: a Stop call with the flag false starts a new turn (plan 2.1 holds).
- (b) With `--setting-sources project`, a Stop hook in the project's `.claude/settings.json` is loaded and runs (one hook execution per Stop). Negative control: with `--setting-sources user` the same project hook is not loaded.
- (c) With `--plugin-dir <autopilot checkout>` plus the project hook: the trace lists 6 Stop hooks; when the probe hook blocks and the five plugin hooks allow, the block is honored (the model continues, the probe hook is called again with the flag true). Expected coexistence rule: a block from any one hook blocks.
- (d) `verify-turn.js` wall time on the t14 repo: well under 2 s per run (node start plus a few repo invocations, bounded by its internal 10 s per-command timeout); max of 5 runs reported.
- (e) Probe NC6 (hook without a knob, blocks once): the transcript shows one block and the hook log holds exactly one block record.
