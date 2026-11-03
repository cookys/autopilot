# Plan — G40-data: the agent lane gets its own live quota for every alias
> Status: design only (no code in this plan's authoring commit). Owner: PM program. Branch: `hands/g40data/1`. Size: S (design); implementation phases below. Frame: builds on G37 (`project/plans/2026-11-03-g37-account-switching.md`) and the codeforge G40 design (codeforge `feature/g40-usage-accounts` @ `98c7a8b`, `doc/plans/2026-11-03-g40-usage-accounts.md`).

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
- Hub (after fleet F4): same JSON as the value, key `accounts/<alias>/quota`. Until the hub exists nothing else changes; the local file is the source of truth.

Questions to settle with fleet--claude before the hub phase (P5), all written in section 12 too:
1. Key naming and namespace (`accounts/<alias>/quota` per alias, or one `accounts` table keyed by alias plus `host`?). Two hosts that both run alias `main` observe the same account; do they write one key or `<alias>@<host_role>`?
2. Write permission: who may write an alias key (any lane, or only the wrapper identity)? A lane must not be able to overwrite another account's record.
3. TTL: proposal 6 h to equal `MAX_AGE_MS`; does the hub expire or only the reader?
4. Cross-host clocks: see section 11. Does the hub stamp `received_at_ms`?
5. Conflict: two hosts write the same alias concurrently; rule proposed in 8.3 (newest observed wins per window). Does the hub give compare-and-set or last-writer-wins?
6. Payload limit and rate: at most one write per alias per 30 s; size under 1 KiB.

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
Rules: `five_hour` and `seven_day` are an object or `null` (V3 means either can be missing; `null` is "not reported", never 0). `pct` is a finite number in `[0, 1.5]`; `resets_at` a positive integer in unix seconds. `observed_at` is unix milliseconds on the writer's clock, an integer. `source` is one of the three words; `statusline` appears only on the merged view of a codeforge snapshot, never written by the wrapper (V10). `host_role` is a short role word, `^[a-z0-9-]{1,24}$`, from config `accounts.host_role` (default `agent`); never a host name. `token_issued_at` and `token_expires_at` are unix seconds or `null`. Unknown keys: the record is rejected (`quota_invalid`), the same strictness as `codeforge.quota/1`. Maximum file size 4096 bytes. No other field; in particular no token, no config-dir path, no account email or organisation id. The alias is the only identity.

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
With the hub (P5), the wrapper reads the hub's per-alias records and treats each as another observation candidate in the same merge (5.2): newest per window wins, ties go to the local own record, a record whose `host_role` differs is accepted (the account is the same, only the vantage differs). Two hosts that disagree by more than 0.15 on one window at near-equal `observed_at` produce a `quota_conflict` note and the HIGHER pct is used (understating is the dangerous direction). Each host writes only its own observations; the merge happens at the reader, so there is no writer conflict to resolve beyond last-writer-wins on a single key.

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
- Q8 Hub questions in 5.4 (key naming, write permission, TTL, clocks, conflict, rate) go to fleet--claude via the PM.
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

## Review log
- R0: authored by the G40-data hands lane; no review round yet.
