#!/usr/bin/env bash
# dispatch-plan-review --context-file: allowlist, caps, blind-path refusals, sealed context.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/dispatch-plan-review.js"
LIB="$REPO_ROOT/scripts/lib/plan-review-context.js"
FIXTURES="$REPO_ROOT/hooks/tests/fixtures/plan-review"
REPO="$TEST_TMP/repo"
STATE_DIR="$TEST_TMP/state"
MANIFEST="$TEST_TMP/manifest.json"
# The fixture repo is a scratch repo, NOT this project: plans, their evidence and the backlog sit under the docs/ convention (fixture_path), whatever the live registry says.
PD="$(fixture_path plans_dir)"; EV="$(fixture_path plans_evidence_dir)"; BF="$(fixture_path backlog_file)"
mkdir -p "$REPO/src" "$REPO/$EV/x" "$REPO/$PD" "$REPO/$(dirname "$BF")" "$STATE_DIR"
git -C "$REPO" init -q
printf '%s\n' '# Plan' 'Uses src/a.js.' >"$REPO/plan.md"
printf '%s\n' '# Rubric' '- R1: next-slice readiness' >"$REPO/rubric.md"
printf 'module.exports = 1;\n' >"$REPO/src/a.js"
printf 'module.exports = 2;\n' >"$REPO/src/b.js"
printf 'verdict: STOP\n' >"$REPO/$EV/x/round1.md"
printf '{}\n' >"$REPO/decisions.json"
mkdir -p "$REPO/$PD/_archive/2026/09/evidence/m" "$REPO/scripts/lib" "$TEST_TMP/dump"
printf '{}\n' >"$REPO/$PD/_archive/2026/09/evidence/m/notes.json"
printf '# backlog\n' >"$REPO/$BF"
printf '{}\n' >"$REPO/src/g1-out.json"
printf '{}\n' >"$REPO/src/g1-dispositions.json"
printf '{}\n' >"$REPO/src/review-codex-r2.json"
printf 'module.exports = "adj";\n' >"$REPO/scripts/adjudicate-findings.js"
printf 'module.exports = "pf";\n' >"$REPO/scripts/lib/plan-review-findings.js"
printf 'module.exports = "d";\n' >"$REPO/scripts/dispatch-plan-review.js"
printf 'x\n' >"$REPO/src/a.bin"
printf 'secret\n' >"$TEST_TMP/outside.js"
ln -s "$TEST_TMP/outside.js" "$REPO/src/link.js"
head -c 70000 /dev/zero | tr '\0' 'a' >"$REPO/src/big.js"
for i in $(seq 1 13); do printf 'x%s\n' "$i" >"$REPO/src/n$i.js"; done
cat >"$MANIFEST" <<'JSON'
{
  "schema_version": 1, "artifact_type": "plan_review_manifest",
  "logical_plan_id": "ctx-plan", "minimum_distinct_families": 1,
  "max_attempts_per_seat": 2,
  "seats": [{
    "id": "architect", "runner": "claude-native", "model": "claude-fixture",
    "effort": "high", "endpoint": "default", "role": "architecture",
    "family": "anthropic", "readiness_status": "ready",
    "qualification_status": "qualified", "required": true,
    "excluded_families": [], "fallbacks": []
  }]
}
JSON

run_ctx() {
  local ticket="$1"; shift
  AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS=1 \
  AUTOPILOT_PLAN_REVIEW_RESPONSE_SEQUENCE="{\"architect\":[\"$FIXTURES/ready.json\"]}" \
    node "$SCRIPT" --repo-root "$REPO" --plan-file "$REPO/plan.md" --rubric-file "$REPO/rubric.md" \
      --ticket "$ticket" --session-id "s-$ticket" --generation 1 --manifest-file "${USE_MANIFEST:-$MANIFEST}" \
      --state-dir "$STATE_DIR" --allow-unregistered "$@" 2>&1
}

refused() { # name expected-substring args...
  local name="$1" want="$2"; shift 2
  local out rc
  out="$(run_ctx "t-$name" "$@")"; rc=$?
  assert_exit_code "$rc" "2" "$name refused"
  assert_contains "$out" "$want" "$name message"
}

