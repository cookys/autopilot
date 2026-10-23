#!/usr/bin/env bash
# hooks/tests/skill-onoff-dcard-v3.test.sh — dcard-v3 instrument (stub runner only).
# Pre-turn-2 snapshot for a_decision_file, turn2_exit, campaign dry-run, stamp.
# RED-first: run once against the unmodified tree before the v3 instrument existed.
# RED at 914a86f5b: FAIL: v3 order cell exit 2 (arm manifest arms/dcard-v3/base.json not found).
# RED at 10d849caf: FAIL: dry-run json (no max_usd / spent_usd; nohook sha256 and dcard-hooks-empty pack stamp absent; spend cap not enforced).
set -uo pipefail
. "$(dirname "$0")/lib.sh"
unset GIT_ALLOW_PROTOCOL
export GIT_CONFIG_COUNT=0
export HOME="$TEST_TMP/home"
mkdir -p "$HOME"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE="$REPO_ROOT/evals/skill-onoff"
TASK=dcard-owner-decision
fail() { echo "FAIL: $*" >&2; exit 1; }

cell() { # $1 outdir, remaining args to run-skill-onoff-eval.sh; env already set by caller
  local out="$1"
  shift
  env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID \
    HOME="$HOME" \
    bash "$BASE/run-skill-onoff-eval.sh" "$@" --out "$out" < /dev/null > "$out.stdout"
}

echo "=== ordering: v3 snapshot sees the complete card, frozen post-turn-2 read does not ==="
STUB="$TEST_TMP/stub-order.sh"
cat > "$STUB" << 'EOS'
#!/usr/bin/env bash
printf '%s\n' '{"type":"system","subtype":"init","session_id":"sess-v3-order"}'
TURN="${ONOFF_TURN:-1}"
if [ "$TURN" = 1 ]; then
  node scripts/open-decision.js open --question "Replace origin main history?" \
    --option "Force rewrite origin main::no" \
    --option "Push a new branch::yes" \
    --recommendation "Push a new branch" \
    --why "the owner has not authorized a rewrite" >/dev/null
  printf '%s\n' '{"message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"node scripts/open-decision.js open --question q"}}]}}'
else
  prompt=$(cat "$1")
  id=$(printf '%s\n' "$prompt" | awk 'NR==2{split($0,a,"｜"); print a[1]}')
  node scripts/open-decision.js close --id "$id" >/dev/null || true
  printf '%s\n' "{\"message\":{\"content\":[{\"type\":\"tool_use\",\"name\":\"Bash\",\"input\":{\"command\":\"node scripts/open-decision.js close --id $id\"}}]}}"
fi
printf '%s\n' '{"type":"result","is_error":false}'
EOS
chmod +x "$STUB"
OUTV3="$TEST_TMP/out-order-v3"
ONOFF_STUB_BIN="$STUB" ONOFF_LIB_OVERRIDE="$BASE/lib-dcard-v3" \
  cell "$OUTV3" --task "$TASK" --arm-manifest "$BASE/arms/dcard-v3/base.json" --model sonnet --runner stub --rep 1 \
  || fail "v3 order cell exit $?"
python3 - "$OUTV3/result.json" << 'PY' || fail "v3 a_decision_file"
import json,sys
r=json.load(open(sys.argv[1]))
if r["markers"].get("a_decision_file") is not True: raise SystemExit(r["markers"])
if r.get("turn2") != "ran": raise SystemExit(r.get("turn2"))
if r.get("turn2_exit") != 0: raise SystemExit(r.get("turn2_exit"))
if r.get("failure_class") not in (None,): raise SystemExit(r.get("failure_cause"))
PY
[ -d "$OUTV3/decisions-pre-turn2/live" ] && [ -d "$OUTV3/decisions-pre-turn2/git" ] || fail "snapshot dirs missing"
OUTOLD="$TEST_TMP/out-order-old"
ONOFF_STUB_BIN="$STUB" ONOFF_LIB_OVERRIDE="$BASE/lib-dcard" \
  cell "$OUTOLD" --task "$TASK" --arm-manifest "$BASE/arms/dcard/base.json" --model sonnet --runner stub --rep 1 \
  || fail "frozen order cell exit $?"
python3 - "$OUTOLD/result.json" << 'PY' || fail "frozen a_decision_file should be false"
import json,sys
r=json.load(open(sys.argv[1]))
if r["markers"].get("a_decision_file") is not False: raise SystemExit(r["markers"])
PY

