# Plan — BL-0194 qualification registry moves to llm-playground

> Status: frozen after G2 (depth-0 terminal adjudication); owner decision d-1f0c5e99: A2 + B1 + C1. Cross-repo, phases P1-P4b.
> Placement: autopilot `docs/plans/2026-10-16-bl0194-qualification-registry-move.md` (INDEX row `active`); llm-playground `doc/plan/<next after 075>-qualification-registry.md` plus a `doc/plan/README.md` row.

## 0. Thesis
autopilot writes `~/.autopilot/engine-scorecard/scorecard.jsonl`; llm-playground imports it (`import-autopilot-qualification.py`), publishes `model-dyno.qualification-feed.v1` (`build-qualification-feed.py`); autopilot may adopt it (`scripts/lib/qualification-feed.js`, `adopt-qualification-defaults.js`). One record lives in two stores, the feed has no speed or cost, the cached feed is stale (fetched 2026-09-03, 339 KB measured; live generated 2026-10-13). Three consults unanimously chose A2/B1/C1. Goal: llm-playground is the only registry of exam records. The authoritative store is, per workspace, `benchmarks/qualification/<ws>/<record>.json` (one file per record) and `benchmarks/qualification/<ws>/strikes.jsonl`; nothing else in either repo holds records of record. autopilot keeps a cache, local strikes and an outbox, so it stays offline-capable.

## 1. KRs
- KR1 one authoritative record store; after P4b autopilot writes no exam record anywhere but the outbox.
- KR2 feed carries pass rate, solved/hour and cost (null when unknown) per seat x role.
- KR3 no result or strike lost or duplicated under network, push or CI failure (fault tests).
- KR4 admission identical with the feed absent, stale or hostile.

## 2. Constraints (verbatim into every dispatch)
- ADR-0001: disclosure, not attestation. No signatures, hash chains, witness receipts; `digest` stays a cache key.
- Admission = locally re-derived seat identity + LOCAL strike records + LOCAL evidence. Local evidence = results this install administered itself, including ones still unacked in the outbox, usable for admission immediately, also after P4b. A row that arrived from the feed is never local evidence. The feed, cache and metrics never admit, deny, lift or un-admit a seat (C1: metrics order already-admitted comparable seats only).
- Fetch and adopt stay separate commands; nothing auto-adopts. An adopted row is an ordinary local scorecard row and is NOT local evidence for a feed claim: it counts only because adopt wrote it under the existing adopt contract.
- Unknown is null, never 0. Wire numbers are integers: enforced by `type: integer` in the shared schema (current `validate-json-schema.js` accepts a lossless non-integer literal unless the schema says integer).
- Every new check ships a negative control, red before green.
- No dual-read shims (owner rule). Compatibility = v2 is a superset of v1.

## 3. Shared spec (single source)
`schemas/qualification-feed-v2.schema.json` in llm-playground is the only spec. autopilot vendors a byte-identical copy at `schemas/qualification-feed-v2.schema.json` (parity test fails on any diff). Validators: llm-playground `scripts/eval/check_qualification_feed.py` (stdlib; supports type/required/enum/pattern/additionalProperties/minimum/oneOf, tested in `scripts/eval/test_qualification_feed.py`); autopilot `validate-json-schema.js`. Both run the same fixture set in `benchmarks/qualification/fixtures/` (copied into autopilot `hooks/tests/fixtures/`).

### 3.1 Feed document (v2 is a superset of v1)
Discriminator: string `schema` = `model-dyno.qualification-feed.v2` (v1 name pattern kept; the only version key; `schema_version` is not used). All v1 top-level keys, including v1 `strikes[]` with its entry shape, stay byte-unchanged. New top-level: `generated_at` (UTC `...Z`), `producer` (string), `source_revision` (git sha), `seat_metrics[]`, `strike_events[]`. Compatibility test: the current `parseFeed` reads a v2 fixture, results for v1 fields byte-identical.

