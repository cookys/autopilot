# Build task: `scripts/engine-scorecard.js`

You are implementing ONE new file in the `autopilot` Claude Code plugin. Build it exactly to
this contract. This is a deterministic data engine — correctness of the state semantics is
the whole point.

## GOAL
Create `scripts/engine-scorecard.js`: the append-only JSONL **scorecard store** + query
engine that records per-`(engine, runner, role)` qualification results and answers
"what is currently qualified, ranked, and what is the fallback ladder."

## SCOPE (touch ONLY these)
- CREATE `scripts/engine-scorecard.js`
- CREATE `hooks/tests/engine-scorecard.test.sh` (a self-contained bash test, `set -euo pipefail`,
  using a temp `ENGINE_SCORECARD_DIR`, asserting every behavior below; print `PASS`/`FAIL`
  per assertion and exit non-zero on any failure). The repo's `hooks/tests/run.sh`
  auto-discovers `*.test.sh`.
- Do NOT modify any other file.

## RUNTIME CONSTRAINTS
- **Node.js, built-in modules ONLY** (`fs`, `path`, `os`, `process`, `child_process` for
  `flock` if needed). No npm deps. Node ≥ 20.10. (Rationale: must run in a dependency-minimal
  sandbox.)
- Store path: `${ENGINE_SCORECARD_DIR:-~/.autopilot/engine-scorecard}/scorecard.jsonl`,
  append-only JSONL (one JSON object per line). Create the dir if missing.
- **All writes are flock-guarded** (advisory lock on a `.lock` file via `fs`/`flock`;
  concurrent ephemeral writers must not corrupt or interleave a line). A simple, correct
  approach: open the lockfile, acquire an exclusive lock (e.g. via `fs.openSync` + an
  `flock(1)` child, or an atomic `O_CREAT|O_EXCL` spin with backoff). Document the choice.
- `--help` on any invocation prints usage. Unknown subcommand → exit 2.

## ROW SCHEMA (one JSONL line per qualification run)
```jsonc
{
  "event_id": 1719724800001,   // MONOTONIC integer, assigned by `record` (NOT caller-supplied):
                               //   use max(existing event_id)+1, or a stored counter. This is
                               //   the authoritative latest-wins key.
  "engine": "minimax-m3",
  "runner": "cc-shim",
  "family": "minimax",
  "role": "reviewer",          // reviewer | implementer | planner
  "model_version": "M3-2026-06",
  "version_source": "manual",  // runtime | manual
  "corpus_version": "known-bad@v3",
  "harness_version": "engine-qualify@2.27.0",
  "runner_version": "agy 1.0.12",
  "prompt_config_hash": "sha256:...", // opaque string; part of CONFIGURED identity
  "date": "2026-06-30",        // human-readable only; NEVER the latest-wins key (use event_id)
  "quality": { "corpus_pass": "10/10", "false_pass_critical": 0, "specificity": "3/3 clean SHIP" },
  "capability_score": 0.92,    // continuous [0,1]; ORDER among qualified engines
  "cost": { "source": "manual", "usd_per_mtok_input": 0.0, "usd_per_mtok_output": 0.0, "sample_tokens": 0 },
  "latency": { "sample_wall_time_s": 0 },
  "status": "qualified",       // qualified | failed | expired
  "qualified_at": "2026-06-30",
  "expires": "2026-09-30"      // ISO date; TTL boundary
}
```
- **CONFIGURED IDENTITY** = the tuple `(engine, runner, role, corpus_version,
  harness_version, runner_version, prompt_config_hash)`. **`model_version` is NOT part of it.**

## SUBCOMMANDS

### `record` — append a row
- Reads ONE JSON object from `--file <path>` or stdin.
- **Assigns `event_id`** itself (monotonic, ignore any caller-supplied value).
- Validates required fields present + enums (`role`, `version_source`, `status`,
  `cost.source` ∈ {measured,manual,unknown}); on invalid → stderr message, exit 1, write nothing.
- Appends one line under flock. Exit 0. Echo the stored row (with assigned `event_id`) as JSON.

### `current --role <role>` — effective status view
- For each distinct CONFIGURED IDENTITY present in the store for that role, the **effective
  row = the one with the highest `event_id`** (latest-event-wins). Older rows are superseded.
- Apply **TTL expiry at read time**: if an effective row's `status == "qualified"` but its
  `expires` date is in the past **relative to a caller-supplied `--now <ISO-date>`** (so the
  function is deterministic/testable; default to today only if `--now` omitted), report its
  effective status as `expired` (do not mutate the store — derive it).
- Output JSON: array of `{engine, runner, role, configured_identity_fields..., status,
  capability_score, family, cost, model_version, event_id}`, one per configured identity.
- Exit 0.

### `report --role <role> [--key capability|cost]` — ranked qualified engines
- From the `current` view, take only **effective status `qualified`** rows.
- `--key capability` (default): sort by `capability_score` DESC.
- `--key cost`: sort ASC by `usd_per_mtok_input + usd_per_mtok_output`, but **rows with
  `cost.source == "unknown"` sort LAST (worst-cost), never first** (an unmeasured engine is
  never "free"). Ties broken by `capability_score` DESC.
- Output JSON array, ranked. Exit 0.

### `ladder --role <role> [--implementer-family <fam>]` — fallback ladder
- Start from the `report --key capability` ranking (qualified only) as `(engine, runner)` pairs.
- **Decorrelation soft penalty (NOT exclusion):** if `--implementer-family` is given, any
  entry whose `family == <fam>` is **demoted to the bottom** of the ladder (kept, never
  removed — a same-family reviewer must still appear if it is the only option). If
  `--implementer-family` is omitted/unknown, no penalty (rank by capability alone).
- Output JSON array of `{engine, runner, family, capability_score, same_family: bool}` in
  ladder order. Exit 0.

## ACCEPTANCE (the test file MUST assert all of these)
1. `record` assigns a monotonic `event_id` even if the input omits/forges one; two records → event_ids strictly increasing.
2. Two `qualified` rows for the SAME configured identity → `current` returns ONE row (the higher event_id); a later `failed` row supersedes an earlier `qualified` for that identity.
3. Two rows differing ONLY in `model_version` are the SAME configured identity (model_version is not in the identity) → latest event_id wins.
4. Two rows differing in `runner` (or `corpus_version`) are DIFFERENT identities → both appear in `current`.
5. A `qualified` row past its `expires` (vs a supplied `--now`) shows as `expired` in `current`, WITHOUT mutating the stored line.
6. `report --key cost` puts a `cost.source:"unknown"` engine LAST even if its nominal unit price is 0.
7. `report --key capability` orders by `capability_score` DESC.
8. `ladder --implementer-family X` demotes family-X entries to the bottom but still includes them; without the flag, pure capability order.
9. Invalid `record` input (missing required field / bad enum) → exit 1, store unchanged.
10. Concurrent `record` (spawn 5 in parallel in the test) → all 5 lines present, none corrupted/interleaved (flock works).
11. `--help` and unknown-subcommand (exit 2) behave.

## BOUNDARIES
- No network. No npm deps. No mutation of stored lines (expiry is derived at read time).
- Deterministic: never call `Date.now()`/`Math.random()` in a way that breaks tests — accept
  `--now` for time-dependent logic; assign `event_id` from the store's max, not a clock.
- Fail-closed: malformed store line → skip it with a stderr warning, do not crash the query.
- Keep it a single self-contained file; clear `--help`; stable JSON schemas; documented exit codes (0 ok / 1 validation / 2 usage).
