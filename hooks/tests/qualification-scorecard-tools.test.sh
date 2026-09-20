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

assert_r55_autopilot_endpoints() {
  # endpoints test --model must reach the probe payload; default stays haiku.
  local work stub_js port_file bodies_file port stub_pid home_dir base_env
  local with_model without_model
  work="$(mktemp -d "$TEST_TMP/r55-XXXXXX")"
  stub_js="$work/echo-stub.js"
  port_file="$work/port.txt"
  bodies_file="$work/bodies.jsonl"
  home_dir="$work/home"
  base_env="$work/endpoints.env"
  mkdir -p "$home_dir"
  cat > "$stub_js" <<'EOF'
const http = require('http');
const fs = require('fs');
const bodiesPath = process.argv[3];
fs.writeFileSync(bodiesPath, '');
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    fs.appendFileSync(bodiesPath, Buffer.concat(chunks).toString('utf8') + '\n');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'msg_1', content: [{ type: 'text', text: 'OK' }] }));
  });
});
server.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(process.argv[2], String(server.address().port));
});
EOF
  node "$stub_js" "$port_file" "$bodies_file" &
  stub_pid=$!
  local i
  for i in $(seq 1 50); do
    if [ -f "$port_file" ]; then break; fi
    sleep 0.05
  done
  [ -f "$port_file" ] || fail "r55: stub server did not bind"
  port="$(cat "$port_file")"
  printf 'tok' | env HOME="$home_dir" AUTOPILOT_ENDPOINTS_ENV="$base_env" \
    node "$REPO_ROOT/bin/autopilot.js" endpoints set stubok --url "http://127.0.0.1:$port" --token-stdin >/dev/null \
    || fail "r55: endpoints set failed"
  with_model="$(env HOME="$home_dir" AUTOPILOT_ENDPOINTS_ENV="$base_env" \
    node "$REPO_ROOT/bin/autopilot.js" endpoints test stubok --model some-other-id --json 2>&1)"
  without_model="$(env HOME="$home_dir" AUTOPILOT_ENDPOINTS_ENV="$base_env" \
    node "$REPO_ROOT/bin/autopilot.js" endpoints test stubok --json 2>&1)"
  kill "$stub_pid" 2>/dev/null || true
  wait "$stub_pid" 2>/dev/null || true
  local bodies
  bodies="$(cat "$bodies_file")"
  # RED at 503b6d25170915d2dd14f0b04b625a83b64277b2: --model some-other-id silently ignored; both probe bodies sent {"model":"claude-3-haiku-20240307",...}
  assert_contains "$with_model" '"outcome":"ok"' "r55: --model probe still reports ok against echo stub"
  assert_contains "$bodies" '"model":"some-other-id"' "r55: --model some-other-id is sent in the probe body"
  assert_contains "$bodies" '"model":"claude-3-haiku-20240307"' "r55: omitting --model still sends the historical default"
  printf '%s' "$bodies" | awk 'NR==1 && /some-other-id/ {found=1} END {exit found?0:1}' \
    || fail "r55: first request must carry some-other-id, not the hardcoded default"
}

assert_r55_autopilot_endpoints