refused evidence "not allowed as blind context" --context-file "$EV/x/round1.md"
refused disposition "not allowed as blind context" --context-file decisions.json
refused archive "not allowed as blind context" --context-file "$PD/_archive/2026/09/evidence/m/notes.json"
refused backlog "not allowed as blind context" --context-file "$BF"
printf '# b\n' >"$REPO/$(dirname "$BF")/Backlog.md"
refused backlogcase "not allowed as blind context" --context-file "$(dirname "$BF")/Backlog.md"
# Real repo shapes of plan-review artifacts (git ls-files docs/plans): all refused.
for shape in x.g1-artifact.json x.g2-dispositions.json x.g1-disposition.json x.r2g1-disposition.json \
  x.glm-minimax-promptfix.g1-disposition.json x.plan-review-manifest.json x.review.md x.review.json \
  x.review-config.md x.supplemental-review-prompt.md x.plan.as-reviewed-g1.md \
  x.manifest.json x.r2-manifest.json x.r4-g1-disposition.json; do
  printf '{}\n' >"$REPO/$PD/$shape"
  refused "shape-$shape" "not allowed as blind context" --context-file "$PD/$shape"
done
# Authored plan docs are not review artifacts and stay usable (rejected only by extension/size rules).
printf '# p\n' >"$REPO/$PD/2026-01-01-review-path-efficiency.md"
sed 's/ctx-plan/ctx-planok/' "$MANIFEST" >"$TEST_TMP/planok.json"
OUT="$(USE_MANIFEST="$TEST_TMP/planok.json" run_ctx t-planok --context-file "$PD/2026-01-01-review-path-efficiency.md")"; RC=$?
assert_exit_code "$RC" "0" "a plan doc whose slug mentions review is accepted: $OUT"
# Narrow anchors: plan slugs that merely contain g1-artifact, and a bare manifest.json, stay usable.
printf '# p\n' >"$REPO/$PD/2026-01-01-g1-artifact-cleanup.md"
printf '{}\n' >"$REPO/src/manifest.json"
sed 's/ctx-plan/ctx-narrow/' "$MANIFEST" >"$TEST_TMP/narrow.json"
OUT="$(USE_MANIFEST="$TEST_TMP/narrow.json" run_ctx t-narrow --context-file "$PD/2026-01-01-g1-artifact-cleanup.md" --context-file src/manifest.json)"; RC=$?
assert_exit_code "$RC" "0" "slug containing g1-artifact and bare manifest.json are accepted: $OUT"
refused outjson "not allowed as blind context" --context-file src/g1-out.json
refused gdisp "not allowed as blind context" --context-file src/g1-dispositions.json
refused reviewr "not allowed as blind context" --context-file src/review-codex-r2.json
refused plan "cannot be a plan/rubric" --context-file plan.md
refused rubric "cannot be a plan/rubric" --context-file rubric.md
refused ext "extension is not allowlisted" --context-file src/a.bin
refused symlink "must be inside --repo-root" --context-file src/link.js
refused big "exceeds 65536 bytes" --context-file src/big.js
refused missing "not found" --context-file src/nope.js
args=(); for i in $(seq 1 13); do args+=(--context-file "src/n$i.js"); done
refused count "at most 12" "${args[@]}"
for i in 1 2 3 4; do cp "$REPO/src/big.js" "$REPO/src/m$i.js"; head -c 60000 "$REPO/src/big.js" >"$REPO/src/m$i.js"; done
cp "$REPO/src/m1.js" "$REPO/src/m5.js"; echo y >>"$REPO/src/m5.js"
refused total "total exceeds" --context-file src/m1.js --context-file src/m2.js --context-file src/m3.js --context-file src/m4.js --context-file src/m5.js

