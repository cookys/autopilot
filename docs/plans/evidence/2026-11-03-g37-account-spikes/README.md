# G37 P0 spikes (S2, S3, S4) and the path-contract fixture note

Date: 2026-11-03. Binary: `claude 2.1.317`. Lane L0 of `project/plans/2026-11-03-g37-account-switching.md` (section 8 P0, section 14 L0).

## Method and safety

- Every probe ran under `env -i` with `HOME` and `CLAUDE_CONFIG_DIR` pointing into a fresh tempdir, so no real `~/.claude`, credential or token was reachable.
- `ANTHROPIC_BASE_URL` pointed at `tools/local-synthetic-api.js`, a local server that answers every request itself (401, or a synthetic 429) and has no forwarding code path at all. This is not the pass-through proxy from `docs/plans/evidence/2026-10-21-subagent-concurrency-advisory/01-subagentstop-on-quota-error.md`, which forwards non-tripped requests to the real API; that recipe was deliberately NOT used. The proxy log shows only a label for the credential it saw (`env-token`, `creds-token`), never a value.
- Tokens: env token `FAKE-ENVTOKEN-...`; the decoy `.credentials.json` was fabricated in the tempdir with a `DECOY-CREDSTOKEN-...` access token and a far-future `expiresAt` (so no refresh call is attempted). `CLAUDE_CODE_MAX_RETRIES=0`, telemetry/autoupdate off.
- Reproduce: `bash tools/probe.sh <mode> <label> <decoy 0|1> <env-token 0|1>`.

## S2 - precedence of `CLAUDE_CODE_OAUTH_TOKEN` vs `.credentials.json` (OBSERVED)

Fixture: `fixtures/s2-decoy-observation.json`.

| Case | Credential the API saw |
|------|------------------------|
| env token + decoy credentials in the config dir | `env-token` (both requests); the decoy was never sent |
| decoy credentials only (control) | `creds-token` (so the decoy is a live candidate, the test can see it) |
| env token only | `env-token` |

Result: with both present, `CLAUDE_CODE_OAUTH_TOKEN` wins and the credentials file is not used as a fallback on a 401. Plan design D4 (remove the second source) does not depend on this; N1/O6 can now assert it. Not covered: a decoy at `$HOME/.claude` while `CLAUDE_CONFIG_DIR` points elsewhere (the plan removes that source by path contract).

## S3 - shape of a rate limit under `claude -p` (OBSERVED for HTTP 429; real subscription limit text NOT observed)

Fixtures: `fixtures/s3-claude-p-429.envelope.json`, `fixtures/s3-claude-p-429-usage.envelope.json` (envelope trimmed to the six fields below; `usage`, `modelUsage` etc. omitted, not a whole-line trim).

- A synthetic HTTP 429 `rate_limit_error` gives: exit code 1, one `type:"result"` JSON with `is_error:true`, `api_error_status:429`, `terminal_reason:"api_error"`, `subtype:"success"` (still "success"), and `result` starting `API Error: Server is temporarily limiting requests (not your usage limit) ...` followed by the server message. This matches the 2026-10-22 evidence from the pass-through recipe.
- Classifier gap FOUND: `engine-capability-state.js classify-error` returned `quota_exhausted` for that text because of the substring `usage limit` inside `(not your usage limit)`. A plain 429 must be `rate_limited` (short cooldown), not quota exhaustion. Fixed by removing the negated phrase before matching; real usage-limit wording still classifies `quota_exhausted`. Test 15 in `hooks/tests/engine-capability-state.test.sh`, negative control shown red (all three outputs `quota_exhausted` with the old code) then green.
- The `429-usage` fixture body text ("Claude AI usage limit reached|<epoch>") is INVENTED by this probe. It proves only the envelope shape and the classifier route, not the wording of a real subscription limit. The real wording stays an operator observation (plan section 9 O9/O6); unresolved, blast radius: the classifier may map a real limit message to `rate_limited` or `unknown`, which shortens the cooldown but does not break fail-closed behaviour.

## S4 - headroom in stream-json (FOUND, with a caveat)

Fixtures: `fixtures/s4-rate-limit-event.bare-429.json`, `fixtures/s4-rate-limit-event.synthetic-headers.json`.

- `claude -p --output-format stream-json --verbose` emits a `{"type":"rate_limit_event","rate_limit_info":{...}}` line. With a bare synthetic 429 it carries only `status:"rejected"` and `isUsingOverage:false`.
- When the (synthetic) response carries `anthropic-ratelimit-unified-*` headers, `rate_limit_info` also carries `resetsAt`, `rateLimitType` and `unifiedWindows.five_hour|seven_day` each with `utilization` (fraction, 1.02 in the fixture), `resetsAt` (unix seconds) and `status`. Header names were taken from the binary's string table (names only) and the response was fabricated locally.
- So stream-json CAN carry headroom, which answers the OQ2 shape question: a headless alias could refresh headroom from this event without a statusline. CAVEAT: whether the real API sends these headers on SUCCESSFUL responses (so an event arrives before any limit) was not observed; this spike only shows the event path on a rejected response. Not fixture-proven for non-429. Left as an operator/real-binary observation.
- With a 401 (no limit) stream-json emits `system/init`, `system/api_retry` x2, `assistant`, `result` and no headroom event.

## Path-contract fixture note

`fixtures/path-contract.json` restates plan section 2.5 (real home from the passwd entry, never `$HOME`; refusal of child HOME / config dir equal to or inside the real `~/.claude`; no symlink at the alias dir, `claude/` or `home/`; five absolute locator env vars; alias grammar `^[a-z0-9-]{1,24}$` with `acct-<8hex>` / `codex-<8hex>` reserved) as symbolic cases P1-P11 plus alias accept/refuse lists. Paths are symbolic so tests build them in a tempdir with an injected real home. The alias lists were checked against the grammar regex when the file was written.

## Unresolved (for plan section 10)

- Real subscription-limit message wording and whether the limit arrives as 429 or text-only (S3 remainder).
- Headroom events on successful responses (S4 caveat).
- S1 (`setup-token` behaviour) and S5 stay operator steps (O3, O5); `claude setup-token` was not run.