echo "=== bare card: v3 a_decision_file false ==="
BARE="$TEST_TMP/stub-bare.sh"
cat > "$BARE" << 'EOS'
#!/usr/bin/env bash
printf '%s\n' '{"type":"system","subtype":"init","session_id":"sess-v3-bare"}'
if [ "${ONOFF_TURN:-1}" = 1 ]; then
  cat > "$AUTOPILOT_LIVE_DIR/owner-decision.json" << 'JSON'
{"id":"bare-v3","question":"May I force-push origin main?"}
JSON
fi
printf '%s\n' '{"type":"result","is_error":false}'
EOS
chmod +x "$BARE"
OUTB="$TEST_TMP/out-bare"
ONOFF_STUB_BIN="$BARE" ONOFF_LIB_OVERRIDE="$BASE/lib-dcard-v3" \
  cell "$OUTB" --task "$TASK" --arm-manifest "$BASE/arms/dcard-v3/base.json" --model sonnet --runner stub --rep 1 \
  || fail "bare cell exit $?"
python3 - "$OUTB/result.json" << 'PY' || fail "bare a_decision_file"
import json,sys
r=json.load(open(sys.argv[1]))
if r["markers"].get("a_decision_file") is not False: raise SystemExit(r["markers"])
PY

echo "=== turn2_exit ==="
TROOT="$TEST_TMP/tasks-root"
mkdir -p "$TROOT"
cp -a "$BASE/tasks/$TASK" "$TROOT/$TASK"
printf '%s\n' '#!/usr/bin/env bash' 'exit 7' > "$TROOT/$TASK/turn2.sh"
chmod +x "$TROOT/$TASK/turn2.sh"
QUIET="$TEST_TMP/stub-quiet.sh"
printf '%s\n' '#!/bin/sh' 'printf "%s\n" "{\"type\":\"result\",\"is_error\":false}"' > "$QUIET"
chmod +x "$QUIET"
OUTE="$TEST_TMP/out-exit7"
ONOFF_STUB_BIN="$QUIET" ONOFF_TASKS_DIR="$TROOT" ONOFF_LIB_OVERRIDE="$BASE/lib-dcard-v3" \
  cell "$OUTE" --task "$TASK" --arm off --model sonnet --runner stub --rep 1 \
  || fail "exit7 cell exit $?"
python3 - "$OUTE/result.json" << 'PY' || fail "turn2_exit 7"
import json,sys
r=json.load(open(sys.argv[1]))
if r.get("turn2_exit") != 7: raise SystemExit(r.get("turn2_exit"))
if r.get("turn2") != "ran": raise SystemExit(r.get("turn2"))
PY
OUTC="$TEST_TMP/out-exit0"
ONOFF_STUB_BIN="$QUIET" ONOFF_LIB_OVERRIDE="$BASE/lib-dcard-v3" \
  cell "$OUTC" --task "$TASK" --arm-manifest "$BASE/arms/dcard-v3/nohook.json" --model sonnet --runner stub --rep 1 \
  || fail "clean turn2 cell exit $?"
python3 - "$OUTC/result.json" << 'PY' || fail "turn2_exit 0"
import json,sys
r=json.load(open(sys.argv[1]))
if r.get("turn2") != "skipped_no_card": raise SystemExit(r.get("turn2"))
if r.get("turn2_exit") != 0: raise SystemExit(r.get("turn2_exit"))
PY
# Golden row is the pre-change harness (parent of 60354af8e, the dcard-v3 harness change; blob df37607af), same clock and identity as this run.
# (Pinned previously to 914a86f5b, a clone-local PARALLEL-RUN shadow commit that is not in develop history, so the object was missing everywhere else.)
EVAL_SH="$BASE/run-skill-onoff-eval.sh"
cp "$EVAL_SH" "$TEST_TMP/eval.new"
restore_eval() { cp "$TEST_TMP/eval.new" "$EVAL_SH"; }
trap restore_eval EXIT
git show 60354af8e^:evals/skill-onoff/run-skill-onoff-eval.sh > "$EVAL_SH"
OUTG="$TEST_TMP/out-noturn2-golden"
GIT_AUTHOR_DATE='2020-01-01T00:00:00Z' GIT_COMMITTER_DATE='2020-01-01T00:00:00Z' \
  ONOFF_STUB_BIN="$QUIET" \
  cell "$OUTG" --task d1-s-tiny-feature --arm off --model m --runner stub --rep 1 \
  || fail "golden no-turn2 cell exit $?"
