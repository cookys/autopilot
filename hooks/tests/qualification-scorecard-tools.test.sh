#!/usr/bin/env bash
# Qualification scorecard tool assertions (row-owned cases).
# Later rows APPEND a new assert_rNN_* function and one call below the last one.
. "$(dirname "$0")/lib.sh"

CLI="$REPO_ROOT/scripts/engine-scorecard.js"
FIXTURE_JS="$REPO_ROOT/hooks/tests/lib/consult-discuss-genuine-row-fixture.js"
SCOPE_HELPER="$REPO_ROOT/scripts/lib/qualification-applicability-scope.js"

assert_r49_scorecard_runner_tok() {
  # Plant one qualifying consult row recorded as runner "codex-cli", then query
  # current --role consult and seat-status --runner codex (incl. --require-evidence).
  rm -f "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$ENGINE_SCORECARD_DIR/.lock"
  rm -f "$ENGINE_CAPABILITY_DIR/qualification-evidence.jsonl"
  touch "$ENGINE_CAPABILITY_DIR/qualification-evidence.jsonl"

  local qual_row scope current_out seat_out seat_strict
  qual_row="$(node "$FIXTURE_JS" consult --engine gpt-5.6-sol --runner codex-cli)" \
    || fail "r49: genuine-row fixture failed"
  printf '%s\n' "$qual_row" | node "$CLI" record >/dev/null \
    || fail "r49: scorecard record failed"

  scope="$(mktemp "$TEST_TMP/r49-scope.XXXXXX.json")"
  node "$SCOPE_HELPER" write-scope --role consult --out "$scope" >/dev/null \
    || fail "r49: write-scope failed"

  current_out="$(node "$CLI" current --role consult --now 2026-09-21)"
  assert_contains "$current_out" '"runner":"codex-cli"' \
    "r49: current --role consult still surfaces the stored runner token (no rewrite)"

  seat_out="$(node "$CLI" seat-status --engine gpt-5.6-sol --runner codex --role consult --effort high --now 2026-09-21)"
  seat_strict="$(node "$CLI" seat-status --engine gpt-5.6-sol --runner codex --role consult --effort high --now 2026-09-21 --require-evidence --scope-file "$scope")"

  # RED at a0107ead5b90e9dd56b946c453f9e78ed2cce849: {"admission_status":"no_record","expiry_warning":false,"strikes_since_pass":0,"critical_trigger":false,"would_requalify":false,"strike_threshold":3,"strike_policy_version":2,"rejected_strikes":0,"effort":"high","seat_hash":"8e04712d63f6b90597da4a2e0c93e9c33f3ae60aa39655e7456d93f2de796b2a","baseline_event_id":null,"baseline_qualified_at":null}
  assert_contains "$seat_out" '"admission_status":"qualified"' \
    "r49: seat-status --runner codex resolves a stored codex-cli baseline"
  assert_contains "$seat_strict" '"admission_status":"qualified"' \
    "r49: seat-status --require-evidence --runner codex resolves a stored codex-cli baseline"
  assert_neq "null" "$(printf '%s' "$seat_out" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(d.baseline_event_id))')" \
    "r49: non-strict seat-status found a baseline_event_id"
  assert_neq "null" "$(printf '%s' "$seat_strict" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(d.baseline_event_id))')" \
    "r49: strict seat-status found a baseline_event_id"
}

assert_r49_scorecard_runner_tok

assert_r51_adopt_qualification() {
  # Legacy feed rows omit official_event_id / evidence_bundle (and may omit
  # evidence_pointers entirely). list --from must not interpolate those as
  # "event undefined — null".
  local cache fixture list_out
  cache="$TEST_TMP/r51-feed-cache"
  mkdir -p "$cache"
  fixture="$TEST_TMP/r51-legacy-feed.json"
  node -e '
const fs = require("fs");
const doc = {
  schema: "model-dyno.qualification-feed.v1",
  artifact_type: "official-qualification-defaults",
  digest: "deadbeef",
  defaults: [{
    default_id: "feed:legacy:implementer:glm:cc-shim",
    role: "implementer",
    status: "qualified",
    capability_score: 1,
    seat: { engine: "GLM-5.3", runner: "cc-shim", role: "implementer", effort: "high" },
    administration: {
      engine: "GLM-5.3",
      runner: "cc-shim",
      family: "zhipu",
      date: "2026-08-21",
      effort: "high",
      version_source: "operator-asserted",
      runner_version: "2.1.239-Claude-Code",
      harness_version: "dispatch-hetero:003d7975",
      corpus_version: "impl-live-rail-v1",
      prompt_config_hash: "16b45e1a0ed185e494a602fd84e249f12fd6f86be0ab2b18ba3d5a6c64db7a5a",
      model_version: "GLM-5.3",
      expires: "2026-11-19",
    },
    evidence_pointers: { evidence_bundle: null },
  }],
  strikes: [],
  priors: [],
};
fs.writeFileSync(process.argv[1], JSON.stringify(doc) + "\n");
' "$fixture" || fail "r51: fixture write failed"

  list_out="$(node "$REPO_ROOT/scripts/adopt-qualification-defaults.js" list --from "$fixture" --feed-cache-dir "$cache" 2>&1)" \
    || fail "r51: list --from failed"

  # RED at d1cad5c7e090e3f64593b6f4e0ef85074e2bc270: evidence        event undefined — null
  assert_not_contains "$list_out" "event undefined" \
    "r51: list --from must not print literal event undefined for a legacy feed row"
  assert_contains "$list_out" "  evidence        (pre-effort feed row — no event id / bundle recorded)" \
    "r51: list --from uses the pre-effort fallback when event id and bundle are absent"
}

