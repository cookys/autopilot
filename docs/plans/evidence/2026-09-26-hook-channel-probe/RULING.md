# Hook channel probe — PostToolUse / PostToolUseFailure / Stop reaching the model

Method: reused `p1-probe-nodecision`'s dump/inject.js style (Node hook appends raw
stdin to `payloads.jsonl`, emits only the field under test, exit code per variant).
All runs used `CLAUDE_CONFIG_DIR=$S/cfg` with only `.credentials.json` copied in
(no real `~/.claude` ever passed). Model observed via `claude -p` turn 1 +
`claude -p --resume <session_id>` turn 2 asking the model to quote any
`NONCE-STOP*` line it saw.

## Verdict lines

- **V1 PostToolUse/additionalContext: MODEL-VISIBLE** — hook fired on `echo hi`
  (payloads.jsonl `V1-PostToolUse` entry), main-turn model answered with
  `NONCE-PTU-7f3a9c` verbatim (`v1v2/out.txt`).
- **V2 PostToolUseFailure/additionalContext: MODEL-VISIBLE** — `PostToolUseFailure`
  is a real, distinct event: it fired only for the failing command
  (`/bin/false_does_not_exist_xyz`, payload has an `error` field and no
  `tool_response`, separate from the V1 success payload which has
  `tool_response`), and the same turn's model answer included
  `NONCE-PTUF-b81e2d` verbatim (`v1v2/out.txt`).
- **V3 Stop/systemMessage: NOT-VISIBLE** — hook fired both turns (2 `V3-Stop-systemMessage`
  entries in `payloads.jsonl`), but the emitted `NONCE-STOP-SM-4d9f21` appears
  in neither turn-1 stdout JSON (`v3/turn1.json` has no `systemMessage` key at
  all) nor the human-facing stdout/stderr; turn-2 resume asked directly and the
  model answered `NONE` (`v3/turn2.txt`) — the model never saw it.
- **V4 Stop/additionalContext: MODEL-VISIBLE (accepted, not rejected — but pathological)** —
  Claude Code does not reject the field; the transcript file contains
  `NONCE-STOP-AC-e02c77` 59 times. However the harness treats a Stop hook that
  keeps returning `additionalContext` (without honoring `stop_hook_active`) as
  a "don't stop" signal: it fires the same Stop hook repeatedly within one
  `-p` invocation (9 times per turn, `stop_hook_active` flips `true` after
  the first) until it hits an internal cap, and the model's final visible
  answer both turns was the generic `"Acknowledged."` rather than the
  requested text or a quote of the nonce — i.e. the field reaches the model's
  context every cycle but derails the actual turn instead of being cleanly
  recallable like V1/V2's additionalContext.
- **V5 Stop/exit-2+stderr: MODEL-VISIBLE, CONTINUES-SESSION** — the hook wrote
  `NONCE-STOP-X2-a17be4` to its own stderr and exited 2 only on the first
  firing (flag file); `claude`'s own process stderr was empty
  (`v5/turn1.err`) — the human running `-p` sees nothing — but the JSON
  result for turn 1 shows `num_turns: 2` and the model's `result` text quotes
  `NONCE-STOP-X2-a17be4` verbatim, explicitly reasoning about "the stop hook
  returned ... with no instruction attached" (`v5/turn1.json`). So the
  session continued for an extra internal turn and the nonce reached the
  model, confirmed again on the resumed turn 2 (`v5/turn2.txt`).

## Notes
- `payloads.jsonl` is the union of all variants' raw hook stdin (nonce values
  and `agent_id`-free); secret-scan below was run against the full evidence
  dir before commit-adjacent copy (not committed per brief).
- `$S/cfg` (the isolated CLAUDE_CONFIG_DIR containing the copied credentials)
  was deleted after the runs; only `payloads.jsonl`, hook scripts, settings,
  and turn outputs were copied here.