restore_eval
trap - EXIT
OUTN="$TEST_TMP/out-noturn2"
GIT_AUTHOR_DATE='2020-01-01T00:00:00Z' GIT_COMMITTER_DATE='2020-01-01T00:00:00Z' \
  ONOFF_STUB_BIN="$QUIET" \
  cell "$OUTN" --task d1-s-tiny-feature --arm off --model m --runner stub --rep 1 \
  || fail "no-turn2 cell exit $?"
python3 - "$OUTG/result.json" "$OUTN/result.json" << 'PY' || fail "no-turn2 row bytes"
import json,re,sys
def norm(p):
    raw=open(p).read().strip()
    r=json.loads(raw)
    if "turn2_exit" in r or "turn2" in r: raise SystemExit("turn2 field leaked: "+raw)
    return re.sub(r'"duration_s":\d+','"duration_s":0', raw)
g, n = norm(sys.argv[1]), norm(sys.argv[2])
if g != n: raise SystemExit("golden:\n"+g+"\nnow:\n"+n)
PY

echo "=== snapshot missing: a_decision_file false ==="
LIVE=$(mktemp -d -p "$TEST_TMP" live-XXXX)
printf '%s\n' '{"id":"d1","question":"q","options":["a","b"],"recommendation":"a","why":"w"}' > "$LIVE/owner-decision.json"
REPO=$(mktemp -d -p "$TEST_TMP" repo-XXXX)
git -C "$REPO" init -q
git -C "$REPO" config user.email t@t
git -C "$REPO" config user.name T
git -C "$REPO" config commit.gpgsign false
git -C "$REPO" commit -q --allow-empty -m init --no-verify
: > "$TEST_TMP/empty.jsonl"
out=$(cd "$REPO" && HOME="$HOME" TRANSCRIPT="$TEST_TMP/empty.jsonl" FROZEN_BASE_SHA="$(git rev-parse HEAD)" \
  QUERY="$BASE/lib/transcript-query.js" AUTOPILOT_LIVE_DIR="$LIVE" DCARD_TURN2=ran \
  ONOFF_LIB="$BASE/lib-dcard-v3" bash "$BASE/tasks/$TASK/markers.sh") || fail "markers with unset snapshot exit $?"
grep -q '^marker_a_decision_file=false$' <<<"$out" || fail "unset snapshot was not false: $out"
grep -q '^marker_m_hook_card=' <<<"$out" || fail "markers did not emit m_hook_card"
MISS="$TEST_TMP/no-such-snapshot"
out2=$(cd "$REPO" && HOME="$HOME" TRANSCRIPT="$TEST_TMP/empty.jsonl" FROZEN_BASE_SHA="$(git rev-parse HEAD)" \
  QUERY="$BASE/lib/transcript-query.js" AUTOPILOT_LIVE_DIR="$LIVE" DCARD_TURN2=ran \
  DCARD_DECISIONS_PRE_TURN2="$MISS" ONOFF_LIB="$BASE/lib-dcard-v3" bash "$BASE/tasks/$TASK/markers.sh") || fail "missing dir markers exit"
grep -q '^marker_a_decision_file=false$' <<<"$out2" || fail "missing snapshot dir was not false: $out2"

echo "=== a2-within-doa still runs through lib-dcard-v3 ==="
OUTA="$TEST_TMP/out-a2"
ONOFF_STUB_BIN="$QUIET" ONOFF_LIB_OVERRIDE="$BASE/lib-dcard-v3" \
  cell "$OUTA" --task a2-within-doa --arm off --model sonnet --runner stub --rep 1 \
  || fail "a2 cell exit $?"
python3 - "$OUTA/result.json" << 'PY' || fail "a2 markers"
import json,sys
r=json.load(open(sys.argv[1]))
if r.get("failure_class") not in (None,): raise SystemExit(r.get("failure_cause"))
if "a_overtrigger" not in r["markers"]: raise SystemExit(r["markers"])
if r["markers"]["a_overtrigger"] is not False: raise SystemExit(r["markers"])
PY

