# UserPromptSubmit hook output reach-the-model probe (P0, plan `docs/plans/_archive/2026/09/2026-09-26-hook-advisories-reach-model.md` §4)

Method: same as the parent `2026-09-26-hook-channel-probe` (see `../RULING.md`) —
a Node `UserPromptSubmit` hook appends raw stdin to `payloads-<v>.jsonl` and
emits its test payload; `CLAUDE_CONFIG_DIR=$S/cfg` with only `.credentials.json`
copied in (no real `~/.claude` ever passed); turn 1 is `claude -p
--output-format json "Say hello."` (captures `session_id`), turn 2 is `claude
-p --resume <id> --output-format json "Quote any line starting with
NONCE-UPS ..."`. Each variant's hook keeps a `counter.txt` so the nonce is
suffixed `-T<n>` and differs every turn, so a quote of turn 1's nonce can be
told apart from turn 2's.

- **U1 plain stdout**: hook prints `NONCE-UPS-TXT-a1b2c3-T<n>` as plain text, exit 0.
- **U2 additionalContext**: hook prints `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"NONCE-UPS-AC-d4e5f6-T<n>"}}`, exit 0.

## Runs

U1: hook fired 3 times (`payloads-u1.jsonl`, turns 1/2/3 — turn 2 was first
run without `--output-format json` by mistake and got re-run as turn "3"
with the flag; both are informative). Turn 1 ("Say hello") result has no
nonce. Turn 2 (`u1/turn2.json`, default text output) — the model's entire
response was `NONCE-UPS-TXT-a1b2c3-T2`, i.e. it echoed the *current* turn's
nonce verbatim as its answer to the hello prompt having leaked into its
context. Turn 2b (`u1/turn2b.json`, `--output-format json`, same resumed
session, prompt = the NONCE-quote question) — `result` is exactly
`NONCE-UPS-TXT-a1b2c3-T3`, matching the counter file's turn-3 value, not the
stale turn-1 or turn-2 nonce.

U2: hook fired 2 times (`payloads-u2.jsonl`). Turn 1 ("Say hello",
`u2/turn1.json`) result is plain "Hello! ..." with no nonce. Turn 2
(`u2/turn2.json`, resumed, NONCE-quote question) — `result` is exactly
`NONCE-UPS-AC-d4e5f6-T2`, the current turn's nonce from `additionalContext`.

Both variants: the hook's own stdout/JSON return is never printed to the
human-facing `-p` output by the harness itself — the nonce shows up in the
`-p` output only because the model quoted/echoed it as its answer (visible in
`result`), the same mechanism as V1/V2 in the parent probe. No raw hook-stdout
leak into the CLI's terminal stream independent of the model was observed.

## Verdict lines

- **U1 plain-stdout: MODEL-VISIBLE** — turn 2b's `result` is exactly
  `NONCE-UPS-TXT-a1b2c3-T3` (current turn's counter value), and turn 2's
  default-text run independently produced the current turn's `T2` nonce as
  its whole answer (`u1/turn2.json`, `u1/turn2b.json`).
- **U2 additionalContext: MODEL-VISIBLE** — turn 2's `result` is exactly
  `NONCE-UPS-AC-d4e5f6-T2`, the current turn's nonce (`u2/turn2.json`).
