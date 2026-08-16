#!/usr/bin/env bash
# Red-case coverage for scripts/decision-ledger.js (autonomous-brain P3, KR3).
# Proves: rationale-less decisions refused, veto of unknown id refused, veto
# blocks later rounds (via conformance preflight), unlogged dispatch caught by
# the ledger-independent audit universe, report renders without polling.
. "$(dirname "$0")/lib.sh"

LEDGER_SCRIPT="$REPO_ROOT/scripts/decision-ledger.js"
CONF_SCRIPT="$REPO_ROOT/scripts/check-blueprint-conformance.js"
L="$TEST_TMP/ledger.jsonl"

# ── append requires a rationale (KR3: a decision without one is unreportable) ──
node "$LEDGER_SCRIPT" append --ledger "$L" --kind decision --json '{"decision_id":"d-1","round":1,"class":"tactical"}' >/dev/null 2>&1
assert_exit_code "$?" "1" "decision without rationale refused"
node "$LEDGER_SCRIPT" append --ledger "$L" --kind decision --json '{"decision_id":"d-1","round":1,"class":"tactical","rationale":"picked zstd","reversibility":"two-way"}' >/dev/null
assert_exit_code "$?" "0" "decision with rationale accepted"
node "$LEDGER_SCRIPT" append --ledger "$L" --kind dispatch --json '{"decision_id":"d-2","round":1,"run_id":"hetero-42","rationale":"impl unit u1"}' >/dev/null
node "$LEDGER_SCRIPT" append --ledger "$L" --kind pick --json '{"decision_id":"d-3","round":1,"row_title":"Fix X","pick_record":{"backlog_digest":"b","preference_digest":"p","readiness_snapshot":{}},"rationale":"top auto-eligible"}' >/dev/null
node "$LEDGER_SCRIPT" append --ledger "$L" --kind decision --json '{"decision_id":"d-4","round":1,"class":"ask-first","rationale":"L-effort refactor needs Board"}' >/dev/null

# ── veto: unknown id refused; known id lands ──
node "$LEDGER_SCRIPT" veto --ledger "$L" --id d-99 >/dev/null 2>&1
assert_exit_code "$?" "1" "veto of unknown decision refused"
node "$LEDGER_SCRIPT" veto --ledger "$L" --id d-1 --reason "board says no" >/dev/null
assert_exit_code "$?" "0" "veto of known decision accepted"

# ── query ──
OUT="$(node "$LEDGER_SCRIPT" query --ledger "$L" --kind veto --json)"
assert_contains "$OUT" "d-1" "query returns the veto row"

# ── KR3 red: veto blocks a later round that builds on the vetoed decision ──
WORK="$TEST_TMP/repo"; mkdir -p "$WORK/units" "$WORK/src/f"
git -C "$TEST_TMP" init -q repo; git -C "$WORK" config user.email t@t; git -C "$WORK" config user.name t
printf '{"schema":1,"deliverables":[{"id":"u1","paths":["src/f/"],"churn_budget":{"max_files":3,"max_lines":100}}]}\n' > "$WORK/units/dag.json"
printf 'r\n' > "$WORK/rubric.md"; printf 'x\n' > "$WORK/src/f/a.js"
git -C "$WORK" add -A && git -C "$WORK" commit -qm base
BASE="$(git -C "$WORK" rev-parse HEAD)"
sha(){ sha256sum "$1"|cut -d' ' -f1; }
cat > "$TEST_TMP/contract.json" <<JSON
{"schema":1,"unit_id":"u1","role":"implementer","goal":"g","spec":{"path":"rubric.md","section":"r"},
 "base_sha":"$BASE","depends_on":[],"scope":{"allow_paths":["src/f/"]},
 "go":{"required_engine_role":"implementer"},"no_go":{},
 "output":{"kind":"commit","paths":["src/f/a.js"]},"acceptance":[],"budget":{},
 "frozen_four_tuple":{"granularity_path":"units/dag.json","granularity_digest":"$(sha "$WORK/units/dag.json")",
  "gate_set":["defect-review"],"rubric_path":"rubric.md","rubric_digest":"$(sha "$WORK/rubric.md")",
  "control_plane_pins":{"rubric.md":"$(sha "$WORK/rubric.md")"}}}
JSON
cat > "$TEST_TMP/intent.json" <<'JSON'
{"schema":1,"unit_id":"u1","role":"implementer","gate_set":["defect-review"],
 "diff_scope":{"paths":["src/f/a.js"],"churn_estimate":{"files":1,"lines":5}},
 "based_on_decisions":["d-1"]}
JSON
node "$CONF_SCRIPT" preflight --contract "$TEST_TMP/contract.json" --intent "$TEST_TMP/intent.json" --repo "$WORK" --plugin-root "$TEST_TMP/empty-plugin" --ledger "$L" >/dev/null 2>&1
assert_exit_code "$?" "1" "round building on vetoed d-1 refused by preflight"
node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('$TEST_TMP/intent.json','utf8'));j.based_on_decisions=['d-2'];fs.writeFileSync('$TEST_TMP/intent.json',JSON.stringify(j))"
node "$CONF_SCRIPT" preflight --contract "$TEST_TMP/contract.json" --intent "$TEST_TMP/intent.json" --repo "$WORK" --plugin-root "$TEST_TMP/empty-plugin" --ledger "$L" >/dev/null
assert_exit_code "$?" "0" "round building on un-vetoed d-2 passes"

# ── KR3 red: unlogged dispatch manifest fails audit (ledger-independent universe) ──
mkdir -p "$TEST_TMP/manifests"
printf '%s\n' '{"run_id":"hetero-42"}' > "$TEST_TMP/manifests/hetero-42.manifest.json"
printf '%s\n' '{"run_id":"hetero-777"}' > "$TEST_TMP/manifests/hetero-777.manifest.json"
OUT="$(node "$CONF_SCRIPT" audit --contract "$TEST_TMP/contract.json" --intent "$TEST_TMP/intent.json" --repo "$WORK" --plugin-root "$TEST_TMP/empty-plugin" --manifest-dir "$TEST_TMP/manifests" --ledger "$L")"; RC=$?
assert_exit_code "$RC" "1" "unlogged dispatch hetero-777 fails audit"
assert_contains "$OUT" "hetero-777" "the unlogged run is named"
assert_not_contains "$OUT" "unlogged_decision] dispatch manifest 'hetero-42'" "the ledgered run hetero-42 raises nothing"

# ── report renders all sections without polling ──
printf '%s\n' '{"tripped":false,"consecutive_zero_product":1,"threshold":3}' > "$TEST_TMP/stall.json"
printf '%s\n' '{"findings":[{"id":"ux-1","summary":"error message names no fix"}],"human_only":["打擊感"]}' > "$TEST_TMP/critic.json"
OUT="$(node "$LEDGER_SCRIPT" report --ledger "$L" --round 1 --stall "$TEST_TMP/stall.json" --critic "$TEST_TMP/critic.json")"
assert_contains "$OUT" "d-1" "report lists the proxy decision"
assert_contains "$OUT" "VETOED" "report marks the vetoed decision"
assert_contains "$OUT" "Fix X" "report lists the auto-pick"
assert_contains "$OUT" "L-effort refactor" "report lists the ask-first queue item"
assert_contains "$OUT" "healthy (1/3" "report shows stall status"
assert_contains "$OUT" "ux-1" "report shows critic finding"
assert_contains "$OUT" "打擊感" "report routes human-only qualities to the operator"

finalize_test