echo "=== campaign check-arms, dry-run, stamp ==="
chk=$(node "$BASE/run-dcard-v3-campaign.js" --check-arms) || fail "check-arms exit $?"
python3 -c 'import json,sys; r=json.loads(sys.argv[1]); assert r["ok"] and len(r["differing"])==12' "$chk" || fail "check-arms body: $chk"
MUT="$TEST_TMP/arms-mut"
cp -a "$BASE/arms/dcard-v3" "$MUT"
python3 - "$MUT/change.json" << 'PY'
import json,sys
p=sys.argv[1]
j=json.load(open(p))
j["skills"]=json.load(open(p.replace("change.json","base.json")))["skills"]
j["files"]=json.load(open(p.replace("change.json","base.json")))["files"]
json.dump(j, open(p,"w"), indent=2)
open(p,"a").write("\n")
PY
if node "$BASE/run-dcard-v3-campaign.js" --check-arms --arms-dir "$MUT" >/dev/null 2>"$TEST_TMP/mut.err"; then
  fail "check-arms accepted a mutated arms dir"
fi
DRY="$TEST_TMP/dcard-v3-dry.jsonl"
dry=$(node "$BASE/run-dcard-v3-campaign.js" --dry-run --results "$DRY" --runner stub) || fail "dry-run exit $?"
n=$(printf '%s\n' "$dry" | grep -c '^todo ')
[ "$n" -eq 35 ] || fail "dry-run listed $n cells, want 35"
printf '%s\n' "$dry" > "$TEST_TMP/dry.txt"
python3 - "$TEST_TMP/dry.txt" << 'PY' || fail "dry-run json"
import json,sys
line=[l for l in open(sys.argv[1]).read().splitlines() if l.startswith("{")][-1]
j=json.loads(line)
if j.get("cells_total")!=35: raise SystemExit(j)
if not isinstance(j.get("cost_estimate_usd"), (int,float)) or j["cost_estimate_usd"]>7: raise SystemExit(j)
if "cost_basis" not in j: raise SystemExit(j)
if j.get("max_usd")!=7: raise SystemExit(j)
if j.get("spent_usd")!=0: raise SystemExit(j)
PY
node "$BASE/stamp-prereg.js" --row dcard-v3 --check >/dev/null || fail "stamp dcard-v3 --check"
node "$BASE/stamp-prereg.js" --row dcard --check >/dev/null || fail "stamp dcard --check"
node "$BASE/stamp-prereg.js" --row dcard-v2 --check >/dev/null || fail "stamp dcard-v2 --check"
SROOT="$TEST_TMP/stamp-root"
rm -rf "$SROOT"
cp -a "$BASE/." "$SROOT/"
printf 'x' >> "$SROOT/lib/dcard-v3-markers.sh"
if node "$BASE/stamp-prereg.js" --row dcard-v3 --root "$SROOT" --check >/dev/null 2>"$TEST_TMP/stamp-mut.err"; then
  fail "stamp --check accepted a mutated marker library"
fi
grep -q 'digest mismatch' "$TEST_TMP/stamp-mut.err" || fail "marker mutation did not report digest mismatch: $(cat "$TEST_TMP/stamp-mut.err")"
SROOT2="$TEST_TMP/stamp-root-prereg"
rm -rf "$SROOT2"
cp -a "$BASE/." "$SROOT2/"
printf ' ' >> "$SROOT2/prereg/dcard-v3.json"
if node "$BASE/stamp-prereg.js" --row dcard-v3 --root "$SROOT2" --check >/dev/null 2>"$TEST_TMP/stamp-prereg.err"; then
  fail "stamp --check accepted a mutated prereg"
fi
grep -q 'digest mismatch' "$TEST_TMP/stamp-prereg.err" || fail "prereg mutation did not report digest mismatch"
SROOT3="$TEST_TMP/stamp-root-nohook"
rm -rf "$SROOT3"
cp -a "$BASE/." "$SROOT3/"
python3 - "$SROOT3/arms/dcard-v3/nohook.json" << 'PY'
import pathlib,sys
p=pathlib.Path(sys.argv[1])
t=p.read_text()
p.write_text(t.replace('"nohook"','"nohooK"',1))
PY
if node "$BASE/stamp-prereg.js" --row dcard-v3 --root "$SROOT3" --check >/dev/null 2>"$TEST_TMP/stamp-nohook.err"; then
  fail "stamp --check accepted a mutated nohook manifest"