assert_r51_adopt_qualification

assert_r52_feed_listing_prints() {
  # Three pre-effort (three-key) seat_hash rows: the list loop used to print a
  # ⚠ block once per row. After the change, one consolidated summary after the loop.
  local cache fixture list_out advert_n summary_n
  cache="$TEST_TMP/r52-feed-cache"
  mkdir -p "$cache"
  fixture="$TEST_TMP/r52-preeffort-feed.json"
  node -e '
const fs = require("fs");
const crypto = require("crypto");
function threeFieldHash(engine, runner, role) {
  const obj = { engine: String(engine), runner: String(runner), role: String(role) };
  return crypto.createHash("sha256").update(JSON.stringify(obj, Object.keys(obj).sort()), "utf8").digest("hex");
}
function row(engine, runner, role) {
  return {
    default_id: "feed:r52:" + engine + ":" + runner + ":" + role,
    role,
    status: "qualified",
    capability_score: 1,
    seat: { engine, runner, role, effort: "high" },
    seat_hash: threeFieldHash(engine, runner, role),
    administration: {
      engine, runner, family: "zhipu", date: "2026-08-21", effort: "high",
      version_source: "operator-asserted",
      runner_version: "2.1.239-Claude-Code",
      harness_version: "dispatch-hetero:003d7975",
      corpus_version: "impl-live-rail-v1",
      prompt_config_hash: "16b45e1a0ed185e494a602fd84e249f12fd6f86be0ab2b18ba3d5a6c64db7a5a",
      model_version: engine,
      expires: "2026-11-19",
    },
  };
}
const doc = {
  schema: "model-dyno.qualification-feed.v1",
  artifact_type: "official-qualification-defaults",
  digest: "deadbeef",
  defaults: [
    row("GLM-5.3", "cc-shim", "implementer"),
    row("GLM-5.3", "cc-shim", "reviewer"),
    row("GLM-5.3", "cc-shim", "consult"),
  ],
  strikes: [],
  priors: [],
};
fs.writeFileSync(process.argv[1], JSON.stringify(doc) + "\n");
' "$fixture" || fail "r52: fixture write failed"

  list_out="$(node "$REPO_ROOT/scripts/adopt-qualification-defaults.js" list --from "$fixture" --feed-cache-dir "$cache" 2>&1)" \
    || fail "r52: list --from failed"

  advert_n="$(printf '%s\n' "$list_out" | grep -c '⚠ feed advertises' || true)"
  summary_n="$(printf '%s\n' "$list_out" | grep -c 'of 3 rows advertise a pre-effort seat_hash; all re-derived locally' || true)"
  # RED at c0ff15d7e485106b55a3de6f068a63f953d69da8: ⚠ feed advertises appears 3 times (once per row); consolidated summary absent
  assert_eq "$advert_n" "0" "r52: per-row ⚠ feed advertises must not print once per row"
  assert_eq "$summary_n" "1" "r52: list prints exactly one consolidated pre-effort seat_hash summary"
}

assert_r52_feed_listing_prints

assert_r53_runner_opencode_usag() {
  # OpenCode --format json event stream: sum step_finish.part.tokens fields.
  local fixture out
  fixture="$TEST_TMP/r53-opencode.jsonl"
  printf '%s\n' \
    '{"type":"step_start","timestamp":1}' \
    '{"type":"step_finish","part":{"reason":"stop","tokens":{"total":100,"input":50,"output":20,"reasoning":10,"cache":{"write":0,"read":20}}}}' \
    '{"type":"text","part":{"text":"ignore me"}}' \
    '{"type":"step_finish","part":{"reason":"stop","tokens":{"total":80,"input":40,"output":30,"reasoning":5,"cache":{"write":2,"read":10}}}}' \
    '{"type":"step_finish","part":{"reason":"stop","tokens":{"total":20,"input":10,"output":5,"reasoning":1,"cache":{"write":1,"read":4}}}}' \
    > "$fixture"

  out="$(node "$REPO_ROOT/scripts/dispatch-status.js" --log "$fixture" --format jsonl-opencode --usage-only)"

  # RED at a82805d3df8e28daebc91015643198d54fb19502: --format jsonl-opencode is unrecognized; --usage-only prints null (never-fail) / --summary exits 2 with "--format must be codex-chrome|jsonl|pi-rpc|agy-json|plain|auto"
  assert_contains "$out" '"total_tokens":200' "r53: summed step_finish tokens.total"
  assert_contains "$out" '"input_tokens":100' "r53: summed step_finish tokens.input"
  assert_contains "$out" '"output_tokens":55' "r53: summed step_finish tokens.output"
  assert_contains "$out" '"reasoning_tokens":16' "r53: summed step_finish tokens.reasoning"
  assert_contains "$out" '"cache_read_tokens":34' "r53: summed step_finish tokens.cache.read"
  assert_contains "$out" '"cache_write_tokens":3' "r53: summed step_finish tokens.cache.write"
  assert_contains "$out" '"source":"jsonl-opencode"' "r53: usage source labeled jsonl-opencode"
}

assert_r53_runner_opencode_usag

finalize_test
