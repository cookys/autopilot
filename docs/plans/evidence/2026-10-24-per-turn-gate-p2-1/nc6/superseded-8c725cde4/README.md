# NC6 live: result against the final hook (P2-1, plan section 4 NC6)

Date 2026-10-24. Hook under test: `hooks/per-turn-gate.js` of commit 8c725cde4 (git blob c0d9380efb3d0fcfdddf09d5bfc5aa849d5be9ac, equal to the worktree HEAD blob), not modified. CLI 2.1.309, alias claude-haiku-4-5. Expected readings were committed first (`expected.md`, commit 2b205d83a, 01:12:00Z); both calls started later (`call-times.txt`).

This replaces the earlier run against c23012aac, which is kept in `superseded-c23012aac/` (see `SUPERSEDED.md` there): the hook was changed afterwards (owner-token two-stage lock, no take-then-give-back), so the old readings no longer describe the shipped hook.

## Method

Unchanged from the superseded run: `run.sh <off|on>` (this directory, same file) with `NC6_ROOT` set to one `mktemp -d` root outside any work tree (it refuses otherwise); config dir holds only a copy of `.credentials.json`; per-run HOME; scratch project whose `.claude/settings.json` wires only the hook as a Stop hook; `--setting-sources project`; `AUTOPILOT_LIVE_DIR` and `AUTOPILOT_CONFIG_FILE` inside the root; `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID`. Verifier `stub-verifier.js` (always exit 1, one violation: reply with the single word PINEAPPLE), `max_blocks` 1 in both configs. ON enables `hooks.per-turn-gate`; OFF sets the same verifier but does not enable the hook (the mutation). Prompt "Reply with the word done."

## Readings

| Run | Hook log (`raw-excerpts/<run>.hook-log.jsonl`) | Transcript (`raw-excerpts/<run>.stream-excerpt.jsonl`) | Verdict |
|---|---|---|---|
| OFF (red) | exactly 1 record: `turn null, allow, off, counter 0` | model replied `done`; Stop hook_response empty; no feedback message | no block, as expected |
| ON (green) | exactly 2 records: `turn 1, block, block, counter 1`, then `turn 1, allow, cap, counter 1` (same prompt id) | model replied `done`; user message "Stop hook feedback: ... STUB-RULE ... PINEAPPLE ..."; model replied `PINEAPPLE`; session ended | one block in the log and one in the transcript, then released at the cap |

Identical to the superseded run: no difference was found between the old and the final hook on this probe. ON left the hook's state files (`<session>.jsonl`, `.turn`, `.t1.count`) and no stray lock file in the live directory after the call.

Not covered: the real t14 verifier (stub used), `violations+features` mode, multi-turn sessions, concurrent Stop invocations (the lock change is exercised by the unit tests, not by this live probe), the plugin's other Stop hooks (not loaded).

## Cost and files

total_cost_usd: OFF 0.0163, ON 0.0228; sum 0.0391 USD (cap 0.2; `cost.txt`). No reruns.

`raw-excerpts/` hold masked excerpts (same rules as P2-0: `<MKTEMP>`, `<SCRATCH>`, `<REPO>`, `<HOME>`, ids as `<run.sidK>`/`<run.pidK>`; message bodies kept as transcript evidence; usage tables dropped; scans for `sk-ant`, token fields, `Bearer`, the account name, and the UUID pattern `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}` find nothing). `*.jsonl` added with `git add -f` (a global ignore rule skips them). `sums.txt`: sha256 of the committed files, then of the unmasked raw files (kept in scratch).
