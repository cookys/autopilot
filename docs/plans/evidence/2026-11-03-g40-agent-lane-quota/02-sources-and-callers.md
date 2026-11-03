# G40-data evidence: where each fact comes from

No real `claude` binary was run for this plan (PM instruction). Nothing here contains a token, an account
identifier or a host name.

## E1 Facts taken from the codeforge design (not re-measured here)

Source: repo codeforge, branch `feature/g40-usage-accounts`, commit `98c7a8b`, path
`doc/plans/2026-11-03-g40-usage-accounts.md`, section 1.1 (read with `git show 98c7a8b:<path>`).

| Fact | codeforge row | Mark in that doc |
|------|---------------|------------------|
| `claude -p --output-format stream-json --verbose` emits `type:"rate_limit_event"` between the assistant message and the result | 1 | VERIFIED (two runs, default login) |
| shape `rate_limit_info.{status,resetsAt,rateLimitType,unifiedWindows.{five_hour?,seven_day?}.{utilization 0-1,resetsAt unix s,status}}` | 2 | VERIFIED |
| values come from `anthropic-ratelimit-unified-*` headers; a window absent from the account state is absent from the event | 3 | VERIFIED (binary string) |
| both probes showed `seven_day` only, no `five_hour` | 4 | VERIFIED phenomenon, cause UNVERIFIED |
| single-object `--output-format json` carries no quota field | 5 | UNVERIFIED (inference) |
| a rejected request's result carries `rate_limit_info` in the same shape | 6 | binary string only |
| probe cost about 0.0016 USD API-equivalent, 8 output tokens, about 7.9K cache-creation tokens | 7 | VERIFIED |
| statusline input uses 0-100 (`used_percentage`), stored as 0-1 | 8 | VERIFIED (`src/cli/statusline.rs:401-408`) |
| `claude --help` has no usage subcommand | 11 | VERIFIED |
| `setup-token` token lasts 1 year (official page `code.claude.com/docs/en/authentication`, "generate a one-year OAuth token with claude setup-token"; binary constant 31536000 s) | section 2 | VERIFIED per that doc |

## E2 Local fixture run (synthetic, no API)

`01-parseenvelope-fixture.txt` is the output of running the shipped `parseEnvelope` (`scripts/claude-account.js`)
on a hand-written four-line stream-json fixture. Result: the function keeps only the last `type:"result"` line;
the `rate_limit_event` line is read and discarded. So passive capture needs a small addition next to it, not a
new parser.

## E3 What argv the wrapper passes (static reading)

`claude-account.js run` appends no flag of its own: it spawns exactly the `-- claude <argv...>` the caller gave
(`scripts/claude-account.js` cmdRun, execAttempt). Whether a `rate_limit_event` exists therefore depends only on
the caller's `--output-format`. The claude rails that call through the wrapper use `--output-format json`:
`scripts/dispatch-hetero.sh:3949`, `:3969`, `:3980`; the selftest prompt is also json
(`scripts/claude-account.js:788`). Consequence: with today's callers the passive channel yields no event.

## E4 Existing code the design reuses

- reader and merge point: `scripts/lib/account-quota.js` (`interpretSnapshot`, `PCT_MAX=1.5`, `MAX_AGE_MS=6h`,
  `FUTURE_SKEW_MS=5min`), `scripts/lib/account-pick.js` (pure picker).
- storage base: `scripts/lib/live-state-dir.js` `resolveLiveDir()`; durable state dir is `ctx.stateDir`
  (`scripts/claude-account.js`, `XDG_STATE_HOME`-based). Cooldown precedent: `<live_dir>/accounts/cooldown`.
- token write site: `scripts/accounts-onboard.sh` lines 213-225 (`token-write` marker).
- registry rejects unknown row keys (`scripts/lib/account-registry.js` ROW_KEYS), so token dates cannot go there.
