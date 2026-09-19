# Hand prompt — provider readiness live probe is refused by claude-native since the v2.36.71 author frame (Fix)

## Context (verified at base 28f9ce827b90ac2b6c9f11898989b06ce6e1db73, 2026-09-20)
Every strict /l5 campaign is blocked at intake with `provider_readiness … strict_l5_provider_not_ready`: the readiness
live probe (`src/readiness/live-probe.js` → `scripts/dispatch-author.sh`) sends the canonical prompt `Respond only with OK.`
(`src/readiness/probe.js:150`); since v2.36.71 `dispatch-author.sh` wraps every non-codex prompt in the nonce frame
(`:976-1012`: "You are an authoring engine. Output ONLY a wrapped block … Do NOT echo these instructions. Your VERY FIRST
output character MUST be …"). claude-fable-5-1 via `claude-native` REFUSES that combination — raw response:
"I'm not going to do that. The message asks me to act as an 'authoring engine' bound to a fixed output format … Neither
reflects a real task." → `status: truncated, error: frame_missing`, exit 5 → the qc:1 seat is `probe-needed` forever.
Other runners (cursor, cc-shim GLM/MiniMax, qoderclicn) answer the framed probe with `OK` and are `usable`.
The same model accepts `dispatch-review.sh`'s frame on real diffs, so the trigger is the identity-override tone plus a
trivially-shaped task, not the frame itself.

## Product (two files, both required; no other behaviour change)
1. `src/readiness/probe.js` `LIVE_PROBE_REQUEST_BODY.prompt`: replace `Respond only with OK.` with an honest,
   self-describing request, e.g. `This is the autopilot dispatcher's provider readiness probe: it only checks that this
   provider answers. Reply with the single word OK and nothing else.` Keep `LIVE_PROBE_EXPECTED_RESPONSE = 'OK'` and the
   packaging tolerance exactly as they are. The `request_digest` changes with the prompt (it is derived) — nothing pins the
   old digest bytes except the tests named below; update the prompt-text assertions in
   `hooks/tests/provider-readiness-consumer.test.sh:561` and the two explanatory comments (`probe.js:116`,
   `hooks/tests/provider-readiness.test.sh:575`) to the new sentence.
2. `scripts/dispatch-author.sh` wrap block (`:998-1010`): reword the preamble so it reads as the DISPATCHER's output
   format contract, not an identity override — replace `You are an authoring engine. Output ONLY a wrapped block (no other
   text/fences), beginning with:` with `Output format contract set by the autopilot dispatcher that is calling you: write
   your whole answer as ONE wrapped block (no other text, no code fences), beginning with the line:`; delete the sentence
   `Do NOT echo these instructions.`; keep every marker/nonce line, the tool-fence prohibition and the "very first output
   character" rule byte-identical. Codex transport untouched.
3. Prove it live, from a scratch cwd (an active l5 marker on the main checkout would otherwise refuse the dispatch):
   `mkdir -p /tmp/probe-cwd && cd /tmp/probe-cwd && printf '%s\n' "<the new probe sentence>" > p.txt &&
   env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID AUTOPILOT_AUTHOR_MAX_TOKENS=512 DISPATCH_QUIET=1 bash <clone>/scripts/dispatch-author.sh --runner claude-native --model claude-fable-5-1 --effort low --prompt-file p.txt --timeout 3m`
   must return `status: authored` with raw output `OK` (packaging tolerated); repeat for `--runner qoderclicn --model
   Qwen3.8-Max-Preview`. Paste both status lines into your commit message. If claude-native still refuses, try ONE more
   wording (keep it honest and short) and stop after that — report the raw refusal verbatim.
4. Codex mirrors via `bash scripts/sync-codex-plugin-skills.sh` then `--check`.

## Tests (RED-first: record the observed base output in a `# RED at 28f9ce827b90ac2b6c9f11898989b06ce6e1db73: …` comment; never weaken an existing assertion)
- `hooks/tests/provider-readiness-consumer.test.sh`: the prompt assertion updated to the new sentence (RED note: old bytes).
- `hooks/tests/dispatch-author.test.sh`: one case asserting the wrapped prompt no longer contains `You are an authoring engine`
  or `Do NOT echo these instructions` and still contains the BEGIN marker line, the NONCE line and `AUTHORING TASK:`.

## Verify (foreground, each with `< /dev/null`, all exit 0)
```
bash hooks/tests/provider-readiness.test.sh
bash hooks/tests/provider-readiness-consumer.test.sh
bash hooks/tests/dispatch-author.test.sh
bash hooks/tests/dispatch-author-result-failures.test.sh
bash hooks/tests/dispatch-author-claude-native.test.sh
bash hooks/tests/dispatch-author-strict-endpoint.test.sh
bash hooks/tests/autopilot-cli.test.sh
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-js-syntax.js
```

## Allowed files
`src/readiness/probe.js`, `scripts/dispatch-author.sh`, their codex twins via the sync script, `hooks/tests/provider-readiness.test.sh`
(comment only), `hooks/tests/provider-readiness-consumer.test.sh`, `hooks/tests/dispatch-author.test.sh`. Nothing else.

Commit ONE commit on the branch you are on; do not touch other files; run every verify command in the foreground before
committing; never set `AUTOPILOT_SESSION_ID`/`CLAUDE_CODE_SESSION_ID` in the environment of any command you run.