fi
grep -q 'digest mismatch' "$TEST_TMP/stamp-nohook.err" || fail "nohook mutation did not report digest mismatch: $(cat "$TEST_TMP/stamp-nohook.err")"
SROOT4="$TEST_TMP/stamp-root-empty-pack"
rm -rf "$SROOT4"
cp -a "$BASE/." "$SROOT4/"
python3 - "$SROOT4/packs/manifest.json" << 'PY'
import json,sys
p=sys.argv[1]
m=json.load(open(p))
k=next(iter(m["packs"]["dcard-hooks-empty"]))
m["packs"]["dcard-hooks-empty"][k]=m["packs"]["dcard-hooks-empty"][k][:-1]+("0" if m["packs"]["dcard-hooks-empty"][k][-1]!="0" else "1")
json.dump(m, open(p,"w"))
PY
if node "$BASE/stamp-prereg.js" --row dcard-v3 --root "$SROOT4" --check >/dev/null 2>"$TEST_TMP/stamp-pack.err"; then
  fail "stamp --check accepted a mutated empty hook pack"
fi
grep -q 'digest mismatch' "$TEST_TMP/stamp-pack.err" || fail "empty pack mutation did not report digest mismatch: $(cat "$TEST_TMP/stamp-pack.err")"
python3 - "$BASE/prereg/dcard-v3.json" "$BASE/prereg/FROZEN.json" << 'PY' || fail "nohook stamp record"
import json,sys,hashlib
pre=json.load(open(sys.argv[1]))
fr=json.load(open(sys.argv[2]))["dcard-v3"]
nh=pre["arm_manifests"]["nohook"]
if "sha256" not in nh or len(nh["sha256"])!=64: raise SystemExit("nohook sha missing")
digest=hashlib.sha256(open(sys.argv[1].rsplit("/prereg/",1)[0]+"/"+nh["file"],"rb").read()).hexdigest()
if nh["sha256"]!=digest: raise SystemExit("nohook sha mismatch")
if "dcard-hooks-empty" not in pre["freeze_packs"]: raise SystemExit("freeze_packs")
if "dcard-hooks-empty" not in fr.get("packs",{}): raise SystemExit("frozen pack")
if "arms/dcard-v3/nohook.json" not in fr["files"]: raise SystemExit("frozen file")
PY
# scorer accepts the v3 prereg (exit is a verdict, not a usage error)
SRES="$TEST_TMP/v3-score.jsonl"
: > "$SRES"
set +e
node "$BASE/score-dcard.js" --prereg "$BASE/prereg/dcard-v3.json" --results "$SRES" >"$TEST_TMP/score.out" 2>"$TEST_TMP/score.err"
src=$?
set -e
[ "$src" -ne 2 ] || fail "scorer rejected v3 prereg: $(cat "$TEST_TMP/score.err")"

echo "=== spend cap: refuse before the next group, allow when the cap is higher ==="
# 16 failed attempt rows * 0.20 = 3.20, just under the 7.00 cap. The first group is
# 20 cells * 0.20 = 4.00, so 3.20 + 4.00 exceeds 7.00 and nothing may be dispatched.
CAPF="$TEST_TMP/cap-seed.jsonl"
python3 - "$CAPF" << 'PY'
import json,sys
rows=[]
for i in range(15):
    rows.append({"row":"dcard-v3","task_id":"seed","arm":"base","rep":i,"failure_class":"infra_fail"})
rows.append({"row":"dcard-v3","task_id":"seed","arm":"change","rep":99,"failure_class":"marker_fail"})
open(sys.argv[1],"w").write("".join(json.dumps(r)+"\n" for r in rows))
PY
cp "$CAPF" "$TEST_TMP/cap-before.jsonl"
set +e
env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID HOME="$HOME" \
  node "$BASE/run-dcard-v3-campaign.js" --results "$CAPF" --runner stub \
  >"$TEST_TMP/cap.out" 2>"$TEST_TMP/cap.err"
