# G40: hub side of the shared quota store (`fleet.quota/1`)

Status: design note, fleet position pending hetero plan review. It is reviewed
in the same round as autopilot's G40 plan (`project/plans/2026-11-03-g40-agent-lane-quota.md`;
generation 2 revision on autopilot branch `hands/g40swexp/1` at 04636bf00, which
moves the matching sections to §6, §11, §18, §21 to §23). Nothing here is built
yet. The hub change ships with or after the F4 batch, never during a release
freeze.

Revision 2 (plan review generation 1, CONDITIONAL): units are epoch seconds,
`refusal` and `token_state_at` added to the record, mirror writer and shape
aligned with the autopilot plan, reporter budget stated strictly below the hub
limits, nack handling listed as tests, `hub_now` on view frames.

## Scope

The hub stores per-account quota observations so that dispatch pick and the
displays on every host read one view. The record shape is autopilot's
`fleet.quota/1`: `(provider, alias)`, `windows[]`, `host_role`,
`token_state` with `token_state_at`, `token_issued_at`, `token_expires_at`,
and an optional `refusal`. This note settles what the hub does with it: key,
writers, expiry, clock, conflicts, rate limits and storage form. The reporter,
the local mirror, the adapters and pick are autopilot's, and this note does
not change them.

Out of scope: semantic interpretation of windows (the reader's merge), the
probe experiment, provider adapters.

## 1. Storage: a typed table, not kv

A typed protobuf message in `contracts/` (`QuotaRecord`, `QuotaWindow`,
`QuotaRefusal`, with the window kind and the refusal reason as enums) and one
hub table. Not the generic kv item.

- No free-form fields, so a token cannot travel in an extra key.
- Every string field is pattern-bounded (section 2), so a token-shaped value is
  refused `quota_invalid`. "Tokens never reach the hub" is then a property of
  the schema, not a convention.
- Units, validated once by the hub:
  - every time field is **integer epoch seconds**: `observed_at`, `sent_at`,
    `resets_at`, `token_state_at`, `token_issued_at`, `token_expires_at`,
    `refusal.observed_at`, `refusal.retry_at`. Nullable ones are `resets_at`,
    `token_state_at`, `refusal.retry_at`.
  - any epoch field `> 1e11` is refused `quota_invalid` (that is a
    milliseconds value).
  - `utilization` in `[0, 1]`.
  - at most one window per kind, at most seven windows, `used`/`limit`/`unit`
    all-or-none.
- `refusal` (optional, record level): `{observed_at, retry_at|null, reason}`,
  `reason` an enum `rate_limit | quota | other` (pattern
  `^(rate_limit|quota|other)$` in the JSON form). No window kind and no reset
  hint on it.
- `token_state_at` (seconds, nullable) sits beside `token_state`: when that
  state was last observed.
- One additive migration: a new table plus an index on
  `(namespace, provider, alias)`. Nothing existing is rewritten.

Generic kv stays a separate post-F4 item for untyped data.

## 2. Key

The hub key is `(namespace, provider, alias, writer_courier)`.

- `namespace` and `writer_courier` come from the authenticated courier
  connection, never from the record body. Aliases are operator-local names:
  two namespaces may both have `claude/main`.
- `provider`: `^[a-z0-9-]{1,24}$`. `alias`: autopilot's alias grammar.
  `host_role`: a short bounded pattern (or enum once the role list is fixed,
  F1).
- The JSON form of the message is exactly autopilot's spelling
  (`utilization`, `resets_at`, `observed_at`). codeforge's `pct` stays in its
  own adapter; the hub never learns it.

## 3. Who writes and reads

- Hub writers: couriers only, with their own credential, and each courier only
  its own rows (fleet design principle 5). The courier's reporter is the single
  hub writer. No plugin or wrapper carries a hub URL.
- Local mirror writers (autopilot's side, stated so both documents agree): the
  **reporter** writes the mirror; its statusline adapter converts the codeforge
  snapshot and writes the mirror row first, whether or not the hub is
  reachable, then pushes. codeforge's statusline path does not write the
  mirror. The only local-row writers are the wrapper (passive capture, probe)
  and the reporter.
- A record whose body names a different courier or namespace is refused
  `quota_writer_mismatch`.
- Optional `_access` capability `quota_publish` per courier: allowed by
  default for the namespace's couriers, refused `quota_publish_denied` when
  `_access` denies it. `_access` is one of the three places fleet fails
  closed.
- Readers: any courier in the same namespace. Cross-namespace reads only with
  the same channel / `_access` consent rule as dispatch (F2).
- Explicit delete of the courier's own rows (alias removed on that host).

## 4. Expiry

- Row expiry = `hub_received_at + 6 h`, a hard cap that a write cannot extend
  beyond 6 h from its own receipt. The hub clock decides, not `observed_at`.
- There is no heartbeat: an unchanged observation is not re-pushed, so a
  stable idle alias ages out exactly at 6 h. That is intended; an old
  observation must not look fresh.
- The hub sweeps expired rows and also filters them on every read.
- A window whose `resets_at` has passed stays in the row: the reader ignores
  it; the other windows of the row may still be live.
- Re-push after hub expiry (autopilot plan §18.2 rule 4 and §23.1) is accepted
  as a normal write: the reporter sends `sent_at` = now and keeps the original
  `observed_at`. The row's hub expiry restarts from the new receipt, but its
  freshness does not: readers judge age only by `observed_at_hub`, never by
  row presence. No separate "re-push" field is needed; there is no lower bound
  on `observed_at` age in v1.
- The reporter does not re-push a row whose windows are all older than 6 h,
  unless the row carries a state that does not age: `token_state` invalid, a
  `refusal` still in force, or a placeholder. Re-push is at most once per alias
  per 6 h.

## 5. Clock skew between hosts

Every push frame carries `sent_at` (epoch seconds, the reporter's clock),
including a re-push after expiry. The record carries `observed_at` (epoch
seconds) per window. The hub computes `skew = hub_now - sent_at` and stores
`observed_at_hub = newest.observed_at + skew` beside the raw values, where
`newest` is the record's newest window observation. Readers compare only
hub-normalized times, so host clock offset cancels and only network delay
remains.

- An older window's hub time is derived by the reader:
  `observed_at_hub - (newest.observed_at - window.observed_at)`.
- `observed_at > sent_at + 5 s` (any window, `token_state_at`,
  `refusal.observed_at`): refused `quota_clock_invalid`.
- `|skew| > 5 min`: stored, flagged `skewed` in the view so displays can
  mark it (matches autopilot's 5 minute skew limit).
- Snapshot and delta frames to readers carry `hub_now` (epoch seconds) so a
  reader can estimate its own offset from the hub (Q20: yes, adopted).

## 6. Two hosts report the same `(provider, alias)`

Per-host rows; no merge at the hub.

- Each writer courier owns its row, so concurrent writes never conflict and
  there is no last-writer race across hosts.
- The view returns every live row for `(provider, alias)`: the
  `fleet.quota/1` record plus `writer_courier`, `host_role`,
  `observed_at_hub` and `skewed`. The reader applies autopilot's per-window
  newest-wins merge. codeforge gets the host list it needs for `host_role`
  directly.
- Mirror shape (autopilot §22.2, stated so both documents agree): one file
  per `(provider, alias)` holding that view as a list of rows. The local
  pending row is marked with the local courier id and `observed_at_hub: null`;
  it is the only row the reporter pushes. Other couriers' rows are read-only
  and never re-pushed. On a tie the local writer wins.
- A hub-side merge would drop that list and put pick policy in the hub, which
  by design knows only couriers and namespaces.

## 7. Rate and size limits

Hub limits:

| Limit | Hub value | Reporter budget (strictly below) |
|-------|-----------|----------------------------------|
| writes per writer courier and `(provider, alias)` | 1 per 10 s, burst 3 | 1 per 12 s, burst 2 |
| writes per courier | 60 per minute | 50 per minute |
| live rows per courier | 256 | 240 own live rows |
| windows per record | 7, one per kind | same |

The reporter's token bucket covers every push, including the start-up push of
all aliases, so a restart cannot burst past the hub.

- Exceeding a rate limit: nack `quota_rate_limited` with `retry_after`
  (seconds). Never a silent drop (principle 3).
- Exceeding 256 live rows: nack `quota_rows_full` (no `retry_after`; it clears
  only when rows expire or are deleted).

## 8. Delivery to readers

Couriers receive the namespace's quota view the same way they receive
`_access` and the directory (snapshot on connect, deltas after, each frame
with `hub_now`), and write the local mirror from it. A query form exists for
diagnostics (`fleet quota [--json]`, F3).

Reporter handling of each nack (principle 2, degrade and warn):

| Nack | Reporter does |
|------|---------------|
| `unsupported` | treat as hub=old: keep the mirror, keep running, warn |
| `quota_rate_limited` | wait `retry_after`, retry with the newest value only |
| `quota_rows_full` | stop adding new aliases, warn, keep pushing existing rows |
| `quota_publish_denied` | stop pushing; one probe frame per hour |
| `quota_clock_invalid` | never resend the same frame unchanged |
| `quota_invalid` / `quota_writer_mismatch` | drop that frame, warn (a bug, not a retry case) |

An old courier simply never subscribes.

## 9. Error names

`quota_invalid` (schema, range, pattern, a millisecond epoch),
`quota_writer_mismatch`, `quota_clock_invalid`, `quota_rate_limited`
(+ `retry_after` seconds), `quota_rows_full`, `quota_publish_denied`
(`_access`), `unsupported` (old hub).

## 10. Negative controls and tests for the fleet build

- A record with an extra string carrying a token-shaped value, or a
  provider/alias/host_role/refusal reason outside its pattern, is refused.
- An epoch field of `1.7e12` (milliseconds) is refused `quota_invalid`;
  `utilization` 1.01 is refused.
- A record naming another courier is refused; a courier cannot delete another
  courier's row.
- A row is gone from reads at `hub_received_at + 6 h` even if its windows have
  future `resets_at`.
- A re-push with `sent_at` = now and the original `observed_at` is accepted;
  its `observed_at_hub` stays old.
- A reporter with its clock 10 min ahead: stored, flagged `skewed`,
  `observed_at_hub` within network delay of the hub time.
- Two couriers write the same `(provider, alias)`: both rows are returned.
- The 4th write within 10 s for one key is nacked `quota_rate_limited` with
  `retry_after`; the 257th live row is nacked `quota_rows_full`.
- Snapshot and delta frames carry `hub_now`.
- Reporter-side (autopilot tests, listed here so both sides agree): each row of
  the section 8 nack table, including an old hub (`unsupported`) where the
  courier keeps running and warns.

## 11. Open questions for the plan review

- F1 (autopilot Q9): should `host_role` be an enum from hangar's host
  inventory (then the hub can check it) or a free bounded string? Open.
- F2: does any reader need cross-namespace quota at all, or can the read side
  be namespace-only for the first version?
- F3: is a fleet-side `fleet quota` CLI wanted in the first version, or only
  the courier mirror?
- Q20: answered in section 5 (`hub_now` on snapshot and delta frames).
