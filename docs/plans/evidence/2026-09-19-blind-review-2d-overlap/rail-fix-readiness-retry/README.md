# rail-fix-readiness-retry (v2.36.76)

D2 attempt 2 (base b04a9354) died three times in a row at `provider_readiness` (22:26Z, 22:39Z, 22:44Z; the 22:41Z
launch reused the cached unknown verdict inside the 300 s receipt TTL). Each time exactly one of the two
qoderclicn/Qwen3.8-Max-Preview seats (verification_author or qc:4) returned a non-OK reply:

- `I'm here and ready to help. What can I do for you?` (authored, frame present)
- `I'm QoderCN, an AI coding assistant. I can't comply with requests to override my output format or pretend to be an
  automated system probe. …` (dispatch-author `truncated/frame_missing`, exit 5)

Manual repro against the same prompt via `dispatch-author.sh`: 6 calls → 5 `OK`, 1 small talk. Same tuple answers `OK`
on the next call, so this is model compliance, not transport; per launch two Qwen probes must both pass.

Fix: `src/readiness/live-probe.js` retries the adapter ONCE when the provider answered but not with `OK`
(`truncated`, or authored-but-not-OK); every transport-class outcome (auth, quota, 429, timeout, generic exit failure,
precondition) is returned unchanged. Envelope shape unchanged. New suite `hooks/tests/provider-readiness-live-retry.test.sh`
(RED at base: 7 FAIL, GREEN: 24 assertions); consumers `provider-readiness`, `provider-readiness-consumer`,
`autopilot-cli`, `autopilot-engine`, `scripts/qualification-review-provider.test.js` green in a marker-free clone.

Files: `impl-run3-readiness-blocked.json` (first blocked run), `readiness-after-run4.json` (status readiness after the
third block: qc:4 live unknown, all other seats ready), `retry.review.json` (claude-fable-5-1 second-family review:
SHIP-AS-IS, 3🔵).