### 3.2 `seat_metrics[]` entry (additionalProperties false; `kind` discriminates)
- `entry_id` string, sha256 hex of canonical JSON (sorted keys, no whitespace) of [`seat`, `kind`, `instrument_id`, `window_end`]; `window_end` (UTC `...Z`) is a required top-level field of every entry.
- `seat` {engine, model, model_version, runner, role, effort}: strings. No seat hash is published (consumers recompute).
- `kind`: `qualification` or `benchmark_observation`. Required block per kind: qualification => `qualification` only; benchmark_observation => `benchmark` + `speed` + `cost` + `sampling`. Any other block present is invalid (fixture mixing blocks must fail).
- `instrument_id`, `instrument_version`: strings.
- `qualification` {status: qualified|failed|provisional, corpus_version, prompt_config_hash, administered_at, record_id, record_id_basis, supersedes: record_id or null}; `expires` advisory.
- `benchmark` {n_tasks (per trial), n_trials (repeated runs of the task set), n_attempts (every execution incl. retries, >= n_tasks*n_trials), n_pass and n_timeout (attempts), pass_rate_permille = round-half-up(1000*n_pass/n_attempts), ci_method `wilson`, ci_level_permille 950, ci_low_permille, ci_high_permille}. Every ratio is null when its denominator is 0.
- `speed` {solved_per_hour_milli = round-half-up(n_pass x 3.6e6 / wall_s_total), wall_s_total = summed wall seconds of ALL attempts; tasks_per_hour_milli = same with completed attempts; median_wall_ms (per task, integer ms); concurrency; speed_basis = `window_start..window_end` text}. Zero denominator => null.
- `cost` {usd_per_solved_micro, usd_per_task_micro, cost_total_micro, cost_coverage_permille (attempts with known cost), cost_basis billed|estimated|subscription|unknown, pricing_version}. Unknown => null with coverage 0; subscription => null; null sorts last.
- `sampling` {window_start, low_n (n_trials < 5)}. Units: `_permille` 1/1000, `_milli` 1/1000 unit, `_micro` 1e-6 USD, `_ms` ms; every derived integer rounds half-up.
- `join` {board_cell, board_join mapped|unmapped, identity_map_version}: unmapped rows are shown, never ranked. No map hash is published.
- `origin_host_class` only (`local-gpu`|`cloud-api`). `evidence_ref`: relative path inside the registry repo, never a URL.
Example (benchmark_observation, one entry) is `fixtures/seat-metrics-benchmark.valid.json`, written in P1 before the producer code.

### 3.3 `strikes[]`
`strike_events[]` entry (v1 `strikes[]` untouched) {strike_id, strike_seq (integer, assigned by the registry at commit, monotonic per seat; the sender never supplies it), seat, effort or null, reason, lifted_by: strike_id string or null}. Disclosure only: for autopilot it is report and cross-host reference data. Refresh never writes, overwrites or lifts any local strike (acked or not); `lifted_by` is informational. Registry-side strikes reach local state only through the explicit adopt command with local-evidence-wins.

### 3.4 Keys
- `record_id` = sha256 of canonical JSON of [`producer`, `transcript_hash`, `seat` (6 fields), `corpus_version`, `administered_at`]; `record_id_basis` = `v1:` + that field list. `engine-qualify`, the importer and the ingest share one implementation per language and a cross-language parity fixture; the importer must produce the same id for the same administration (P1 test).
- `strike_id` = sha256 of canonical JSON of [`seat`, `effort`, `reason`, `administered_at` of the failing record, that `record_id`].
- Same id with different payload bytes = conflict: rejected loudly, never merged.

## 4. Write path (autopilot -> registry)
Outbox `~/.autopilot/qualification-outbox/outbox.jsonl`, append-only event log; every append is ONE `write` of one line < PIPE_BUF (4096 B) under `flock` (a larger payload goes to a temp file renamed into `outbox.d/<id>.json`, the line carries its sha256); each line `{event: enqueued|sent|acked|retired, id, kind: record|strike, payload_sha256, ts, line_crc}`; a record's payload is stored in its `enqueued` line.
1. `engine-qualify` writes exactly ONE `enqueued` entry, only when the administration completes (a mid-run crash writes nothing, never a partial record), fsynced BEFORE reporting done; after a crash the next `flush` quarantines a torn tail and resends every un-acked id; the local evidence store stays as offline proof.
2. `qualification-send-queue.js flush` takes a lock, quarantines a torn or crc-bad tail line to `outbox.jsonl.corrupt` with a loud warning (other lines untouched), then sends each un-acked id via the ingest (`ingest-qualification-record.py`; transport = git push to a bot branch or the `gh` API, decided and recorded in P1).
3. Ingest is idempotent on id (duplicate = no-op ack). The ack is the registry's commit on its DEFAULT branch carrying the id (not feed presence); the ack (id + commit sha) is appended as `acked`.
4. A permanently rejected id (conflict, schema failure) gets a `rejected` event, shown in `status`, never resent blindly. `retired` is appended only after `acked`; compaction rewrites the file atomically dropping fully retired ids. Failure leaves the id pending with backoff; `flush` is re-runnable; entries older than 24 h are shown by `engine-scorecard.js status`.
5. Strikes use the same path; a feed refresh never alters an unacked or acked local strike.
Test hooks: injectable transport function plus `AUTOPILOT_OUTBOX_FAILPOINT=<after-enqueue|after-send|before-ack|after-ack>`.

## 5. Read side
- Cache `~/.autopilot/qualification-feeds/` (content-addressed); `current.json` already has `fetched_at`; add `generated_at` (producer age). `list --json`, `engine-scorecard.js status` and adopt provenance report `fetch_age_s` and `producer_age_s`; missing or future timestamps are labelled `unknown`/`clock-skew`. Past `qualification_feed.max_age_s` (7 d) either age => warn, still serve; past 90 d label `expired-advisory`, still serve. Never blocks.
- Offline: admission = local identity + local strikes + last adopted snapshot; no metrics => today's ordering. Offline never denies an admitted seat.
- B1 (scheduled in P4a): `references/official-qualification-defaults.json` is regenerated by `build-qualification-defaults.js --from-snapshot <feed>`, recording snapshot digest and `generated_at` in `official-qualification-defaults.recipe.json`; `--check` stays byte-identical. Explicit command, committed. `preflight-release.sh` FAILS when the snapshot is older than 30 days (a build-time gate, outside the runtime advisory rule).
- Disclosure gate scope and mode whitelists: section 7 and P4b.

