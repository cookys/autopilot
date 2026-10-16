# Plan — BL-0194 qualification registry moves to llm-playground

> Status: draft (owner decision d-1f0c5e99: A2 + B1 + C1). Owner: cookys. Frame: cross-repo, 4 phases.
> Repo docs placement: autopilot copy at `docs/plans/2026-10-16-bl0194-qualification-registry-move.md` (register in `docs/projects/INDEX.md`, Version `active`); llm-playground copy at `doc/plan/<next number after 075>-qualification-registry.md` plus one row in `doc/plan/README.md` (its plans are numbered files there, indexed by that README, filterable by `scripts/plan_filter.py`).

## 0. Context / thesis
Today autopilot writes `~/.autopilot/engine-scorecard/scorecard.jsonl`; llm-playground imports it into `benchmarks/qualification/<ws>/` (plan 064, `import-autopilot-qualification.py`), publishes `model-dyno.qualification-feed.v1` (plan 065, `build-qualification-feed.py`), and autopilot may adopt it (`scripts/lib/qualification-feed.js`, `adopt-qualification-defaults.js`). The same record lives in two stores, the feed has no speed or cost, and autopilot's cache is stale (fetched 2026-09-03; live feed generated 2026-10-13). Three heterogeneous consults (gpt-6.1-sol, GLM-5.3, Qwen3.8-Max) unanimously chose A2/B1/C1.

## 1. Problem
One registry, one writer. llm-playground becomes the sole registry; autopilot keeps only a cache, strikes, and a send queue so it stays offline-capable (standalone plugin).

## 2. OKR / KRs
- KR1: exactly one authoritative store for exam records (llm-playground); autopilot holds no second authoritative copy after P4.
- KR2: feed carries pass rate, solved/hour, cost (null when unknown) per seat x role.
- KR3: no exam result lost when publish or network fails (queue + idempotent resend, proven by a fault test).
- KR4: admission behaviour unchanged when the feed is unreachable.

## 2.5 Global Constraints (verbatim into every dispatch)
- ADR-0001: the feed is disclosure, not attestation. No signatures, hash chains, witness receipts. `digest` stays a cache key.
- Admission = locally re-derived identity + local strike state. Metrics (speed, cost) never admit a seat (C1: ordering and reports only, among already-admitted, comparable seats).
- Fetch and adopt stay separate; no timer auto-adopts.
- Unknown is null, never 0. Numbers on the wire are integers (validate-json-schema.js rejects non-integer JSON numbers).
- New or changed checks ship with a negative control shown red before green.

## 2.6 Change-policy decisions
- Compatibility impact: additive in feed (new top-level `seat_metrics[]`, `schema` bumped to `model-dyno.qualification-feed.v2`); v1 consumers must be tested, not assumed, to tolerate it. Because autopilot does not keep dual-read shims, the v2 producer publishes v2 only after the autopilot reader (P2) ships; until then P1 publishes v1 plus a sibling file `qualification-metrics.json`.
- Dependency decision: none new (Python stdlib / Node built-ins).

## 3. File-structure map
llm-playground (about 9 files):
- `scripts/eval/build-qualification-feed.py` (emit v2, seat_metrics, strike_seq)
- `scripts/eval/qualification.py` (record kinds: qualification vs benchmark_observation)
- `scripts/eval/import-autopilot-qualification.py` (kept for backfill only; P4 marks deprecated)
- `scripts/eval/ingest-qualification-record.py` (NEW: accepts a record, idempotent on record_id)
- `scripts/eval/competitiveness.py` (export numerators/denominators for metrics)
- `scripts/eval/qualification-identity.toml` (version + hash exposed in feed)
- `.github/workflows/publish-public-dashboard.yml` (publish + schema validation + size check)
- `benchmarks/qualification/README.md`, `doc/plan/<n>-qualification-registry.md` + `doc/plan/README.md` row
- tests under `scripts/eval/` fixtures (queue replay, schema, null-cost, size)
autopilot (about 10 files):
- `scripts/lib/qualification-feed.js` (v2 parse, TTL, staleness)
- `scripts/lib/qualification-send-queue.js` (NEW: outbox)
- `scripts/engine-qualify.sh` / `engine-qualify.js` (enqueue after exam)
- `scripts/adopt-qualification-defaults.js`, `scripts/build-qualification-defaults.js` (snapshot from feed)
- `scripts/engine-scorecard.js` (local cache/strike store, no longer authoritative for records)
- `scripts/resolve-review-loop.sh` (read metrics for ordering only)
- `references/official-qualification-defaults.json` (becomes a feed snapshot)
- `scripts/config-keys.json`, `docs/scripts-inventory.md`, CLAUDE.md name list, `hooks/tests/*`

