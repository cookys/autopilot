# NC6 live: result (P2-1, plan section 4 NC6)

Date 2026-10-24. Hook under test: `hooks/per-turn-gate.js` at HEAD c23012aac, not modified. CLI 2.1.309 (`init` lines), alias claude-haiku-4-5. Expected readings were committed first: `expected.md`, commit 4f37ce60d (00:53:43Z); both real calls started later (`call-times.txt`: 00:53:45Z and 00:53:49Z).

## Method

`run.sh <off|on>` (this directory) builds everything under a `mktemp -d` root outside any work tree (it refuses otherwise): a config dir holding only a copy of `.credentials.json` (the real `~/.claude` is not given to the child), a per-run HOME, a scratch project whose `.claude/settings.json` wires only the hook as a Stop hook, `--setting-sources project`, `AUTOPILOT_LIVE_DIR` and `AUTOPILOT_CONFIG_FILE` pointing into the root, `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID`. The verifier is `stub-verifier.js` (always exit 1, one violation: reply with the single word PINEAPPLE). `max_blocks` is 1 in both configs. The ON config enables `hooks.per-turn-gate` and sets the verifier; the OFF config sets the same verifier but does not enable the hook (the mutation). Prompt: "Reply with the word done." Commands: `run.sh off`, `run.sh on`, both with `NC6_ROOT` set to one mktemp root.

## Readings

| Run | Hook log (`raw-excerpts/<run>.hook-log.jsonl`) | Transcript (`raw-excerpts/<run>.stream-excerpt.jsonl`) | Verdict |
|---|---|---|---|
| OFF (red) | exactly 1 record: `turn null, decision allow, reason off, counter 0` | model replied `done`; Stop hook_response empty; no feedback message | no block, as expected |
| ON (green) | exactly 2 records: `turn 1, block, block, counter 1`, then `turn 1, allow, cap, counter 1` (same prompt id) | model replied `done`; user message "Stop hook feedback: The change you just made breaks project rule 1: `STUB-RULE: ... PINEAPPLE` ..."; model replied `PINEAPPLE`; session ended | exactly one block in the log and one in the transcript, then released at the cap |

The debug excerpts (`raw-excerpts/<run>.debug-stop-lines.txt`) show the hook executing with status 0 and the CLI treating its output as a deny. NC6 is red-then-green: the knob-off mutation yields zero blocks, the knob-on configuration yields one.

Not covered: the real t14 verifier (a stub was used), `violations+features` mode, a multi-turn session, the other Stop hooks of the plugin (not loaded).

## Cost and files

total_cost_usd: OFF 0.0163, ON 0.0201; sum 0.0365 USD (cap 0.5). No reruns.

`raw-excerpts/` hold masked excerpts (same rules as P2-0: `<MKTEMP>`, `<SCRATCH>`, `<REPO>`, `<HOME>`, ids as `<run.sidK>`/`<run.pidK>`; assistant/user message bodies are kept here because they are the transcript evidence; usage tables dropped; no credentials: a scan for `sk-ant`, token fields, `Bearer` finds nothing). `*.jsonl` files were added with `git add -f` (a global ignore rule skips them). `sums.txt`: sha256 of the committed files and, in the last section, of the unmasked raw files (kept in scratch).