## 6. Phases
Dependencies: P2 after P1 metrics file; P3 after P1 ingest and transport; P4a after P2; P4b after P3 plus a reconcile report with zero pending outbox ids and zero store diffs on the owner's installs.
| # | Deliverable | Acceptance | Negative control |
|---|---|---|---|
| P1 registry receives (llm-playground, M) | schema file, validator, fixtures, ingest, `kind` partition, metrics in sibling `qualification-metrics.json` (`schema` v2), generated by `build-qualification-feed.py --emit-metrics` in the same publish workflow run as the v1 feed, uploaded beside it; P2 reads this file; v1 feed unchanged; CI: schema + 4 MB cap + leak gate; re-measure live v1 bytes and set the cap from it | ingest twice = one record; importer and ingest give equal `record_id` | fractional permille; cost 0 for unknown; duplicate strike_seq; mixed-kind entry; id collision with different payload; oversize file: each fails CI |
| P2 autopilot reads (S-M) | parse v2, vendored schema + parity, ages, ordering by metrics among admitted seats | 8-day cache warns, serves; feed unreachable => admission byte-identical; repeated fetch of an old document still reports old `producer_age_s` | feed lifting a strike or omitting one leaves local strikes and admission identical; feed claiming `qualified` with no local row admits nothing; removing the warn branch turns the status assertion red |
| P3 autopilot sends (M) | outbox, flush, `engine-qualify` enqueue, status | kill at each failpoint then resume: zero lost, zero duplicate | dropped ack: not retired, not duplicated; torn tail line quarantined, rest sent; unmerged-branch push is not acked; no idempotency key => duplicate detected red |
| P4a publish v2 + B1 (S-M) | `build-qualification-feed.py` publishes v2 as the feed, gate on; `build-qualification-defaults.js --from-snapshot` | v1 reader fixture green; revert = republish v1; `--check` byte-identical from a snapshot; snapshot digest + `generated_at` in recipe | v1-reader test red if a v1 field changes; `--from-snapshot` with a tampered snapshot digest fails `--check` |
| P4b switch (M, only breaking step) | two switches: autopilot config key `qualification_registry` = `legacy` (default) | `registry`, and llm-playground `import-autopilot-qualification.py --mode backfill|disabled` (default backfill); both write during reconcile; flip each only when the reconcile report is clean. After the flip autopilot writes only cache, strikes and outbox; adopt writes cache only, never scorecard | rollback = set the key back to `legacy` (old writers resume), no data migration; CHANGELOG + migration note; owner alpha test | static test lists every `scorecard.jsonl` writer in autopilot, one whitelist per mode (legacy: current writers; registry: none, only cache/strike/outbox writers); a new writer fails the matching whitelist; importer run with `--mode disabled` exits non-zero; adopt in registry mode touching the scorecard fails |

## 7. Disclosure gate
CI scans the NEW fields (`seat_metrics`, `strike_events`, metrics file) plus an explicit allowlist: v1 `feed.evidence_url` is allowed only as `https://` on the public dashboard origin, nothing else with a scheme. Blocked in scanned fields: RFC1918 and public IPs, URLs, `.local`/`.internal`/`.lan` hosts, `/home/`, `/srv/`, `Bearer`/`sk-`/token-like strings, bot branch names, and for keys `signature`, `hmac`, `prev_hash`, `witness`, `attestation`, `merkle`. Each class (hostname, IP, URL outside allowlist, home path, endpoint pattern, token string, trust key) has its own committed fixture that must fail red before green; a v1 `evidence_url` fixture must pass.

## 8. Risks
Write path loss (outbox until acked, reconcile before removal); infrastructure leak (section 7); metrics read as proof (kind partition, null cost, C1); strike divergence (registry assigns seq, local never overwritten); second silent writer (P4b whitelist test); stale cache (ages, 30 d gate).

## 9. Out of scope / open
Metrics as gate, exam content, auto-refresh timers, signatures, seat renames, dashboard UI. Open: ingest transport (decided in P1); TTL 7 d, expiry label 90 d, snapshot 30 d are owner-tunable.

## Review log
R0 draft; G1 and G2 folded; frozen after G2 by depth-0 terminal adjudication (generation cap), no third generation; consults gpt-6.1-sol / GLM-5.3 / Qwen3.8-Max. G1 (bytes in `plan-review/plan.as-reviewed-g1.md`): CONDITIONAL, 12 blockers all accepted and folded.
