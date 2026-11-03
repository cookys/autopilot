# Plan — G40-data: the agent lane gets its own live quota for every alias
> Status: design only (no code in this plan's authoring commit). Owner: PM program. Branch: `hands/g40data/1`. Size: S (design); implementation phases below. Frame: builds on G37 (`project/plans/2026-11-03-g37-account-switching.md`) and the codeforge G40 design (codeforge `feature/g40-usage-accounts` @ `98c7a8b`, `doc/plans/2026-11-03-g40-usage-accounts.md`).

> **Amended 16:00Z by PM (operator direction): section 20 (provider-neutral contract keyed by provider and alias, adapter manifests, Claude adapter first) is binding and overrides the record shape of 6 and 18.1 and the phase order of 13 and 18.8.**
>
> **Amended 2026-11-04 by PM (addendum D, section 22: the fleet hub decisions, source fleet message 01M6H3S89D3MPBWVWEASJM27M2; fleet message 01M6H3W6FC4ZNJM450WZ64JAB4; fleet `develop` `cd91624`, `docs/plans/2026-11-04-g40-hub-quota-store.md`). Hub key is (namespace, provider, alias, writer_courier), namespace and writer taken from the authenticated connection; typed proto table with string patterns; only a courier writes and only its own row; `_access` `quota_publish` can deny; hard expiry `hub_received_at + 6 h`, no heartbeat; skew via `sent_at` into `observed_at_hub`, flagged over 5 min; per-host rows merged by the reader (section 5.2); hub limits 1 write per 10 s per key (burst 3), 60 per minute and 256 rows per courier, visible nack `quota_rate_limited`; snapshot plus deltas feeding the mirror; `unsupported` means `hub=absent`; `pct` adapter-local. Earlier text changed to match fleet: 5.4 hub key and questions 1-6 and Q8; 8.3 writer rule, tie-break and the higher-pct `quota_conflict` rule (dropped); 18.1 one row per alias; 18.2 push pacing (now bounded by the hub limits); 18.4 mirror authority and layout; section 6 `pct` as a record field (adapter-local only); 21.1 and 21.6 (hub expiry vs local persistence); phase P5 dependency (F4 and the freeze). N39-N43 added. Fleet design-note sha: `cd91624` (placeholder resolved). Addendum C (section 21): seven contract gaps closed in the schema body (token_state, remaining-only credits, one mirror root name, contract constants for the token warn levels, field-name mapping with Q11 resolved, L0 placeholder records, no history in v1); N31 to N38 added. Section 21 wins over 20.2 and 20.4 where they differ.**
>
> **Amended 15:54Z by PM (operator direction): sections 18 and 19 are binding and override 5.3, 5.4, 6, 8.3 and 13 where they differ (one contract, one store with a local mirror, an always-on zero-token courier reporter, and the probe experiment).**

## 0. Context / thesis

G37 picks an account per headless `claude` call from `codeforge.quota/1` snapshots. Those snapshots are written by the interactive statusline, which never runs under `claude -p`. So every headless-only alias is `class=unknown` forever, and a snapshot is at most as fresh as the last interactive render (G37 section 4.3).

The operator's position: the user lane (statusline, codeforge) and the agent lane (dispatch) are two separate roads. Dispatch must not depend on a file the statusline happens to write. This plan designs how the agent lane obtains per-alias quota by itself, publishes it, and reads a shared view, while still accepting the statusline snapshot as one more source.

## 1. Problem

For each alias, `pick` needs a current `{five_hour, seven_day}` utilization and reset time, produced by the agent lane's own traffic (or, optionally and only when enabled, a tiny probe), without reading any credential beyond what G37 already reads, and without per-call cost. Also: a token that expires in a year must warn before it dies.

## 2. OKR / KRs

- KR1 After a headless run that carried a rate-limit event, the alias has an observation younger than the run, with no statusline involved.
- KR2 `pick` classifies an alias `ok`/`tight` from an agent-lane observation when no usable statusline snapshot exists.
- KR3 No new spend by default: probing is off unless an operator switches it on.
- KR4 Every alias with a recorded issue date shows days-to-expiry; under 30 days warns.
- KR5 Every new check ships a negative control (section 9).

## 2.5 Global Constraints (copied verbatim into every dispatch)
- Node >= 20.10, built-ins only; JSON handling in Node, not shell (CLAUDE.md language rule).
- No token, credentials file, config-dir credential, host name, user name or email in any record, log, audit line, fixture or doc. A record carries the alias only.
- `pct` is a fraction 0..1 everywhere in this plan's records (the stream `utilization` scale and the `codeforge.quota/1` scale). 0..100 values (statusline `used_percentage`) are divided by 100 exactly once, at the boundary that receives them. The reader keeps the existing `PCT_MAX = 1.5` bound.
- `resets_at` is unix seconds; `observed_at` and every `*_ms` field is unix milliseconds. Token dates are unix seconds in the file and ISO in display only.
- Silence is never "ok": a missing, stale, invalid or future-dated observation is `unknown`, never `ok`.
- The wrapper never changes a caller's `--output-format`, exit code or stdout bytes because of quota capture. Capture and publish failures are swallowed (one debug line), never a new exit code.
- Probe defaults to OFF. It is enabled only by an explicit config key.
- ADR-0001: no hash chains, signatures or attestation for these records; freshness comes from re-deriving (the next run or probe), not from proving the writer.

## 2.6 Change-policy decisions
- Compatibility impact: additive. `codeforge.quota/1` is untouched and still read. `registry.json` is untouched (its row keys are strict; token dates go in a separate file). New records and a new reader path; `account-quota.js` and `account-pick.js` keep their public shapes, with one added output field (`source`, `observed_at_ms`).
- Dependency decision: none (no new package). Hub storage is a later phase that depends on fleet F4 and is not started here.

## 3. File-structure map (all future work; none edited by this plan)

| File | Change | Responsibility |
|------|--------|----------------|
| `scripts/lib/account-observation.js` (new) | add | schema `autopilot.account-quota/1`: build, validate, read, write one record; `mergeWindows` (section 5.2); unit conversion helpers |
| `scripts/lib/account-quota.js` | modify | `readQuota` also reads own records and merges with the codeforge snapshot, returns `source`, `observed_at_ms` |
| `scripts/lib/account-pick.js` | modify | carry `source` and `observed_at_ms` into `choice`; new pure `staleCandidates()` for the probe trigger |
| `scripts/claude-account.js` | modify | passive capture after each attempt (next to `parseEnvelope`); optional probe before pick; `status` prints source and age; new `usage-probe` subcommand (phase P4) |
| `scripts/accounts-onboard.sh` | modify | after the token write, record `issued_at` via a small Node helper (section 7) |
| `scripts/lib/account-token-meta.js` (new) | add | schema `autopilot.token-meta/1`: read/write `<accounts-dir>/<alias>/token-meta.json`, expiry arithmetic |
| `docs/guide/accounts.md`, `docs/guide/settings-reference.md`, `scripts/config-keys.json` | modify | document and register the new config keys (section 10) |
| `docs/scripts-inventory.md`, `CLAUDE.md` script lists | modify | per the "When adding a new script" rule |

## 4. Verified facts (each with its evidence)

Legend: VERIFIED = measured or read at the cited place; UNVERIFIED = not established, listed in section 12, never relied on.

| # | Fact | Mark | Evidence |
|---|------|------|----------|
| V1 | `claude -p ... --output-format stream-json --verbose` emits a `rate_limit_event` between the assistant message and the result | VERIFIED (by codeforge, two runs) | codeforge `98c7a8b` `doc/plans/2026-11-03-g40-usage-accounts.md` section 1.1 row 1; `docs/plans/evidence/2026-11-03-g40-agent-lane-quota/02-sources-and-callers.md` E1 |
| V2 | Shape: `rate_limit_info.{status, resetsAt, rateLimitType, unifiedWindows.{five_hour?, seven_day?}.{utilization 0..1, resetsAt unix s, status}}`; values come from `anthropic-ratelimit-unified-*` headers; a window not in the account state is absent | VERIFIED (same source rows 2 and 3) | same |
| V3 | A probe observed `seven_day` only, no `five_hour`; cause unknown | VERIFIED phenomenon, UNVERIFIED cause | same row 4 |
| V4 | The wrapper adds no flag; it runs the caller's argv. `parseEnvelope` keeps only the last `type:"result"` line and discards the event line | VERIFIED (code + fixture) | `scripts/claude-account.js` cmdRun/execAttempt/`parseEnvelope`; `01-parseenvelope-fixture.txt` |
| V5 | Today's claude rails behind the wrapper use `--output-format json` (hetero `scripts/dispatch-hetero.sh:3949,3969,3980`), so they produce no `rate_limit_event` | VERIFIED (static) | evidence E3. That the single-object json form carries no quota field is codeforge's inference (row 5, UNVERIFIED) |
| V6 | Probe cost about 0.0016 USD API-equivalent, 8 output tokens, about 7.9K cache-creation tokens. Subscription plans are not billed per token, so the share of quota consumed is not measured | VERIFIED for tokens, UNVERIFIED for quota share | codeforge row 7 |
| V7 | No `claude` subcommand reports usage; `auth status` reports login only. No official usage endpoint was found, so none is used | VERIFIED for the CLI help (codeforge row 11, G37 F1/F2); official-endpoint question UNVERIFIED (no URL to cite) | G37 plan 4.0 F1, F2 |
| V8 | `setup-token` tokens last 1 year; the command prints the token and does not save it | VERIFIED per official doc and binary constant | `https://code.claude.com/docs/en/authentication` ("generate a one-year OAuth token with `claude setup-token`"); codeforge doc section 2. `claude setup-token --help` lists no option, so a shorter lifetime cannot be requested from the CLI (UNVERIFIED that no env/other route exists) |
| V9 | Statusline scale is 0..100 (`used_percentage`), `codeforge.quota/1` stores 0..1 | VERIFIED | G37 plan 4.3; codeforge `src/cli/statusline.rs:401-408` |
| V10 | `codeforge.quota/1` has exactly the keys `schema, alias, root, written_at_ms, five_hour, seven_day`: no `source` field | VERIFIED | G37 plan 4.3; `scripts/lib/account-quota.js` header |

## 5. Design

### 5.1 Item 1 — passive capture (zero cost)

Answer to "does `claude -p` output carry rate-limit info?": yes in stream-json with `--verbose` (V1, V2), per-event fields in V2; unknown for the single json object (V5). It is not on every run: the event is sent when the rounded percentage, reset time, status or threshold changes, and per V3 a window can be missing. So the contract is "an event, when present, is recorded"; absence is not an error and not a zero.

Where: `claude-account.js run`, after `classifyAttempt` for each finished attempt (success or not, but never when the outcome is `token_scrubbed`). A new pure function `extractRateLimit(stdoutText)` scans stdout lines of type `rate_limit_event` (and, per codeforge row 6, `rate_limit_info` on a rejected `result`) and returns the LAST one. Input is the already-scrubbed attempt bytes. Output: `{ five_hour|null, seven_day|null }` with `pct = utilization` (already 0..1), `resets_at = resetsAt`.

Coverage reality (the biggest finding of this plan): with today's `--output-format json` callers (V5) there is no event, so passive capture alone would observe almost nothing from dispatch. Three ways to close it, in order of preference; the choice is a phase gate, not decided here:
- C1 Rail migration: callers that go through the wrapper switch to `--output-format stream-json --verbose` and read the final `result` line. Touches every rail parser (hetero envelope parsing), so it is M or L and carries regression risk.
- C2 Wrapper-side transparent transform: the wrapper rewrites `--output-format json` to `stream-json --verbose`, captures the event, and emits ONLY the final `result` object as stdout, so callers see one JSON object as before. Needs one operator-authorised measurement first: is the stream `result` line byte-equivalent in fields to the single json envelope, and does `--verbose` change stderr? Until measured it is UNVERIFIED and must not ship. Keep it behind a config key default off.
- C3 Do nothing: accept that only stream callers and probes feed observations.
Verifying "the wrapper's current stream-json params yield an event": the wrapper has no params of its own (V4); with a stream argv the existing shim-based tests can assert capture using a fixture, no API (phase P2 test).

Failure policy: capture never alters exit code, stdout, audit outcome. A malformed event is dropped and counted in the audit line field `quota_capture=bad_event`. The event is an observation of whichever account the attempt ran as, so the record key is the attempt's alias, never a caller-supplied one.

### 5.2 Item 3 (schema) and merging windows

Record file `autopilot.account-quota/1`, one per alias, written by the wrapper (section 6). Merge inside the reader (section 8) uses these rules:
1. Per record, a window is usable only if `resets_at*1000 > now`; an elapsed window is dropped (same as `account-quota.js`).
2. Whole record is dropped if `observed_at_ms` is older than `MAX_AGE_MS` (6 h, unchanged) or more than `FUTURE_SKEW_MS` (5 min) in the future.
3. Candidates for one alias: own record and the statusline snapshot (converted: `observed_at_ms = written_at_ms`, `source = statusline`, V10 means no source field to trust).
4. Result window by window: pick the window from the candidate with the newest `observed_at_ms`; if that candidate lacks the window but another still-live candidate has it, take the older one (a live window can only have grown, so the older value is a lower bound and `used` is not understated by more than growth since then); note `merged_floor` in the output.
5. Ties on `observed_at_ms` prefer own record (agent lane) over statusline.
6. `source` of the result is the source of the candidate that supplied the window that sets `used` (the max); the full per-window sources are kept for `status`.
This means a quiet alias with only an old record falls to `unknown` at 6 h, the same fail-safe as today.

### 5.3 Item 2 — probe only when the observation is stale

Default OFF (`accounts.quota_probe = "off"`), because whether one probe starts the 5-hour window clock is UNVERIFIED (codeforge open question 2). If it did, probing an idle alias would push its 5h reset later and distort the very number `pick` reads. Cheapest first:
1. Official, no-quota endpoint: none found (V7). Treated as UNVERIFIED and not used. If an official URL turns up, replace the probe with it and record the URL here.
2. Smallest model call: `claude -p --model haiku --output-format stream-json --verbose --tools "" --strict-mcp-config`, prompt of a few words, through the alias env (token from the alias file, same path as a run). Cost per V6: about 8 output tokens and about 7.9K cache-creation tokens (system prompt), roughly 0.0016 USD API-equivalent; share of subscription quota UNVERIFIED (to be measured under operator authorisation before enabling by default).

Trigger and N: the wrapper, in `gather`, asks pure `staleCandidates(accounts, merged, nowMs, N)` for aliases that are not excluded or cooling, whose best observation is older than N minutes (or missing), and whose last known `used` is below `TIGHT_THRESHOLD` (never probe an alias already at or above 0.90; it does not need refreshing and a tight alias is the one most likely to 429). Suggested N = 60 minutes (matches the codeforge proposal; 6 h hard staleness is unchanged), at most one probe per alias per N, serial, never more than 1 probe per `run` invocation, and never when the `run` is itself `--alias`-pinned (the pin chose already). A probe's observation is published like any other, `source: probe`. Probe failure (auth, 429, timeout) records nothing, applies the normal cooldown/auth-stop classification, and never blocks the real call: it is bounded by `accounts.quota_probe_timeout_secs` (default 20).

Two operator modes beyond the default: `quota_probe = "stale"` (the above) and `quota_probe = "off"`. A manual `claude-account.js usage-probe --alias A` (P4) is explicit and prints only `{alias, five_hour, seven_day}`.

### 5.4 Item 3 — publish

Wrapper writes the record after capture or probe. Contents (schema section 6). Local file, same schema as the future hub value:
- Path: `<live_dir>/accounts/quota/<alias>.json`, with `<live_dir>` from `resolveLiveDir()` in `scripts/lib/live-state-dir.js` (the same base that already holds `accounts/cooldown`, `claude-account.js` `ctx.liveDir`). 0600 in a 0700 directory made through `scripts/lib/runtime-paths.js` `ensurePrivateDir`. RAM-backed is fine: an observation is worth nothing after a reboot (6 h rule), and nothing here is a secret. Token dates are NOT stored here (they are durable; section 7).
- Writes are temp file + rename, one writer per alias per file; readers open with `O_NOFOLLOW` and fstat-limit (reuse `readSmallFile`).
- Hub (after fleet F4): same JSON as the value; key is `(namespace, provider, alias, writer_courier)` (decided, 22.1; the earlier `accounts/<alias>/quota` is superseded). Until the hub exists nothing else changes; the local file is the source of truth.

Questions for fleet--claude before the hub phase (P5): ALL SETTLED (fleet message 01M6H3S89D3MPBWVWEASJM27M2; fleet `develop` `cd91624`, `docs/plans/2026-11-04-g40-hub-quota-store.md`), answers in 22.1, each line below carries its answer:
1. SETTLED: key `(namespace, provider, alias, writer_courier)`, one row per host (22.1). Was: key naming and namespace (`accounts/<alias>/quota` per alias, or one `accounts` table keyed by alias plus `host`?). Two hosts that both run alias `main` observe the same account; do they write one key or `<alias>@<host_role>`?
2. SETTLED: only a courier writes, only its own row; the reporter is the only writer; `_access` `quota_publish` can deny (22.1). Was: write permission, who may write an alias key (any lane, or only the wrapper identity)? A lane must not be able to overwrite another account's record.
3. TTL: proposal 6 h to equal `MAX_AGE_MS`; does the hub expire or only the reader? SETTLED: both; the hub's hard cap is `hub_received_at + 6 h` (22.1).
4. Cross-host clocks: see section 11. Does the hub stamp `received_at_ms`? SETTLED: it stores `hub_received_at` for expiry and `observed_at_hub = observed_at + skew` from `sent_at` (22.1).
5. Conflict: two hosts write the same alias concurrently; rule proposed in 8.3 (newest observed wins per window). Does the hub give compare-and-set or last-writer-wins? SETTLED: neither is needed; each host keeps its own row and the reader merges newest per window (22.1).
6. Payload limit and rate: at most one write per alias per 30 s; size under 1 KiB. SETTLED: hub limits in 22.1; over a limit the hub answers a visible nack `quota_rate_limited`.

### 5.5 Item 4 — pick reads the shared view

Done in section 8 (concrete changes to `account-quota.js` and `account-pick.js`).

### 5.6 Item 5 — token expiry

Write point: `accounts-onboard.sh` after the successful token write (the `onboard:token-write` line, about line 215), by a small Node helper call that records, per alias, `issued_at` = now. The script does not know when `setup-token` actually ran (another pane), so `issued_at` is the paste time; a lag of minutes against a 365-day life is irrelevant. File: `<accounts-dir>/<alias>/token-meta.json`, schema `autopilot.token-meta/1`, 0600, `{schema, alias, issued_at, lifetime_days}`. It is NOT put in `registry.json` (strict row keys, evidence E4) and NOT in the live dir (durable data on tmpfs would be lost). Validity: V8 says 365 days; store `lifetime_days = 365` as the default and let the operator override per alias, since the CLI help offers no option and the lifetime of a token made elsewhere is unknown. `token_expires_at = issued_at + lifetime_days*86400`.
- Warn at 30 days remaining (config `accounts.token_warn_days`, default 30), higher severity at 7 days, `expired` after. Where it shows: `claude-account.js status` and `env-check` (a stderr warning line, never a failure: expiry is advisory, per the standing "expiry warns, never blocks" rule); the quota record carries both dates so the hub and codeforge can show them.
- A recorded 401 (`auth_failed`) overrides the dates: `status` shows `invalid` regardless of days left (a token can be revoked early; UNVERIFIED how often).
- Existing aliases without a file: `status` prints `token_expiry: unknown`; the operator backfills with `claude-account.js token-meta set --alias A --issued-at <date>` (P3). Backfilling from the token file's mtime is not done without the operator's consent (metadata of a secret file).
- The helper never reads the token file and never prints it.

## 6. Schema `autopilot.account-quota/1`

```json
{
  "schema": "autopilot.account-quota/1",
  "alias": "<alias>",
  "five_hour": { "pct": 0.0, "resets_at": 0 } ,
  "seven_day": { "pct": 0.0, "resets_at": 0 },
  "observed_at": 0,
  "source": "passive | probe | statusline",
  "host_role": "<role>",
  "token_issued_at": 0,
  "token_expires_at": 0
}
```
Rules: `five_hour` and `seven_day` are an object or `null` (V3 means either can be missing; `null` is "not reported", never 0). `pct` (adapter-local only after 22.1; the record field of the contract is `utilization`) is a finite number in `[0, 1.5]`; `resets_at` a positive integer in unix seconds. `observed_at` is unix milliseconds on the writer's clock, an integer. `source` is one of the three words; `statusline` appears only on the merged view of a codeforge snapshot, never written by the wrapper (V10). `host_role` is a short role word, `^[a-z0-9-]{1,24}$`, from config `accounts.host_role` (default `agent`); never a host name. `token_issued_at` and `token_expires_at` are unix seconds or `null`. Unknown keys: the record is rejected (`quota_invalid`), the same strictness as `codeforge.quota/1`. Maximum file size 4096 bytes. No other field; in particular no token, no config-dir path, no account email or organisation id. The alias is the only identity.

Units, once and for all: stream `utilization` (0..1) is stored as is. A statusline value (0..100) is divided by 100 at the statusline-reading boundary only, so the contract between code is always 0..1. A reader that sees `pct > 1.5` rejects the record (it is almost certainly a 0..100 value that skipped the conversion); the negative control in section 9 pins this.

## 7. File-format note: token metadata

`<accounts-dir>/<alias>/token-meta.json`: `{ "schema": "autopilot.token-meta/1", "alias": "...", "issued_at": 0, "lifetime_days": 365 }` plus nothing else. Requires that `env-check` and registry validation tolerate this extra file in `<alias>/` (they check named entries, not a whitelist; verified by reading `account-registry.js` section list in G37 5.1, but P3 must add a negative control proving a stray `.credentials.json` is still refused while `token-meta.json` is accepted).

## 8. Design for item 4 — what changes in the reader and the picker

### 8.1 `account-quota.js`
- Add `readObservation(liveBase, alias)` (via `account-observation.js`) next to `readSnapshotFile`.
- `readQuota` gains `mergeSources`: it reads both files, converts the snapshot into the observation shape (`source = statusline`, `observed_at = written_at_ms`), applies the rules of 5.2, and returns the current `{state, used, source, note, tight_resets}` plus `observed_at_ms` and `sources` (per window). `source` now takes `passive|probe|statusline|none` instead of `snapshot|none`; every existing caller that compares `source === 'snapshot'` is found by grep and updated in the same change (the old value `snapshot` is not kept as an alias, per the no-shim rule).
- `interpretSnapshot` stays a pure function over one snapshot; add `interpretObservations(list, opts)` pure over a list, so tests need no filesystem.

### 8.2 `account-pick.js`
- Input gains `observations: {alias: [record...]}` next to `snapshots`; if omitted, behaviour is exactly today's (negative control N8).
- Classes and ordering unchanged. `choice.source` and `choice.observed_at_ms` are returned; `status` shows them.
- New pure `staleCandidates({accounts, merged, cooldowns, exclude, nowMs, minutes})` for 5.3. `pick` itself never probes and never does fs or clock.

### 8.3 Cross-host global pick
With the hub (P5), the wrapper reads the hub's per-alias records and treats each as another observation candidate in the same merge (5.2): newest per window wins, ties go to the local own record, a record whose `host_role` differs is accepted (the account is the same, only the vantage differs). Two hosts that disagree by more than 0.15 on one window at near-equal `observed_at` produce a `quota_conflict` note and the HIGHER pct is used (understating is the dangerous direction). Each courier writes only its own row (the key includes `writer_courier`, 22.1); the merge happens at the reader, so there is no writer conflict at all. [Changed by 22.3: the `quota_conflict` higher-pct rule and the local tie-break above are replaced by fleet's rule, newest per window.]