assert_r75_vacuous_red_case_in() {
  # Alien-hash disposition must emit PROFILE_GUIDED_DISPOSITION_NOT_IN_BASELINE,
  # not the still-present DEAD code (vacuous if both branches share DEAD).
  local sandbox base_dispositions fake_rule hash alien out rc
  sandbox="$TEST_TMP/r75-repo"
  mkdir -p "$sandbox/skills" "$sandbox/docs/projects/_archive/2026/07"
  cp -r "$REPO_ROOT/profiles" "$sandbox/profiles"
  cp -r "$REPO_ROOT/skills/ceo-agent" "$sandbox/skills/ceo-agent"
  cp -r "$REPO_ROOT/skills/dev-flow" "$sandbox/skills/dev-flow"
  cp -r "$REPO_ROOT/docs/projects/_archive/2026/07/2026-07-26-capability-adaptive-profiles" \
        "$sandbox/docs/projects/_archive/2026/07/2026-07-26-capability-adaptive-profiles"
  base_dispositions="$(node -e '
    const fs=require("fs"),path=require("path");
    const f=path.join(process.argv[1],"profiles/guided-baseline-dispositions.json");
    console.log(JSON.stringify(JSON.parse(fs.readFileSync(f,"utf8")).dispositions));
  ' "$sandbox")"
  fake_rule="- synthetic baseline rule planted by assert_r75_vacuous_red_case_in"
  hash="$(node -e '
    const fs=require("fs"),path=require("path");
    const { sha256 }=require(process.argv[2]+"/scripts/measure-profile-context.js");
    const sandbox=process.argv[1];
    const rule=process.argv[3];
    const basePath=path.join(sandbox,"docs/projects/_archive/2026/07/2026-07-26-capability-adaptive-profiles/p0-context-baseline.json");
    const base=JSON.parse(fs.readFileSync(basePath,"utf8"));
    const entry=base.source_surface.files.find(f=>f.path==="skills/dev-flow/SKILL.md");
    const snapPath=path.join(sandbox,"profiles/p0-sources",sha256("skills/dev-flow/SKILL.md")+".txt");
    const snap=fs.readFileSync(snapPath,"utf8")+rule+"\n";
    fs.writeFileSync(snapPath,snap);
    entry.sha256=sha256(snap);
    fs.writeFileSync(basePath,JSON.stringify(base,null,2)+"\n");
    console.log(sha256(rule.trim().replace(/\s+/g," ")));
  ' "$sandbox" "$REPO_ROOT" "$fake_rule")"
  alien="$(printf 'b%.0s' $(seq 64))"
  node -e '
    const fs=require("fs"),path=require("path"),crypto=require("crypto");
    const sandbox=process.argv[1];
    const f=path.join(sandbox,"profiles/guided-baseline-dispositions.json");
    const doc=JSON.parse(fs.readFileSync(f,"utf8"));
    doc.dispositions=JSON.parse(process.argv[3]).concat(JSON.parse(process.argv[2]));
    fs.writeFileSync(f,JSON.stringify(doc,null,2)+"\n");
    const sha=x=>crypto.createHash("sha256").update(fs.readFileSync(x)).digest("hex");
    const catPath=path.join(sandbox,"profiles/profile-catalog.json");
    const cat=JSON.parse(fs.readFileSync(catPath,"utf8"));
    cat.guided_dispositions_sha256=sha(f);
    fs.writeFileSync(catPath,JSON.stringify(cat,null,2)+"\n");
  ' "$sandbox" "[{\"content_hash\":\"$alien\",\"disposition\":\"removed\",\"rationale\":\"test: alien hash\"},{\"content_hash\":\"$hash\",\"disposition\":\"removed\",\"rationale\":\"test: keeps the planted shortfall discharged\"}]" "$base_dispositions"
  set +e
  out="$(node "$REPO_ROOT/scripts/build-profile-payload.js" catalog --check --repo "$sandbox" 2>&1)"
  rc=$?
  set -e
  [ "$rc" -ne 0 ] || fail "r75: alien-hash disposition passed catalog --check"
  # RED at 13146c7b7f371194b5a2263d93ec5515f0cc81e4: PROFILE_GUIDED_DISPOSITION_DEAD: guided baseline disposition targets a hash not in the baseline: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
  assert_contains "$out" "PROFILE_GUIDED_DISPOSITION_NOT_IN_BASELINE" \
    "r75: alien-hash emits NOT_IN_BASELINE (not DEAD)"
  assert_not_contains "$out" "PROFILE_GUIDED_DISPOSITION_DEAD" \
    "r75: alien-hash must not also emit the still-present DEAD code"
}

assert_r75_vacuous_red_case_in

finalize_test
