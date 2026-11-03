<!-- Review context copy (blind review); original at docs/plans/evidence/2026-11-03-g40-agent-lane-quota/fleet-hub-quota-store-905d13e.md -->
<!-- Source: repo fleet, sha 905d13e, path docs/plans/2026-11-04-g40-hub-quota-store.md (verbatim below) -->
# G40: hub side of the shared quota store (`fleet.quota/1`)

Status: design note, fleet position pending hetero plan review. It is reviewed
in the same round as autopilot's G40 plan (autopilot develop 591f5918c,
`project/plans/2026-11-03-g40-agent-lane-quota.md` sections 18 to 20). Nothing
here is built yet. The hub change ships with or after the F4 batch, never
during a release freeze.

## Scope

The hub stores per-account quota observations so that dispatch pick and the
displays on every host read one view. The record shape is autopilot's
`fleet.quota/1` (section 20.2): `(provider, alias)`, `windows[]`,
`host_role`, `token_issued_at`, `token_expires_at`. This note settles what
the hub does with it: key, writers, expiry, clock, conflicts, rate limits and
storage form. The reporter, the local mirror, the adapters and pick are
autopilot's, and this note does not change them.

Out of scope: semantic interpretation of windows (the reader's section 5.2
merge), the probe experiment (section 19), provider adapters.

## 1. Storage: a typed table, not kv

A typed protobuf message in `contracts/` (`QuotaRecord`, `QuotaWindow`, with
the window kind as an enum) and one hub table. Not the generic kv item.

- No free-form fields, so a token cannot travel in an extra key.
- Every string field is pattern-bounded (section 2), so a token-shaped value is
  refused `quota_invalid`. "Tokens never reach the hub" is then a property of
  the schema, not a convention.
- The hub validates units once: `utilization` in `[0, 1.5]`, `resets_at`
  integer epoch seconds or null, at most one window per kind, at most seven
  windows, `used`/`limit`/`unit` both-or-neither.
- One additive migration: a new table plus an index on
  `(namespace, provider, alias)`. Nothing existing is rewritten.

Generic kv stays a separate post-F4 item for untyped data.

## 2. Key

The hub key is `(namespace, provider, alias, writer_courier)`.

- `namespace` and `writer_courier` come from the authenticated courier
  connection, never from the record body. Aliases are operator-local names:
  two namespaces may both have `claude/main`.
- `provider`: `^[a-z0-9-]{1,24}$`. `alias`: autopilot's alias grammar.
  `host_role`: a short bounded pattern (or enum once the role list is fixed).
- The JSON form of the message is exactly autopilot's section 20.2 spelling
  (`utilization`, `resets_at`, `observed_at`). codeforge's `pct` stays in its
  own adapter; the hub never learns it (autopilot Q11).

## 3. Who writes and reads

- Writers: couriers only, with their own credential, and each courier only
  its own rows (fleet design principle 5). The wrapper and the statusline
  write the local mirror; the courier's reporter is the single hub writer. No
  plugin or wrapper carries a hub URL.
- A record whose body names a different courier or namespace is refused
  `quota_writer_mismatch`.
- Optional `_access` capability `quota_publish` per courier: allowed by
  default for the namespace's couriers, refused when `_access` denies it.
  `_access` is one of the three places fleet fails closed.
- Readers: any courier in the same namespace. Cross-namespace reads only with
  the same channel / `_access` consent rule as dispatch.
- Explicit delete of the courier's own rows (alias removed on that host).

## 4. Expiry

- Row expiry = `hub_received_at + 6 h`, a hard cap that a write cannot extend
  beyond 6 h from its own receipt. The hub clock decides, not `observed_at`.
- There is no heartbeat (autopilot section 18.2): an unchanged observation is
  not re-pushed, so a stable idle alias ages out exactly at 6 h. That is
  intended; an old observation must not look fresh.