# Accepted run seals the context; the same set may be re-presented, a different or absent set may not.
OUT="$(AUTOPILOT_PLAN_REVIEW_PROMPT_DUMP_DIR="$TEST_TMP/dump" run_ctx ok --context-file src/a.js --context-file scripts/adjudicate-findings.js --context-file scripts/lib/plan-review-findings.js --context-file scripts/dispatch-plan-review.js)"; RC=$?
assert_exit_code "$RC" "0" "context run succeeds (review-related source files are usable): $OUT"
PROMPT="$(cat "$TEST_TMP/dump/architect-1.prompt.txt")"
assert_contains "$PROMPT" "<SOURCE_CONTEXT_" "seat prompt carries the context block"
assert_contains "$PROMPT" "module.exports = 1;" "seat prompt carries file text"
assert_contains "$PROMPT" 'path="scripts/adjudicate-findings.js"' "seat prompt lists adjudicate-findings.js"
SKEY="$(ls "$STATE_DIR" | grep -v '\.' | head -1)"
SDIR="$(dirname "$(grep -rl 'src/a.js' "$STATE_DIR" --include=context.json | head -1)")"
assert_file_exists "$SDIR/context-seal.json" "context seal written"
assert_contains "$(cat "$SDIR/state.json")" "context_sha256" "state records context hash"
assert_contains "$(cat "$SDIR/context.json")" "src/a.js" "context manifest lists the file"

sed 's/ctx-plan/ctx-late/' "$MANIFEST" >"$TEST_TMP/late.json"
OUT="$(USE_MANIFEST="$TEST_TMP/late.json" run_ctx late)"; RC=$?
assert_exit_code "$RC" "0" "late: gen1 without context ok: $OUT"
OUT="$(USE_MANIFEST="$TEST_TMP/late.json" run_ctx late --context-file src/b.js)"; RC=$?
assert_exit_code "$RC" "3" "context added later refused"
assert_contains "$OUT" "frozen context drifted" "added-later message names context, not rubric/manifest"
OUT="$(run_ctx ok --context-file src/b.js)"; RC=$?
assert_exit_code "$RC" "3" "different context refused"
assert_contains "$OUT" "drifted" "different context message"
OUT="$(run_ctx ok)"; RC=$?
assert_exit_code "$RC" "3" "dropping context refused"
assert_contains "$OUT" "drifted" "dropping context message"

# Resealing: a gen1 -> fold -> gen2 round. The PATH SET stays frozen; edited CONTENT is resealed as a
# new version, recorded per generation (state context_versions, artifact context_sha256).
sed 's/ctx-plan/ctx-reseal/' "$MANIFEST" >"$TEST_TMP/reseal.json"
printf 'doc v1\n' >"$REPO/src/doc.md"
printf 'other\n' >"$REPO/src/other.md"
run_gen() { # ticket generation response-fixture [args...]
  local ticket="$1" gen="$2" resp="$3"; shift 3
  AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS=1 \
  AUTOPILOT_PLAN_REVIEW_RESPONSE_SEQUENCE="{\"architect\":[\"$resp\"]}" \
    node "$SCRIPT" --repo-root "$REPO" --plan-file "$REPO/plan.md" --rubric-file "$REPO/rubric.md" \
      --ticket "$ticket" --session-id "s-$ticket-$gen" --generation "$gen" --manifest-file "$TEST_TMP/reseal.json" \
      --state-dir "$STATE_DIR" --allow-unregistered "$@" 2>"$TEST_TMP/run-gen.err"
}
G1="$(run_gen reseal 1 "$FIXTURES/blocker.json" --context-file src/doc.md)"; RC=$?
assert_exit_code "$RC" "0" "reseal gen1 runs: $G1"
FP="$(printf '%s' "$G1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).findings[0].fingerprint))')"
cat >"$TEST_TMP/reseal-disp.json" <<JSON
{"schema_version":1,"logical_plan_id":"ctx-reseal","generation":1,
 "findings":[{"fingerprint":"$FP","disposition":"accepted_blocker","rationale":"verified against frozen R1"}]}