## 4. Phases
### New feed schema (v2 `seat_metrics[]`, one entry per seat x role x instrument)
| Field | Type | Rule |
|---|---|---|
| `entry_id` | string | sha256 of (seat identity, instrument_id, window_end); idempotency key |
| `seat` {engine, model, model_version, runner, role, effort} | strings | `seat_hash` is NOT published as trusted; consumer recomputes. If emitted it is `informational_seat_hash`, or dropped (decision: drop; Qwen's point accepted) |
| `kind` | `qualification` or `benchmark` | partition: never mixed in one object |
| `instrument_id`, `instrument_version` | string | autopilot trap family vs dyno 34-task canonical; scoring rules version |
| qualification block | `status` (qualified/failed/provisional), `corpus_version`, `prompt_config_hash`, `administered_at`, `record_id`, `record_id_basis`, `evidence_id`, `evidence_url`, `supersedes` | `expires` advisory only |
| benchmark block | `n_tasks` (independent tasks), `n_attempts` (incl. retries), `n_pass`, `n_timeout`, `pass_rate_permille`, `ci_method`="wilson", `ci_level_permille`=950, `ci_low_permille`, `ci_high_permille` | permille rounding: round-half-up, written in the spec |
| speed | `solved_per_hour_milli` = passed tasks / (summed wall seconds of ALL attempts incl. failures and retries) x 3600 x 1000; `tasks_per_hour_milli` = completed tasks over same denominator; `median_wall_s` = per task; `concurrency` | denominator window = `window_start..window_end`, stated in `speed_basis` |
| cost | `usd_per_solved_micro`, `usd_per_task_micro`, `cost_total_micro`, `cost_coverage_permille` (share of attempts with known cost), `cost_basis` (billed/estimated/subscription/unknown), `pricing_version` | unknown => null, cost_coverage 0; subscription => null unless amortisation rule named; sorting treats null as last |
| sampling | `n_trials`, `window_start`, `window_end` (UTC ISO-8601 Z), `low_n` boolean (n_trials < 5 => provisional, still published) | |
| join | `board_cell`, `board_join` (mapped/unmapped), `identity_map_version`, `identity_map_sha256` | unmapped rows listed, behaviour: shown, never ranked |
| strikes | top-level `strikes[]` each with `strike_seq` (monotonic per seat), `strike_id` (idempotency key), `seat`, `effort` tier or null, `reason`, `lifted_by` | top-level is authoritative; per-seat strike count is derived and labelled so |
| host | `origin_host_class` only (e.g. "local-gpu", "cloud-api"); raw hostnames and runner paths never published | GLM risk |
Top-level: `schema_version` 2, `generated_at`, `producer`, `source_revision`, `staleness_max_age_s` hint.
Size estimate: current v1 feed is 394 KB (29 defaults, 120 priors). A seat_metrics entry is about 0.8 KB; 300 entries is 240 KB, so v2 is well under 1 MB against the 8 MB reader cap (about 8x headroom at 3x growth). CI fails the publish at 4 MB (half the cap).

### Write path (autopilot to llm-playground)
1. `engine-qualify` finishes an administration and appends the full record to the local outbox `~/.autopilot/qualification-outbox/pending.jsonl` (append-only, fsync) and to the existing local evidence store (kept as the offline proof).
2. `scripts/lib/qualification-send-queue.js flush` posts each pending record to llm-playground's ingest (a PR/commit of `benchmarks/qualification/<ws>/<record>.json` via `ingest-qualification-record.py`; transport = git push to a bot branch or the `gh` API; final choice recorded in P1).
3. Ingest is idempotent on `record_id`; a duplicate is a no-op ack. The ack (record_id plus commit sha) is written back to the outbox as `acked`; an entry is deleted only after the ack is observed in the published feed or in the registry repo.
4. Failure (network, push rejected, CI red): entry stays pending, exponential backoff, `flush` re-runnable by hand; a stuck entry older than 24 h is surfaced by `engine-scorecard.js` status. Nothing is deleted on failure.
5. Strikes use the same path with `strike_id` as the key; a feed refresh never overwrites a local strike not yet acked.

### Autopilot read side
- Cache: `~/.autopilot/qualification-feeds/` keeps content-addressed copies; `current.json` gains `fetched_at`, `max_age_s` (default 7 d, config key `qualification_feed.max_age_s`). Past TTL: warn on use, still serve cached (advisory, never block).
- Fetch and adoption are separate commands; no auto-adopt.
- Offline: admission uses local identity + local strikes + last adopted snapshot; metrics absent => ordering falls back to current behaviour. Offline never denies a previously admitted seat.
- B1: `references/official-qualification-defaults.json` is generated from a pinned feed snapshot (records source digest, feed `generated_at`, adopted_at); regenerated only by an explicit command and committed; the release gate warns when the snapshot is older than N days (N=30). The old `feed -> defaults -> importer -> feed` loop is cut: the importer never reads built-in defaults once P4 lands.

### Phases
| # | Size | Deliverable | Acceptance | Negative control |
|---|---|---|---|---|
| P1 llm-playground receives | M | ingest script, `kind` partition, seat_metrics + strike_seq in feed (published as sibling `qualification-metrics.json` while v1 feed stays), size/schema CI check | ingest twice = one record; metrics file validates; unknown cost is null | feed with cost 0 for unknown, or oversized (>4 MB), or duplicate strike_seq must fail CI |
| P2 autopilot reads v2 | S-M | reader parses v2/metrics, TTL + staleness warning, ordering uses metrics only among admitted seats | cached feed 8 days old warns but serves; feed unreachable leaves admission byte-identical | a feed claiming `qualified` with no local evidence must NOT admit a seat; metric-only seat stays unadmitted |
| P3 autopilot sends | M | outbox + flush, engine-qualify enqueues, status surfaces stuck entries | kill network mid-flush then resume: zero lost, zero duplicates | drop the ack and rerun flush: record must not be deleted nor duplicated; remove idempotency key: duplicate must be detected red |
| P4 switch + dedupe | M | v2 becomes the published schema; llm-playground is sole writer; autopilot scorecard.jsonl is cache+strikes only; B1 snapshot generation + staleness gate; importer deprecated; duplicate store removed | one store of record (grep proof both repos); built-in defaults regenerate byte-identical from the snapshot | stale snapshot (>30 d) fails release gate; re-enabling the importer to read defaults is blocked by a loop-detection test |
Each phase merges independently (P1 and P2 are additive; P3 is dark until the ingest exists; P4 is the only breaking step and ships behind the owner's alpha test, per no-compat-shims rule).

## 5. Test / validation
Script-gated: schema validation (validate-json-schema.js), fault-injection replay, size check, byte-identical regeneration. Human-gated: owner confirms the P4 cutover on an alpha build.

## 6. Risks + inversion
- Biggest: the new write path. If push/ingest is unreliable, results are lost or the two stores diverge during P3-P4. Mitigation: outbox keeps raw until acked, dual-write window with reconcile report before removing the old store.
- Public bundle leaks infrastructure (GLM): publish only `origin_host_class`; strip hostnames, paths, endpoint names; CI grep gate for hostnames/IPs.
- `seat_hash` redundant (Qwen): dropped from the feed; consumers recompute.
- Metrics read as capability proof: instrument/kind partition, null cost, C1-only use.
- Feed outage: cached snapshot + local strikes; offline never denies.
- Calendar rot (6-week stale cache today): TTL warning plus release-gate snapshot age.
- Strike divergence: strike_id/seq; local unacked strike never overwritten.
- Inversion: what guarantees failure is a second silent writer. P4 removes it and a test greps for it.

## 7. Out of scope
Metrics as gate (C2/C3), changing exam content, auto-refresh timers, signatures, renaming seats, dashboard UI.

## 8. Open questions
Transport for ingest (git bot branch vs gh API) is decided in P1; snapshot age N=30 d and TTL 7 d are defaults the owner may tune.

## Review log
R0: author draft; consults gpt-6.1-sol / GLM-5.3 / Qwen3.8-Max in `scratchpad/bl0194/raw-*.txt`; not yet plan-reviewed.