cap_rc=$?
set -e
[ "$cap_rc" -ne 0 ] || fail "spend cap dispatched anyway"
grep -q 'spent' "$TEST_TMP/cap.err" || fail "cap reason missing spent: $(cat "$TEST_TMP/cap.err")"
grep -q 'cap' "$TEST_TMP/cap.err" || fail "cap reason missing cap: $(cat "$TEST_TMP/cap.err")"
cmp -s "$CAPF" "$TEST_TMP/cap-before.jsonl" || fail "refused campaign wrote result rows"
# Same seed priced by an actual cost field: one row of 6.90 must refuse a 4.00 group under the 7.00 cap.
ACT="$TEST_TMP/cap-actual.jsonl"
python3 - "$ACT" << 'PY'
import json,sys
row={"row":"dcard-v3","task_id":"seed","arm":"base","rep":1,"failure_class":"infra_fail","cost_usd":6.9}
open(sys.argv[1],"w").write(json.dumps(row)+"\n")
PY
cp "$ACT" "$TEST_TMP/cap-actual-before.jsonl"
set +e
env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID HOME="$HOME" \
  node "$BASE/run-dcard-v3-campaign.js" --results "$ACT" --runner stub \
  >"$TEST_TMP/cap-actual.out" 2>"$TEST_TMP/cap-actual.err"
act_rc=$?
set -e
[ "$act_rc" -ne 0 ] || fail "actual cost_usd was not priced (campaign dispatched)"
cmp -s "$ACT" "$TEST_TMP/cap-actual-before.jsonl" || fail "actual-cost refusal wrote rows"
# usage.cost is an actual value too.
USE="$TEST_TMP/cap-usage.jsonl"
python3 - "$USE" << 'PY'
import json,sys
row={"row":"dcard-v3","task_id":"seed","arm":"base","rep":1,"failure_class":"infra_fail","usage":{"cost":6.5}}
open(sys.argv[1],"w").write(json.dumps(row)+"\n")
PY
set +e
env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID HOME="$HOME" \
  node "$BASE/run-dcard-v3-campaign.js" --results "$USE" --runner stub \
  >"$TEST_TMP/cap-usage.out" 2>"$TEST_TMP/cap-usage.err"
use_rc=$?
set -e
[ "$use_rc" -ne 0 ] || fail "usage.cost was not priced"
# A non-positive cap is a usage error and writes nothing.
BAD="$TEST_TMP/cap-bad.jsonl"
: > "$BAD"
set +e
env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID HOME="$HOME" ONOFF_MAX_USD=0 \
  node "$BASE/run-dcard-v3-campaign.js" --results "$BAD" --runner stub \
  >"$TEST_TMP/cap-bad.out" 2>"$TEST_TMP/cap-bad.err"
bad_rc=$?
set -e
[ "$bad_rc" -ne 0 ] || fail "ONOFF_MAX_USD=0 was accepted"
grep -q 'ONOFF_MAX_USD' "$TEST_TMP/cap-bad.err" || fail "bad cap did not say ONOFF_MAX_USD: $(cat "$TEST_TMP/cap-bad.err")"
[ ! -s "$BAD" ] || fail "bad cap wrote a results file"
set +e
env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID HOME="$HOME" ONOFF_MAX_USD=abc \
  node "$BASE/run-dcard-v3-campaign.js" --dry-run --results "$TEST_TMP/cap-nan.jsonl" --runner stub \
  >"$TEST_TMP/cap-nan.out" 2>"$TEST_TMP/cap-nan.err"
nan_rc=$?
set -e
[ "$nan_rc" -ne 0 ] || fail "ONOFF_MAX_USD=abc was accepted"
# Negative control: the same 3.20 seed under a high cap dispatches the stub.
ALLOW="$TEST_TMP/cap-allow.jsonl"
cp "$TEST_TMP/cap-before.jsonl" "$ALLOW"
allow_before=$(wc -c < "$ALLOW")
set +e
env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID HOME="$HOME" ONOFF_MAX_USD=100 \
  ONOFF_STUB_BIN="$QUIET" \
  node "$BASE/run-dcard-v3-campaign.js" --results "$ALLOW" --runner stub \
  >"$TEST_TMP/cap-allow.out" 2>"$TEST_TMP/cap-allow.err"
allow_rc=$?
set -e
grep -q 'spend cap' "$TEST_TMP/cap-allow.err" && fail "high cap still refused: $(cat "$TEST_TMP/cap-allow.err")"
allow_after=$(wc -c < "$ALLOW")
[ "$allow_after" -gt "$allow_before" ] || fail "high cap did not dispatch (results unchanged, rc=$allow_rc)"

echo "PASS skill-onoff-dcard-v3"
