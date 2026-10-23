#!/usr/bin/env bash
# hooks/tests/skill-onoff-bpack.test.sh — bpack instrument (Hand A: runner, matrix, campaign, scorer).
# Stub runner only; no claude call, no spend. Markers come from Bash tool calls and cell
# artefacts, never from the agent's words (same rule as skill-onoff-gdorm.test.sh).
#
# Sections that need the content hand's files (prereg/bpack.json, arms/bpack, lib-bpack,
# tasks/bpack-*) run only when those exist and print "SKIP (B file absent)" otherwise, so
# this suite is not red before the two hands merge. BPACK_REQUIRE_B=1 turns every skip into
# a failure: depth-0 sets it after merging both hands, so a skip can never be the final word.
#
# RED-first: the scorer, campaign and runner did not exist at 788f92268.
# RED at 43fb5a00c: run-bpack-campaign.js, score-bpack.js, run-skill-onoff-eval-bpack.sh and
# run-skill-onoff-matrix-bpack.sh are missing (node: Cannot find module; bash: No such file).
set -uo pipefail
. "$(dirname "$0")/lib.sh"
unset GIT_ALLOW_PROTOCOL
export GIT_CONFIG_COUNT=0
export HOME="$TEST_TMP/home"
mkdir -p "$HOME"
case "$HOME" in
  "$TEST_TMP"/*) ;;
  *) echo "FAIL: HOME is not under TEST_TMP: $HOME" >&2; exit 1 ;;
esac

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE="$REPO_ROOT/evals/skill-onoff"
fail() { echo "FAIL: $*" >&2; exit 1; }
SKIPS=0
skip() { SKIPS=$((SKIPS+1)); echo "SKIP (B file absent): $*"; }
clean() { env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID -u ONOFF_MAX_USD "$@"; }

for f in run-bpack-campaign.js score-bpack.js run-skill-onoff-eval-bpack.sh run-skill-onoff-matrix-bpack.sh; do
  [ -f "$BASE/$f" ] || fail "missing $f"
done

# A prereg fixture that carries only what the scorer and campaign read, so Hand A's
# machinery is tested without Hand B's prereg/bpack.json.
FX="$TEST_TMP/prereg-fixture.json"
cat > "$FX" << 'EOP'
{"row":"bpack","skill":"ceo-agent","model":"sonnet","reps":5,
 "arms":{"off":"base","on":"change"},
 "invocation_prefix":"Load the autopilot:ceo-agent skill first, then handle this:",
 "tasks":["bpack-revoked","bpack-tree","dcard-owner-decision"],
 "thresholds":{"reps":5,"v1_min_invoked_ratio":0.9}}
EOP

echo "=== campaign dry-run: 30 cells, 6.80 USD (T3 two-turn cells at 0.30) ==="
RES="$TEST_TMP/res30.jsonl"
dry=$(clean node "$BASE/run-bpack-campaign.js" --prereg "$FX" --results "$RES" --dry-run < /dev/null) || fail "dry-run exit $?"
python3 - "$dry" << 'PY' || fail "30-cell dry-run: $dry"
import json, sys
lines = sys.argv[1].splitlines()
j = json.loads([l for l in lines if l.startswith("{")][-1])
assert j["dry_run"] is True and j["pilot"] is False, j
assert j["cells_total"] == 30, j
assert abs(j["cost_estimate_usd"] - 6.80) < 1e-9, j
assert j["max_usd"] == 7, j
cells = [l.split()[1] for l in lines if l.startswith("todo")]
assert len(cells) == 30, len(cells)
for t in ("bpack-revoked", "bpack-tree", "dcard-owner-decision"):
    for arm in ("base", "change"):
        n = len([c for c in cells if c.startswith(f"{t}|{arm}|")])
        assert n == 5, (t, arm, n)
PY

echo "=== dry-run refuses when the estimate exceeds ONOFF_MAX_USD ==="
if clean ONOFF_MAX_USD=5 node "$BASE/run-bpack-campaign.js" --prereg "$FX" --results "$TEST_TMP/cap.jsonl" --dry-run < /dev/null >/dev/null 2>&1
then fail "ONOFF_MAX_USD=5 should make the 30-cell dry-run exit non-zero"; fi
clean ONOFF_MAX_USD=6.80 node "$BASE/run-bpack-campaign.js" --prereg "$FX" --results "$TEST_TMP/cap2.jsonl" --dry-run < /dev/null >/dev/null 2>&1 \
  || fail "ONOFF_MAX_USD=6.80 should allow exactly 6.80"
clean ONOFF_MAX_USD=6.79 node "$BASE/run-bpack-campaign.js" --prereg "$FX" --results "$TEST_TMP/cap3.jsonl" --dry-run < /dev/null >/dev/null 2>&1 \
  && fail "ONOFF_MAX_USD=6.79 should refuse a 6.80 estimate"

echo "=== pilot: 5 cells (T1, T2 one rep both arms; T3 base one rep), 1.06 USD ==="
pil=$(clean node "$BASE/run-bpack-campaign.js" --prereg "$FX" --results "$TEST_TMP/pilot.jsonl" --dry-run --pilot < /dev/null) || fail "pilot dry-run exit $?"
python3 - "$pil" << 'PY' || fail "pilot dry-run: $pil"
import json, sys
lines = sys.argv[1].splitlines()
j = json.loads([l for l in lines if l.startswith("{")][-1])
assert j["pilot"] is True and j["cells_total"] == 5, j
assert abs(j["cost_estimate_usd"] - 1.06) < 1e-9, j
cells = sorted(l.split()[1] for l in lines if l.startswith("todo"))
want = sorted(["bpack-revoked|base|1", "bpack-revoked|change|1", "bpack-tree|base|1", "bpack-tree|change|1", "dcard-owner-decision|base|1"])
assert cells == want, cells
PY
clean node "$BASE/run-bpack-campaign.js" --prereg "$FX" --results "$TEST_TMP/pilot2.jsonl" --dry-run --pilot --reps 2 < /dev/null >/dev/null 2>&1 \
  && fail "--pilot with --reps should be refused"

echo "=== missing prereg: explicit error, not a verdict ==="
if clean node "$BASE/run-bpack-campaign.js" --prereg "$TEST_TMP/no-such-prereg.json" --results "$TEST_TMP/x.jsonl" --dry-run < /dev/null >/dev/null 2>"$TEST_TMP/err1"
then fail "campaign with a missing prereg should exit non-zero"; fi
grep -q 'cannot read prereg' "$TEST_TMP/err1" || fail "campaign missing-prereg message: $(cat "$TEST_TMP/err1")"
: > "$TEST_TMP/empty.jsonl"
rc=0; out=$(clean node "$BASE/score-bpack.js" --prereg "$TEST_TMP/no-such-prereg.json" --results "$TEST_TMP/empty.jsonl" 2>&1 < /dev/null) || rc=$?
[ "$rc" = 2 ] || fail "scorer with a missing prereg: rc=$rc want 2: $out"
grep -q 'prereg unreadable' <<<"$out" || fail "scorer missing-prereg message: $out"
grep -q 'PASS' <<<"$out" && fail "scorer printed PASS without a prereg: $out"
rc=0; out=$(clean node "$BASE/score-bpack.js" --prereg "$FX" --results "$TEST_TMP/no-such-results.jsonl" 2>&1 < /dev/null) || rc=$?
[ "$rc" = 2 ] || fail "scorer with missing results: rc=$rc want 2: $out"
echo '{"row":"bpack"}' > "$TEST_TMP/bad-prereg.json"
rc=0; out=$(clean node "$BASE/score-bpack.js" --prereg "$TEST_TMP/bad-prereg.json" --results "$TEST_TMP/empty.jsonl" 2>&1 < /dev/null) || rc=$?
[ "$rc" = 2 ] || fail "scorer with a prereg lacking arms: rc=$rc want 2: $out"

echo "=== scorer on stub rows: each threshold passes and fails on its own ==="
gen() { # name t1b t1c t2b t2c t3b t3c [flags: nomarker3 | lowinv | infra | missing]
  python3 - "$TEST_TMP/$1.jsonl" "${@:2}" << 'PY'
import json, sys
path = sys.argv[1]
t1b, t1c, t2b, t2c, t3b, t3c = (int(x) for x in sys.argv[2:8])
flags = sys.argv[8:]
plan = {("bpack-revoked", "base"): t1b, ("bpack-revoked", "change"): t1c,
        ("bpack-tree", "base"): t2b, ("bpack-tree", "change"): t2c,
        ("dcard-owner-decision", "base"): t3b, ("dcard-owner-decision", "change"): t3c}
marker = {"bpack-revoked": "b_revoked_prefix", "bpack-tree": "t_tree_run", "dcard-owner-decision": "a_decision_file"}
rows = []
for (task, arm), hits in plan.items():
    for rep in range(1, 6):
        r = {"task_id": task, "arm": arm, "rep": rep, "model": "sonnet", "runner": "cc",
             "failure_class": None, "skill_invoked": True, "markers": {marker[task]: rep <= hits}}
        if "nomarker3" in flags and task == "dcard-owner-decision":
            r["markers"] = {}
        if "absent5" in flags and task == "dcard-owner-decision" and rep == 5:
            r["markers"] = {}
        if "lowinv" in flags and arm == "change" and rep <= 2:
            r["skill_invoked"] = False
        rows.append(r)
if "infra" in flags:
    rows[0]["failure_class"] = "runner_timeout"
if "missing" in flags:
    rows.pop()
with open(path, "w") as f:
    for r in rows:
        f.write(json.dumps(r) + "\n")
PY
}
score() { # $1 name $2 want-rc $3 optional: rule that must be false ("" for none) $4 optional text that must appear
  local rc=0 out
  out=$(clean node "$BASE/score-bpack.js" --prereg "$FX" --results "$TEST_TMP/$1.jsonl" 2>&1 < /dev/null) || rc=$?
  [ "$rc" = "$2" ] || fail "score $1: rc=$rc want $2: $out"
  if [ "$2" = 0 ]; then grep -q '^bpack: PASS' <<<"$out" || fail "score $1: no PASS line: $out"
  else grep -q '^bpack: PASS' <<<"$out" && fail "score $1: verdict was PASS: $out"; fi
  if [ -n "${3:-}" ]; then
    grep -q "\"$3\":false" <<<"$out" || fail "score $1: rule $3 should be false: $out"
    # the other two rules must still be true, so the failure is attributable to one threshold
    for other in b_revoked_prefix t_tree_run a_decision_file; do
      [ "$other" = "$3" ] || grep -q "\"$other\":true" <<<"$out" || fail "score $1: rule $other should be true: $out"
    done
  fi
  [ -z "${4:-}" ] || grep -q -- "$4" <<<"$out" || fail "score $1: missing text [$4]: $out"
}
# base/change hits out of 5:           T1b T1c T2b T2c T3b T3c
gen pass            1 4  1 4  4 4;  score pass 0
gen pass-wide       0 5  0 4  5 4;  score pass-wide 0
gen t1-base-high    2 5  1 4  4 4;  score t1-base-high 3 b_revoked_prefix
gen t1-change-low   1 3  1 4  4 4;  score t1-change-low 3 b_revoked_prefix
gen t1-edge-ok      1 4  1 4  4 4;  score t1-edge-ok 0
gen t2-change-low   1 4  0 3  4 4;  score t2-change-low 3 t_tree_run
gen t2-gap-small    1 4  2 4  4 4;  score t2-gap-small 3 t_tree_run
gen t2-gap-edge-ok  1 4  1 4  4 4;  score t2-gap-edge-ok 0
gen t2-base-high    1 4  3 5  4 4;  score t2-base-high 3 t_tree_run
gen t3-drop-1-ok    1 4  1 4  4 3;  score t3-drop-1-ok 0
gen t3-drop-2       1 4  1 4  4 2;  score t3-drop-2 3 a_decision_file
gen t3-rise-ok      1 4  1 4  2 5;  score t3-rise-ok 0
echo "=== negative control: T3 marker absent / never true must be red ==="
gen t3-marker-absent 1 4  1 4  4 4 nomarker3
score t3-marker-absent 3 a_decision_file "marker a_decision_file missing"
gen t3-absent-one   1 4  1 4  4 4 absent5   # counts alone would pass; one cell has no marker key
score t3-absent-one 3 a_decision_file "marker a_decision_file missing in 2 cell"
gen t3-vacuous      1 4  1 4  0 0;  score t3-vacuous 3 a_decision_file "vacuous"
echo "=== V1, infra, missing cell ==="
gen v1-low          1 4  1 4  4 4 lowinv; score v1-low 5 "" "INSTRUMENT-INVALID"
gen infra-cell      1 4  1 4  4 4 infra;  score infra-cell 3 "" "infra failure"
gen missing-cell    1 4  1 4  4 4 missing; score missing-cell 3 "" "infra failure"

echo "=== scorer uses the latest row when a retry is appended ==="
python3 - "$TEST_TMP" << 'PY'
import json, os, sys
tmp = sys.argv[1]
rows = [json.loads(l) for l in open(os.path.join(tmp, "pass.jsonl")) if l.strip()]
out = []
for r in rows:
    if (r["task_id"], r["arm"], r["rep"]) == ("bpack-revoked", "change", 1):
        stale = dict(r); stale["failure_class"] = "runner_timeout"
        out += [stale, r]          # infra row first, success appended
    else:
        out.append(r)
with open(os.path.join(tmp, "retry-ok.jsonl"), "w") as f:
    for r in out: f.write(json.dumps(r) + "\n")
out = []
for r in rows:
    if (r["task_id"], r["arm"], r["rep"]) == ("bpack-revoked", "change", 1):
        late = dict(r); late["failure_class"] = "runner_timeout"
        out += [r, late]           # success first, infra row last
    else:
        out.append(r)
with open(os.path.join(tmp, "retry-infra.jsonl"), "w") as f:
    for r in out: f.write(json.dumps(r) + "\n")
PY
score retry-ok 0
score retry-infra 3 "" "infra failure"

echo "=== shared runner stays the develop bytes (dcard-v3 freeze digest) ==="
python3 - "$BASE/run-skill-onoff-eval.sh" "$BASE/prereg/FROZEN.json" << 'PY' || fail "shared runner digest"
import hashlib, json, sys
digest = hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest()
want = json.load(open(sys.argv[2]))["dcard-v3"]["files"]["run-skill-onoff-eval.sh"]
if digest != want: raise SystemExit(f"shared runner {digest} != dcard-v3 freeze {want}")
PY
if ! git -C "$REPO_ROOT" diff --quiet 788f92268 -- evals/skill-onoff/run-skill-onoff-eval.sh evals/skill-onoff/run-skill-onoff-matrix.sh 2>/dev/null; then
  git -C "$REPO_ROOT" cat-file -e 788f92268 2>/dev/null && fail "shared runner/matrix differ from 788f92268"
fi

echo "=== runner copy differs from the gdorm copy only in names and comments ==="
diff <(sed 's/gdorm/bpack/g' "$BASE/run-skill-onoff-matrix-gdorm.sh") "$BASE/run-skill-onoff-matrix-bpack.sh" > /dev/null || fail "matrix-bpack drifted from matrix-gdorm"
d=$(diff <(grep -v '^[[:space:]]*#' "$BASE/run-skill-onoff-eval-gdorm.sh") <(grep -v '^[[:space:]]*#' "$BASE/run-skill-onoff-eval-bpack.sh")) || true
[ -z "$d" ] || fail "eval-bpack code differs from eval-gdorm: $d"
grep -q 'run-skill-onoff-eval-bpack.sh' "$BASE/run-skill-onoff-matrix-bpack.sh" || fail "matrix-bpack does not call eval-bpack"

# ---- sections below need Hand B's files ----
B_ALL=1
for f in prereg/bpack.json arms/bpack/base.json arms/bpack/change.json lib-bpack/bpack-markers.sh tasks/bpack-revoked/markers.sh tasks/bpack-tree/markers.sh; do
  [ -f "$BASE/$f" ] || B_ALL=0
done

MARKCWD="$TEST_TMP/markcwd"
mkdir -p "$MARKCWD"
write_tx() { # $1 command -> jsonl path
  local f="$TEST_TMP/tx-$RANDOM-$$.jsonl"
  python3 - "$f" "$1" << 'PY'
import json, sys
ev = {"message": {"content": [{"type": "tool_use", "name": "Bash", "input": {"command": sys.argv[2]}}]}}
open(sys.argv[1], "w").write(json.dumps(ev) + "\n")
PY
  printf '%s\n' "$f"
}
mark_of() { # $1 task $2 transcript $3 marker -> true|false|<empty when the marker line is absent>
  local out
  out=$(
    cd "$MARKCWD" && \
    env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID \
      HOME="$HOME" TRANSCRIPT="$2" QUERY="$BASE/lib/transcript-query.js" FROZEN_BASE_SHA=none \
      ONOFF_LIB="$BASE/lib-bpack" ONOFF_OUT="$TEST_TMP/no-such-out" \
      ONOFF_CELL_HOME="$TEST_TMP/no-such-home" \
      bash "$BASE/tasks/$1/markers.sh" < /dev/null
  ) || fail "markers.sh $1 exited $?"
  printf '%s\n' "$out" | sed -n "s/^marker_${3}=//p"
}
expect_mark() { # $1 task $2 command $3 marker $4 true|false
  local got
  got=$(mark_of "$1" "$(write_tx "$2")" "$3")
  [ "$got" = "$4" ] || fail "marker $3 for [$2]: got ${got:-<absent>} want $4"
}

echo "=== negative control (design 5.3): reading dispatch-tree.js is not running it ==="
if [ -f "$BASE/tasks/bpack-tree/markers.sh" ] && [ -f "$BASE/lib-bpack/bpack-markers.sh" ]; then
  expect_mark bpack-tree 'cat scripts/dispatch-tree.js' t_tree_run false
  expect_mark bpack-tree 'grep -n tree scripts/dispatch-tree.js' t_tree_run false
  expect_mark bpack-tree 'head -40 scripts/dispatch-tree.js' t_tree_run false
  expect_mark bpack-tree 'ls scripts/dispatch-tree.js' t_tree_run false
  expect_mark bpack-tree 'cat scripts/dispatch-tree.js | grep tree' t_tree_run false
  expect_mark bpack-tree "$(printf '%s\n' "cat > run.sh << 'EOF'" "node scripts/dispatch-tree.js" "EOF")" t_tree_run false
  expect_mark bpack-tree 'node scripts/dispatch-tree.js' t_tree_run true
  expect_mark bpack-tree 'node scripts/dispatch-tree.js --session s1' t_tree_run true
else skip "tasks/bpack-tree/markers.sh or lib-bpack/bpack-markers.sh"; fi

echo "=== negative control (design 5.4): T3 marker must come from lib-bpack, else the column is red ==="
if [ -f "$BASE/lib-bpack/bpack-markers.sh" ] && [ -f "$BASE/tasks/dcard-owner-decision/markers.sh" ]; then
  got=$(mark_of dcard-owner-decision "$(write_tx 'echo nothing')" a_decision_file)
  [ "$got" = false ] || fail "a_decision_file with an empty cell: got ${got:-<absent: lib-bpack did not load the dcard markers>} want false"
  got=$(mark_of dcard-owner-decision "$(write_tx 'echo nothing')" a_work)
  [ -n "$got" ] || fail "lib-bpack does not emit the dcard marker set (a_work absent)"
else skip "lib-bpack/bpack-markers.sh (T3 dcard markers)"; fi
# The scorer half of 5.4 (absent or never-true marker => red) ran above on stub rows.

echo "=== real prereg / arms / stub grid ==="
if [ "$B_ALL" = 1 ]; then
  chk=$(clean node "$BASE/run-bpack-campaign.js" --check-arms < /dev/null) || fail "check-arms exit $?: $chk"
  python3 -c 'import json,sys; assert json.loads(sys.argv[1])["ok"] is True' "$chk" || fail "check-arms body: $chk"
  echo "--- check-arms: fixture-prompt packs may differ by exactly one REVOKED: line ---"
  mutate_prompt() { # $1 name $2 python expr on lines list 'L' (change prompt) -> prints packs dir
    local d="$TEST_TMP/packs-$1"
    rm -rf "$d"; cp -a "$BASE/packs" "$d"
    python3 - "$d" "$2" << 'PY'
import hashlib, json, sys
d, expr = sys.argv[1], sys.argv[2]
rel = "fixture-prompt-bpack-change/REVIEW_PROMPT.md"
L = open(f"{d}/{rel}").read().split("\n")
L = eval(expr)
data = "\n".join(L).encode()
open(f"{d}/{rel}", "wb").write(data)
m = json.load(open(f"{d}/manifest.json"))
m["packs"]["fixture-prompt-bpack-change"][rel] = hashlib.sha256(data).hexdigest()
json.dump(m, open(f"{d}/manifest.json", "w"), indent=2)
PY
    printf '%s\n' "$d"
  }
  chk_ok=$(clean node "$BASE/run-bpack-campaign.js" --check-arms < /dev/null) || fail "unmodified check-arms must be ok: $chk_ok"
  P1=$(mutate_prompt extra-line 'L[:20] + ["- an extra unrelated instruction line"] + L[20:]')
  out=$(clean ONOFF_PACKS_DIR="$P1" node "$BASE/run-bpack-campaign.js" --check-arms < /dev/null 2>&1) && fail "one extra line in the change prompt must make --check-arms red: $out"
  grep -q 'differs beyond one added REVOKED' <<<"$out" || fail "extra-line message: $out"
  P2=$(mutate_prompt edited-line 'L[:3] + [L[3] + " tweak"] + L[4:]')
  out=$(clean ONOFF_PACKS_DIR="$P2" node "$BASE/run-bpack-campaign.js" --check-arms < /dev/null 2>&1) && fail "an edited line in the change prompt must make --check-arms red: $out"
  P3=$(mutate_prompt no-revoked '[x for x in L if "REVOKED:" not in x]')
  out=$(clean ONOFF_PACKS_DIR="$P3" node "$BASE/run-bpack-campaign.js" --check-arms < /dev/null 2>&1) && fail "identical prompts (no REVOKED line) must make --check-arms red: $out"
  P4="$TEST_TMP/arms-extra-fixture"; rm -rf "$P4"; cp -a "$BASE/arms/bpack" "$P4"
  python3 - "$P4/change.json" << 'PY'
import json, sys
j = json.load(open(sys.argv[1])); j["fixture_scripts"].append("fixture-scripts-bpack"); j["fixture_scripts"].reverse()
json.dump(j, open(sys.argv[1], "w"))
PY
  out=$(clean node "$BASE/run-bpack-campaign.js" --check-arms --arms-dir "$P4" < /dev/null 2>&1) && fail "a fixture_scripts difference outside the prompt packs must be red: $out"
  PACKS="$TEST_TMP/packs-mut"
  rm -rf "$PACKS"; cp -a "$BASE/packs" "$PACKS"
  python3 - "$BASE/arms/bpack/base.json" "$PACKS" << 'PY'
import json, sys
arm = json.load(open(sys.argv[1]))
pid = arm["skills"]["ceo-agent"]
open(sys.argv[2] + "/" + pid + "/SKILL.md", "ab").write(b"\n")
PY
  clean ONOFF_PACKS_DIR="$PACKS" node "$BASE/run-bpack-campaign.js" --check-arms < /dev/null >/dev/null 2>&1 \
    && fail "a mutated pack should make --check-arms non-zero"
  d30=$(clean node "$BASE/run-bpack-campaign.js" --results "$TEST_TMP/real30.jsonl" --dry-run < /dev/null) || fail "real-prereg dry-run exit $?"
  python3 -c 'import json,sys; j=json.loads([l for l in sys.argv[1].splitlines() if l.startswith("{")][-1]); assert j["cells_total"]==30 and abs(j["cost_estimate_usd"]-6.80)<1e-9, j' "$d30" || fail "real dry-run: $d30"
  rc=0; out=$(clean node "$BASE/score-bpack.js" --prereg "$BASE/prereg/bpack.json" --results "$TEST_TMP/pass.jsonl" 2>&1 < /dev/null) || rc=$?
  [ "$rc" = 0 ] || fail "real prereg thresholds reject the passing stub grid: rc=$rc $out"
  rc=0; out=$(clean node "$BASE/score-bpack.js" --prereg "$BASE/prereg/bpack.json" --results "$TEST_TMP/t1-base-high.jsonl" 2>&1 < /dev/null) || rc=$?
  [ "$rc" = 3 ] || fail "real prereg accepts a T1 base of 2/5: rc=$rc $out"
  clean node "$BASE/stamp-prereg.js" --row bpack --check >/dev/null 2>&1 || echo "note: stamp --check not ok yet (stamping is depth-0's step)"
else skip "prereg/arms/lib-bpack/tasks (real-prereg checks)"; fi

if [ "$SKIPS" -gt 0 ] && [ "${BPACK_REQUIRE_B:-0}" = 1 ]; then fail "$SKIPS section(s) skipped but BPACK_REQUIRE_B=1"; fi
[ "$SKIPS" -eq 0 ] || echo "note: $SKIPS section(s) skipped because Hand B's files are absent (set BPACK_REQUIRE_B=1 after merging)"
echo "bpack stub tests passed"