## 9. Failure and degradation

| Situation | Behaviour |
|-----------|-----------|
| No observation, no snapshot | alias `unknown` (today's behaviour); never `ok` |
| Observation older than 6 h, or window past `resets_at` | `unknown` for that window/alias |
| Capture fails (bad event, write error) | swallowed; one audit field `quota_capture=<reason>`; exit code and stdout unchanged |
| Hub unreachable (P5) | fall back to local file silently, `quota_hub=down` in `status`; never blocks a call |
| Local live dir refused (`LIVE_DIR_REFUSED`) | publish skipped, read side sees nothing; the run itself proceeds |
| Clock: writer ahead by more than 5 min | record dropped as `quota_invalid` (existing rule); writer behind: looks older, falls to staler/unknown sooner, safe |
| Event lacks `five_hour` | window `null`; `used` computed from what exists; a note `quota_five_hour_missing` in `status` (see section 12 Q1) |
| Probe timeout/auth/429 | nothing recorded; normal classification applies; real call proceeds |
| Token expiry file absent or unreadable | `unknown`, no warning, no block |

## 10. Config keys (all under `accounts.*`, registered in `scripts/config-keys.json`)

`quota_probe` (`off|stale`, default `off`), `quota_probe_stale_minutes` (default 60, range 5..360), `quota_probe_timeout_secs` (default 20), `host_role` (default `agent`), `token_warn_days` (default 30), `quota_capture` (`on|off`, default `on`; zero-cost, so on).

## 11. Cross-host clock

`resets_at` is a server-provided absolute time, immune to skew. `observed_at` is the writer's clock, so skew only changes freshness: a record from a host up to 5 min ahead is accepted (the existing `FUTURE_SKEW_MS`), further ahead is dropped. The reader compares `observed_at` to its own `nowMs`, so a host whose clock is behind just looks older. When the hub stamps `received_at_ms`, the reader takes `min(observed_at, received_at)` for freshness (never trust a writer's claim of newness over the hub's).

## 12. Open questions (items 1 to 5 are evidence-gated; Q numbers are referenced above)

- Q1 With no recent run, does `five_hour` stay absent from the event (V3 cause)? It decides whether an idle alias shows `unknown` or `0`. Needs one operator-authorised comparison measurement (idle alias vs one used within 5 h).
- Q2 Does one probe start the 5-hour window clock? Gates `quota_probe` default; stays `off` until answered.
- Q3 Is the stream `result` line equivalent to the single json envelope (C2), and does `--verbose` change stderr? Gates the transparent transform.
- Q4 Does the single-object `--output-format json` carry any quota field? (codeforge inference only.)
- Q5 How much subscription quota does one probe consume? (tokens known, share unknown.)
- Q6 Is there an official, quota-free usage endpoint or `claude` subcommand? None found (V7); to be re-checked against the official docs before P4.
- Q7 `setup-token` lifetime: 1 year per official docs (V8); is it the same for team/enterprise subscriptions, and can the CLI be asked for a shorter lifetime? Unverified; treat 365 as default and allow override.
- Q8 [SETTLED by fleet message 01M6H3S89D3MPBWVWEASJM27M2; fleet message 01M6H3W6FC4ZNJM450WZ64JAB4; fleet `develop` `cd91624`, `docs/plans/2026-11-04-g40-hub-quota-store.md`; answers in 22.1] Hub questions in 5.4 (key naming, write permission, TTL, clocks, conflict, rate).
- Q9 `host_role` vocabulary: free role word or a fixed set? Proposed config default `agent`, set by the operator; confirm with fleet--claude whether fleet already has a role field to reuse.
- Q10 Pick is read-mostly on every run: reading two small files per alias per run is cheap, but the hub read in P5 adds latency; budget and timeout need a number from the fleet side.

## 13. Phases (each independently shippable; acceptance = "done when")

| Phase | Size | Content | Done when |
|-------|------|---------|-----------|
| P1 | S | `account-observation.js`: schema validate/read/write, unit rules, `interpretObservations`/merge (5.2); `account-quota.js`/`account-pick.js` changes (section 8); no wrapper change | pure tests for merge, ties, floor rule, stale, skew; N1-N6, N8 red then green |
| P2 | M | wrapper passive capture (`extractRateLimit`, 5.1) + publish (5.4) + `status` columns; shim fixture with a stream argv; decision record for C1/C2/C3 | a stream run through the shim writes a record; json run writes none and still exits unchanged; N7, N9, N10 red then green |
| P3 | S | token meta (section 7): onboard helper, `status`/`env-check` warning, `token-meta set` | warn at 30 and 7 days, `expired`, 401 overrides; N11, N12 red then green |
| P4 | M | probe (5.3): `usage-probe` subcommand, `staleCandidates`, config, bounded timeout; blocked until Q2 and Q5 answered under operator authorisation; default stays `off` | probe off by default proven; N13 to N15 red then green |
| P5 | L | hub publish/read (5.4, 8.3); blocked on fleet F4 and the coordination answers | two-host scenario test; hub-down fallback; N16, N17 |
| P6 (C1/C2 only if chosen) | M or L | rail migration or transparent transform | existing rail suites still pass; stdout byte-identical for a json caller |

Dependency map: P1 then P2; P3 independent of P1/P2; P4 after P2 plus Q2, Q5; P5 after P2 plus F4; P6 after P2 plus Q3.

## 14. Negative controls (every one shown red before green; ship with the check it guards)

- N1 A record with `pct` 62 (0..100 scale skipped conversion) is rejected as `quota_invalid`, alias not `ok`.
- N2 A record with an unknown key is rejected; with a token-shaped string anywhere (fixture token) the writer refuses to write.
- N3 A record older than 6 h, or 10 min in the future, yields `unknown`.
- N4 A window with `resets_at` in the past is ignored.
- N5 Merge: a fresher statusline snapshot beats an older own record and vice versa; a tie prefers own record.
- N6 Missing `five_hour` never becomes 0 and never makes an otherwise tight alias `ok` (merge keeps a live older window as floor).
- N7 Writer refuses a symlink target and a wrong-mode directory (reuses `runtime-paths`/`live-state-dir` refusals).
- N8 `pick` with no `observations` input equals today's output byte-for-byte on the existing fixtures.
- N9 A stream argv with an event records; a json argv records nothing; a malformed event is dropped; in every case exit code and stdout bytes equal the run without capture.
- N10 A fixture child that prints the token inside an event line is scrubbed before capture (record contains no token; outcome `token_scrubbed`).
- N11 Token meta: 29, 7 and 0 days boundaries; absent file is `unknown` not `ok`.
- N12 A `.credentials.json` in `<alias>/claude/` is still refused while `token-meta.json` beside the token is accepted; the helper never opens the token file (test with an unreadable token file).
- N13 Probe disabled by default: with `quota_probe` unset a stale alias triggers zero spawns (counted by the shim).
- N14 A tight alias (>= 0.90) is never probed; a cooling or pinned run never probes.
- N15 Probe timeout and 401 do not change the real call's outcome.
- N16 Hub down: pick result equals local-only result.
- N17 Two hosts disagree by more than 0.15: higher pct wins and `quota_conflict` is noted.

## 15. Risks and inversion

What would guarantee failure: (a) all dispatch rails stay on json, so the passive channel yields nothing and the design looks finished but observes nothing (mitigation: P2 acceptance includes a coverage line in `status`, "observations in last 24 h per alias", and the C1/C2/C3 decision is explicit); (b) a probe moves the 5h window and `pick` chases its own measurement (mitigation: off by default, Q2 gate, never probe tight); (c) a unit slip (0..100 vs 0..1) silently marks an alias `ok`(N1); (d) quota records on shared tmpfs become a covert channel between lanes (mitigation: 0600, alias-only content, one writer identity); (e) the hub is trusted for freshness (mitigation: `min(observed_at, received_at)`).

## 16. Out of scope

Any code in this commit; running `claude setup-token`; real-binary measurement; changes to `~/projects/codeforge` or to `codeforge.quota/1`; the display side (bands, panes, charts: codeforge's); historical trends; per-model weekly limits (`seven_day_opus` and similar); synthetic 429 traffic; hub implementation.

## 17. Self-review

- Scope coverage: items 1 (5.1), 2 (5.3), 3 (5.4, 6), 4 (5.5, 8), 5 (5.6, 7) each map to a phase; the three PM open questions map to Q1, Q2 and section 6 units.
- Placeholder scan: no TODO/TBD left in a load-bearing step; unknowns are named Q-items with owners/gates.
- Dependency map in section 13; risks in section 15.

## 18. Addendum A (PM, operator direction 15:54Z): one contract, one store, always-on reporter

This addendum is binding and wins over sections 5.3, 5.4, 6, 8.3 and 13 wherever they differ. Those sections stay as the first design pass; section 18.8 lists exactly what changes in each.

### 18.1 One contract, one store

Every source writes the SAME record schema. The record goes through the local courier into the fleet hub's quota table (one row per (namespace, provider, alias, writer_courier), 22.1). Every display and reader (codeforge chip, statusline, `codeforge usage accounts`, `claude-account.js pick`) reads the hub or its local mirror (18.4). No second pipeline: nothing reads `codeforge.quota/1` files, wrapper records or probe output directly for display or for pick once the mirror exists.

Sources (the `source` field):
- `statusline`: the interactive session's statusline feed (today the codeforge `quota/<alias>.json` snapshot; zero token).
- `passive`: the G37 wrapper capturing a `rate_limit_event` from a finished run (zero token; coverage depends on 18.7).
- `probe`: the only source that spends tokens (section 19).

Contract `fleet.account-quota/1` (replaces the section 6 record; same alias-only rule, no token, no path, no email, no organisation id):
```json
{
  "schema": "fleet.account-quota/1",
  "alias": "<alias>",
  "five_hour": { "utilization": 0.0, "resetsAt": 0 },
  "seven_day": { "utilization": 0.0, "resetsAt": 0 },
  "observed_at": 0,
  "source": "statusline | passive | probe",
  "host_role": "<role>",
  "token_issued_at": 0,
  "token_expires_at": 0
}
```
Pinned units (they replace the section 2.5 `pct` / `resets_at` spelling; the Global Constraint line is amended in 18.8):
- `utilization`: fraction 0..1 (the stream-event scale, V2). Accepted range `[0, 1.5]`, anything above is rejected `quota_invalid` (it is almost certainly an unconverted 0..100 value).
- `resetsAt`: epoch seconds, integer (the stream-event scale, V2).
- `observed_at`: epoch milliseconds on the observing host's clock (the exception to "seconds": it is a freshness stamp, not a server value; kept in ms to match `written_at_ms`).
- `five_hour` / `seven_day`: object or `null`; `null` means "not reported", never 0 (V3).
- Conversion rule at each boundary, once, before the write: statusline `used_percentage` (0..100) -> `utilization = used_percentage / 100`; statusline `resets_at` is already epoch seconds (V9) -> `resetsAt` unchanged; `codeforge.quota/1` (`pct` already 0..1, `resets_at` seconds, `written_at_ms`) -> rename fields, `observed_at = written_at_ms`; stream event: copy `utilization` and `resetsAt` verbatim.
- Mapping to the existing reader: `account-quota.js` reads `pct` / `resets_at`; the adapter that turns a hub or mirror record into the shape `interpretSnapshot` expects is the only place that renames (`utilization` -> `pct`, `resetsAt` -> `resets_at`). Naming consistency with codeforge is an open question (Q11).

### 18.2 Courier-side reporter (always on, zero token)

A reporter runs in the local courier for the life of the courier. It never calls the API and never touches a token or credentials file, so leaving it on costs nothing. It only normalises local observations (the codeforge statusline snapshot files, the wrapper's passive and probe mirror records) into the contract and pushes to the hub when something changed.

When is it a change (compared with the last record this reporter pushed, per alias, per window):
1. `utilization` rounded to whole percent differs (`round(u*100)`). The stream event itself is emitted on a rounded-percent change (V2), so a sub-percent move is not a signal.
2. `resetsAt` differs by more than 60 s. A 60 s tolerance exists because the header value is a server timestamp that may jitter by a second or two; that jitter is UNVERIFIED (no repeated-header sample was taken), so the tolerance is a guard, tightened if samples show none. A real window rollover moves `resetsAt` by hours, so 60 s loses nothing.
3. A window appears or disappears (`null` <-> object).
4. The alias has no record in the hub yet, or the hub's copy of this alias has been missing since the reporter started.
5. `source` is not part of the comparison: the same numbers from a different source are not a change (otherwise statusline and passive would ping-pong).

Debounce and rate limit:
- Trailing debounce 5 s: bursts of changes within 5 s collapse into one push carrying the latest values.
- Minimum 30 s between pushes for one alias (matches the existing statusline snapshot throttle, `WRITE_EVERY_MS` 30 s), except rule 4 and a status change to `rejected` / limit reached, which push at once.
- Last-writer ordering is by `observed_at`: the reporter never pushes a record whose `observed_at` is older than what it last pushed.
- No heartbeat: an unchanged observation is not re-pushed and its `observed_at` is never refreshed by the reporter (freshness must not be forged). The hub copy ages out by the reader's 6 h rule (5.2) exactly as before. Cost of silence: a stable idle alias shows an old `observed_at`; that is correct, and is what makes the probe's "skip if recent" rule (19.5) meaningful.
- [Amended by 22.5: every push, including the "at once" ones above, is paced by a local token bucket equal to the hub limits.] Hub down: keep the newest record per alias in the local mirror (18.4), retry with backoff 5 s -> 5 min cap, drop nothing newer than what is mirrored; on reconnect push only the changed ones.

### 18.3 Where each source enters

| Source | Writer | Enters through |
|--------|--------|----------------|
| `statusline` | codeforge statusline (user lane, unchanged) writes its snapshot file | reporter reads that file, converts per 18.1, pushes |
| `passive` | G37 wrapper after each attempt (5.1) | wrapper writes the mirror record, reporter pushes |
| `probe` | wrapper `usage-probe` (19.5) | same mirror record, reporter pushes |

Because the reporter is the single publisher, "writers" never talk to the hub themselves; the wrapper only writes the mirror (a local file, 0600), and the codeforge statusline path stays untouched. Reading the codeforge snapshot is read-only for this plan (G37 4.3).

### 18.4 Local mirror (replaces "local file first")

The section 5.4 "local file first, hub later" is replaced by: the hub is the store; the local file is its mirror.
- Same contract, same schema, same file shape as the hub row, at `<live_dir>/accounts/quota/<alias>.json` (path from `resolveLiveDir()`, directory via `runtime-paths.js`, as in 5.4).
- Direction: the mirror is written by (a) the wrapper (passive and probe, before the reporter pushes), and (b) the reporter, which refreshes it from the hub (pull side) so a host with no direct hub path still sees other hosts' observations. Readers (pick, display) read ONLY the mirror; the reporter is the only code that talks to the hub. This gives pick a no-network read path and keeps the display side from forming a parallel pipeline.
- [Amended by 22.2: the hub holds one row per writer courier; pulled rows of other couriers go to a separate peers file and the own file is never overwritten by a pull.] Authority on conflict: hub row vs mirror row for the same alias: the one with the newer `observed_at` wins, per window, with the section 5.2 rules; a mirror row newer than the hub's is pushed (it is the unpushed pending state). The mirror is never authoritative against a newer hub row.
- Until the hub exists (fleet F4): the mirror alone, same schema; the reporter's push step is a no-op that logs `hub=absent`. Nothing about readers changes when the hub arrives. This replaces the old P1..P5 ordering of "local first, then a different format at the hub".

### 18.5 What stays for section 5.2 and 8

The merge rules (per-window newest wins, tie prefers the locally observed record, floor rule, 6 h and 5 min skew limits) are unchanged; they now run over mirror rows whose `source` may be any of the three, including statusline-derived rows that arrived through the reporter (so `account-quota.js` no longer needs to read `codeforge.quota/1` itself once the reporter is live; until then it keeps the direct read as the fallback, section 8.1).

### 18.6 Zero-token sources (checked, not assumed)

Question: is there any data source that gives the 5 h and 7 d utilization without spending tokens? Checked on the installed `claude 2.1.317` with `--help` only (no API call, no `auth status` run):
- `claude --help` command list (full): `agents, attach, auth, auto-mode, doctor, gateway, import, install, logs, mcp, plugin, purge, respawn, rm, setup-token, stop, ultrareview, update`. No `usage`, `stats`, `quota` or `limits` subcommand. `claude usage --help` and `claude stats --help` fall through to the top-level help (they are treated as a prompt), which confirms they are not commands.
- `claude auth --help`: `login, logout, status`. `claude auth status -h`: "Show authentication status", options `--json` (default) and `--text`. The description is authentication status, not usage. Whether its JSON contains any quota field: not run, so UNVERIFIED; the codeforge doc (row 11) only says it answers login state. The check to close it is one zero-token run of `claude auth status --json` by someone who may see the (account-identifying) output, with the keys redacted: that run is quota-free (it reads local login state), but it is not done here because its output names the account.
- `claude doctor --help`: "Check the health of your Claude Code installation. Reads settings files ..."; installation health, not usage.
- `claude gateway`: "Run the enterprise auth/telemetry gateway": an enterprise component; not examined; not a per-subscription usage source for these aliases (UNVERIFIED, noted not used).
- Statusline stdin JSON `rate_limits.five_hour|seven_day.{used_percentage, resets_at}`: zero token and already in use (codeforge `src/cli/statusline.rs:401-408`, row 8), but only in interactive sessions. Official doc URL for the statusline input schema was not fetched in this lane; the evidence is codeforge's reading of the real input. UNVERIFIED against the official page.
- Interactive slash command `/usage` (or similar): not checked; it exists only inside an interactive session, so it is not scriptable for the agent lane; not found in the CLI help; UNVERIFIED.
- Official documentation: no usage or quota API found in the pages already cited by this plan (`https://code.claude.com/docs/en/authentication` covers `setup-token` and login only). Not exhaustively searched on the web in this lane. Any OAuth usage endpoint a person could find by reading the client would be unpublished and would need the token, so it is rejected by design (codeforge section 1.2 (c)).
- codeforge design read (`98c7a8b`, section 1.2 (c)): "`claude auth status` exists but answers login state, not usage; calling an OAuth usage API directly needs the token and an undocumented endpoint: not adopted."
Result: found only two zero-token sources: the interactive statusline feed and the stream `rate_limit_event` already present in output the agent lane pays for anyway (passive). Not found: any quota-free, token-free-callable way to read an idle alias's usage. That is exactly why the probe exists and why section 19 matters. Re-check against the official docs before enabling probes by default (add to the experiment's preconditions).

### 18.7 Re-assessment: dispatch rails use `--output-format json`

Evidence E3 stands: the claude rails behind the wrapper use `--output-format json` (`scripts/dispatch-hetero.sh:3949,3969,3980`), and codeforge infers (UNVERIFIED, row 5) that a single json object carries no quota field. In the new architecture:
- Courier reporter: unaffected by the output format. It is source-agnostic and reads local records; it never sees run output. What changes is how many records exist for it to push. With json callers, a headless-only alias gets nothing from passive capture, so its hub row comes from the probe (and from the statusline if someone also uses it interactively).
- Passive capture: its value is capped by the rail formats. It records only for stream callers (the foreman's kimi stream is a different engine, not claude). So passive stays a free bonus for the stream callers that exist and for any rail migrated later; it is not the primary feed for dispatch.
- Therefore probing moves from "optional supplement" to "the main feed for headless-only aliases". That makes the section 19 experiment the gating question for the whole design, not a detail.
- C1/C2/C3 recommendation updated: ship C3 (no rail change) first. Measure C2's precondition (stream `result` line equals the json envelope fields; Q3) as an extra step inside the section 19 experiment (it costs one more probe, 19.4 step E7). If equivalent, C2 (transparent transform in the wrapper, config-gated, default off) turns every json caller into a free observation source and the probe frequency can drop; if not, keep C3. C1 (migrating rails) is not recommended: it touches every rail parser for a signal a probe already gives cheaply.

### 18.8 Edits this addendum makes to earlier sections (apply in the same change when implementing)

- 2.5: replace the units line with: "`utilization` is a fraction 0..1 and `resetsAt` is epoch seconds in every record of this plan; 0..100 values are divided by 100 once, at the boundary that receives them; the reader bound `[0, 1.5]` is kept".
- 5.3: probe default is now decided by the section 19 decision tree (default stays `off` until the experiment has a recorded result); N moves to 19.5.
- 5.4 and 8.3: "local file first" and "the wrapper reads the hub" are replaced by 18.4 (hub is the store, mirror is its local copy, reporter is the only hub client).
- 6: the record schema is 18.1's `fleet.account-quota/1`; the wrapper writes it to the mirror.
- 13 phases: P1 builds the contract and mirror reader; P2 wrapper passive writes the mirror; new P2b (S): reporter (18.2) with a fake hub, enabled only when courier work is scheduled; P5 becomes "hub client in the reporter" (L, blocked on F4); P4 probe is blocked on the 19 experiment result.
- Negative controls added: N18 a record with `utilization` 62 is rejected; N19 the reporter does not push when only `source` differs or `resetsAt` moves less than 60 s; N20 two changes inside 5 s produce one push; N21 the reporter never pushes an older `observed_at` and never refreshes `observed_at` without a new observation; N22 hub down: pick output from the mirror equals the output with the hub up and the same rows; N23 the reporter source tree contains no read of a token or credentials path (static scan, shown red by a planted read).

## 19. Experiment: does a probe start the 5-hour window?

### 19.1 Question and why it matters

Does one probe against an idle account START that account's 5-hour window (and with it the reset clock)? Always-on cheap probing (the operator accepts a small, low-frequency, standing probe cost, about 0.0016 USD API-equivalent per probe, V6) is only safe if a probe does not move the clock; if it does, a probed idle alias would present a 5 h window it would not otherwise have, and the reset time `pick` reads would be the probe's own doing.

### 19.2 Who runs it and what authorisation it needs

This lane does NOT run it. It needs a real API call with an alias token.
- Executor: the operator, or a person/session the operator names through the PM. Not this hands lane.
- Authorisation required: (1) the operator names ONE alias to use (an account he is willing to have measured), in writing to the PM; (2) the operator's own confirmation of the spend (6 to 8 probes, roughly 0.01 to 0.013 USD API-equivalent in total, and an unknown share of that alias's subscription quota); (3) the run goes through the G37 wrapper (`claude-account.js run --alias <A>`), so no token is read by the executor. A PM "go" message does not by itself cover use of an account's credentials; the operator's confirmation is needed and should be recorded in the run's evidence directory.
- Not allowed: running it on an account in active use, using the default login instead of an alias, or sending any 429 traffic.

### 19.3 Preconditions (confirm the account is idle without spending)

All must hold and be written down before step E1:
1. The latest observation for the alias (statusline snapshot, wrapper mirror, or hub row) shows `five_hour` absent or `resetsAt` already in the past, and, if a statusline value exists, utilization 0.
2. No attempt for that alias in the wrapper audit file (`accounts-audit.jsonl`, `ctx.auditFile`) in the last 5 hours plus 30 minutes margin, and the operator confirms no interactive session, no other host and no other tool used the account in that time.
3. The probe command works against the alias (`claude-account.js env-check --alias <A>` passes; it spawns no claude).
4. The executor has a quiet terminal and a clock (UTC) and will not use the account for the duration (about 6 hours of observation, mostly waiting).
5. Re-check of 18.6 against the official docs, so a free source is not missed.
If condition 1 or 2 cannot be established, the account is not idle and the experiment is invalid; pick another alias or wait.

### 19.4 Procedure (each step output goes to a file in a temp dir; only field names and the numbers below are kept)

Probe command (the executor substitutes `<A>`; the prompt is a few words):
```
node scripts/claude-account.js run --alias <A> --purpose quota-experiment --timeout 60 \
  --stdout <tmp>/e<k>.out --stderr <tmp>/e<k>.err -- \
  claude -p --model haiku --output-format stream-json --verbose --tools "" --strict-mcp-config 'Reply with OK'
```
Extraction (no tokens printed): load `<tmp>/e<k>.out` with Node, find the line with `type:"rate_limit_event"`, print only `unifiedWindows.five_hour` and `seven_day` (`utilization`, `resetsAt`, `status`), `rateLimitType`, and from the `result` line `total_cost_usd`, `usage` token counts, exit code. Nothing else.

Steps:
- E1 (t0) record the baseline from zero-token sources (19.3 item 1) and the exact UTC time.
- E2 (t1, within 10 min of E1) probe 1. Record `five_hour` present/absent, `resetsAt`, `utilization`, plus `seven_day`. Keep the UTC send time `t1` (the time the request was made).
- E3 (t1 + 30 min) probe 2. Same record.
- E4 (t1 + 2 h) probe 3. Same record.
- E5 (t1 + 4 h 30 min) probe 4, just before the expected reset. Same record.
- E6 (t1 + 5 h 30 min) probe 5, after the expected reset. Same record. (Skip E4 to E6 if E2 shows `five_hour` absent: see the read-out below, and then run E4' below.)
- E4' (only if E2 shows `five_hour` absent) repeat a probe at t1 + 30 min, t1 + 2 h and t1 + 5 h 30 min to see whether it ever appears without any other use of the account.
- E7 (one extra, answers Q3 and Q4) immediately after E6, one probe with `--output-format json` and the same prompt; record the key names of the single envelope and whether any quota-like key exists; compare the json envelope's field names with the stream `result` line's.
Record per step: UTC time, probe sequence number, exit code, `five_hour{utilization, resetsAt, status}` or `absent`, `seven_day{...}`, `total_cost_usd`, `usage.input_tokens / output_tokens / cache_creation_input_tokens`. No session id, request id, email or organisation id; the transcript is written to `docs/plans/evidence/<run-date>-g40-window-experiment/` after `node scripts/leak-guard.js` and `scripts/redact-personal.js` pass.

### 19.5 Read-out

Let `d1 = resetsAt(E2) - t1` (seconds). Expected for a window started by the probe: close to 18000 (5 h), within the time the request took.
| Observation | Interpretation |
|-------------|----------------|
| E2 `five_hour` present, `d1` about 18000, and `resetsAt` unchanged at E3, E4, E5 | The probe STARTED the window, and later probes do not slide it (anchored at the first call). Probe starts the clock once. |
| E2 present, `d1` about 18000, and `resetsAt` moves forward with each later probe (E3 > E2, E4 > E3) | Every probe restarts or slides the window. Probing is harmful as a standing job. |
| E2 absent and absent through E4' | A probe does NOT start the window (or the server does not report it for a tiny call). Idle shows `five_hour` absent (answers Q1). |
| E2 absent, then present at a later probe with `resetsAt - t = 18000` of the later probe | Window started by the later probe, not the first: the first probe was too small to open it (or too early); record and treat as "does not start on the first call, but counts later" (needs a repeat). |
| E2 present with `d1` clearly less than 18000 or `resetsAt` before E2 | The precondition failed (account was not idle, or a clock problem); the run is void, not a result. |
| E6 shows a new `resetsAt` about 18000 after E6's time | Window rolled and was re-opened by the probe E6; consistent with "starts"; confirms the anchor logic. |

### 19.6 Decision tree (what the design does with the answer)

- A. Probe does NOT start the window (third row): default to periodic probing of every enrolled alias that has a token on that host: every P = 60 minutes, but SKIP an alias when it already has an observation (any source) newer than N = 30 minutes, and skip when its last known utilization is at or above 0.90. Reasons for N = 30 min: half the probe period, so a busy alias (passive or statusline feeding it more often than every 30 min) is never probed, an idle one is probed about once an hour; and a stream event is emitted when the rounded percent changes, so a 30 min-old observation is already coarse for headroom decisions but the 6 h hard staleness limit is far away. Cost: at most 24 probes per idle alias per day, about 0.04 USD API-equivalent per day (24 x 0.0016), plus an unmeasured quota share (Q5).
- B. Probe STARTS or slides the window (first, second rows): probing happens only just before pick and only when the best observation of the candidate aliases is older than 60 minutes: `pick` asks `staleCandidates` (5.3), the wrapper probes at most the top 1 stale candidate it is about to use, never the others. The alias being picked is going to be used immediately anyway, so starting its window costs nothing it would not have paid. No background schedule. Unknown (idle) aliases are never probed speculatively.
- C. Void or ambiguous (fifth or fourth row): repeat the experiment on a fresh idle alias; until a result exists the default is `quota_probe = off` and the system relies on statusline + passive only.
Record the answer here (section 12 Q2) and in the config comment when the default flips.

### 19.7 What the experiment does not settle

How much of the alias's subscription quota one probe consumes (Q5): the experiment records `utilization` before and after on a non-idle second alias only if the operator chooses to; it is not required for the tree. Whether an interactive session's first message starts the same window: out of scope.

### 19.8 Result for glm and minimax (run by lane g40swexp, 2026-11-03)

- glm: one probe at an idle 5 h entry started the window (reset = probe time + 5 h, utilization 0 to 1 %, stable at +60 s). Decision branch B applies to glm: probe only just before pick, never on a standing schedule. `starts_window: true`. Details: [starts-window/RESULT.md](../../docs/plans/evidence/2026-11-03-g40-agent-lane-quota/starts-window/RESULT.md).
- minimax: PENDING. The window was in use at T0 (fixed 5 h grid, 87 % remaining), so no probe was sent; a retry is scheduled for 20:03Z. `starts_window` stays `unknown` (treated as true) until it lands.
- Claude: not run (needs an idle alias); the rest of this section is unchanged.

## 20. Addendum B (PM, operator direction 16:00Z): provider-neutral contract and adapter manifests

Binding; it wins over sections 6 and 18.1 (record shape), 13 and 18.8 (phase order). Everything in 18 about the reporter, the mirror, the hub-as-store and the probe experiment stays, with the record shape below.

Reference providers (the operator's own accounts): agy, grok, codex, claude code, minimax, qoder, qoder-cli-cn, opencode, glm, kimi. Only the Claude adapter is built by this plan's first phases; the contract and the manifest are provider-neutral from day one.

### 20.1 The key is (provider, alias), not the harness

A quota record belongs to one billing account at one provider. The harness (the CLI that reads or spends it) is not part of the key: a session under opencode that spends a glm account writes provider `glm`, not `opencode`. Rule for naming: `provider` is whoever meters and limits the account. Whether `opencode`, `agy` or `qoder-cli-cn` is a provider or only a harness is decided per row by the capability matrix (20.5), not here.
- `provider`: `^[a-z0-9-]{1,24}$`, lowercase word from the matrix (for example `claude`, `codex`, `grok`, `kimi`, `glm`, `minimax`, `qoder`).
- `alias`: the existing alias grammar. The G37 registry stays Claude-only; its aliases are implicitly provider `claude`. No registry change is made for other providers in this plan.
- Hub key and mirror path: `quota/<provider>/<alias>` and `<live_dir>/quota/<provider>/<alias>.json`. (The earlier `accounts/quota/<alias>.json` becomes `quota/claude/<alias>.json`; nothing was shipped under the old path, so there is no migration or dual read.)

### 20.2 Record `fleet.quota/1` (replaces the 18.1 schema; same alias-only, no token, no path, no email rule)

```json
{
  "schema": "fleet.quota/1",
  "provider": "claude",
  "alias": "<alias>",
  "visibility": "L3",
  "windows": [
    { "kind": "rolling_5h", "utilization": 0.0, "used": null, "limit": null, "unit": null,
      "resets_at": 0, "source": "passive", "observed_at": 0 },
    { "kind": "weekly", "utilization": 0.0, "resets_at": 0, "source": "passive", "observed_at": 0 }
  ],
  "host_role": "<role>",
  "token_issued_at": 0,
  "token_expires_at": 0
}
```
Window fields:
- `kind`: one of `rolling_5h`, `weekly`, `daily`, `monthly`, `credits`, `rpm`, `tpm`. At most one window per `kind` per record. (`rpm/tpm` in the PM text is read as two kinds, `rpm` and `tpm`.)
- `utilization`: number 0..1 (accepted `[0, 1.5]`, above is `quota_invalid`). Required, except the remaining-only `credits` window of 21.2 where it is `null`. If a provider reports only `used` and `limit`, the adapter computes `utilization = used / limit` before the write; a window with no way to get a fraction is not written (that provider is L1, see 20.4).
- `used`, `limit`: optional non-negative numbers, both or neither, `unit` required when present: `requests`, `tokens` or `credits`.
- `resets_at`: epoch seconds integer, or `null` when the provider gives no reset time (then the window is usable for ordering but never for "tight until"; `null` is not 0). This spelling replaces `resetsAt` of 18.1: the stream-event adapter maps `resetsAt` to `resets_at`. All boundary conversions of 18.1 stand (0..100 divided by 100 once, before the write).
- `source`: one of `passive` (parsed from output the provider's CLI produced in a normal run, including the interactive statusline feed), `endpoint` (a zero-token endpoint or response header), `probe` (a tinyprobe call), `estimated` (a local counter against a plan limit), `429` (the provider refused a request). `statusline` of 18.1 is now `passive`.
- `observed_at`: epoch milliseconds of the observation, per window (so the section 5.2 per-window merge needs no record-level source).
Record-level: `visibility` is the adapter's effective level (20.4); `token_state` (21.1), `remaining` window field (21.2), L0 placeholder `source` (21.6); `host_role`, `token_issued_at`, `token_expires_at` as before (token dates may be `null` when the manifest says the lifetime is unknown).
Claude mapping: stream `unifiedWindows.five_hour` -> `rolling_5h`, `seven_day` -> `weekly`; `utilization` copied; `resetsAt` -> `resets_at`; source `passive` (event or statusline feed) or `probe`. `seven_day_opus` and `seven_day_sonnet` are not mapped (out of scope, 16).

Semantics shared by all providers:
- `429` windows: utilization 1.0, `resets_at` from the provider's retry hint when it has one, else `null`. G37's cooldown file remains the headless signal; the record is how other hosts learn of it.
- `estimated` windows may only make an alias look tighter: for ordering they can raise `used` and can classify `tight` (>= 0.90), never `ok`; an alias whose only windows are `estimated` and below 0.90 stays `unknown`. A local counter is not a measurement.
- Windows of kind `rpm` and `tpm` are short throttles: stored and displayed, but excluded from the `used` that decides class `ok`/`tight`; they feed the cooldown path only.
- `used` for pick = max `utilization` over live windows of kinds `rolling_5h`, `weekly`, `daily`, `monthly`, `credits` (not `rpm`/`tpm`). A window whose `resets_at` has passed is ignored (5.2 rule 1); `resets_at: null` never expires by clock, so only the 6 h observation age limit retires it.
- The reader adapter that feeds `interpretSnapshot` renames per window (`rolling_5h` -> `five_hour`, `weekly` -> `seven_day`, `utilization` -> `pct`) for Claude records; non-Claude kinds are handled by the generic `interpretWindows` added in P1.

### 20.3 Adapter manifest `fleet.quota-adapter/1`

One manifest per provider, a data file (proposed path `scripts/quota-adapters/<provider>.json`, validated by a new checker that follows the `config-keys.json` pattern). The manifest declares what is possible; adapter code implements the modes. Fields:
```json
{
  "schema": "fleet.quota-adapter/1",
  "provider": "claude",
  "visibility": "L3",
  "starts_window": "unknown",
  "windows": [ {"kind": "rolling_5h", "unit": null, "limit_known": false},
               {"kind": "weekly",     "unit": null, "limit_known": false} ],
  "capture": [
    {"mode": "passive",   "cost": "zero_token", "verified": true,
     "parser": "claude-stream-rate-limit-event", "needs": "stream-json --verbose",
     "evidence": "<url or evidence path>"},
    {"mode": "endpoint",  "cost": "zero_token", "verified": false,
     "note": "none found"},
    {"mode": "tinyprobe", "cost": "tokens", "verified": true,
     "argv_template": ["claude","-p","--model","haiku","--output-format","stream-json","--verbose","--tools","","--strict-mcp-config","<PROMPT>"],
     "est_cost_usd": 0.0016, "est_out_tokens": 8, "min_interval_minutes": 60,
     "starts_window": "unknown"},
    {"mode": "fallback",  "cost": "local",
     "counter": null, "plan_limit": null, "source": "estimated",
     "cooldown_on_429": {"default_minutes": 30}}
  ],
  "credential_ref": {"kind": "file", "path": "<accounts-dir>/<alias>/token"},
  "token_lifetime": {"days": 365, "evidence": "https://code.claude.com/docs/en/authentication"},
  "matrix_row": "capability-matrix.md#claude"
}
```
Rules:
1. Capture modes are listed in cost order, cheapest first: `passive` (parse normal run output), then `endpoint` (zero-token endpoint or header), then `tinyprobe` (spends tokens: the manifest states the exact argv template and the per-call cost), then `fallback` (a local counter against the plan's published limit, labelled `estimated`, plus the 429 cooldown). The runtime tries them in that order and stops at the first that yields a fresh window; it never calls a more expensive mode while a cheaper one produced a fresh observation (the `skip if recent` rule of 19.6 generalised).
2. `starts_window` is `true | false | "unknown"`, with the evidence path when not unknown. `unknown` is treated as `true` for any decision (conservative): probes then run only before pick, never on a standing schedule (19.6 branch B).
3. `credential_ref` holds a REFERENCE only: `kind` (`file`) and a path template under the accounts dir. Never a value. The checker rejects a manifest whose `credential_ref` is not a path template (no scheme, no `=`, no token-shaped string, no absolute path outside the accounts dir and the matrix-listed provider dirs). The adapter reads the credential through the existing wrapper path; the manifest checker and the reporter never open it.
4. `token_lifetime`: `{days, evidence}`; `days: null` means unknown and suppresses expiry warnings for that provider.
5. `visibility` is the highest level this manifest can reach with VERIFIED captures: L0 nothing is visible; L1 only a refusal (429 or equivalent) is visible; L2 a utilization percentage is visible but without reset times for every window; L3 full `windows[]` with reset times. A capture marked `"verified": false` never counts toward the level and is disabled at runtime. The record's `visibility` equals the highest level actually produced by the last observation, so a degraded adapter shows as degraded.
6. `capture[].verified` follows the matrix: a mode with no evidence is `false` and the matrix row must say what was checked (same rule as 18.6).
7. Pure data; adding a provider adds a manifest and an adapter implementation, never a new contract version.

Claude manifest values above come from this plan's own verified facts (V1 to V3, V6 to V8, 18.6). Everything else in a row is filled from the matrix.

### 20.4 Visibility levels and what pick does with them

| Level | Meaning | Record | Pick behaviour |
|-------|---------|--------|----------------|
| L0 | nothing visible | none (or a record with `windows: []`) | alias `unknown`; ordering by priority only |
| L1 | only a refusal is visible | `windows` contain only `429` entries | `unknown` until a 429, then cooling (G37 cooldown) |
| L2 | utilization visible, resets incomplete | windows with `utilization`, some `resets_at: null` | `ok` / `tight` from `utilization`; `tight` without a reset time uses the default cooldown instead of a reset |
| L3 | full | windows with `utilization` and `resets_at` | full behaviour of section 8 |

### 20.5 Capability matrix (produced by another lane)

The 10-provider capability survey is NOT part of this plan; lane `g40survey` produces it. This plan only reserves the place and the rule for using it:
- Location: the evidence directory `docs/plans/evidence/2026-11-03-g40-agent-lane-quota/capability-matrix.md` (see capability-matrix.md there; this lane does not create or edit it).
- Using the matrix to fill a manifest (one provider = one row):
  1. `provider` and its harness: take the provider that meters the account; a harness-only row (for example a CLI that fronts another vendor) gets no manifest of its own, its row points at the real provider's manifest.
  2. For each of the four capture modes, copy `verified` from the matrix's evidence mark; copy `cost` and the tinyprobe argv and per-call cost from the matrix; a mode the matrix marks "not found" becomes `verified: false` with `note` = what the matrix says was checked.
  3. `windows`: the matrix's list of window kinds and whether a limit number is public (`limit_known`).
  4. `visibility`: highest level that has at least one `verified: true` capture producing it.
  5. `starts_window`: the matrix cell, else `unknown`.
  6. `credential_ref`: the credential file or login location the matrix names, converted to a path template under the accounts dir; if the matrix gives only a value or a vendor keychain item with no path, the credential is not referenced and the mode that needs it is `verified: false`.
  7. `token_lifetime`: matrix cell with its URL, else `days: null`.
  8. `matrix_row`: the anchor of the row, so a reviewer can re-derive every field.
- A manifest field not backed by a matrix row (or by this plan's own verified facts for Claude) fails the manifest checker (negative control N27).

### 20.6 Phase order (replaces the order in 13 and 18.8)

| Phase | Size | Content | Gate |
|-------|------|---------|------|
| P1 | M | generic contract `fleet.quota/1`: schema validator, unit rules, `interpretWindows` + merge (5.2) generalised to `windows[]`, manifest schema and checker; Claude reader adapter (windows[] <-> `interpretSnapshot`) | pure tests; N1-N8 (rewritten for `windows[]`), N24-N30 red then green |
| P2 | M | Claude adapter, FIRST because G37 needs it: wrapper passive capture (5.1) writing `quota/claude/<alias>.json`, `status` columns, `manifest claude.json`; pick reads the mirror | fixture-driven; json caller records nothing and exits unchanged |
| P2b | S | generic reporter (18.2), provider-keyed, fake hub; reads any mirror under `quota/<provider>/` | N19-N23 |
| P3 | S | token meta, generic fields; lifetime from the manifest | N11, N12 |
| P4 | M | Claude tinyprobe, blocked on the 19 experiment | N13-N15 |
| P5 | L | hub client in the reporter, blocked on fleet F4; the hub change ships with or after F4 and never during a release freeze (fleet freeze until 2026-11-10T16:24Z), so P5 cannot start before then | N16, N17, N39-N43 |
| P6 | M/L | C2 transparent transform, only if Q3 is answered yes | byte-identical stdout for json callers |
| A-agy, A-grok, A-codex, A-minimax, A-qoder, A-qoder-cli-cn, A-opencode, A-glm, A-kimi | each S to M | one provider adapter each (manifest from the matrix row + implementation of the modes the manifest marks `verified`) | each is its own project and starts ONLY after the PM gives a go for that provider; none is started by this plan |
Dependency map: P1 -> P2 -> P2b; P3 after P1; P4 after P2 + experiment; P5 after P2b + F4; provider adapters after P1 + P2b + the matrix + a per-provider PM go.

### 20.7 Negative controls added

- N24 A record whose key says provider `a` but whose path or body says provider `b` is rejected (`provider_mismatch`).
- N25 A window of an unknown `kind`, a duplicate `kind`, a `used` without `limit`/`unit`, or a `unit` outside the enum is rejected.
- N26 An `estimated` window below 0.90 never yields class `ok`; at or above 0.90 it yields `tight`.
- N27 A manifest with a `verified: true` capture and no `evidence`/`matrix_row`, or with `starts_window` missing, fails the checker; a manifest enabling a capture marked `verified: false` fails.
- N28 A manifest `credential_ref` carrying a value (token-shaped string, `KEY=...`, a URL with userinfo) or a path outside the allowed roots fails; the checker never opens the referenced file (test: the path points at an unreadable fixture file and the check still passes/fails on the string alone).
- N29 `rpm` / `tpm` windows at 1.0 do not make an alias `tight`; a `weekly` window at 0.95 does.
- N30 `resets_at: null` on a `rolling_5h` window: usable for ordering, never extends a cooldown, retired by the 6 h age rule.

### 20.8 Additional open questions

- Q11 [RESOLVED in 21.5: the contract name is `fleet.quota/1`; codeforge's `codeforge.quota/1` file keeps `pct` and is converted at the adapter, no dual spelling in the contract] Field spelling: the contract now uses `resets_at` (PM 16:00Z) and `utilization`; the codeforge quota file uses `pct`. Is `fleet.quota/1` a codeforge-side name too, or does the hub keep its own schema name? Ask fleet--claude.
- Q12 Which of the ten names are providers and which are harnesses? Settled per row by the matrix; until then the provider word list in 20.1 is an example, not a registry.
- Q13 `rpm`/`tpm` and `credits` windows: do other lanes display them? The contract stores them, the pick ignores rpm/tpm.
- Q14 Where does the manifest checker run (preflight-release, the config-keys check pattern)? To settle in P1.

## 21. Addendum C (PM): seven contract gaps closed

Binding; it wins over 20.2 and 20.4 where they differ, and over 5.6 and 10 on the token warn levels. Source of the gaps: codeforge `5eb4ed7`, `doc/plans/2026-11-03-g40-usage-accounts.md` section 9 (read-only). Code is not changed by this section.

### 21.1 Token revoked or invalid: record field `token_state`

Record-level field `token_state`: `"ok" | "invalid" | "unknown"`. Absent is read as `unknown`. It is a different state from a 429 (a cooling window, retried after `resets_at`) and from stale data (older than 6 h, ignored): `invalid` says the credential itself is refused and no waiting fixes it.
- Set to `invalid` only by one of: (1) an authentication refusal on a call that used this alias's credential (HTTP 401 or 403, or the provider's documented auth-failure code; the existing `auth_failed` of 5.6); (2) the operator command `account set --state revoked`; (3) a manifest-verified endpoint that reports the credential invalid. Never by a 429, never by an old `observed_at`, never by `token_expires_at` passing (an expired date is its own warn level, 21.4).
- Set to `ok` only by a later successful authenticated call for that alias or `account set --state active`. Set to `unknown` when no authenticated call has been seen. `token_state` is a state, not a measurement: the 6 h age rule does NOT retire an `invalid` in the own mirror; only a state change does. [22.1: the hub row itself expires at `hub_received_at + 6 h` with no heartbeat; the reporter re-pushes a held `invalid` only under 18.2 rule 4 (hub copy missing), which never refreshes `observed_at`.]
- Reporter: a change of `token_state` pushes at once (same class as 18.2 rule 4), and counts as a change even when no window moved.
- Pick: an `invalid` alias is never selected, gets class `invalid` (not `cooling`, not `unknown`), no cooldown timer is started, and `claude-account.js status` shows it on its own line. Its windows stay in the record but are ignored for ordering.
- Display: `invalid` is drawn as the token chip (codeforge ordering: token chip first), with the alias and the word for revoked; no gauge, no utilization.

### 21.2 Credits balance without a denominator

`credits` windows (codex shows only a balance) may carry `used: null`, `limit: null` and a new optional window field `remaining` (non-negative number, `unit` required when present).
- Allowed shapes: (a) `used` and `limit` both set (as in 20.2), `remaining` optional and, if present, must equal `limit - used`; (b) remaining-only: `used: null`, `limit: null`, `remaining` set, `unit` set, and `utilization: null`.
- `utilization: null` is legal ONLY in shape (b), on kind `credits`. Any other kind or shape with a null `utilization` is `quota_invalid`. It is never 0 and never 1.
- Pick: a window with `utilization: null` is excluded from the `used` maximum (20.2). An alias whose only live windows are null-utilization stays class `unknown` (same rule as an `estimated`-only alias, N26), except `remaining == 0`, which classifies `tight` (balance exhausted). A balance can say "empty", never "plenty".
- Display: the row shows `remaining unit` text and no gauge and no percentage.

### 21.3 One mirror root name: `<live_dir>`

Pinned name: `<live_dir>`; mirror path `<live_dir>/quota/<provider>/<alias>.json`. codeforge's `<live_base>` is the same directory in the ordinary case; the two resolvers are:
- autopilot `resolveLiveDir()` (`scripts/lib/live-state-dir.js`): `$AUTOPILOT_LIVE_DIR` override (line 263, 282), else `$XDG_RUNTIME_DIR/autopilot` (line 244-245), else `<run-user-root>/<uid>/autopilot` when `XDG_RUNTIME_DIR` is unset and that dir exists (xdg-inferred, lines 246-251), else `/dev/shm/autopilot-<uid>` (line 254), else `~/.autopilot` (line 310).
- codeforge `resolve_live_base()` (`src/live.rs` at `5eb4ed7`): `$AUTOPILOT_LIVE_DIR` (lines 54-58), `$XDG_RUNTIME_DIR/autopilot` (59-65), `/dev/shm/autopilot-<uid>` (66-69), `/tmp/autopilot-<uid>` (70-74), else `~/.autopilot` (line 87).
- Same on: override, xdg, shm, `~/.autopilot` fallback. Different on exactly two points: autopilot has the xdg-inferred step and no `/tmp` candidate; codeforge has the `/tmp` candidate and no xdg-inferred step. codeforge's own files live one level below the base (`<live_base>/codeforge/...`); the quota mirror sits at `<live_dir>/quota/`, so the subdirectories never collide.
- Rule: `<live_dir>` is defined by the autopilot resolver. A reader in another repo must reproduce it exactly: add the xdg-inferred step, and a mirror found only under a `/tmp` candidate is not a mirror (not RAM-backed by the autopilot rule). Parity vectors: N37. Coordination item for codeforge, tracked there, not edited here.

### 21.4 Token warn levels are contract constants

Contract constants (a data file shared by every consumer, proposed `scripts/lib/quota-contract.json`; both the autopilot code and codeforge read the same values, the display never hard-codes them):
```json
{ "token_warn_days": { "notice": 30, "urgent": 7 }, "observation_max_age_hours": 6 }
```
- A token with `token_expires_at` minus now at or under `notice` days warns `notice`; at or under `urgent` days warns `urgent`; past the date `expired`. All three are advisory (expiry warns, never blocks).
- The config key `accounts.token_warn_days` (section 10) is removed in favour of the constant: one source, no decoupling between code and display. A warn level is derived by the reader from `token_expires_at`; the record does not carry it.

### 21.5 Field-name mapping (Q11 resolved)

| Concept | `fleet.quota/1` (contract, binding) | `codeforge.quota/1` file | 18.1 draft (superseded) | stream event |
|---------|-------------------------------------|---------------------------|-------------------------|--------------|
| fraction used | `utilization` 0..1 | `pct` 0..1 | `utilization` | `utilization` |
| reset time | `resets_at` epoch seconds, or null | `resets_at` epoch seconds | `resetsAt` | `resetsAt` |
| observation time | `observed_at` ms, per window | `written_at_ms` | `observed_at` (record) | none |
| 5 h window | `kind: "rolling_5h"` in `windows[]` | top-level 5 h entry | `five_hour` | `unifiedWindows.five_hour` |
| 7 d window | `kind: "weekly"` | top-level 7 d entry | `seven_day` | `unifiedWindows.seven_day` |
| schema name | `fleet.quota/1` | `codeforge.quota/1` | `fleet.account-quota/1` | n/a |
The codeforge file keeps its own names and schema; it is an input to the reporter's adapter, converted once at the boundary (18.1 rule). The contract has exactly one spelling. A record carrying `pct`, `resetsAt`, `five_hour` or `seven_day` is rejected by the validator (N38), never silently renamed. Display code locks onto `fleet.quota/1` (codeforge 14). When this contract's version is frozen, codeforge is told.

### 21.6 L0 placeholder record for aliases with no data

For every alias in the G37 registry (implicitly provider `claude`, 20.1) that has no mirror record and no hub row, the reporter pushes one placeholder per cycle that finds the gap, so the display can show an account that was never observed:
```json
{ "schema": "fleet.quota/1", "provider": "claude", "alias": "<alias>", "visibility": "L0",
  "windows": [], "source": "registry", "host_role": "<role>", "token_state": "unknown",
  "token_issued_at": null, "token_expires_at": null }
```
- `source` is a record-level field allowed ONLY here: value `registry`, valid only when `windows` is empty (a window-level `source` cannot exist without a window). A record with non-empty `windows` and a record-level `source` is rejected.
- No `observed_at` anywhere (nothing was observed; freshness is not forged). Token dates come from the registry's token metadata when present, else null; never a token value.
- A placeholder is only pushed when no real record exists; any real observation replaces it, and a placeholder never overwrites a real record. It is not retired by the 6 h reader rule (it carries no measurement); the hub copy still expires at `hub_received_at + 6 h` (22.1), so the reporter re-pushes the placeholder under 18.2 rule 4 when the hub copy is missing.
- Scope: Claude registry aliases only. Other providers have no registry (20.1), so their never-observed accounts are not enumerated by this contract; that is a gap the per-provider adapters close with their own alias list.

### 21.7 Not in v1: history and sparkline

v1 stores no history and defines no history field. A trend or sparkline is deferred to the hub table (fleet F4), which would own sampling; until then a display must not invent one from mirror reads (codeforge 10).

### 21.8 Negative controls added (each shown red before green)

- N31 An alias with `token_state: "invalid"` and utilization 0.1 is never picked; a 429-cooling alias and a stale alias are not classed `invalid`; the planted case (pick selects the invalid alias) is red.
- N32 `token_state` outside the enum is rejected; an `invalid` record older than 6 h stays `invalid`; only an `ok` observation clears it.
- N33 A `credits` window `{used:null, limit:null, remaining:3100, unit:"credits", utilization:null}` is accepted; `utilization: null` on any other kind, or `remaining` that does not equal `limit - used`, is rejected.
- N34 An alias whose only windows have null `utilization` is never class `ok`; `remaining: 0` yields `tight`.
- N35 Static scan: the warn code contains no literal 30 or 7 day threshold outside `quota-contract.json`; a planted literal fails the scan; changing the constant changes the warn level in both readers.
- N36 The reporter pushes an L0 placeholder for a registry alias with no record; it does not overwrite a real record; a record-level `source` with non-empty `windows`, or a placeholder carrying `observed_at`, is rejected.
- N37 Parity vectors for `<live_dir>` (override, xdg, xdg-inferred, shm, fallback): the autopilot resolver and a reference reader built from 21.3 return the same path on every vector; a reader that includes the `/tmp` candidate fails vector xdg-inferred absent plus `/tmp` present.
- N38 A record with `pct`, `resetsAt`, `five_hour` or `seven_day` is rejected `quota_invalid`, not renamed.

## 22. Addendum D: hub design settled by fleet

Sources: fleet message 01M6H3S89D3MPBWVWEASJM27M2; fleet message 01M6H3W6FC4ZNJM450WZ64JAB4; fleet `develop` `cd91624`, `docs/plans/2026-11-04-g40-hub-quota-store.md`. Binding; wins over 5.4, 8.3, 18.1, 18.2 (pacing), 18.4 and section 6 where they differ. (The earlier placeholder for fleet's design-note sha is resolved: `cd91624`.)

### 22.1 Questions of 5.4 and Q8, each settled

| Topic | Settled answer |
|-------|----------------|
| Storage | a proto-typed table, not generic kv; string fields have patterns, so a token-shaped value is rejected by the schema itself |
| Key | `(namespace, provider, alias, writer_courier)`; `namespace` and `writer_courier` come from the authenticated connection, not from the reporter's record body (the record carries neither field) |
| Write permission | only a courier writes, and only its own row; the reporter is the only hub writer; `_access` `quota_publish` can deny, answered with a nack `quota_publish_denied` (the reporter then stops pushing and keeps the mirror) |
| Expiry | hard cap `hub_received_at + 6 h` on the hub clock; a write cannot extend past it; no heartbeat; the hub sweeps and also filters on read; a window whose `resets_at` passed stays in the row and the reader ignores it |
| Clock skew | the reporter sends `sent_at`; the hub stores `observed_at_hub = observed_at + (hub_now - sent_at)` beside the raw value; `abs(skew) > 5 min` stores the row flagged `skewed`, displays may mark it |
| Conflict | each host keeps its own row; the reader merges (section 5.2: newest per window); codeforge takes the `host_role` list from these rows |
| Limits | per key `(provider, alias)` per courier: 1 write per 10 s, burst 3; per courier: 60 writes per minute and 256 live rows; 7 windows per record. Over a limit: visible nack `quota_rate_limited` with `retry_after`; the reporter backs off and keeps its newest value in the mirror |
| Delivery | snapshot on connect, deltas after, feeding the mirror; an old hub nacks the new frame `unsupported`: the reporter logs `hub=absent` and keeps the mirror |
| Spelling (Q11) | the hub uses 20.2: `utilization`, `resets_at`, `observed_at`; `pct` stays adapter-local in codeforge |
| Schedule | the hub change ships with or after F4, never during a release freeze; freeze until 2026-11-10T16:24Z |

### 22.2 Mirror (18.4)

Own courier record: `<live_dir>/quota/<provider>/<alias>.json` (single writer, never overwritten by a pull). Rows of other couriers, delivered by the snapshot and deltas: `<live_dir>/quota/<provider>/<alias>.peers.json`, an array of rows each tagged with `writer_courier`, `host_role`, `observed_at_hub`, `skewed`. Readers merge own plus peers per window.

### 22.3 Merge rule

Per `kind`: newest `observed_at` (own rows by `observed_at`, peer rows by `observed_at_hub`) wins; an exact tie keeps the own row; rows past `hub_received_at + 6 h` and windows older than the 6 h reader rule are ignored. The 8.3 higher-pct `quota_conflict` rule is dropped (not part of fleet's rule). `writer_courier` is the identity; `host_role` is informational.

### 22.4 Open questions raised by fleet (fleet design note section 11, `cd91624`)

- Q15 (F1) Should `host_role` be an enum from hangar's host inventory (the hub could then check it) or a free bounded string? Contract today: bounded string with the hub's pattern (N39). Owner: PM and fleet.
- Q16 (F2) Does any reader need cross-namespace quota, or is the first version namespace-only? Assumed namespace-only; cross-namespace reads would need the dispatch-style channel and `_access` consent.
- Q17 (F3) Is a fleet-side `fleet quota` CLI wanted in v1, or only the courier mirror? This plan builds only the mirror reader.

### 22.5 Push pacing against the hub limits

The reporter's own rules (5 s debounce, 30 s minimum per alias) give at most 2 pushes per minute per key, far under 1 per 10 s burst 3. The paths that bypass them ("at once": 18.2 rule 4, `rejected`, `token_state` change 21.1, placeholders 21.6) could exceed the limits, so every push goes through a local token bucket: per key 1 per 10 s, burst 3; per courier 60 per minute; own live rows capped at 256 (placeholders are pushed last and never displace a row that has a window). A delayed push is still "at once" in order, only paced; a `quota_rate_limited` nack waits for its `retry_after` and keeps only the newest value per key.

### 22.6 Negative controls added

- N39 The validator carries the hub's string patterns for `alias`, `provider`, `host_role`, `kind`, `source`, `token_state`, `unit`; a token-shaped string in any of them is rejected before a push; a record body carrying `namespace` or `writer_courier` is rejected (the hub takes them from the connection).
- N40 Two rows with the same `(provider, alias)` and different `writer_courier` coexist in the reader; a pull never overwrites the own file and the reporter never writes a peer row as its own.
- N41 The merge takes the newest per window across own and peer rows; an exact tie keeps own; a peer row past 6 h is ignored; a `skewed` row is flagged, not dropped.
- N42 A nack `quota_rate_limited`, `quota_publish_denied` or `unsupported` is never recorded as pushed: `quota_rate_limited` retries after `retry_after`, `quota_publish_denied` stops pushing, `unsupported` logs `hub=absent` (a fake hub for each).
- N43 Pacing: a burst of 20 "at once" events on one key produces at most 3 pushes in the first second and at most 1 per 10 s afterwards; 300 aliases never leave more than 256 own live rows, and placeholders are the ones dropped (shown red with the bucket removed).

## Review log
- R0: authored by the G40-data hands lane; no review round yet.
- R0b: addendum B (section 20) added for PM direction 16:00Z; capability matrix is produced by lane g40survey, not here.
- R0a: addendum (sections 18, 19) added for PM direction 15:54Z; the experiment in section 19 is NOT run by the hands lane.
- R0c: addendum C (section 21) added for PM direction: seven contract gaps from codeforge `5eb4ed7` section 9; N31-N38.
- R0d: addendum D (section 22) added: fleet hub decisions (fleet message 01M6H3S89D3MPBWVWEASJM27M2; fleet message 01M6H3W6FC4ZNJM450WZ64JAB4; fleet `develop` `cd91624`, `docs/plans/2026-11-04-g40-hub-quota-store.md`); conflicts changed to match fleet; Q15-Q17 raised by fleet.