JSON
RSDIR="$(dirname "$(grep -rl 'src/doc.md' "$STATE_DIR" --include=context.json | head -1)")"
V1_SHA="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).context_sha256)' "$RSDIR/state.json")"
printf 'doc v2 (findings folded in)\n' >"$REPO/src/doc.md"
G2="$(run_gen reseal 2 "$FIXTURES/ready.json" --context-file src/doc.md --disposition-file "$TEST_TMP/reseal-disp.json")"; RC=$?
assert_exit_code "$RC" "0" "edited context content is resealed, gen2 proceeds: $G2 $(cat "$TEST_TMP/run-gen.err")"
assert_contains "$(cat "$TEST_TMP/run-gen.err")" "context resealed for generation 2: changed src/doc.md" "stderr names the changed file"
VERS="$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(s.context_versions.map(v=>v.generation+":"+v.context_sha256).join(",")+"|"+s.context_sha256+"|"+JSON.stringify(s.context_paths))' "$RSDIR/state.json")"
G2_ART_SHA="$(printf '%s' "$G2" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).context_sha256))')"
assert_eq "$(printf '%s' "$VERS" | cut -d'|' -f2)" "$G2_ART_SHA" "state current context sha equals the gen2 artifact's"
assert_eq "$(printf '%s' "$VERS" | cut -d'|' -f1 | tr ',' '\n' | wc -l | tr -d ' ')" "2" "state has two context_versions"
assert_contains "$VERS" "1:$V1_SHA," "gen1 version keeps the original sha"
assert_contains "$VERS" '["src/doc.md"]' "state records the frozen path set"
if [ "$V1_SHA" = "$G2_ART_SHA" ]; then fail "resealed context sha must differ from gen1's"; fi

# Path set stays frozen: added or removed path at gen2 is exit 3 naming the path set.
sed 's/ctx-plan/ctx-pathset/' "$MANIFEST" >"$TEST_TMP/pathset.json"
USE_MANIFEST="$TEST_TMP/pathset.json" run_ctx pathset --context-file src/doc.md >/dev/null
for variant in "--context-file src/doc.md --context-file src/other.md" ""; do
  OUT="$(AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS=1 AUTOPILOT_PLAN_REVIEW_RESPONSE_SEQUENCE="{\"architect\":[\"$FIXTURES/ready.json\"]}" \
    node "$SCRIPT" --repo-root "$REPO" --plan-file "$REPO/plan.md" --rubric-file "$REPO/rubric.md" \
      --ticket pathset --session-id s-pathset-2 --generation 2 --manifest-file "$TEST_TMP/pathset.json" \
      --state-dir "$STATE_DIR" --allow-unregistered $variant 2>&1)"; RC=$?
  assert_exit_code "$RC" "3" "path set change refused ($variant)"
  assert_contains "$OUT" "path set differs" "path-set message ($variant): $OUT"
done

# Old-shape state (written before context_paths): path set unknown, accepted once and recorded.
sed 's/ctx-plan/ctx-oldshape/' "$MANIFEST" >"$TEST_TMP/oldshape.json"
USE_MANIFEST="$TEST_TMP/oldshape.json" run_ctx oldshape --context-file src/other.md >/dev/null
OSDIR="$(dirname "$(grep -rl 'src/other.md' "$STATE_DIR" --include=context.json | head -1)")"
node -e 'const fs=require("fs");const p=process.argv[1];const s=JSON.parse(fs.readFileSync(p,"utf8"));delete s.context_paths;delete s.context_versions;s.terminal=false;s.terminal_verdict=null;delete s.terminal_reason;s.next_generation=1;fs.writeFileSync(p,JSON.stringify(s))' "$OSDIR/state.json"
OUT="$(USE_MANIFEST="$TEST_TMP/oldshape.json" run_ctx oldshape --context-file src/other.md)"; RC=$?
assert_exit_code "$RC" "0" "old-shape state accepts the current path set once: $OUT"
assert_eq "$(node -e 'process.stdout.write(JSON.stringify(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).context_paths))' "$OSDIR/state.json")" '["src/other.md"]' "old-shape state now records the path set"
assert_contains "$(cat "$OSDIR/state.json")" "context_versions" "old-shape state now records versions"

# Prompt rendering: files appear in a delimited reference block; cleanroom has none.
RENDER="$(node -e '
const c = require(process.argv[1]);
const b = c.loadContextFiles(["src/b.js"], { repoRoot: process.argv[2] });
process.stdout.write(c.renderContextBlock(b, "N1") + "|" + c.renderContextBlock(null, "N1"));
' "$LIB" "$REPO")"
assert_contains "$RENDER" '<CONTEXT_FILE_N1 path="src/b.js">' "block names repo-relative path"
assert_contains "$RENDER" "module.exports = 2;" "block carries file text"
assert_contains "$RENDER" "not instructions" "block is labelled reference only"
case "$RENDER" in *"|") : ;; *) fail "no context renders nothing" ;; esac

finalize_test