- The hub sweeps expired rows and also filters them on every read.
- A window whose `resets_at` has passed stays in the row: the reader ignores
  it (section 5.2 rule 1); the other windows of the row may still be live.
- Re-push after hub expiry (autopilot section 22: invalid and placeholder
  rows, about once per alias per 6 h) is accepted as a normal write: the
  reporter sends `sent_at` = now and keeps the original `observed_at`. The
  row's hub expiry restarts from the new receipt, but its freshness does not:
  readers judge age only by `observed_at_hub`, never by row presence. No
  separate "re-push" field is needed; there is no lower bound on
  `observed_at` age in v1.

## 5. Clock skew between hosts

The reporter sends `observed_at` (per window) and `sent_at`, both epoch ms on
its own clock. The hub computes `skew = hub_now - sent_at` and stores
`observed_at_hub = observed_at + skew` beside the raw value. Readers compare
only hub-normalized times, so host clock offset cancels and only network
delay remains.

- `observed_at > sent_at + 5 s`: refused `quota_clock_invalid`.
- `|skew| > 5 min`: stored, flagged `skewed` in the view so displays can
  mark it (matches autopilot's 5 minute skew limit).

## 6. Two hosts report the same `(provider, alias)`

Per-host rows; no merge at the hub.

- Each writer courier owns its row, so concurrent writes never conflict and
  there is no last-writer race across hosts.
- The view returns every live row for `(provider, alias)` with
  `writer_courier`, `host_role`, `observed_at_hub` and `skewed`. The reader
  applies autopilot's per-window newest-wins merge (section 5.2). codeforge
  gets the host list it needs for `host_role` directly.
- A hub-side merge would drop that list and put pick policy in the hub, which
  by design knows only couriers and namespaces.

## 7. Rate and size limits

Above the reporter's own throttle (5 s debounce, 30 s per alias):

| Limit | Value |
|-------|-------|
| writes per writer courier and `(provider, alias)` | 1 per 10 s, burst 3 |
| writes per courier | 60 per minute |
| live rows per courier | 256 |
| windows per record | 7, one per kind |

Exceeding a limit is a visible nack `quota_rate_limited` with `retry_after`,
never a silent drop (principle 3). The reporter backs off and keeps its
newest value in the mirror.

## 8. Delivery to readers

Couriers receive the namespace's quota view the same way they receive
`_access` and the directory (snapshot on connect, deltas after), and write the
local mirror from it (autopilot section 18.4). A query form exists for
diagnostics (`fleet quota [--json]`).

Version tolerance (principle 2): an old hub without the table nacks the new
frames `unsupported`; the reporter logs `hub=absent`, keeps the mirror, and
warns. An old courier simply never subscribes.

## 9. Error names

`quota_invalid` (schema, range, pattern), `quota_writer_mismatch`,
`quota_clock_invalid`, `quota_rate_limited` (+ `retry_after`),
`quota_rows_full`, `quota_publish_denied` (`_access`), `unsupported`
(old hub).

## 10. Negative controls for the fleet build

- A record with an extra string carrying a token-shaped value, or a
  provider/alias/host_role outside its pattern, is refused.
- A record naming another courier is refused; a courier cannot delete another
  courier's row.
- A row is gone from reads at `hub_received_at + 6 h` even if its windows have
  future `resets_at`.
- A reporter with its clock 10 min ahead: stored, flagged `skewed`,
  `observed_at_hub` within network delay of the hub time.
- Two couriers write the same `(provider, alias)`: both rows are returned.
- The 4th write within 10 s for one key is nacked `quota_rate_limited`.
- An old hub: the new courier frame is nacked `unsupported`, and the courier
  keeps running and warns.

## 11. Open questions for the plan review

- F1: should `host_role` be an enum from hangar's host inventory (then the
  hub can check it) or a free bounded string?
- F2: does any reader need cross-namespace quota at all, or can the read side
  be namespace-only for the first version?
- F3: is a fleet-side `fleet quota` CLI wanted in the first version, or only
  the courier mirror?
