# Plan — G40-data: the agent lane gets its own live quota for every alias
> Status: design only (no code in this plan's authoring commit). Owner: PM program. Branch: `hands/g40data/1`. Size: S (design); implementation phases below. Frame: builds on G37 (`project/plans/2026-11-03-g37-account-switching.md`) and the codeforge G40 design (codeforge `feature/g40-usage-accounts` @ `98c7a8b`, `doc/plans/2026-11-03-g40-usage-accounts.md`).

> This plan states the current design only. History is in git and in the Review log; the fleet hub design note (`project/plans/context/g40-fleet-hub-quota-store-1949b11.md`, fleet `1949b11`, revision 4) is the companion for the hub side. The two documents agree except for the points listed in the Review log.

## 0. Context / thesis

G37 picks an account per headless `claude` call from `codeforge.quota/1` snapshots. Those snapshots are written by the interactive statusline, which never runs under `claude -p`. So every headless-only alias is `class=unknown` forever, and a snapshot is at most as fresh as the last interactive render (G37 section 4.3).

The operator's position: the user lane (statusline, codeforge) and the agent lane (dispatch) are two separate roads. Dispatch must not depend on a file the statusline happens to write. This plan designs how the agent lane obtains per-alias quota by itself, publishes it, and reads a shared view, while still accepting the statusline snapshot as one more source.

## 1. Problem

For each alias, `pick` needs a current `{five_hour, seven_day}` utilization and reset time, produced by the agent lane's own traffic (or, optionally and only when enabled, a tiny probe), without reading any credential beyond what G37 already reads, and without per-call cost. Also: a token that expires in a year must warn before it dies.

> Amended 2026-11-04 (d-2d6a93aa): "only when enabled" for the tiny probe is superseded by the per-provider default (on-demand before pick; periodic only for confirmed `false`). See "Amendment 2026-11-04: probe policy per provider" at the end of this plan.


## 2. OKR / KRs

- KR1 After a headless run that carried a rate-limit event, the alias has an observation younger than the run, with no statusline involved.
- KR2 `pick` classifies an alias `ok`/`tight` from an agent-lane observation when no usable statusline snapshot exists.
- KR3 No new spend by default: probing is off unless an operator switches it on.

> Amended 2026-11-04 (d-2d6a93aa): supersedes the default only: KR3 no longer means "off unless an operator switches it on". The default is now per provider: on-demand probe before pick (spend only on an alias about to be used) for `true`/`unknown`/unconfirmed `false`, periodic probe only for confirmed `false` with a recorded Q5. The "no new spend" intent is carried by the evidence gates. See "Amendment 2026-11-04: probe policy per provider" at the end of this plan.

- KR4 Every alias with a recorded issue date shows days-to-expiry; under 30 days warns.
- KR5 Every new check ships a negative control (section 9).

## 2.5 Global Constraints (copied verbatim into every dispatch)
- Node >= 20.10, built-ins only; JSON handling in Node, not shell (CLAUDE.md language rule).
- No token, credentials file, config-dir credential, host name, user name or email in any record, log, audit line, fixture or doc. A record carries the alias only.
- Units (section 6): `observed_at`, `resets_at` and `sent_at` are epoch SECONDS (integers); `utilization` is a fraction in [0, 1]. Millisecond inputs (such as `written_at_ms`) and 0..100 inputs are converted exactly once, at the boundary that receives them. An epoch field above 1e11 is rejected (it is a millisecond value).
- Silence is never "ok": a missing, stale, invalid or future-dated observation is `unknown`, never `ok`.
- The wrapper never changes a caller's `--output-format`, exit code or stdout bytes because of quota capture. Capture and publish failures are swallowed (one debug line), never a new exit code.
- Probe defaults to OFF for every provider. It is enabled only by an explicit config key (5.3).

> Amended 2026-11-04 (d-2d6a93aa): the default is no longer OFF for every provider. It follows the manifest: on-demand probe before pick for `starts_window` `true`/`unknown`, a periodic probe only for confirmed `false`; see "Amendment 2026-11-04: probe policy per provider" at the end of this plan. Superseded only once the P4 build ships; until then probing stays gated off.

- ADR-0001: no hash chains, signatures or attestation for these records; freshness comes from re-deriving (the next run or probe), not from proving the writer.

## 2.6 Change-policy decisions
- Compatibility impact: additive until P2b. `codeforge.quota/1` is untouched; from P2b it is read only by the reporter's statusline adapter (18.3), no longer by `account-quota.js`. `registry.json` is untouched (its row keys are strict; token dates go in a separate file). `account-quota.js` and `account-pick.js` keep their public shapes, with added output fields (`source`, `observed_at`).
- Dependency decision: none (no new package). Hub storage is a later phase that depends on fleet F4 and is not started here.

## 3. File-structure map (all future work; none edited by this plan)

| File | Change | Responsibility |
|------|--------|----------------|
| `scripts/lib/account-observation.js` (new) | add | contract `fleet.quota/1`: build, validate, unit boundaries (6), mirror view read/write (rows, 22.2), `interpretWindows` and merge (5.2, 8.3) |
| `scripts/quota-reporter.js` (new, P2b) | add | reporter (18.2): source adapters (statusline), mirror writes, pacing, hub client later (P5) |
| `scripts/lib/account-quota.js` | modify | reads the mirror view only; P2b removes the direct `codeforge.quota/1` read; returns `source`, `observed_at` |
| `scripts/lib/account-pick.js` | modify | carry `source` and `observed_at` into `choice`; classes of 8.3; new pure `staleCandidates()` for the probe trigger |
| `scripts/claude-account.js` | modify | passive capture after each attempt (next to `parseEnvelope`); optional probe before pick; `status` prints source and age; `usage-probe` subcommand (P4) |
| `scripts/accounts-onboard.sh` | modify | after the token write, record `issued_at` via a small Node helper (section 7) |
| `scripts/lib/account-token-meta.js` (new) | add | schema `autopilot.token-meta/1`: read/write `<accounts-dir>/<alias>/token-meta.json`, expiry arithmetic |
| `scripts/quota-adapters/<provider>.json` (new) | add | manifests (20.3) and their checker |
| `docs/guide/accounts.md`, `docs/guide/settings-reference.md`, `scripts/lib/config-keys.json` | modify | document and register the new config keys (section 10) |
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
| V6 | Probe cost: codeforge measured about 0.0016 USD API-equivalent, 8 output tokens, about 7.9K cache-creation tokens; the capability survey did not reproduce that and measured the same command at 0.0033936 USD with 16,412 cache-creation and 222 output tokens. Plan budgets use 0.0034 USD. Subscription plans are not billed per token, so the share of quota consumed is not measured | VERIFIED for tokens and USD (two differing measurements), UNVERIFIED for quota share | codeforge row 7; capability matrix claude field 4 (`project/plans/context/g40-capability-matrix.md`) |
| V7 | No `claude` subcommand reports usage; `auth status` reports login only. No official usage endpoint was found, so none is used | VERIFIED for the CLI help (codeforge row 11, G37 F1/F2); official-endpoint question UNVERIFIED (no URL to cite) | G37 plan 4.0 F1, F2 |
| V8 | `setup-token` tokens last 1 year; the command prints the token and does not save it | VERIFIED per official doc and binary constant | `https://code.claude.com/docs/en/authentication` ("generate a one-year OAuth token with `claude setup-token`"); codeforge doc section 2. `claude setup-token --help` lists no option, so a shorter lifetime cannot be requested from the CLI (UNVERIFIED that no env/other route exists) |
| V9 | Statusline scale is 0..100 (`used_percentage`), `codeforge.quota/1` stores 0..1 | VERIFIED | G37 plan 4.3; codeforge `src/cli/statusline.rs:401-408` |
| V10 | `codeforge.quota/1` has exactly the keys `schema, alias, root, written_at_ms, five_hour, seven_day`: no `source` field | VERIFIED | G37 plan 4.3; `scripts/lib/account-quota.js` header |

## 5. Design

### 5.1 Item 1 — passive capture (zero cost)

Answer to "does `claude -p` output carry rate-limit info?": yes in stream-json with `--verbose` (V1, V2), per-event fields in V2; unknown for the single json object (V5). It is not on every run, and per V3 a window can be missing. The CLI's condition for emitting the event is UNVERIFIED (Q19; it may be on a change of rounded percentage, reset time, status or threshold, but no primary source says so). So the contract is "an event, when present, is recorded"; absence is not an error and not a zero.

Where: `claude-account.js run`, after `classifyAttempt` for each finished attempt (success or not, but never when the outcome is `token_scrubbed`). A new pure function `extractRateLimit(stdoutText)` scans stdout lines of type `rate_limit_event` (and, per codeforge row 6, `rate_limit_info` on a rejected `result`) and returns the LAST one. Input is the already-scrubbed attempt bytes. Output: windows `rolling_5h` and `weekly` (or none), each with `utilization` copied (already 0..1; boundary rule of 6), `resets_at = resetsAt` (seconds) and `observed_at` = the START time of the attempt in seconds (the wrapper clock when the child was spawned). A lower bound that never overstates freshness: the event carries no time (Q19, N84).

Coverage reality (the biggest finding of this plan): with today's `--output-format json` callers (V5) there is no event, so passive capture alone would observe almost nothing from dispatch. Three ways to close it, in order of preference; the choice is a phase gate, not decided here:
- C1 Rail migration: callers that go through the wrapper switch to `--output-format stream-json --verbose` and read the final `result` line. Touches every rail parser (hetero envelope parsing), so it is M or L and carries regression risk.
- C2 Wrapper-side transparent transform: the wrapper rewrites `--output-format json` to `stream-json --verbose`, captures the event, and emits ONLY the final `result` object as stdout, so callers see one JSON object as before. Needs one operator-authorised measurement first: is the stream `result` line byte-equivalent in fields to the single json envelope, and does `--verbose` change stderr? Until measured it is UNVERIFIED and must not ship. Keep it behind a config key default off.
- C3 Do nothing: accept that only stream callers and probes feed observations.
Verifying "the wrapper's current stream-json params yield an event": the wrapper has no params of its own (V4); with a stream argv the existing shim-based tests can assert capture using a fixture, no API (phase P2 test).

Failure policy: capture never alters exit code, stdout, audit outcome. A malformed event is dropped and counted in the audit line field `quota_capture=bad_event`. The event is an observation of whichever account the attempt ran as, so the record key is the attempt's alias, never a caller-supplied one.


### 5.2 The mirror view, freshness and merge (one algorithm)

Input: the mirror view of one `(provider, alias)`: a list of rows (22.2), each a `fleet.quota/1` record (20.2) plus `writer_courier`, `host_role`, `observed_at_hub` and `skewed`. The local courier's own row carries the local courier id and `observed_at_hub: null`; a peer row without any stamp (a placeholder) has `null` too. Clock model: section 11. Rules:
1. Row time basis. A STAMP is a window `observed_at`, `refusal.observed_at` or `token_state_at`. The row basis `B` is the largest stamp in the record, and `observed_at_hub` is the hub-clock time of `B` (the hub computes `B + (hub_now - sent_at)` from the frame's `sent_at`; a record with no stamp has none; `skewed` comes from `sent_at` alone, so refusal-only and state-only rows get a time and the flag like any other). A peer stamp `x` has hub time `t = observed_at_hub - (B - x)`; a local row's stamps are on the local clock. Durations are kept, instants are translated: a peer refusal ends at `t(refusal.observed_at) + (retry_at - refusal.observed_at)` (21.8). No courier corrects another writer's time with its own clock; there is no `min()`.
2. Age is the only comparable quantity. A local stamp has age `now_local - t`; a peer stamp has age `(now_local + hub_offset) - t` (section 11). Newest-wins, the 6 h bound and the future bound all use ages; a raw local `t` is never compared with a hub `t` (N80). A window is dropped when its age exceeds `MAX_AGE_S` (21600), when its age is below `-FUTURE_SKEW_S` (300; observed in the future), or when `resets_at` is not null and is at or before `now_c = now_local + hub_offset` (a server absolute time, one domain for local and peer rows; offset 0 without a hub). A `skewed` row is judged the same way and flagged in `status`, never dropped for skew alone.
3. Winner per `kind`, among MEASURED windows (`passive`, `endpoint`, `probe`): the live window with the smallest age. If the newest row lacks the kind but another row still has a live one, take the older one: a live window can only have grown, so it is a lower bound; note `merged_floor`. An exact tie goes to the local row; a tie between two peers goes to the higher `utilization` (understating is the dangerous direction).
4. Estimates merge apart from measurements. An `estimated` window never replaces or lowers a measured one and never makes a required window present (8.3); it can only raise `used` (`max(measured, estimated)`). With no measured window of its kind it is the only candidate for `used` and the kind still counts as absent for 8.3 (N81).
5. The original `observed_at` of the winning window travels with it in the merge, in re-pushes and in reader output; nothing rewrites it. The reader's result carries per window `{kind, utilization, resets_at, observed_at, writer_courier, source}`.
6. A live `refusal` (21.8) is taken from the row with the smallest refusal age; it is not cleared by a lower window, only by its own expiry.
7. Class (8.3) is computed from the merged windows; the source and `choice.observed_at` of the result are those of the window that sets `used` (a floor from an older row shows the older time); per-window times stay in `status`.
A quiet alias with only old windows falls to `unknown` at 6 h, the same fail-safe as today.

### 5.3 Item 2 - probe

Default OFF for every provider and every manifest: `accounts.quota_probe = "off"`, regardless of the manifest's `starts_window`. Whether a probe starts the provider's window clock decides only what an operator who enables probing gets (enablement and scheduling eligibility are separate):

> Amended 2026-11-04 (d-2d6a93aa): "Default OFF for every provider ... regardless of the manifest's `starts_window`" is replaced by a per-provider default derived from `starts_window` and `starts_window_confidence`; see "Amendment 2026-11-04: probe policy per provider" at the end of this plan.

- `quota_probe = "stale"`: probe only just before pick, and only when the best observation of a candidate is older than N minutes (default 60). Used for `starts_window` `true` or `unknown` (treated as `true`; the glm result, 23.2, is the evidence for the conservative rule).

> Amended 2026-11-04 (d-2d6a93aa): on-demand (`stale`) is now the default for `true`, `unknown` and unconfirmed `false`, not an opt-in mode.

- `quota_probe = "scheduled"`: a standing schedule (19.6 branch A). Accepted at config load only for providers whose manifest says `starts_window: false` with an evidence path; otherwise it is rejected with a message.

> Amended 2026-11-04 (d-2d6a93aa): `scheduled` is now the default (about every 30 minutes, only without a newer observation) for confirmed `false` (`false` + `high` confidence + evidence); see "Amendment 2026-11-04: probe policy per provider" at the end of this plan.

- Claude: its `starts_window` is `unknown` and no Claude experiment has run (19.8). The Claude probe code path (the `stale` trigger and `usage-probe`) may ship, but `quota_probe` stays `off` by default, `scheduled` is rejected for Claude (N66), and until the section 19 result is recorded no document or default may enable it; absent telemetry in that experiment is ambiguous, not a "does not start" result (19.5).

> Amended 2026-11-04 (d-2d6a93aa): for Claude, the operator decision supersedes this paragraph. `unknown` means an on-demand probe before pick when the data is stale; the experiment of section 19 is no longer a precondition for that. Reason on the operator's card: the alias is about to be used anyway, so starting its clock is acceptable. `scheduled` is rejected for Claude only while its manifest is still `unknown` or any periodic-eligibility gate has not passed (`false` + `high` + evidence, and Claude's own Q5 recorded); after that it can flip on evidence like any other provider (N66 keeps the rejection for `unknown`/`true`); see "Amendment 2026-11-04: probe policy per provider" at the end of this plan.


Cheapest first: (1) official no-quota endpoint: none found (V7), not used; if an official URL turns up, replace the probe with it and record it here. (2) Smallest model call: `claude -p <prompt> --model haiku --output-format stream-json --verbose --tools "" --no-session-persistence`, a few-word prompt, through the alias env (same path as a run). This is byte for byte the matrix's live command (capability matrix, claude field 4). `--no-session-persistence` is kept so a probe leaves no session transcript under the alias's config dir. `--strict-mcp-config` (listed by `claude --help` of 2.1.317) has no live run and is NOT in the argv; it may be added only after a live probe records it. Cost per V6: 0.0034 USD API-equivalent per probe (about 0.02 to 0.03 USD for the 6 to 8 probes of the experiment, up to about 0.08 USD per day per idle alias on a standing hourly schedule, which only the demand rule of 19.6 branch A allows); share of subscription quota UNVERIFIED (Q5).

> Amended 2026-11-04 (d-2d6a93aa): supersedes the cost figure and the schedule: the standing schedule is now about every 30 minutes (up to 48 probes, about 0.16 USD API-equivalent per day per idle alias, 48 x 0.0034), not hourly at 0.08 USD, and only for confirmed `false` with a recorded Q5. The cost is recorded only, with no limit set. See "Amendment 2026-11-04: probe policy per provider" at the end of this plan.


Trigger in `stale` mode: the wrapper, in `gather`, asks pure `staleCandidates(accounts, merged, cooldowns, exclude, nowS, minutes)` for aliases that are not excluded or cooling, whose best observation is older than N minutes (or missing), and whose last known `used` is below 0.90 (a tight alias is never probed: it does not need refreshing and is the one most likely to 429). At most one probe per alias per N, serial, at most 1 per `run`, never when the `run` is `--alias`-pinned. A probe's observation is published like any other, `source: probe`. Probe failure (auth, 429, timeout) records nothing, applies the normal cooldown and auth-stop classification, and never blocks the real call; bounded by `accounts.quota_probe_timeout_secs` (default 20). A manual `claude-account.js usage-probe --alias A` (P4) is explicit and prints only `{alias, windows}`.

### 5.4 Item 3 - publish

The wrapper writes its observation into the mirror (18.4) as the local row; the reporter (18.2) is the only code that talks to the hub.
- Path: `<live_dir>/quota/<provider>/<alias>.json` (21.3), 0600 in a 0700 directory made through `scripts/lib/runtime-paths.js` `ensurePrivateDir`. RAM-backed is fine: an observation is worth nothing after a reboot (6 h rule) and nothing here is a secret. Token dates are NOT stored here (they are durable; section 7).
- Writes are temp file + rename under the short lock of 18.4; readers open with `O_NOFOLLOW` and fstat-limit (reuse `readSmallFile`).
- Hub: key `(namespace, provider, alias, writer_courier)`, all settled with fleet (22.1). The hub questions Q1 to Q6 of the first design pass are closed there; none is open.

### 5.5 Item 4 - pick reads the shared view

Section 8.


### 5.6 Item 5 — token expiry

Write point: `accounts-onboard.sh` after the successful token write (the `onboard:token-write` line, about line 215), by a small Node helper call that records, per alias, `issued_at` = now. The script does not know when `setup-token` actually ran (another pane), so `issued_at` is the paste time; a lag of minutes against a 365-day life is irrelevant. File: `<accounts-dir>/<alias>/token-meta.json`, schema `autopilot.token-meta/1`, 0600, `{schema, alias, issued_at, lifetime_days}`. It is NOT put in `registry.json` (strict row keys, evidence E4) and NOT in the live dir (durable data on tmpfs would be lost). Validity: V8 says 365 days; store `lifetime_days = 365` as the default and let the operator override per alias, since the CLI help offers no option and the lifetime of a token made elsewhere is unknown. `token_expires_at = issued_at + lifetime_days*86400`.
- Warn at 30 days remaining (contract constant, 21.4), higher severity at 7 days, `expired` after. Where it shows: `claude-account.js status` and `env-check` (a stderr warning line, never a failure: expiry is advisory, per the standing "expiry warns, never blocks" rule); the quota record carries both dates so the hub and codeforge can show them.
- A recorded 401 (`auth_failed`) overrides the dates: `status` shows `invalid` regardless of days left (a token can be revoked early; UNVERIFIED how often); precedence over cached quota is the first bullet after this list.
- Existing aliases without a file: `status` prints `token_expiry: unknown`; the operator backfills with `claude-account.js token-meta set --alias A --issued-at <date>` (P3). Backfilling from the token file's mtime is not done without the operator's consent (metadata of a secret file).
- The helper never reads the token file and never prints it.
- Credential-scoped precedence (what overrides cached quota): for a credential, `invalid` state beats every quota observation, however fresh and however low the utilization. Order in pick: (1) a local `auth_failed` for this alias's credential on this host, or a mirror row with `token_state: invalid` whose `token_state_at` is not older than the credential's `issued_at` (so a peer's report of a refused token counts here too); (2) cooling; (3) tight; (4) ok; (5) unknown. Recovery after the operator replaces the credential: onboarding writes a new `issued_at` (section 7), which retires every `invalid` older than it, and a later successful authenticated call sets `token_state: ok`; `account set --state active` does the same by hand. Nothing else clears `invalid` (a fresh low-utilization mirror never does). The 401 of a probe is the same signal as the 401 of a run: it sets `invalid`, it does not "record nothing". Only 401 sets it (21.1); a 403 keeps its G37 classification and leaves `token_state` alone.
- When the hub denies publication (`quota_publish_denied`, 22.1) the local state still holds: the local `invalid` is applied by this host's pick from its own wrapper state and mirror, with no hub round trip; peers learn nothing until publication is allowed again.


## 6. Units and boundary conversions (pinned once)

The record itself is `fleet.quota/1` (20.2). This section pins every number in it.
- Time: `observed_at`, `resets_at`, `sent_at`, `token_state_at`, `token_issued_at`, `token_expires_at` are epoch seconds, integers. The validator rejects any of them above 1e11 as `quota_invalid` (`unit_magnitude`: it is a millisecond value), and rejects non-integers. The record, the reporter frame and the reader output use exactly one spelling, `observed_at`; there is no `_ms` field anywhere and no `observed_at_ms`.
- `utilization`: a fraction in `[0, 1]`. Stored values never exceed 1.
- Each foreign scale is converted exactly once, in the adapter that receives it, before anything is written: statusline `used_percentage` (0..100) is divided by 100; `codeforge.quota/1` `written_at_ms` becomes `floor(written_at_ms / 1000)` in the reporter's statusline adapter only (its `pct` and `resets_at` are already a fraction and seconds); a stream event's `utilization` and `resetsAt` are copied verbatim. After the boundary nothing converts again.
- Overshoot at the boundary: a received value in `(1, 1.5]` is clamped to 1.0 and the window gets `clamped: true`; a value above 1.5 or below 0 is rejected (`quota_invalid`: it is almost certainly an unconverted 0..100 value). A stored record with `utilization > 1` is rejected by every reader. Clamping happens only at the local writer boundary (one shared function, used by the reporter's adapters and the wrapper's capture before anything is written); the hub never clamps and refuses any `utilization > 1` with `quota_invalid`, so a frame leaving the reporter never carries one.
- Passive and probe `observed_at` is the attempt's start time (5.1). Arithmetic constants are in seconds: `MAX_AGE_S` 21600, `FUTURE_SKEW_S` 300.

## 7. File-format note: token metadata

`<accounts-dir>/<alias>/token-meta.json`: `{ "schema": "autopilot.token-meta/1", "alias": "...", "issued_at": 0, "lifetime_days": 365 }` plus nothing else. Requires that `env-check` and registry validation tolerate this extra file in `<alias>/` (they check named entries, not a whitelist; verified by reading `account-registry.js` section list in G37 5.1, but P3 must add a negative control proving a stray `.credentials.json` is still refused while `token-meta.json` is accepted).


## 8. Design for item 4 - what changes in the reader and the picker

### 8.1 `account-quota.js`
- Reads the mirror view (22.2) through `account-observation.js` and returns `{state, used, source, note, tight_resets}` plus `observed_at` and per-window `sources`. `source` takes the window enum of 20.2 (`passive|endpoint|probe|estimated`) or `none` (reader output only, never stored) instead of `snapshot|none`; every caller that compares `source === 'snapshot'` is found by grep and updated in the same change (no alias kept, per the no-shim rule).
- `interpretWindows(rows, manifest, nowS)` is pure over the row list (5.2 plus 8.3), so tests need no filesystem. `interpretSnapshot` survives only as the adapter for the codeforge file inside the reporter.
- One ingestion rule (F8): until P2b ships, G37's existing direct read of `codeforge.quota/1` is left exactly as it is. P2b moves that read into the reporter's statusline adapter (18.3), which writes the converted row into the mirror whether or not the hub is reachable, and DELETES the direct read from `account-quota.js`. After P2b a `codeforge.quota/1` file is read by exactly one component (N60). Interim precedence (P2 only): per alias, pick judges the mirror row and the snapshot each by its own age and takes the NEWER observation whole (no window-by-window mixing; a tie goes to the mirror); the stale one is ignored (N83).
- Amended 2026-11-04 (PM ruling): equal stamps go to the snapshot; the mirror takes over only when strictly newer. After D5 a same-second mirror row is a copy of the same snapshot, so a tie carries no new information and G37 parity wins.

### 8.2 `account-pick.js`
- Input gains `observations: {alias: [row...]}` (the mirror view) next to `snapshots`; if omitted, behaviour is exactly today's (N8). After P2b `snapshots` is not an input.
- Classes: `invalid`, `cooling`, `tight`, `ok`, `unknown`; ordering unchanged. `choice.source` and `choice.observed_at` are returned; `status` shows them.
- New pure `staleCandidates` for 5.3. `pick` itself never probes and never does fs or clock.

### 8.3 Classification and required windows
Each adapter manifest lists its windows with `required: true|false` (20.3). `used` is the maximum `utilization` over live windows of the kinds in 20.2.
- `invalid` (5.6 precedence), then `cooling` (a G37 cooldown, or a live refusal 21.8), then:
- `tight`: any live window at or above 0.90, whether or not it is required.
- `ok`: EVERY required window is present as a measured window (5.2 rule 4), live (`resets_at` not passed) and fresh (inside `MAX_AGE_S`), and `used` is below 0.90. A missing, elapsed or stale required window never yields `ok`.
- otherwise `unknown`.
Claude: `rolling_5h` is required, `weekly` is not. A fresh weekly window at 0.20 with a missing or stale `rolling_5h` is `unknown`, not `ok` (N57); with another live window at or above 0.90 it is `tight`. A provider whose manifest reaches L2 or L3 must list at least one required window (the checker enforces it).

### 8.4 Cross-host view
Each courier writes only its own row (key includes `writer_courier`, 22.1) and the reader merges the rows with 5.2, so there is no writer conflict and no last-writer-wins anywhere. A peer row with a different `host_role` is accepted (same account, different vantage). Peers' rows are read-only for the local courier: they are never republished (18.2 rule 0).

## 9. Failure and degradation

| Situation | Behaviour |
|-----------|-----------|
| No observation, no snapshot | alias `unknown` (today's behaviour); never `ok` |
| Required window missing, elapsed or older than 6 h | alias `unknown` unless another live window is at or above 0.90 (`tight`) |
| Capture fails (bad event, write error, mirror lock busy) | swallowed; one audit field `quota_capture=<reason>`; exit code and stdout unchanged |
| Hub unreachable (P5) | local rows and last-delivered peer rows stay; peers age by `observed_at_hub` on the local clock and retire at 6 h; `quota_hub=down` in `status`; never blocks a call; on reconnect the snapshot replaces peer rows and own pending rows are pushed with their original `observed_at` and a new `sent_at` |
| Old hub nacks `unsupported` | log `hub=old` once per courier start, keep the mirror, keep running |
| Nack `quota_rate_limited` (always with `retry_after`, seconds) | honour `retry_after`; the newest row per key stays in the mirror and is retried; nothing is dropped (18.2) |
| Nack `quota_rows_full` (always the 257th live row, never with `retry_after`; clears only when a row expires or is deleted) | stop adding new aliases (placeholders first), keep pushing rows that already exist; log and show `quota_rows_full` in `status` until it clears |
| Nack `quota_invalid` or `quota_writer_mismatch` | drop that frame, warn once per kind; never retried, never recorded as pushed (it is a bug, not a retry case) |
| Nack `quota_publish_denied` | stop pushing, keep the mirror, `quota_hub=denied` in `status`; one trial frame per hour; pick stays local (5.6) |
| Nack `quota_clock_invalid` | never retried with the same frame; the reporter's own check (N61) means this signals a local clock fault: log and stop pushing until the clock check passes |
| Local live dir refused (`LIVE_DIR_REFUSED`) | publish skipped, read side sees nothing; the run itself proceeds |
| Clock: local row more than 5 min ahead of the local clock | window dropped (`quota_invalid`); a peer row is judged by `observed_at_hub`; a `skewed` row is flagged, not dropped (section 11) |
| Event lacks `five_hour` | window absent (never 0); class per 8.3; note `quota_five_hour_missing` in `status` (Q1) |
| Probe timeout/429 | nothing recorded; normal classification applies; real call proceeds. A probe 401 sets `invalid` (5.6) |
| Auth refusal once (a single 401 or 403) | 401 sets `invalid` at once (5.6, 21.1); there is no automatic recovery, on purpose: pick never selects an invalid alias, so only the operator (re-onboard, or `account set --state active`) clears it, and `status` shows it on its own line. 403 changes nothing in `token_state` (N85) |
| Token expiry file absent or unreadable | `unknown`, no warning, no block |

## 10. Config keys (all under `accounts.*`, registered in `scripts/lib/config-keys.json`)

`quota_probe` (`off|stale|scheduled`, default `off`; `scheduled` accepted only per 5.3), `quota_probe_stale_minutes` (default 60, range 5..360), `quota_probe_timeout_secs` (default 20), `host_role` (default `agent`), `quota_capture` (`on|off`, default `on`; zero-cost, so on). The token warn levels are contract constants (21.4), not config.

> Amended 2026-11-04 (d-2d6a93aa): the `quota_probe` default `off` becomes a per-provider default resolved from the manifest (key name and values to be settled by the P4 build); see "Amendment 2026-11-04: probe policy per provider" at the end of this plan.


## 11. Clock model (the only one)

- Writers stamp `observed_at` (seconds, the writer's clock) per window. The reporter stamps `sent_at` (seconds, its clock at push time) on EVERY frame, including re-pushes.
- Hub: every snapshot and delta frame to readers carries `hub_now` (epoch seconds); it refuses `observed_at > sent_at + 5 s` (`quota_clock_invalid`); stores `observed_at_hub = B + (hub_now - sent_at)` beside the raw values, where `B` is the row basis of 5.2 rule 1 (the largest window `observed_at`, `refusal.observed_at` or `token_state_at`; none for a stampless record); flags `skewed` when `abs(hub_now - sent_at) > 5 min` (from `sent_at` alone, so every row has the flag); never drops for skew (22.1).
- Reader: every candidate becomes an age (local row `now_local - t`, peer row `(now_local + hub_offset) - t`, 5.2 rules 1 and 2) and only ages are compared, ordered or bounded (6 h, 300 s future). Nobody corrects another writer's time and nobody takes `min()` of two clocks. `resets_at` is a server absolute time, immune to writer skew, and is compared with `now_local + hub_offset` for every row.
- Re-push and merge keep the original `observed_at`; receipt time never refreshes freshness (22.3).
- Reader offset (Q20, adopted): on every delivered frame the reader sets `hub_offset = hub_now - local_now` (seconds, network delay ignored) and stores it in the mirror view (22.2). A peer row's age is `(local_now + hub_offset) - t`, with `t` the row's hub time (5.2 rule 1); the 5 min future bound uses the same corrected age. Local rows still use the local clock only. With no frame ever received (`hub=absent` or `hub=old`) `hub_offset = 0`; offline, the last stored offset is kept. An offset beyond 5 min is applied and shown as `quota_hub_clock_offset` in `status`. Nobody adjusts another writer's `observed_at` (N55, N67).

## 12. Open questions (items 1 to 5 are evidence-gated; Q numbers are referenced above)

- Q1 With no recent run, does `five_hour` stay absent from the event (V3 cause)? It decides whether an idle alias shows `unknown` or `0`. Needs one operator-authorised comparison measurement (idle alias vs one used within 5 h).
- Q2 Does one probe start the Claude 5-hour window clock? Gates Claude probing; stays `off` until answered (glm: yes, 19.8).

> Amended 2026-11-04 (d-2d6a93aa): Q2 no longer gates Claude on-demand probing (confirmed by PM); it still gates any periodic probe for Claude, which needs `false` + `high` confidence + evidence + a recorded Claude Q5.

- Q3 Is the stream `result` line equivalent to the single json envelope (C2), and does `--verbose` change stderr? Gates the transparent transform.
- Q4 Does the single-object `--output-format json` carry any quota field? (codeforge inference only.)
- Q5 How much subscription quota does one probe consume? (tokens known, share unknown.)
- Q6 Is there an official, quota-free usage endpoint or `claude` subcommand? None found (V7); re-check against the official docs before P4.
- Q7 `setup-token` lifetime: 1 year per official docs (V8); is it the same for team/enterprise subscriptions, and can the CLI be asked for a shorter lifetime? Unverified; treat 365 as default and allow override.
- Q9 `host_role` vocabulary (also fleet note F1): enum from hangar's host inventory, or a free bounded string? Contract today: bounded string with the hub's pattern (N39). Owner: PM and fleet.
- Q10 Pick reads the mirror on every run (two small files per alias, cheap); the hub read of P5 adds latency only to the reporter, not to pick. No budget is needed from the fleet side unless pick starts reading the hub directly.
- Q12 Which of the ten names are providers and which are harnesses? Settled per row by the matrix; until then the provider word list in 20.1 is an example.
- Q13 `rpm`/`tpm` and `credits` windows: do other lanes display them? The contract stores them, pick ignores rpm/tpm.
- Q14 Where does the manifest checker run (preflight-release, the config-keys check pattern)? To settle in P1.
- Q16 (fleet F2) Does any reader need cross-namespace quota? Assumed namespace-only; cross-namespace reads would need the dispatch-style channel and `_access` consent.
- Q17 (fleet F3) Is a fleet-side `fleet quota` CLI wanted in v1, or only the courier mirror? This plan builds only the mirror reader.
- Q21 Ruled (depth-0, 2026-11-04): the record-level `source` is a closed enum. It has one value today, `registry`, allowed only on a placeholder (21.6); an unknown value is rejected; adding a value bumps the contract version (N89). The window-level enum is pinned in 20.2. Only the hub's own pattern (`^[a-z0-9_-]{1,24}$`) is still fleet's to tighten; this plan's validator is already the stricter one. Owner of the hub side: PM and fleet.
- Q19 The Claude CLI's emission condition for `rate_limit_event` (5.1) is UNVERIFIED. Closed by quoting the exact codeforge or CLI evidence line.

## 13. Phases (the only phase table; each independently shippable; acceptance = "done when")

| Phase | Size | Content | Gate |
|-------|------|---------|------|
| P1 | M | generic contract `fleet.quota/1`: validator with the unit rules (6), mirror view of rows (22.2), `interpretWindows` and merge (5.2, 8.3), refusal (21.8), manifest schema and checker; Claude reader adapter; G37's direct snapshot read untouched | pure tests; N1-N8, N24-N30, N33, N34, N37, N38, N49-N58, N72, N77, N79-N82, N86 red then green |
| P2 | M | Claude adapter, first because G37 needs it: wrapper passive capture (5.1) writing the local row of `quota/claude/<alias>.json`, `status` columns, `claude.json` manifest; pick reads the mirror | fixture-driven; N9, N10, N74, N78, N83, N84 red then green: json caller records nothing and exits unchanged |
| P2b | S | generic reporter (18.2) with a fake hub: statusline adapter writes the mirror directly (18.3), direct `codeforge.quota/1` read removed from `account-quota.js`, pacing and queue, stale-skip, nack handling | N18-N23, N36, N59-N64, N68-N71 red then green |
| P3 | S | token meta, generic fields; lifetime from the manifest; credential precedence (5.6). Not in the G40 first implementation wave (pick may only take tight or refusal as new inputs): the `invalid` class, `scripts/lib/quota-contract.json` and the N85 writer wait for P3; the validator still accepts shape (c) (N77) | N11, N12, N31, N32, N35, N65, N75, N85 red then green (all excluded from the first wave) |
| P4 | M | Claude tinyprobe (5.3), blocked on the section 19 experiment | N13-N15, N66, N73, N76 red then green |
| P5 | L | hub client in the reporter, blocked on fleet F4; the hub change ships with or after F4 and never during a release freeze (fleet freeze until 2026-11-10T16:24Z) | N16, N17, N39-N48, N67 red then green |
| P6 | M/L | C2 transparent transform, only if Q3 is answered yes | byte-identical stdout for json callers, red first with the transform broken |
| A-agy, A-grok, A-codex, A-minimax, A-qoder, A-qoder-cli-cn, A-opencode, A-glm, A-kimi | each S to M | one provider adapter each (manifest from the matrix row plus the modes it marks `verified`); the `credential_ref` kind `env` checks (20.3 rule 3) already ship in P1 with N28 | each is its own project and starts ONLY after the PM gives a go for that provider; its gate is N24-N30 and N72 run on its own manifest, red then green |
Dependency map: P1 -> P2 -> P2b; P3 after P1; P4 after P2 + experiment; P5 after P2b + F4; provider adapters after P1 + P2b + the matrix + a per-provider PM go; P6 after P2 + Q3.

> Amended 2026-11-04 (d-2d6a93aa): P4 now also carries the per-provider probe policy build (BL-0375), after BL-0372 Tasks 0-3. For Claude, the "blocked on the section 19 experiment" gate applies only to periodic probing; on-demand probing is not blocked by it.


## 14. Negative controls (every one shown red before green; ship with the check it guards)

N1-N17 and N49-N90 are here; N18-N23 sit with the reporter (18.2), N24-N30 with the contract (20.6), N31-N38 with its details (21.9), N39-N48 with the hub (22.5).

- N1 A record with `utilization` 62 (0..100 scale skipped conversion) is rejected as `quota_invalid`, alias not `ok`.
- N2 A record with an unknown key is rejected; with a token-shaped string anywhere (fixture token) the writer refuses to write.
- N3 A record older than 6 h, or 10 min in the future, yields `unknown`.
- N4 A window with `resets_at` in the past is ignored.
- N5 Merge: per window the newest row wins, whichever writer; an exact tie prefers the local writer.
- N6 Missing `five_hour` never becomes 0 and never makes an otherwise tight alias `ok` (merge keeps a live older window as floor); with `merged_floor` set, the reported `choice.observed_at` equals the floor window's time, and a planted newest-row time is red.
- N7 Writer refuses a symlink target and a wrong-mode directory (reuses `runtime-paths`/`live-state-dir` refusals).
- N8 `pick` with no `observations` input equals today's output byte-for-byte on the existing fixtures.
- N9 A stream argv with an event records; a json argv records nothing; a malformed event is dropped; in every case exit code and stdout bytes equal the run without capture.
- N10 A fixture child that prints the token inside an event line is scrubbed before capture (record contains no token; outcome `token_scrubbed`).
- N11 Token meta: 29, 7 and 0 days boundaries; absent file is `unknown` not `ok`.
- N12 A `.credentials.json` in `<alias>/claude/` is still refused while `token-meta.json` beside the token is accepted; the helper never opens the token file (test with an unreadable token file).
- N13 Probe disabled by default: with `quota_probe` unset a stale alias triggers zero spawns (counted by the shim).

> Amended 2026-11-04 (d-2d6a93aa): N13 is re-pinned (PM ruling) to: a provider with `starts_window` `unknown` or `true` never has a periodic spawn; an unset `quota_probe` follows the manifest.

- N14 A tight alias (>= 0.90) is never probed; a cooling or pinned run never probes.
- N15 Probe timeout and 401 do not change the real call's outcome.
- N16 Hub down: pick result equals local-only result.
- N17 Two peers' rows disagree: newest per window wins; an exact tie between two peers takes the higher `utilization`; there is no `quota_conflict` rule.
- N49 Unit magnitude: `observed_at`, `resets_at` or `sent_at` of 1.7e12 is rejected `unit_magnitude`, a seconds value is accepted; a static scan of record, reader output and frame keys finds no `observed_at_ms` or other `_ms` key (planted one fails).
- N50 Clamp: received 1.2 is stored 1.0 with `clamped: true`; 62 and -0.1 are rejected; a stored record with 1.2 is rejected by the reader.
- N51 Converted exactly once: statusline `used_percentage` 95 gives 0.95 and class `tight`; a planted second division (0.0095, would read `ok`) is red. `written_at_ms` converts once: the fixture's `observed_at` lands within 1 s of its seconds value; a planted double division by 1000 is red.
- N52 Mirror view: rows keep `writer_courier`, `host_role`, `observed_at_hub`, `skewed` through write and read; two writers' rows for one `(provider, alias)` coexist.
- N53 Ownership: only rows tagged with the local courier id are ever in a push set; a peer row, even newer, never is (planted reporter that republishes a peer row is red).
- N54 Replay: a row re-pushed after hub expiry (hub receipt restarted) is read stale by its `observed_at_hub`; a replayed old frame with a later `sent_at` does not revive it.
- N55 Clock offset: a peer row whose writer clock is 1 h behind is judged by `observed_at_hub` and flagged `skewed`; a planted reader that subtracts its own offset is red; a local window 10 min ahead of the local clock is dropped.
- N56 Reconnect: after a 2 h outage the snapshot replaces peer rows, own pending rows go out with their original `observed_at` and a new `sent_at`; the observation's age is unchanged by the reconnect (a planted reset to "now" is red).
- N57 Required windows: weekly 0.20 with `rolling_5h` missing, or with `rolling_5h` elapsed or older than 6 h, is `unknown`, never `ok`; weekly 0.95 with `rolling_5h` missing is `tight`.
- N58 Refusal: a refusal with no window kind and no `retry_at` is accepted, makes the alias `cooling` for the default period, expires on schedule, and the class then comes from the windows; a refusal that carries an invented window kind is rejected.
- N59 Statusline without hub: with a fixture `codeforge.quota/1` file and the hub absent, the reporter's adapter writes a mirror row and pick classifies from it; a planted adapter that only pushes (writes nothing when the hub is absent) is red.
- N60 Single read: once a mirror row exists pick ignores the `codeforge.quota/1` file (planted override red); a static scan finds no `codeforge.quota` read in `account-quota.js` after P2b.
- N61 Frames: every frame carries `sent_at`; the reporter refuses to send a frame in which ANY timestamp (a window `observed_at`, `token_state_at` or `refusal.observed_at`) exceeds `sent_at` plus 5 s, the same set the hub checks (fleet section 5). Negative control, two frames: a refusal-only record whose `refusal.observed_at` is `sent_at + 6 s`, and a state-only record whose `token_state_at` is `sent_at + 6 s`; each must be refused by the reporter before sending (red with a planted check that reads only window `observed_at`).
- N62 Stale skip: a mirror row whose windows are all older than 6 h, with no `invalid`, refusal or placeholder state to carry, produces zero pushes and one `quota_stale_skipped` log line.
- N63 Startup burst: a courier with 70 rows at start, against a fake hub enforcing the real hub limits, gets no `quota_rate_limited` nack and loses no row (red with the bucket removed); the queue sends newest `observed_at` first and placeholders last.
- N64 Nacks: `quota_clock_invalid` is never resent unchanged; the pending queue holds at most one entry per key and none older than 6 h.
- N65 Credentials: a revoked local credential with a fresh low-utilization mirror is never picked; a peer's `invalid` newer than the local `issued_at` applies, and one older does not; a new `issued_at` clears the old `invalid`; a denied publication leaves the local pick unchanged.
- N67 Reader offset: a reader whose clock is 10 min behind the hub, given a frame with `hub_now`, computes the same peer-row age as a reader in sync; a planted reader that ignores `hub_now` is red; the stored `hub_offset` survives a hub outage and a restart; with no frame ever received the offset is 0.
- N68 `quota_rows_full`: the reporter stops adding new aliases, counts and logs each refused one, and keeps pushing rows that already exist; a planted reporter that retries the refused alias or stops pushing everything is red.
- N69 `quota_invalid` and `quota_writer_mismatch`: the frame is dropped with one warning per kind, never retried and never recorded as pushed (planted retry loop red).
- N70 Mirror-only fields: a push frame built from a mirror that holds `hub_offset` contains no `hub_offset`; a planted reporter that sends the mirror view or its `hub_offset` is red against a fake hub that answers `quota_invalid` for it; a record with `utilization` above 1 is never in a frame.
- N71 Nack table, one control per name: a fake hub answers each of `unsupported`, `quota_rate_limited`, `quota_rows_full`, `quota_publish_denied`, `quota_clock_invalid`, `quota_invalid`, `quota_writer_mismatch` in turn; the reporter must act as section 9 says (and log the name); a planted reporter that stays silent on any one is red for that name; none is recorded as pushed.
- N66 Probe config: `quota_probe` unset is `off` for every manifest; `scheduled` is rejected for `starts_window` `true` or `unknown`.

> Amended 2026-11-04 (d-2d6a93aa): "`quota_probe` unset is `off` for every manifest" is replaced by the per-provider default; the `scheduled`-rejection half stays, with the exception that `starts_window` `false` is accepted only with `high` confidence and evidence; see "Amendment 2026-11-04: probe policy per provider" at the end of this plan.

- N72 A manifest at L2 or L3 with no `required` window fails the checker; one with a required window passes.
- N73 `quota_probe_stale_minutes` outside 5..360 and a non-numeric `quota_probe_timeout_secs` are rejected at config load with a message.
- N74 A mirror lock held for 3 s makes the writer skip the write: audit field `mirror_lock_busy`, exit code and stdout unchanged.
- N75 `env-check` with an expired token exits 0, warning on stderr.
- N76 Two stale candidates in one `run` yield exactly one probe spawn.
- N77 Empty-`windows` shapes (21.6), one case each: accepted: placeholder; L1 + refusal; `invalid` + `token_state_at`. Rejected: L1 with no refusal, `unknown` state and no `source`; L0 + refusal, with or without `source`; `invalid` without `token_state_at`; L2 or L3 with empty windows; non-empty windows with a record-level `source`.
- N78 A first-call 429 for an alias with no prior window (wrapper fixture) yields a local row in shape (b): `refusal` set, `observed_at` = attempt time, `retry_at` from the response when present, no window invented, and the validator accepts it (extends N58).
- N79 State-only rows get a hub time: a refusal-only and an `invalid`-only peer row whose writer clock is 1 h behind get `observed_at_hub` from `sent_at`, are flagged `skewed`, and the refusal ends at the translated time plus its own duration; a planted reader that uses the local clock for them is red.
- N80 Common clock domain: a local row with an older low window (age 120 s, 0.20) and a peer row with a newer tight window (age 30 s, 0.95) select the peer under reader `hub_offset` +600 and -600; a planted raw-`t` comparison is red under at least one sign. `resets_at` just before or after `now_local + hub_offset` is judged the same for both rows. Refusals: the local row has an older refusal (age 600 s, remaining cooldown 60 s from its `retry_at`) and the peer row a newer one (age 30 s, remaining cooldown 1200 s); under reader `hub_offset` +600 and -600 both cases select the peer's refusal, and its end time is `t(refusal.observed_at) + (retry_at - refusal.observed_at)` (5.2 rule 1); a planted comparison of raw `t` is red under at least one of the two offsets.
- N81 Mixed sources: an estimated `rolling_5h` 0.10 newer than a passive 0.95 leaves `used` 0.95 and class `tight`; an estimated `rolling_5h` 0.10 beside a passive `weekly` 0.20 is `unknown`, not `ok`; an estimated 0.95 over a passive 0.20 is `tight`.
- N82 Namespace binding: the same `claude/main` in namespaces A and B. A view stamped `A`, with `namespace.json` switched to `B` and no snapshot yet, contributes no peer row to pick (`quota_peer_namespace_mismatch`) and keeps the local row; after B's snapshot only B's rows count; a planted reader that ignores the binding is red.
- N83 P2 interim: an alias with a fresh mirror row and a stale snapshot classifies from the mirror, the reverse case from the snapshot; N8 still holds with `observations` omitted.
- N84 Passive time: a fixture event printed early in a run that lasts 2 h (clock shimmed) gives `observed_at` = the attempt start; a planted capture-time stamp is red.
- N85 A single 401 (first call, no prior window) writes a state-only row (21.6 c) with `invalid`; a single 403 leaves `token_state` and the row unchanged.
- N86 Namespace config vs frame: the courier's configured namespace is `A` and the snapshot frame carries `B`: no peer row of that view is used by pick (`quota_peer_namespace_mismatch`), the local row is kept; with both equal the peer rows count; a planted reader that trusts the frame alone is red.
- N87 Parity with G37 (PM condition): with no mirror, an expired or unknown row, a broken view or a namespace mismatch, `pick` and `claude-account.js pick|status|run` output equals G37's byte for byte (a golden file made from the unmodified develop code), for `observations` omitted, `{}`, empty lists, stale-only rows, all-elapsed windows, a placeholder, a future-dated row and an `estimated` row below 0.90. Planted: a pick that adds `observed_at` without a mirror, treats no mirror as ok, treats a stale row as fresh, lets an `ok` mirror row promote an `unknown` alias, or lets a newer `ok` mirror row override an older tight snapshot is red.
- N88 Only tight or refusal changes pick (PM condition): of all mirror row kinds, only a fresh live window at or above 0.90 (the alias becomes tight) and a live `refusal` (the alias becomes cooling, drop reason `refusal`, G37 `cooldown` unchanged) change a pick result; `ok`, `unknown`, `estimated`, stale, placeholder, `token_state: invalid` and namespace-mismatch rows each leave the result equal to the no-mirror result.
- N89 Record-level `source` is a closed enum (Q21): `registry` on a placeholder is accepted; any other value is rejected; `registry` on a record that is not a placeholder is rejected; the enum list is pinned by a test so that adding a value forces a contract version bump.
- N90 Statusline root protection: a `codeforge.quota/1` snapshot whose `root` hash8 differs from the alias's `expectedRoot` produces no mirror row in the statusline adapter (`snapshot_root_mismatch`), so the G37 protection survives the move into the adapter.

## 15. Risks and inversion

What would guarantee failure: (a) all dispatch rails stay on json, so the passive channel yields nothing and the design looks finished but observes nothing (mitigation: P2 acceptance includes a coverage line in `status`, "observations in last 24 h per alias", and the C1/C2/C3 decision is explicit); (b) a probe moves the window and `pick` chases its own measurement (mitigation: off by default, per-provider `starts_window`, never probe tight); (c) a unit slip (0..100 vs 0..1, or seconds vs milliseconds) silently marks an alias `ok` (N1, N49, N51); (d) quota records on shared tmpfs become a covert channel between lanes (mitigation: 0600, alias-only content, one writer identity per row); (e) freshness is forged by receipt or by a courier correcting another's clock (mitigation: one clock model, section 11; N54, N55).

> Amended 2026-11-04 (d-2d6a93aa): "off by default" in mitigation (b) is replaced by "on-demand by default, periodic only when confirmed `false`"; never probe tight and the per-provider `starts_window` stay. Residual (minor, accepted by PM): an on-demand probe may start an alias's window and `pick` then refuse that alias (for example the probe shows it is tight).


## 16. Out of scope

Any code in this commit; running `claude setup-token`; real-binary measurement; changes to `~/projects/codeforge` or to `codeforge.quota/1`; the display side (bands, panes, charts: codeforge's); historical trends; per-model weekly limits (`seven_day_opus` and similar); synthetic 429 traffic; hub implementation.

## 17. Review log
- R0 to R0f: authored by the G40-data hands lane across PM directions; the additions were folded into one current design, the layered text is in git history.
- G1 (plan review round 1, 19 findings, all accepted, 8 blockers): units pinned to seconds and `[0, 1]` (6); the mirror is the hub view, a row list with ownership (22.2, 18.2 rule 0); one clock model (11, 5.2); required windows (8.3); provider-neutral refusal (21.8); statusline enters the mirror through the reporter (8.1, 18.3); pacing under every hub cap (22.4); one phase table (13); nack and stale-skip rows (9, 18.2); probe default stated once (5.3); credential precedence (5.6); env credential refs (20.3); unverified emission rule (5.1, Q19). Fleet revision 2 (`c2d57ab`) adopted all of these.
- G1b (fleet cross-check): window `clamped`, window `remaining`, record-level `visibility` and the placeholder `source` are now in fleet `c2d57ab`. Remaining differences: (a) fleet accepts a record-level `source` on any record, this plan only on a placeholder (21.6, stricter, plan-side); (b) the placeholder value here is `registry`, fleet's examples say `placeholder`; (c) whether `source` becomes an enum is open (Q21). Fleet revision 4 (`1949b11`) closes (a) and (b): record-level `source` is allowed only on shape (a) and the example is `registry`; (c) stays open as Q21.
- G2 (plan review round 2, generation 2, CONDITIONAL, generation cap; G40R2-G2 cap adjudication: all 18 findings Q0-Q17 accepted and folded as one bounded text repair, 6 blockers): Q0, Q6 -> 21.6, 21.1, 21.8, 20.4, N77, N78, N85; Q1 -> 5.2, 11, N80; Q2 -> 5.2 rule 1, 11, N79; Q3 -> 5.2 rule 4, 8.3, N81; Q4 -> 22.2, 18.4, N82; Q5, Q14 -> 19.6; Q7 -> 8.1, N83; Q8 -> 18.3; Q9 -> 20.2, 18.2, 8.1, Q21; Q10 -> 18.3, 22.2; Q11 -> 5.1, 6, N84; Q12 -> 18.2, 22.4; Q13 -> 5.3, 19.4, 20.3, N27; Q15 -> 21.1, 5.6, 9, N85; Q16 -> N72-N76, 9; Q17 -> 13. Fleet side: hand-off.

## 18. Reporter and local mirror

### 18.1 One contract, one store

Every source writes the SAME record, `fleet.quota/1` (20.2; alias-only, no token, no path, no email, no organisation id). The hub is the store (one row per `(namespace, provider, alias, writer_courier)`, 22.1); the local mirror (18.4) is its local view. Every display and reader (codeforge chip, statusline, `codeforge usage accounts`, `claude-account.js pick`) reads the mirror, or the hub through the reporter's pull. No second pipeline: nothing reads `codeforge.quota/1` files, wrapper records or probe output directly for display or pick once the mirror exists (8.1). Window `source` values and their meaning are in 20.2; the interactive statusline feed is `passive`.

### 18.2 Courier-side reporter (always on, zero token)

A reporter runs in the local courier for the life of the courier. It never calls the API and never touches a token or credentials file, so leaving it on costs nothing. It normalises local observations (the codeforge statusline snapshot files via its statusline adapter, the wrapper's passive and probe rows in the mirror) into the contract, writes statusline-derived rows into the mirror (18.3), and pushes to the hub when something changed.

Rules (a change is judged against the last row this reporter pushed, per alias, per window):
0. Ownership: only rows tagged with the local courier id are ever pushed. Peer rows delivered by the hub are read-only; the reporter never republishes them as its own observation.
1. `utilization` rounded to whole percent differs (`round(u*100)`). This is a reporter design choice to avoid noise, not a provider fact; whether the Claude CLI itself emits `rate_limit_event` only on such a change is UNVERIFIED (Q19).
2. `resets_at` differs by more than 60 s. The tolerance guards against header jitter, which is itself UNVERIFIED (no repeated-header sample); a real rollover moves it by hours, so 60 s loses nothing.
3. A window appears or disappears (`null` <-> object), or `token_state` or a refusal changes.
4. The hub's copy of the alias is missing (at reporter start, or after hub expiry): push the held row with its ORIGINAL `observed_at` (23.1). Bounded: never push a row whose windows are all older than `MAX_AGE_S` unless it carries state that does not age by observation (`invalid`, a live refusal, a placeholder); log `quota_stale_skipped` once per row (N62).
5. `source` is not part of the comparison (otherwise a probe and a passive event at the same utilization would ping-pong).

Frames and pacing:
- Every frame carries `sent_at` (seconds). The reporter refuses to send a frame in which any timestamp (a window `observed_at`, `token_state_at` or `refusal.observed_at`) exceeds `sent_at` plus 5 s, matching the hub (N61).
- Trailing debounce 5 s; ordering by `observed_at`: never push a row older than what it last pushed. The per-key rate is the bucket of 22.4 and nothing else. "At once" cases (rules 3 and 4) skip the debounce but NOT the bucket.
- Every push, including every "at once" path and the startup push of all aliases, passes the token bucket of 22.4 (strictly below every hub limit). The queue holds at most one entry per key (the newest), sends newest `observed_at` first with placeholders last, and keeps a row in the mirror until the hub accepts it.
- No heartbeat: an unchanged observation is not re-pushed and its `observed_at` is never refreshed by the reporter. The hub copy ages out by the 6 h rule exactly as before; a stable idle alias shows an old `observed_at`, which is correct and is what makes the probe's "skip if recent" rule meaningful.
- Nacks: `quota_rate_limited` waits `retry_after` and keeps the newest value; `unsupported` logs `hub=old`, keeps the mirror, warns once per start; `quota_publish_denied` stops pushing (one trial per hour); `quota_rows_full` stops adding new aliases and keeps pushing existing rows; `quota_invalid` and `quota_writer_mismatch` drop the frame and warn, never retried; `quota_clock_invalid` is never resent unchanged (section 9, N42, N64, N68, N69). No nack is ever recorded as pushed.
- Hub down: keep the newest row per alias in the mirror, retry with backoff 5 s to 5 min, drop nothing newer than what is mirrored; on reconnect push only what changed (N56).
- Controls kept with the reporter: N18 a record with `utilization` 62 is rejected; N19 no push when only `source` differs or `resets_at` moves under 60 s; N20 two changes inside 5 s produce one push; N21 never an older `observed_at` and never a refreshed one without a new observation; N22 hub down: pick output from the mirror equals the output with the hub up and the same rows; N23 the reporter source contains no read of a token or credentials path (static scan, red with a planted read).

### 18.3 Where each source enters

| Source | Writer into the mirror | Then |
|--------|------------------------|------|
| statusline feed | the reporter's statusline adapter: reads the codeforge snapshot file, converts once (6), writes the local row directly, whether or not the hub is reachable | reporter pushes it (rule 0) |
| passive | G37 wrapper after each attempt (5.1) | reporter pushes |
| probe | wrapper `usage-probe` (5.3) | reporter pushes |
| refusal (21.8) | wrapper's local-row write after a classified 429 attempt: `observed_at` = attempt time, `retry_at` from the response when present, no window (P2) | reporter pushes (rule 3) |
| `token_state`, `token_state_at` | wrapper after `auth_failed` (401) or a successful authenticated attempt, and `account set --state` (P3) | reporter pushes (rule 3) |
| estimated (20.2) | the adapter's fallback counter: P1 contract only, no Claude writer; first used by a provider adapter | reporter pushes |

The writer set of the mirror's local row is therefore the wrapper (passive, probe) and the reporter (statusline adapter); the codeforge statusline path itself stays untouched and writes no mirror row. The hub note's section 3 says the same (the reporter writes the mirror, codeforge's statusline path does not). Reading the codeforge snapshot is read-only for this plan (G37 4.3).

### 18.4 Local mirror

The hub is the store; the local mirror is its view, in one file per `(provider, alias)`: `<live_dir>/quota/<provider>/<alias>.json`, shape in 22.2.
- Writers: the wrapper and the reporter's statusline adapter touch ONLY the row tagged with the local courier id; the reporter's pull side touches ONLY the other rows (snapshot, then deltas) and the namespace stamp (22.2), and never overwrites the local row. Each write is read-modify-write under an OS flock on `<alias>.oslock`, held by a helper process (flock(1), else perl; neither present fails closed as `write_failed` / `lock_helper`, shown in `status` as `quota_capture=lock_helper`); a live holder never loses it, however long it stalls, and a dead one frees it at once (BL-0374; the old lock file `<alias>.lock` with a stale rule is gone); a writer that cannot get the lock within 2 s skips the write and counts `mirror_lock_busy` (capture failure rules apply).
- Readers (pick, display) read ONLY the mirror; the reporter is the only code that talks to the hub. This gives pick a no-network read path and keeps display from forming a parallel pipeline.
- Authority: per window, the 5.2 rules decide; the hub row for the local courier is ignored when it echoes (it only confirms receipt). A local row newer than what the hub holds is the unpushed pending state.
- Until the hub exists (fleet F4): the mirror alone, same shape; the reporter's push step is a no-op that logs `hub=absent`. Nothing about readers changes when the hub arrives.


### 18.5 Zero-token sources (checked, not assumed)

Question: is there any data source that gives the 5 h and 7 d utilization without spending tokens? Checked on the installed `claude 2.1.317` with `--help` only (no API call, no `auth status` run):
- `claude --help` command list (full): `agents, attach, auth, auto-mode, doctor, gateway, import, install, logs, mcp, plugin, purge, respawn, rm, setup-token, stop, ultrareview, update`. No `usage`, `stats`, `quota` or `limits` subcommand. `claude usage --help` and `claude stats --help` fall through to the top-level help (they are treated as a prompt), which confirms they are not commands.
- `claude auth --help`: `login, logout, status`. `claude auth status -h`: "Show authentication status", options `--json` (default) and `--text`. The description is authentication status, not usage. Whether its JSON contains any quota field: not run, so UNVERIFIED; the codeforge doc (row 11) only says it answers login state. The check to close it is one zero-token run of `claude auth status --json` by someone who may see the (account-identifying) output, with the keys redacted: that run is quota-free (it reads local login state), but it is not done here because its output names the account.
- `claude doctor --help`: "Check the health of your Claude Code installation. Reads settings files ..."; installation health, not usage.
- `claude gateway`: an enterprise auth/telemetry component, not examined, not used (UNVERIFIED).
- Statusline stdin JSON `rate_limits.five_hour|seven_day.{used_percentage, resets_at}`: zero token and already in use (codeforge `src/cli/statusline.rs:401-408`, row 8), but only in interactive sessions. Official doc URL for the statusline input schema was not fetched in this lane; the evidence is codeforge's reading of the real input. UNVERIFIED against the official page.
- Interactive `/usage` (or similar): exists only inside an interactive session, not scriptable, not in the CLI help; not checked (UNVERIFIED).
- Official documentation: no usage or quota API found in the pages this plan cites (`https://code.claude.com/docs/en/authentication` covers `setup-token` and login only); not searched exhaustively. An unpublished OAuth usage endpoint would need the token and is rejected by design (codeforge section 1.2 (c)).
- codeforge design read (`98c7a8b`, section 1.2 (c)): `claude auth status` answers login state, not usage; an OAuth usage API needs the token and an undocumented endpoint: not adopted.
Result: found only two zero-token sources: the interactive statusline feed and the stream `rate_limit_event` already present in output the agent lane pays for anyway (passive). Not found: any quota-free, token-free-callable way to read an idle alias's usage. That is exactly why the probe exists and why section 19 matters. Re-check against the official docs before enabling probes by default (add to the experiment's preconditions).

### 18.6 Re-assessment: dispatch rails use `--output-format json`

Evidence E3 stands: the claude rails behind the wrapper use `--output-format json` (`scripts/dispatch-hetero.sh:3949,3969,3980`), and codeforge infers (UNVERIFIED, row 5) that a single json object carries no quota field. In the new architecture:
- Courier reporter: unaffected by the output format. It is source-agnostic and reads local records; it never sees run output. What changes is how many records exist for it to push. With json callers, a headless-only alias gets nothing from passive capture, so its hub row comes from the probe (and from the statusline if someone also uses it interactively).
- Passive capture: its value is capped by the rail formats. It records only for stream callers (the foreman's kimi stream is a different engine, not claude). So passive stays a free bonus for the stream callers that exist and for any rail migrated later; it is not the primary feed for dispatch.
- Therefore probing moves from "optional supplement" to "the main feed for headless-only aliases". That makes the section 19 experiment the gating question for the whole design, not a detail.

> Amended 2026-11-04 (d-2d6a93aa): supersedes the experiment gate: the section 19 experiment is no longer the gating question for the whole design. On-demand probing proceeds for `true`/`unknown` without waiting for it; the experiment (and the matching read-only evidence for other providers) now gates only whether a periodic probe can be enabled. See "Amendment 2026-11-04: probe policy per provider" at the end of this plan.

- C1/C2/C3 recommendation updated: ship C3 (no rail change) first. Measure C2's precondition (stream `result` line equals the json envelope fields; Q3) as an extra step inside the section 19 experiment (it costs one more probe, 19.4 step E7). If equivalent, C2 (transparent transform in the wrapper, config-gated, default off) turns every json caller into a free observation source and the probe frequency can drop; if not, keep C3. C1 (migrating rails) is not recommended: it touches every rail parser for a signal a probe already gives cheaply.

## 19. Experiment: does a probe start the 5-hour window?

### 19.1 Question and why it matters

Does one probe against an idle account START that account's 5-hour window (and with it the reset clock)? Always-on cheap probing (the operator accepts a small, low-frequency, standing probe cost, about 0.0034 USD API-equivalent per probe, V6) is only safe if a probe does not move the clock; if it does, a probed idle alias would present a 5 h window it would not otherwise have, and the reset time `pick` reads would be the probe's own doing.

> Amended 2026-11-04 (d-2d6a93aa): the operator's stated standing probe is now limited to confirmed `false` providers (about every 30 minutes, only without a newer observation); see "Amendment 2026-11-04: probe policy per provider" at the end of this plan.


### 19.2 Who runs it and what authorisation it needs

This lane does NOT run it. It needs a real API call with an alias token.
- Executor: the operator, or a person/session the operator names through the PM. Not this hands lane.
- Authorisation required: (1) the operator names ONE alias to use (an account he is willing to have measured), in writing to the PM; (2) the operator's own confirmation of the spend (6 to 8 probes, about 0.03 USD API-equivalent in total, 8 x 0.0034, the larger sample of V6, and an unknown share of that alias's subscription quota); (3) the run goes through the G37 wrapper (`claude-account.js run --alias <A>`), so no token is read by the executor. A PM "go" message does not by itself cover use of an account's credentials; the operator's confirmation is needed and should be recorded in the run's evidence directory.
- Not allowed: running it on an account in active use, using the default login instead of an alias, or sending any 429 traffic.

### 19.3 Preconditions (confirm the account is idle without spending)

All must hold and be written down before step E1:
1. The latest observation for the alias (statusline snapshot, wrapper mirror, or hub row) shows `five_hour` absent or `resetsAt` already in the past, and, if a statusline value exists, utilization 0.
2. No attempt for that alias in the wrapper audit file (`accounts-audit.jsonl`, `ctx.auditFile`) in the last 5 hours plus 30 minutes margin, and the operator confirms no interactive session, no other host and no other tool used the account in that time.
3. The probe command works against the alias (`claude-account.js env-check --alias <A>` passes; it spawns no claude).
4. The executor has a quiet terminal and a clock (UTC) and will not use the account for the duration (about 6 hours of observation, mostly waiting).
5. Re-check of 18.5 against the official docs, so a free source is not missed.
If condition 1 or 2 cannot be established, the account is not idle and the experiment is invalid; pick another alias or wait.

### 19.4 Procedure (each step output goes to a file in a temp dir; only field names and the numbers below are kept)

Probe command (the executor substitutes `<A>`; the prompt is a few words):
```
node scripts/claude-account.js run --alias <A> --purpose quota-experiment --timeout 60 \
  --stdout <tmp>/e<k>.out --stderr <tmp>/e<k>.err -- \
  claude -p 'Reply with OK' --model haiku --output-format stream-json --verbose --tools "" --no-session-persistence
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
| E2 absent and absent through E4' | AMBIGUOUS: either a probe does not start the window, or the server does not report the window for a tiny call. Absent telemetry alone never counts as "does not start". It becomes that result only with an independent observation (for example a statusline snapshot or a real run shortly after, showing no window opened by the probes). Answers Q1 only as "idle shows `five_hour` absent". |
| E2 absent, then present at a later probe with `resetsAt - t = 18000` of the later probe | Window started by the later probe, not the first: the first probe was too small to open it (or too early); record and treat as "does not start on the first call, but counts later" (needs a repeat). |
| E2 present with `d1` clearly less than 18000 or `resetsAt` before E2 | The precondition failed (account was not idle, or a clock problem); the run is void, not a result. |
| E6 shows a new `resetsAt` about 18000 after E6's time | Window rolled and was re-opened by the probe E6; consistent with "starts"; confirms the anchor logic. |

### 19.6 Decision tree (what the design does with the answer)

- A. Probe does NOT start the window (third row, confirmed by an independent observation): the manifest may say `starts_window: false`, which makes `quota_probe = "scheduled"` available to the operator (the recommended setting; the default stays `off`, 5.3). Under it, periodic probing of every enrolled alias that has a token on that host: every P = 60 minutes, but SKIP an alias when it already has an observation (any source) newer than N = 30 minutes, and skip when its last known utilization is at or above 0.90. Reasons for N = 30 min: half the probe period, so a busy alias (passive or statusline feeding it more often than every 30 min) is never probed, an idle one is probed about once an hour; and the CLI's emission condition for the event is UNVERIFIED (Q19), so nothing here relies on it: N = 30 min is a policy choice, half the probe period, far inside the 6 h hard staleness limit. Demand rule: probe only an alias that a `pick` consulted within the last 24 h or that `staleCandidates` returned, never an alias nobody asks about; and `scheduled` is not enabled until Q5 has a recorded quota share. Cost: at most 24 probes per such alias per day, about 0.08 USD API-equivalent per day (24 x 0.0034), plus the quota share Q5 must have measured.

> Amended 2026-11-04 (d-2d6a93aa): the schedule is now about one probe per 30 minutes (replacing P = 60 and N = 30), and only for an alias with no newer observation; the demand rule and the 0.90 skip stay. The "recommended setting, default stays `off`" wording is superseded by the per-provider default. The Q5 gate is KEPT, per provider (PM ruling): periodic probing starts only when the provider has `starts_window=false` + `high` + evidence AND that provider's own Q5 (quota cost of one probe) has a recorded share; on-demand probing is not limited by Q5. Cost at 48 probes per alias per day is about 0.16 USD API-equivalent (48 x 0.0034), double the figure above; see "Amendment 2026-11-04: probe policy per provider" at the end of this plan.

- B. Probe STARTS or slides the window (first, second rows): `quota_probe = "stale"` is the only mode: probing happens only just before pick and only when the best observation of the candidate aliases is older than 60 minutes: `pick` asks `staleCandidates` (5.3), the wrapper probes at most the top 1 stale candidate it is about to use, never the others. The alias being picked is going to be used immediately anyway, so starting its window costs nothing it would not have paid. No background schedule. Unknown (idle) aliases are never probed speculatively.

> Amended 2026-11-04 (d-2d6a93aa): branch B is now the default for `true`, `unknown` and unconfirmed `false`; the same on-demand rule applies without a prior enablement step, and for Claude without waiting for this experiment.

- C. Void or ambiguous (fifth or fourth row): repeat the experiment on a fresh idle alias; until a result exists probing stays off and the system relies on statusline + passive only.

> Amended 2026-11-04 (d-2d6a93aa): supersedes the experiment gate and the default: "until a result exists probing stays off" no longer holds. With a void or ambiguous result `starts_window` stays `unknown`, which means on-demand probe before pick when the data is stale; only the periodic probe stays off. See "Amendment 2026-11-04: probe policy per provider" at the end of this plan.

Record the answer in the manifest `starts_window` with its evidence path (section 12 Q2).

### 19.7 What the experiment does not settle

How much of the alias's subscription quota one probe consumes (Q5): the experiment records `utilization` before and after on a non-idle second alias only if the operator chooses to; it is not required for the tree. Whether an interactive session's first message starts the same window: out of scope.

> Amended 2026-11-04 (d-2d6a93aa): measuring Q5 during the window-start experiment remains optional, but a recorded provider-specific Q5 share is required before periodic probing for that provider (A.5b); on-demand probing remains exempt.


### 19.8 Results so far

- glm (run by lane g40swexp, 2026-11-03): one probe (`max_tokens` 8, prompt `ok`) at an idle 5 h entry made `nextResetTime` appear at probe time plus 5 h and utilization 1 %, unchanged at +60 s. A probe moves an idle account's reset clock, so branch B applies: probe only just before pick, never on a standing schedule. `starts_window: true`. Evidence: [starts-window/RESULT.md](../../docs/plans/evidence/2026-11-03-g40-agent-lane-quota/starts-window/RESULT.md), copy `project/plans/context/g40-starts-window-result.md`. It is also the evidence for treating `unknown` as `true` (20.3 rule 2).
- minimax: PENDING. The window was in use at T0 (fixed 5 h grid, 87 % remaining), so no probe was sent; a retry is scheduled for 20:03Z. `starts_window` stays `unknown` (treated as true) until it lands.

> Amended 2026-11-04 (d-2d6a93aa): minimax leans `false` at medium confidence only, so it stays on-demand until read-only window-start evidence reaches `high`; see "Amendment 2026-11-04: probe policy per provider" at the end of this plan.

- Claude: not run (needs an idle alias); until it runs the Claude manifest keeps `starts_window: unknown`.

> Amended 2026-11-04 (d-2d6a93aa): Claude stays `unknown`, so on-demand before pick, and `scheduled` is rejected until the manifest changes and all periodic gates pass (`false` + `high` + evidence, Claude's own Q5); the experiment now only decides whether periodic probing can ever be enabled; see "Amendment 2026-11-04: probe policy per provider" at the end of this plan.


## 20. Provider-neutral contract and adapter manifests

The contract is provider-neutral from day one; the record shape below is the only record shape. Sections 18 and 22 describe the reporter, the mirror and the hub that carry it.

Reference providers (the operator's own accounts): agy, grok, codex, claude code, minimax, qoder, qoder-cli-cn, opencode, glm, kimi. Only the Claude adapter is built by this plan's first phases; the contract and the manifest are provider-neutral from day one.


### 20.1 The key is (provider, alias), not the harness

A quota record belongs to one billing account at one provider. The harness (the CLI that reads or spends it) is not part of the key: a session under opencode that spends a glm account writes provider `glm`, not `opencode`. Rule for naming: `provider` is whoever meters and limits the account. Whether `opencode`, `agy` or `qoder-cli-cn` is a provider or only a harness is decided per row by the capability matrix (20.5), not here.
- `provider`: `^[a-z0-9-]{1,24}$`, lowercase word from the matrix (for example `claude`, `codex`, `grok`, `kimi`, `glm`, `minimax`, `qoder`).
- `alias`: the existing alias grammar. The G37 registry stays Claude-only; its aliases are implicitly provider `claude`. No registry change is made for other providers in this plan.
- Mirror path: `<live_dir>/quota/<provider>/<alias>.json` (21.3); hub key: `(namespace, provider, alias, writer_courier)` (22.1). Nothing was shipped under any earlier path, so there is no migration or dual read.

### 20.2 Record `fleet.quota/1`

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
  "refusal": null,
  "token_state": "unknown",
  "token_state_at": null,
  "host_role": "<role>",
  "token_issued_at": 0,
  "token_expires_at": 0
}
```
Units are those of section 6 (seconds everywhere, `utilization` in `[0, 1]`). The record carries neither `namespace` nor `writer_courier` (the hub takes them from the connection) and never `sent_at` (that belongs to the frame, 18.2).

Window fields:
- `kind`: one of `rolling_5h`, `weekly`, `daily`, `monthly`, `credits`, `rpm`, `tpm`. At most one window per `kind` per record.
- `utilization`: number in `[0, 1]`, optional `clamped: true` (6). Required, except the remaining-only `credits` window of 21.2 where it is `null`. If a provider reports only `used` and `limit`, the adapter computes `utilization = used / limit` before the write; a window with no way to get a fraction is not written.
- `used`, `limit`: optional non-negative numbers, both or neither, `unit` required when present: `requests`, `tokens` or `credits`.
- `resets_at`: epoch seconds integer, or `null` when the provider gives no reset time (then the window is usable for ordering but never for "tight until"; `null` is not 0).
- `source` (window level; the one enum, no other value is legal, `none` is reader output only): `passive` (parsed from output the provider's CLI produced in a normal run, including the interactive statusline feed, which is not a separate source), `endpoint` (a zero-token endpoint or response header), `probe` (a tiny probe call), `estimated` (a local counter against a plan limit). A refusal is not a window and not a source: see `refusal`. The record-level `source` is a different field (21.6).
- `observed_at`: epoch seconds of the observation, per window.
Record-level: `visibility` is the adapter's effective level (20.4); `refusal` (21.8); `token_state` and `token_state_at` (21.1); the placeholder `source` (21.6, which also lists the only valid empty-`windows` shapes); `host_role`, `token_issued_at`, `token_expires_at` (token dates may be `null` when the manifest says the lifetime is unknown).
Claude mapping: stream `unifiedWindows.five_hour` -> `rolling_5h`, `seven_day` -> `weekly`; `utilization` copied; `resetsAt` -> `resets_at`; source `passive` (event or statusline feed) or `probe`. `seven_day_opus` and `seven_day_sonnet` are not mapped (out of scope, 16).

Semantics shared by all providers:
- A provider refusal (HTTP 429 or equivalent) is a `refusal` (21.8), never an invented window. G37's cooldown file remains the headless signal; the record is how other hosts learn of it.
- `estimated` windows may only make an alias look tighter: they can raise `used` and classify `tight` (>= 0.90), never `ok`; an alias whose only windows are `estimated` and below 0.90 stays `unknown`. They merge apart from measured windows and never lower or replace one (5.2 rule 4, N81).
- `rpm` and `tpm` windows are short throttles: stored and displayed, excluded from the `used` that decides `ok`/`tight`; they feed the cooldown path only.
- `used` for pick = max `utilization` over live windows of kinds `rolling_5h`, `weekly`, `daily`, `monthly`, `credits`. A window whose `resets_at` has passed is dropped (5.2 rule 2); `resets_at: null` never expires by clock, only the 6 h age limit retires it.
- The codeforge file is converted to this contract once, in the reporter's statusline adapter (18.3); nothing else renames fields (21.5). Non-Claude kinds use the generic `interpretWindows` of P1.

### 20.3 Adapter manifest `fleet.quota-adapter/1`

One manifest per provider, a data file (proposed path `scripts/quota-adapters/<provider>.json`, validated by a new checker that follows the `config-keys.json` pattern). The manifest declares what is possible; adapter code implements the modes. Fields:
```json
{
  "schema": "fleet.quota-adapter/1",
  "provider": "claude",
  "visibility": "L3",
  "starts_window": "unknown",
  "windows": [ {"kind": "rolling_5h", "unit": null, "limit_known": false, "required": true},
               {"kind": "weekly",     "unit": null, "limit_known": false, "required": false} ],
  "capture": [
    {"mode": "passive",   "cost": "zero_token", "verified": true,
     "parser": "claude-stream-rate-limit-event", "needs": "stream-json --verbose",
     "evidence": "<url or evidence path>"},
    {"mode": "endpoint",  "cost": "zero_token", "verified": false,
     "note": "none found"},
    {"mode": "tinyprobe", "cost": "tokens", "verified": true,
     "argv_template": ["claude","-p","<PROMPT>","--model","haiku","--output-format","stream-json","--verbose","--tools","","--no-session-persistence"],
     "est_cost_usd": 0.0034, "est_out_tokens": [8, 222], "min_interval_minutes": 60,
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
2. `starts_window` is `true | false | "unknown"`, with the evidence path when not unknown. `unknown` is treated as `true` for any decision (conservative; the glm measurement, 19.8, is the evidence): when an operator enables probing (`quota_probe=stale`, which is off by default whatever this field says, 5.3), probes run only before pick, never on a standing schedule (19.6 branch B). Only `false` with evidence makes `scheduled` available.

> Amended 2026-11-04 (d-2d6a93aa): "which is off by default whatever this field says" and "never on a standing schedule" are replaced by the per-provider default; only `false` with `high` confidence and evidence makes periodic probing the default; see "Amendment 2026-11-04: probe policy per provider" at the end of this plan.

3. `credential_ref` holds a REFERENCE only, never a value. `kind` is `file` (a path template under the accounts dir) or `env` (`{"kind":"env","name":"<VAR>","file":"<env-file path template>"}`: the NAME of an environment variable, pattern `^[A-Z0-9_]{1,64}$`, plus the path template of the file that defines it). The checker rejects a `file` ref that is not a path template (no scheme, no `=`, no token-shaped string, no absolute path outside the accounts dir and the matrix-listed provider dirs) and an `env` ref whose name is followed by `=` and a value or does not match the pattern. The adapter reads the credential through the existing wrapper path; the manifest checker and the reporter never open it.
4. `token_lifetime`: `{days, evidence}`; `days: null` means unknown and suppresses expiry warnings for that provider.
5. `visibility` is the highest level this manifest can reach with VERIFIED captures: L0 nothing is visible; L1 only a refusal (429 or equivalent) is visible; L2 a utilization percentage is visible but without reset times for every window; L3 full `windows[]` with reset times. A capture marked `"verified": false` never counts toward the level and is disabled at runtime. The record's `visibility` equals the highest level actually produced by the last observation, so a degraded adapter shows as degraded.
6. `capture[].verified` follows the matrix: a mode with no evidence is `false` and the matrix row must say what was checked (same rule as 18.5).
7. Pure data; adding a provider adds a manifest and an adapter implementation, never a new contract version.

Claude manifest values above come from this plan's own verified facts (V1 to V3, V6 to V8, 18.5). Everything else in a row is filled from the matrix.
8. `windows[].required` names the windows that must be known and fresh before the alias can be classified `ok` (8.3). A manifest that can reach L2 or L3 lists at least one required window; the checker fails otherwise. For Claude, `rolling_5h` is required and `weekly` is not.

### 20.4 Visibility levels and what pick does with them

| Level | Meaning | Record | Pick behaviour |
|-------|---------|--------|----------------|
| L0 | nothing visible | none, or a placeholder (21.6 a) | alias `unknown`; ordering by priority only |
| L1 | only a refusal is visible | `windows: []` and a `refusal` (21.6 b, 21.8) | `unknown` until a refusal, then `cooling` until it expires |
| L2 | utilization visible, resets incomplete | windows with `utilization`, some `resets_at: null` | `ok` / `tight` from `utilization`; `tight` without a reset time uses the default cooldown instead of a reset |
| L3 | full | windows with `utilization` and `resets_at` | full behaviour of section 8 |

A credential-state-only record (21.6 c) carries L0 or L1 (L1 if it also holds a refusal); pick uses it only for `invalid`.

### 20.5 Capability matrix (produced by another lane)

The 10-provider capability survey is NOT part of this plan (lane `g40survey` produces it). This plan reserves the place and the rule for using it:
- Location: the evidence directory `docs/plans/evidence/2026-11-03-g40-agent-lane-quota/capability-matrix.md` (see capability-matrix.md there; this lane does not create or edit it).
- Using the matrix to fill a manifest (one provider = one row):
  1. `provider` and its harness: take the provider that meters the account; a harness-only row (for example a CLI that fronts another vendor) gets no manifest of its own, its row points at the real provider's manifest.
  2. For each of the four capture modes, copy `verified` from the matrix's evidence mark; copy `cost` and the tinyprobe argv and per-call cost from the matrix; a mode the matrix marks "not found" becomes `verified: false` with `note` = what the matrix says was checked.
  3. `windows`: the matrix's list of window kinds and whether a limit number is public (`limit_known`).
  4. `visibility`: highest level that has at least one `verified: true` capture producing it.
  5. `starts_window`: the matrix cell, else `unknown`.
  6. `credential_ref`: the credential file or login location the matrix names, converted to a `file` path template under the accounts dir; where the matrix names an environment variable and the file that defines it (as for minimax and glm), an `env` ref (20.3 rule 3). If the matrix gives only a value or a vendor keychain item with no name or path, the credential is not referenced and the mode that needs it is `verified: false`.
  7. `token_lifetime`: matrix cell with its URL, else `days: null`.
  8. `matrix_row`: the anchor of the row, so a reviewer can re-derive every field.
- A manifest field not backed by a matrix row (or by this plan's own verified facts for Claude) fails the manifest checker (negative control N27). A `verified: true` tinyprobe whose `argv_template`, with `<PROMPT>` substituted, is not byte-equal to the evidenced command also fails it.

### 20.6 Negative controls

- N24 A record whose key says provider `a` but whose path or body says provider `b` is rejected (`provider_mismatch`).
- N25 A window of an unknown `kind`, a duplicate `kind`, a `used` without `limit`/`unit`, or a `unit` outside the enum is rejected; so is a window `source` outside `passive|endpoint|probe|estimated` (including `none` and `statusline`).
- N26 An `estimated` window below 0.90 never yields class `ok`; at or above 0.90 it yields `tight`.
- N27 A manifest with a `verified: true` capture and no `evidence`/`matrix_row`, or with `starts_window` missing, or a verified tinyprobe whose `argv_template` is not byte-equal to the evidenced command, fails the checker; a manifest enabling a capture marked `verified: false` fails.
- N28 A manifest `credential_ref` carrying a value (token-shaped string, `KEY=...`, a URL with userinfo) or a path outside the allowed roots fails; the checker never opens the referenced file (test: the path points at an unreadable fixture file and the check still passes/fails on the string alone). An `env` ref whose name is followed by `=` and a value, or whose name does not match `^[A-Z0-9_]{1,64}$`, fails the same way.
- N29 `rpm` / `tpm` windows at 1.0 do not make an alias `tight`; a `weekly` window at 0.95 does.
- N30 `resets_at: null` on a `rolling_5h` window: usable for ordering, never extends a cooldown, retired by the 6 h age rule.

## 21. Contract details

Source of these details: codeforge `5eb4ed7`, `doc/plans/2026-11-03-g40-usage-accounts.md` section 9 (read-only). Code is not changed by this section.

### 21.1 Token revoked or invalid: record field `token_state`

Record-level fields `token_state`: `"ok" | "invalid" | "unknown"` (absent is read as `unknown`) and `token_state_at` (epoch seconds of the last state change, or `null`; used for recovery, 5.6). It is a different state from a 429 (a cooling window, retried after `resets_at`) and from stale data (older than 6 h, ignored): `invalid` says the credential itself is refused and no waiting fixes it.
- Set to `invalid` only by one of: (1) an authentication refusal on a call or probe that used this alias's credential (HTTP 401, or the provider's documented auth-failure code; the existing `auth_failed` of 5.6). A 403 (policy, model access) is NOT an auth refusal here: it keeps its G37 classification and never touches `token_state`, so one transient 403 cannot trap an alias; (2) the operator command `account set --state revoked`; (3) a manifest-verified endpoint that reports the credential invalid. Never by a 429, never by an old `observed_at`, never by `token_expires_at` passing (an expired date is its own warn level, 21.4).
- Set to `ok` only by a later successful authenticated call for that alias or `account set --state active`. Set to `unknown` when no authenticated call has been seen. `token_state` is a state, not a measurement: the 6 h age rule does NOT retire an `invalid` in the own mirror; only a state change does. The hub row itself expires at `hub_received_at + 6 h` with no heartbeat; the reporter re-pushes a held `invalid` only under 18.2 rule 4 (hub copy missing), with the ORIGINAL values, 23.1.
- A record with no windows may carry only this state: shape (c) of 21.6 (`token_state_at` required), so a first-call 401 publishes `invalid` without any prior window (N85).
- Reporter: a change of `token_state` pushes at once (18.2 rule 3), and counts as a change even when no window moved.
- Pick: an `invalid` alias is never selected (precedence over cached quota: 5.6), gets class `invalid` (not `cooling`, not `unknown`), no cooldown timer is started, and `claude-account.js status` shows it on its own line. Its windows stay in the record but are ignored for ordering.
- Display: `invalid` is drawn as the token chip (codeforge ordering: token chip first), with the alias and the word for revoked; no gauge, no utilization.


### 21.2 Credits balance without a denominator

`credits` windows (codex shows only a balance) may carry `used: null`, `limit: null` and a new optional window field `remaining` (number `>= 0`, `unit` required when present; only on kind `credits`, on any other kind `quota_invalid`).
- Allowed shapes: (a) `used` and `limit` both set (as in 20.2), `remaining` optional and, if present, must equal `limit - used`; (b) remaining-only: `used: null`, `limit: null`, `remaining` set, `unit` set, and `utilization: null`.
- `utilization: null` is legal ONLY in shape (b), on kind `credits`. Any other kind or shape with a null `utilization` is `quota_invalid`. It is never 0 and never 1.
- Pick: a window with `utilization: null` is excluded from the `used` maximum (20.2). An alias whose only live windows are null-utilization stays class `unknown` (same rule as an `estimated`-only alias, N26), except `remaining == 0`, which classifies `tight` (balance exhausted). A balance can say "empty", never "plenty".
- Display: the row shows `remaining unit` text and no gauge and no percentage.

### 21.3 One mirror root name: `<live_dir>`

Pinned name: `<live_dir>`; mirror path `<live_dir>/quota/<provider>/<alias>.json`. codeforge's `<live_base>` is the same directory normally; the resolvers:
- autopilot `resolveLiveDir()` (`scripts/lib/live-state-dir.js`): `$AUTOPILOT_LIVE_DIR` override (line 263, 282), else `$XDG_RUNTIME_DIR/autopilot` (line 244-245), else `<run-user-root>/<uid>/autopilot` when `XDG_RUNTIME_DIR` is unset and that dir exists (xdg-inferred, lines 246-251), else `/dev/shm/autopilot-<uid>` (line 254), else `~/.autopilot` (line 310).
- codeforge `resolve_live_base()` (`src/live.rs` at `5eb4ed7`): `$AUTOPILOT_LIVE_DIR` (lines 54-58), `$XDG_RUNTIME_DIR/autopilot` (59-65), `/dev/shm/autopilot-<uid>` (66-69), `/tmp/autopilot-<uid>` (70-74), else `~/.autopilot` (line 87).
- Same on: override, xdg, shm, `~/.autopilot` fallback. Different on exactly two points: autopilot has the xdg-inferred step, and its `/tmp` candidate (`/tmp/autopilot-<uid>`, source `tmp`) counts only when `/tmp` is a RAM filesystem (`live-state-dir.js` `ramCandidates`); codeforge takes its `/tmp` candidate without that rule and has no xdg-inferred step. codeforge's own files live one level below the base (`<live_base>/codeforge/...`); the quota mirror sits at `<live_dir>/quota/`, so the subdirectories never collide.
- Rule: `<live_dir>` is defined by the autopilot resolver. A reader in another repo must reproduce it exactly: add the xdg-inferred step, and a mirror found only under a `/tmp` candidate is not a mirror (not RAM-backed by the autopilot rule). Parity vectors: N37. Coordination item for codeforge, tracked there, not edited here.

### 21.4 Token warn levels are contract constants

Contract constants (a data file shared by every consumer, proposed `scripts/lib/quota-contract.json`; both the autopilot code and codeforge read the same values, the display never hard-codes them):
```json
{ "token_warn_days": { "notice": 30, "urgent": 7 }, "observation_max_age_hours": 6 }
```
- A token with `token_expires_at` minus now at or under `notice` days warns `notice`; at or under `urgent` days warns `urgent`; past the date `expired`. All three are advisory (expiry warns, never blocks).
- The config key `accounts.token_warn_days` (section 10) is removed in favour of the constant: one source, no decoupling between code and display. A warn level is derived by the reader from `token_expires_at`; the record does not carry it.

### 21.5 Field-name mapping

| Concept | `fleet.quota/1` (contract) | `codeforge.quota/1` file | stream event |
|---------|----------------------------|---------------------------|--------------|
| fraction used | `utilization` 0..1 | `pct` 0..1 | `utilization` |
| reset time | `resets_at` epoch seconds, or null | `resets_at` epoch seconds | `resetsAt` |
| observation time | `observed_at` epoch seconds, per window | `written_at_ms` (milliseconds, converted once) | none |
| 5 h window | `kind: "rolling_5h"` in `windows[]` | top-level 5 h entry | `unifiedWindows.five_hour` |
| 7 d window | `kind: "weekly"` | top-level 7 d entry | `unifiedWindows.seven_day` |
| schema name | `fleet.quota/1` | `codeforge.quota/1` | n/a |
The codeforge file keeps its own names and schema; it is an input to the reporter's statusline adapter, converted once at the boundary (6). The contract has exactly one spelling. A record carrying `pct`, `resetsAt`, `five_hour`, `seven_day` or any `*_ms` field is rejected by the validator (N38), never silently renamed. Display code locks onto `fleet.quota/1` (codeforge 14). When this contract's version is frozen, codeforge is told.

### 21.6 L0 placeholder record for aliases with no data

For every alias in the G37 registry (implicitly provider `claude`, 20.1) that has no mirror record and no hub row, the reporter pushes one placeholder per cycle that finds the gap, so the display can show an account that was never observed:
```json
{ "schema": "fleet.quota/1", "provider": "claude", "alias": "<alias>", "visibility": "L0",
  "windows": [], "source": "registry", "host_role": "<role>", "token_state": "unknown",
  "token_issued_at": null, "token_expires_at": null }
```
- Empty `windows` is valid in exactly these shapes, and only with `visibility` L0 or L1 (L2 or L3 with no window is `quota_invalid`; a refusal needs L1); anything else is `quota_invalid` (one rule; the hub mirrors it, fleet note section 1):
  - (a) placeholder: `refusal` null, `token_state` `unknown`, `token_state_at` null, and a record-level `source` (below).
  - (b) refusal-only: `refusal` non-null (any `token_state`), no record-level `source`: the refusal is the observation and carries its own time. `visibility` must be L1: a visible refusal is by definition level 1.
  - (c) credential-state-only (L0 or L1): `token_state` `ok` or `invalid` with `token_state_at` required, no record-level `source`; a record may be both (b) and (c). `token_state_at` is null exactly when the state is `unknown`.
- A non-null `refusal` with `visibility` L0 is `quota_invalid` in every shape, with or without a `source` (N77).
- `source` is a record-level field and a CLOSED enum (Q21, N89): the only value is `registry`, allowed ONLY in shape (a); an unknown value is rejected, and adding a value bumps the contract version (the hub's own pattern is `^[a-z0-9_-]{1,24}$`, 22.1). A record with non-empty `windows`, a refusal or a state stamp that carries it is rejected (a window-level `source` is another field, 20.2).
- No `observed_at` anywhere (nothing was observed; freshness is not forged). Token dates come from the registry's token metadata when present, else null; never a token value.
- A placeholder is only pushed when no real record exists; any real observation replaces it, and a placeholder never overwrites a real record. It is not retired by the 6 h reader rule (it carries no measurement); the hub copy still expires at `hub_received_at + 6 h` (22.1), so the reporter re-pushes the placeholder under 18.2 rule 4 when the hub copy is missing (original values, 23.1).
- Scope: Claude registry aliases only. Other providers have no registry (20.1), so their never-observed accounts are not enumerated by this contract; that is a gap the per-provider adapters close with their own alias list.

### 21.7 Not in v1: history and sparkline

v1 stores no history and defines no history field. A trend or sparkline is deferred to the hub table (fleet F4), which would own sampling; until then a display must not invent one from mirror reads (codeforge 10).

### 21.8 Provider-neutral refusal

Some providers refuse a request without telling a window kind or a reset time (the OpenCode Go limit refusal is the evidence). A refusal is therefore NOT a window and needs no `kind`. Record-level field `refusal`: `null`, or
```json
{ "observed_at": 0, "retry_at": null, "reason": "rate_limit" }
```
- `observed_at`: epoch seconds of the refusal. `retry_at`: epoch seconds when the provider says to retry, or `null` when it gives no hint. `reason`: `rate_limit`, `quota` or `other`. No other field.
- Cooldown: until `retry_at` when present; otherwise until `observed_at + default_minutes * 60` (manifest `cooldown_on_429.default_minutes`, 30 when the manifest is silent). A refusal never extends a cooldown that G37's own cooldown file already holds; the longer one applies.
  Amended 2026-11-04 (PM): without retry_at, retry_at = the G37 cooldown end the wrapper computed for that 429; the manifest default applies only where G37 has no class.
- Expiry: the refusal stops counting at the end of its cooldown, or at `MAX_AGE_S` after `observed_at`, whichever is first. After expiry the class comes from the windows (8.3), usually `unknown` for an L1 provider.
- Merge: across rows the live refusal with the smallest age (5.2 rules 2 and 6: a local stamp's age is `now_local - t`, a peer stamp's age is `(now_local + hub_offset) - t(refusal.observed_at)`) is the one considered; a raw local time is never compared with a hub time; one live refusal anywhere makes the alias `cooling` here. Only expiry clears it; a window below 1.0 does not.
- Pick: a live refusal is class `cooling`; no cooldown timer is started by the record itself (G37's file remains the local timer); `status` shows the alias with the reason and the end time.
- A record with no windows may carry only this refusal: shape (b) of 21.6, with no record-level `source`; its time basis is the refusal's own stamp (5.2 rule 1).
- Reporter: a new or changed refusal is a change (18.2 rule 3) and is pushed through the bucket; a re-push keeps the original `observed_at`.
- The hub carries it as an optional typed sub-message (22.1).

### 21.9 Negative controls (each shown red before green)

- N31 An alias with `token_state: "invalid"` and utilization 0.1 is never picked; a 429-cooling alias and a stale alias are not classed `invalid`; the planted case (pick selects the invalid alias) is red.
- N32 `token_state` outside the enum is rejected; an `invalid` record older than 6 h stays `invalid`; only an `ok` observation clears it.
- N33 A `credits` window `{used:null, limit:null, remaining:3100, unit:"credits", utilization:null}` is accepted; `utilization: null` on any other kind, or `remaining` that does not equal `limit - used`, is rejected.
- N34 An alias whose only windows have null `utilization` is never class `ok`; `remaining: 0` yields `tight`.
- N35 Static scan: the warn code contains no literal 30 or 7 day threshold outside `quota-contract.json`; a planted literal fails the scan; changing the constant changes the warn level in both readers.
- N36 The reporter pushes an L0 placeholder for a registry alias with no record; it does not overwrite a real record; a placeholder carrying `observed_at`, `token_state_at` or a refusal is rejected (the full shape table is N77).
- N37 Parity vectors for `<live_dir>` (override, xdg, xdg-inferred, shm, fallback): the autopilot resolver and a reference reader built from 21.3 return the same path on every vector; a reader that includes the `/tmp` candidate fails vector xdg-inferred absent plus `/tmp` present.
- N38 A record with `pct`, `resetsAt`, `five_hour`, `seven_day` or a `*_ms` field is rejected `quota_invalid`, not renamed.

## 22. Hub design settled with fleet

Sources: fleet message 01M6H3S89D3MPBWVWEASJM27M2; fleet message 01M6H3W6FC4ZNJM450WZ64JAB4; fleet `develop` `1949b11` (revision 4), `docs/plans/2026-11-04-g40-hub-quota-store.md` (copy: `project/plans/context/g40-fleet-hub-quota-store-1949b11.md`; the evidence directory keeps the originals of `905d13e`, `625b0fe`, `c2d57ab` and `1949b11`). The first design pass's hub questions (key, write permission, TTL, clocks, conflict, rate) are all answered here.

### 22.1 Settled answers

| Topic | Settled answer |
|-------|----------------|
| Storage | a proto-typed table, not generic kv; string fields have patterns, so a token-shaped value is rejected by the schema itself; the optional `refusal` sub-message (21.8) and `token_state_at` are added to the typed record |
| Key | `(namespace, provider, alias, writer_courier)`; `namespace` and `writer_courier` come from the authenticated connection, not from the record body |
| Write permission | only a courier writes, only its own row; the reporter is the only hub writer; `_access` `quota_publish` can deny, answered with nack `quota_publish_denied` (the reporter stops pushing, keeps the mirror, tries one frame per hour) |
| Expiry | hard cap `hub_received_at + 6 h` on the hub clock; a write cannot extend past it; no heartbeat; the hub sweeps and filters on read; a window whose `resets_at` passed stays in the row and the reader ignores it |
| Clock | every frame carries `sent_at` (seconds); the hub refuses `observed_at > sent_at + 5 s` (any window, `token_state_at` or `refusal.observed_at`: `quota_clock_invalid`), stores `observed_at_hub = observed_at + (hub_now - sent_at)` beside the raw value, and flags `skewed` when `abs(skew) > 5 min` (stored, not refused) |
| Conflict | none at the hub: each courier keeps its own row; the reader merges (5.2); `host_role` is informational |
| Limits | per key `(provider, alias)` per courier: 1 write per 10 s, burst 3; per courier: 60 writes per minute and 256 live rows; 7 windows per record. Over a rate limit: visible nack `quota_rate_limited`, always with `retry_after` in seconds; the 257th live row: `quota_rows_full`, never with `retry_after`, cleared only when a row expires or is deleted |
| Delivery | snapshot on connect, deltas after, each frame carrying `hub_now` (seconds), feeding the mirror; an old hub nacks the new frame `unsupported` |
| Spelling | the hub uses 20.2: `utilization`, `resets_at`, `observed_at` (seconds) |
| Schedule | the hub change ships with or after F4, never during a release freeze; freeze until 2026-11-10T16:24Z |

### 22.2 Mirror view

For each `(provider, alias)` the mirror IS the hub view: one file `<live_dir>/quota/<provider>/<alias>.json`:
```json
{ "schema": "fleet.quota-view/1", "namespace": "<ns>", "hub_offset": 0,
  "rows": [ { "writer_courier": "<id>", "host_role": "<role>", "observed_at_hub": 0, "skewed": false,
              "record": { "schema": "fleet.quota/1", "...": "..." } } ] }
```
- One row per `writer_courier`; with the namespace binding below the full authenticated key is preserved. Row-level `host_role` is a copy the hub takes from the record; a reader uses the record's value. `observed_at_hub` is `null` for the local row and for a peer row with no stamp. The local courier's own pending row is tagged with the local courier id (the id its connection reports; the fixed word `local` when no courier connection exists) and has `observed_at_hub: null` (judged by the local clock). Only that row is ever pushed (18.2 rule 0).
- Peer rows arrive from snapshot and deltas, keep their `writer_courier`, `host_role`, `observed_at_hub` and `skewed`, and are written only by the reporter's pull side. Writer discipline and the lock are in 18.4.
- `hub_offset` is MIRROR-ONLY: the hub refuses a push frame that carries it (`quota_invalid`, unknown field), so the reporter strips it, and every other mirror-only field, from the record before building a frame (N70). `hub_offset` (seconds) is the reader's estimate of hub clock minus local clock, refreshed from `hub_now` on every delivered frame (section 11); the reporter's pull side is its only writer.
- Namespace binding: `namespace` is the authenticated namespace of the connection that delivered the peer rows (never a record field). `<live_dir>/quota/namespace.json` (`{"schema":"fleet.quota-ns/1","namespace":"<ns>"}`) holds the namespace the reporter is connected as now (the namespace of its current connection, which the hub's snapshot frame also carries as the connection's authenticated namespace; the courier's own configured namespace must equal it); the connect step writes it BEFORE replacing any view. A reader uses a view's peer rows only when both values are non-null and equal; otherwise it ignores every peer row (`status`: `quota_peer_namespace_mismatch`) and keeps the local row; a configured namespace that differs from the snapshot frame's namespace gives the same result, and the whole view is not used (N86). The local row describes this host's own account, so it survives a namespace change and is pushed under the new namespace by 18.2 rule 4 with its original `observed_at`. Old peer rows are replaced by the new snapshot (N82).
- Readers merge all rows per window with 5.2.

### 22.3 Merge and freshness

One rule set (5.2, 11): peer rows by hub time, the local row by the local clock, compared as ages, newest per window wins, an exact tie goes to the local writer, rows past `hub_received_at + 6 h` and windows past the 6 h reader rule are ignored. Freshness is judged ONLY by `observed_at_hub` (or the local clock for the local row), never by a row still existing: a re-pushed row (23.1) restarts its hub expiry but keeps its old `observed_at_hub` (fleet `1949b11` section 4). Control N48: a re-pushed old row is stale by its `observed_at_hub` even though it was just received (a planted reader that uses row presence fails).

### 22.4 Push pacing: one token bucket strictly below every hub limit

- Constants (each strictly below the matching hub limit; this bucket is the only per-key rule, 18.2): per key 1 per 12 s, burst 2 (hub: 1 per 10 s, burst 3); per courier 50 writes per minute (hub: 60); own live rows at most 240 (hub: 256). A constant at or above the hub's value is a defect (N44).
- Every push passes it: ordinary pushes, the "at once" paths of 18.2, the startup push of all aliases, re-pushes (23.1) and retries after a nack. At 50 per minute 240 rows take about 5 minutes to publish at start; the order is newest `observed_at` first, placeholders last and never displacing a row that has a window.
- Queue: at most one entry per key; coalescing keeps ONLY the newest value, never silently: each coalesced value increments `coalesced_total` for the key and writes one log line (`coalesced key=<provider>/<alias> dropped_observed_at=<n> kept_observed_at=<n>`); rows dropped for the 240 cap are counted and logged the same way (`row_cap_dropped_total`, every dropped alias named); both show in `status`.
- Retention is bounded: no entry older than `MAX_AGE_S` is kept unless it carries non-aging state (18.2 rule 4); an entry stays in the mirror until the hub accepts it.
- `quota_rate_limited` waits its `retry_after`, then the bucket applies again; the nack never consumes a retry slot early.

### 22.5 Negative controls

- N39 The validator carries the hub's string patterns for `alias`, `provider`, `host_role`, `kind`, `source`, `token_state`, `unit`, `reason`; a token-shaped string in any of them is rejected before a push; a record body carrying `namespace` or `writer_courier` is rejected.
- N40 Two rows with the same `(provider, alias)` and different `writer_courier` coexist in the reader; a pull never overwrites the local row and the reporter never writes a peer row as its own.
- N41 The merge takes the newest per window across rows; an exact tie keeps the local row; a peer window past 6 h is ignored; a `skewed` row is flagged, not dropped.
- N42 A nack `quota_rate_limited`, `quota_publish_denied` or `unsupported` is never recorded as pushed: `quota_rate_limited` retries after `retry_after` and the row stays in the mirror, `quota_publish_denied` stops pushing, `unsupported` logs `hub=old` and the reporter keeps running (a fake hub for each).
- N43 Pacing: a burst of 20 "at once" events on one key produces at most 2 pushes in the first second and at most 1 per 12 s afterwards; 300 aliases never leave more than 240 own live rows and placeholders are the ones dropped (red with the bucket removed).
- N44 The bucket constants are below the hub's on every axis, including the per-courier 60 per minute (a planted constant equal to the hub's fails).
- N45 20 queued events for one key yield one sent value, the newest, `coalesced_total` 19 and 19 log lines; a planted bucket that drops without counting fails.
- N46 With 300 aliases `row_cap_dropped_total` equals 300 minus 240 and every dropped alias is named in the log.
- N47 A re-push of an `invalid` row carries the stored values byte for byte; a planted re-push that stamps `now` fails; at most once per 6 h per alias and only when the hub copy is missing.
- N48 See 22.3.

## 23. Re-push after hub expiry

### 23.1 Re-push of `invalid`, refusal and placeholder rows after hub expiry

- The own mirror keeps `invalid`, refusal and placeholder rows. When the hub copy expires (`hub_received_at + 6 h`), the reporter pushes the row again with its ORIGINAL `observed_at` and `token_state_at` (placeholders have none and keep none) in a frame with a fresh `sent_at`. Windows stay subject to the 6 h reader rule by `observed_at`, so a re-push never makes old data look fresh. It is an ordinary write: no extra "re-push" field.
- Rate: about one write per alias per 6 h. This is not a heartbeat: it fires only when the hub copy is missing, carries no new observation and never refreshes a freshness stamp. Rows whose windows are all older than 6 h and that carry no non-aging state are not re-pushed (18.2 rule 4).
- Hub behaviour, confirmed by fleet (`1949b11` section 4): only `observed_at > sent_at + 5 s` is refused; there is no "too old" floor; after a re-push the hub expiry restarts but `observed_at_hub` keeps the old value.

## Amendment 2026-11-04: probe policy per provider (operator decision d-2d6a93aa)

Status: decision recorded; the build is a follow-up (BL-0375, after BL-0372 Tasks 0-3) on the P4 probe path, which is still gated off. Nothing in this amendment is implemented. Source: operator decision d-2d6a93aa, relayed by the PM on 2026-11-04.

### A.1 The decision

For the probe strategy the operator chose "per provider" (follow each provider's own setting). The probe default is decided by the adapter manifest's `starts_window`:

- `starts_window = false` (confirmed by evidence): a periodic probe, about once every 30 minutes, and only when the alias has no newer observation.
- `true` or `unknown`: on-demand probe only, that is, just before pick and only when the data is stale.
- When new evidence arrives, the setting flips automatically through the manifest; no new operator decision is needed.

For Claude, the PM ruled that this decision supersedes 5.3 and section 19: `unknown` means an on-demand probe before pick when the data is stale. The reason on the operator's card: the alias is about to be used anyway, so starting its clock is acceptable.

### A.2 Mapping from manifest to default behaviour

| `starts_window` | confidence | default probe behaviour |
|---|---|---|
| `false` | `high`, with evidence, and this provider's Q5 recorded | periodic, about every 30 minutes, only without a newer observation; on-demand before pick still applies |
| `false` | `high`, with evidence, Q5 not yet recorded | on-demand only |
| `false` | `low` or `medium` | on-demand only |
| `true` | any | on-demand only |
| `unknown` | any | on-demand only |

Unchanged by this amendment: a tight alias (utilization at or above 0.90) is never probed, a cooling or pinned run never probes, at most one probe spawn per `run` (N14, N76), and `scheduled` is rejected for any provider, Claude included, while its manifest is `unknown`/`true` or a periodic-eligibility gate has not passed (`false` + `high` + evidence, plus that provider's own Q5 recorded); once all pass it flips on evidence with no special case for Claude.

### A.3 The "confirmed" threshold

The threshold lives in the manifest. Proposed (provisional) field: `starts_window_confidence: low|medium|high`. Only `starts_window: false` plus `starts_window_confidence: high` plus an evidence path counts as confirmed (PM accepted this extension of the evidence rule). An unset `quota_probe` follows the manifest. The field name and values are provisional (PM agreed) and are settled by the build round. The manifest checker (N27 family) must reject `false` + `high` without evidence.

### A.4 Current state of the three providers

| Provider | `starts_window` | confidence | resulting behaviour |
|---|---|---|---|
| glm | `true` (19.8, measured) | n/a | on-demand only |
| minimax | leans `false` | `medium` | on-demand until read-only window-start evidence reaches `high` |
| Claude | `unknown` | n/a | on-demand only |

### A.5 Residual

An on-demand probe may start an alias's window, and `pick` then refuses that alias (for example, the probe shows it is tight). The PM accepts this risk; severity minor. Why minor: the alias was already a pick candidate, so it would be used soon anyway, and a probe happens only when its data is stale; if pick then refuses it, all that was wasted is the start of one 5-hour window.

### A.5b Q5 gate and cost (PM ruling)

The Q5 gate stays, counted per provider. Periodic probing for a provider starts only when both hold: (a) `starts_window=false` + `high` + evidence, and (b) that provider's Q5 (the quota cost of one probe) has a recorded share. This is an evidence gate in the spirit of the operator decision, not a reversal of it; on-demand probing is not subject to Q5. The roughly doubled periodic cost (48 probes per alias per day) is recorded only, with no limit set. When a provider's setting flips, the PM tells the operator.

> Amended 2026-11-04 (PM ruling, BL-0374): the mirror lock is an OS flock, not a lock file with a reclaim rule. Residual: the mirror is per host and per user, and the plugin updates host by host, so old and new writers can run side by side for a short time; they do not exclude each other (old: `<alias>.lock`, new: `<alias>.oslock`). It affects only that one host, and the worst case is the already-accepted stale row. macOS is unverified for the perl fallback and has no flock(1) by default.

### A.6 Red-light cases for the build

- A provider whose `starts_window` is `unknown` or `true` must never be scheduled for a periodic probe (this is the re-pinned N13: no periodic spawn for such a provider).
- A provider with `false` + `high` + evidence but no recorded Q5 must never get a periodic spawn; its on-demand probe still works.
- A provider with `starts_window = false` but confidence below `high` (or no evidence) must be probed on-demand only.
- Flipping the manifest evidence from `unknown` to confirmed `false` flips the default to periodic with no config edit, in a fixture where that provider already has a recorded Q5; flipping back reverses it. The same flip without a Q5 record still yields on-demand only.

### A.7 Sections touched

Each of these carries a one-line `Amended 2026-11-04 (d-2d6a93aa)` note pointing here; original text is unchanged: 2.5 (Global Constraints bullet), 1 (problem statement), 2 (KR3), 5.3 (including the "Cheapest first" cost paragraph), 10, 12 Q2, 13 P4, 14 N13 and N66, 15 mitigation (b), 18.6 (third bullet), 19.1, 19.6 A, B and C, 19.7 (Q5 paragraph), 19.8, 20.3 rule 2.
