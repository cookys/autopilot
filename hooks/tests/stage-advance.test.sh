#!/usr/bin/env bash
# hooks/tests/stage-advance.test.sh — session-mode.js `set --size ...` init + scripts/stage-advance.js
# (plan docs/plans/2026-10-06-dev-flow-stage-graph.md section 2.9, phase P2a).
#
# Covers: the full legal walk of every expected.json cell (84), init create / merge / upward-only,
# exit codes 2/3/4/5, the unit rules, high_risk sampling (injected classify/resolve stubs) and the five
# E1 bump walks to finish. Temp repos + a temp AUTOPILOT_SESSION_MODE_DIR; the real ~/.autopilot is never touched.

set -uo pipefail
# git env hygiene + scratch-dir ceilings only (this suite keeps its own TEST_TMP/trap).
AUTOPILOT_TEST_LIB_HELPERS_ONLY=1 . "$(dirname "$0")/lib.sh"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SA="$REPO_ROOT/scripts/stage-advance.js"
SM="$REPO_ROOT/scripts/session-mode.js"
SG="$REPO_ROOT/scripts/stage-graph.js"
FIXTURE="$REPO_ROOT/hooks/tests/fixtures/stage-graph/expected.json"
TEST_TMP=$(mktemp -d -t "stage-advance-test-XXXXXX")
trap 'rm -rf "$TEST_TMP"' EXIT
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "ok: $*"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $*" >&2; }
eq() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1: expected [$2] got [$3]"; fi; }
has() { case "$3" in *"$2"*) ok "$1" ;; *) bad "$1: [$3] lacks [$2]" ;; esac; }

# Environment hygiene: no inherited git plumbing vars, no watcher, sandboxed HOME + marker dir.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID CODEX_THREAD_ID
export GIT_CEILING_DIRECTORIES="$TEST_TMP:/tmp"
export AUTOPILOT_RUNS_WATCH_AUTOSTART=0 AUTOPILOT_REVIEW_SERVER_AUTOSTART=0
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/markers"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
unset AUTOPILOT_ROOT_RUN_ID

# Injected sampling scripts: classify prints fixed risk_flags; resolve prints $STUB_RISK and logs its argv.
STUBS="$TEST_TMP/stubs"; mkdir -p "$STUBS"
cat >"$STUBS/classify.sh" <<'EOF'
#!/usr/bin/env bash
echo '{"risk_flags":{"source_trust":"high","diff_lines":4242,"protected_path":1,"oracle_available":0,"security_surface":1}}'
EOF
cat >"$STUBS/resolve.sh" <<'EOF'
#!/usr/bin/env bash
echo "$*" >>"$STUB_LOG"
[ "${STUB_RISK:-}" = "fail" ] && exit 9
echo "${STUB_RISK:-low}"
EOF
chmod +x "$STUBS/classify.sh" "$STUBS/resolve.sh"
export AUTOPILOT_STAGE_ADVANCE_CLASSIFY="$STUBS/classify.sh" AUTOPILOT_STAGE_ADVANCE_RESOLVE="$STUBS/resolve.sh"
export STUB_LOG="$TEST_TMP/stub.log"; : >"$STUB_LOG"
export STUB_RISK=low

mkrepo() { # dir [branch]
  mkdir -p "$1"; git init -q -b "${2:-develop}" "$1"
  git -C "$1" commit -q --allow-empty -m init
}
plant() { # repo nfiles nlines_each tag
  local r="$1" n="$2" l="$3" tag="${4:-p}" i
  for i in $(seq 1 "$n"); do
    : >"$r/${tag}_$i.txt"
    for _ in $(seq 1 "$l"); do echo line >>"$r/${tag}_$i.txt"; done
  done
  git -C "$r" add -A; git -C "$r" commit -q -m "plant $tag"
}
SESS_N=0
newsess() { SESS_N=$((SESS_N+1)); export AUTOPILOT_SESSION_ID="sa-test-$SESS_N"; MARKER="$AUTOPILOT_SESSION_MODE_DIR/$AUTOPILOT_SESSION_ID.json"; }
jf() { node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const v=process.argv[2].split(".").reduce((a,k)=>a==null?a:a[k],m);console.log(v===undefined?"<absent>":JSON.stringify(v))' "$MARKER" "$1"; }
sm() { node "$SM" "$@"; }
adv() { OUT=$(node "$SA" "$@" 2>"$TEST_TMP/err"); RC=$?; ERR=$(cat "$TEST_TMP/err"); }
schema_ok() { # name
  local v; v=$(node -e '
const { validateJsonSchema } = require(process.argv[1]);
const s = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
const m = JSON.parse(require("fs").readFileSync(process.argv[3], "utf8"));
const r = validateJsonSchema(s, m); console.log(r.valid ? "valid" : JSON.stringify(r.errors));
' "$REPO_ROOT/scripts/validate-json-schema.js" "$REPO_ROOT/schemas/session-marker.schema.json" "$MARKER")
  eq "$1 validates against session-marker.schema.json" "valid" "$v"
}

# ---------------------------------------------------------------- init: create / merge / upward-only
R="$TEST_TMP/r-init"; mkrepo "$R"; HEAD0=$(git -C "$R" rev-parse HEAD)
newsess
OUT=$(sm set --size M --repo-root "$R" 2>/dev/null); RC=$?
eq "init creates an absent marker (rc)" "0" "$RC"
eq "init: level null" "null" "$(jf level)"
eq "init: size" '"M"' "$(jf size)"
eq "init: urgent defaults false" "false" "$(jf urgent)"
eq "init: bug defaults false" "false" "$(jf bug)"
eq "init: base_ref defaults to merge-base HEAD develop" "\"$HEAD0\"" "$(jf base_ref)"
eq "init: stage absent until first write" "<absent>" "$(jf stage)"
schema_ok "fresh init marker"

sm set --size L --urgent --bug --repo-root "$R" >/dev/null 2>&1; RC=$?
eq "merge upward + --urgent --bug flags (rc)" "0" "$RC"
eq "merge: size L" '"L"' "$(jf size)"
eq "merge: urgent true (flag did not swallow --bug)" "true" "$(jf urgent)"
eq "merge: bug true" "true" "$(jf bug)"
eq "merge: base_ref preserved across the size change" "\"$HEAD0\"" "$(jf base_ref)"
BEFORE=$(cksum <"$MARKER")
OUT=$(sm set --size S --repo-root "$R" 2>"$TEST_TMP/err"); RC=$?
[ "$RC" -ne 0 ] && ok "downward --size refused (rc=$RC)" || bad "downward --size must exit non-zero"
has "downward refusal reason on stderr" "only moves up" "$(cat "$TEST_TMP/err")"
eq "downward refusal leaves the marker untouched" "$BEFORE" "$(cksum <"$MARKER")"
sm set --size L --repo-root "$R" >/dev/null 2>&1; eq "same size is a no-op merge (rc)" "0" "$?"
sm set --size XXL --repo-root "$R" >/dev/null 2>&1; eq "invalid --size exits 2" "2" "$?"
sm set --size XL --base-ref nothex --repo-root "$R" >/dev/null 2>&1; eq "invalid --base-ref exits 2" "2" "$?"
sm set --size XL --base-ref "$(printf 'a%.0s' $(seq 1 40))" --repo-root "$R" >/dev/null 2>&1
eq "explicit --base-ref overrides" "\"$(printf 'a%.0s' $(seq 1 40))\"" "$(jf base_ref)"

# level preserved on an existing l4 marker
R2="$TEST_TMP/r-level"; mkrepo "$R2"
newsess
sm set --level l4 --repo-root "$R2" >/dev/null 2>"$TEST_TMP/err"; RC=$?
eq "set --level l4 (rc)" "0" "$RC"
ROOT_BEFORE=$(jf root_run_id); STARTED_BEFORE=$(jf started_at)
sm set --size M --bug --repo-root "$R2" >/dev/null 2>&1; RC=$?
eq "merge into an existing l4 marker (rc)" "0" "$RC"
eq "merge preserves level" '"l4"' "$(jf level)"
eq "merge preserves root_run_id" "$ROOT_BEFORE" "$(jf root_run_id)"
eq "merge preserves started_at" "$STARTED_BEFORE" "$(jf started_at)"
eq "merge preserves entry_level/mission fields" "$(node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(m.entry_level===undefined?"<absent>":JSON.stringify(m.entry_level))' "$MARKER")" "$(jf entry_level)"
eq "merge: size M, bug true" '"M" true' "$(jf size) $(jf bug)"
schema_ok "merged l4 marker"

# base_ref null + stderr note when no default branch resolves
R3="$TEST_TMP/r-trunk"; mkrepo "$R3" trunk
newsess
sm set --size XS --repo-root "$R3" >/dev/null 2>"$TEST_TMP/err"
eq "no default branch: base_ref null" "null" "$(jf base_ref)"
has "no default branch: stderr says so" "could not derive base_ref" "$(cat "$TEST_TMP/err")"
schema_ok "base_ref null marker"
adv --to implement --repo-root "$R3"; adv --to qc-gate --repo-root "$R3"
eq "null base_ref: bump check skipped, advance still writes" "0" "$RC"

# ---------------------------------------------------------------- exit codes 2 / 5 / 3
R4="$TEST_TMP/r-exits"; mkrepo "$R4"
newsess
adv --to implement
eq "no marker -> exit 2" "2" "$RC"
sm set --level none --repo-root "$R4" >/dev/null 2>&1   # plain marker without a size
adv --to implement
eq "marker without size -> exit 5" "5" "$RC"

newsess; sm set --size L --repo-root "$R4" >/dev/null 2>&1
adv --to plan; eq "L first write plan -> 3" "3" "$RC"
has "first-write denial names the entry node" '"legal_next":["intent"]' "$OUT"
has "denial carries allowed:false and a reason" '"allowed":false' "$OUT"
adv --to intent; eq "L first write intent -> 0" "0" "$RC"
eq "stage written" '"intent"' "$(jf stage)"
STAMP=$(jf stage_set_at)
case "$STAMP" in '"'????-??-??T??:??:??.???Z'"') ok "stage_set_at is ISO UTC with ms" ;; *) bad "stage_set_at shape: $STAMP" ;; esac
adv --to proposal; adv --to plan; eq "intent->proposal->plan (rc)" "0" "$RC"
adv --to implement; eq "illegal plan -> implement on L -> 3" "3" "$RC"
has "illegal move lists plan-review" 'plan-review' "$OUT"
eq "illegal move leaves stage untouched" '"plan"' "$(jf stage)"
adv --to nonsense; eq "unknown node -> 1" "1" "$RC"

newsess; sm set --size S --repo-root "$R4" >/dev/null 2>&1
adv --to plan; eq "S first write plan -> 3" "3" "$RC"
newsess; sm set --size S --bug --repo-root "$R4" >/dev/null 2>&1
adv --to implement; eq "S bug first write implement -> 3 (entry is diagnose)" "3" "$RC"
adv --to diagnose; eq "S bug first write diagnose -> 0" "0" "$RC"

# ---------------------------------------------------------------- same-node update
newsess; sm set --size M --repo-root "$R4" >/dev/null 2>&1
adv --to plan; adv --to implement; adv --to verify
SET1=$(jf stage_set_at)
sleep 0.05
adv --to verify --review-families anthropic,openai
eq "same-node update (rc)" "0" "$RC"
eq "same-node update keeps stage_set_at" "$SET1" "$(jf stage_set_at)"
eq "same-node update records review_families" '["anthropic","openai"]' "$(jf review_families)"
adv --to verify --review-families 'bad family!'; eq "invalid review family -> 1" "1" "$RC"
schema_ok "marker after same-node update"

# ---------------------------------------------------------------- unit rules (L, phases)
newsess; sm set --size L --repo-root "$R4" >/dev/null 2>&1
for n in intent proposal plan plan-review; do adv --to $n; done
adv --to implement --unit phase:1/3:parse; eq "implement unit 1/3 -> 0" "0" "$RC"
eq "unit written" '{"kind":"phase","index":1,"total":3,"label":"parse"}' "$(jf unit)"
adv --to verify; eq "verify keeps the unit" "0" "$RC"
adv --to implement --unit phase:1/3:parse; eq "repair (verify -> implement same index) -> 0" "0" "$RC"
adv --to verify
adv --to implement --unit phase:2/3:wire; eq "advance (index+1) -> 0" "0" "$RC"
adv --to verify
adv --to implement --unit phase:1/3:parse; eq "index regression -> 3" "3" "$RC"
adv --to verify --unit phase:1/3:parse; eq "same-node index regression (2 -> 1 at verify) -> 3" "3" "$RC"
adv --to implement --unit phase:4/3:x; eq "index above total -> 3" "3" "$RC"
adv --to implement --unit phase:2/4:x; eq "changing total -> 3" "3" "$RC"
adv --to implement --unit deliverable:2/3:x; eq "changing kind -> 3" "3" "$RC"
adv --to code-review; eq "leaving the loop early (2/3) -> 3" "3" "$RC"
has "early-leave reason" "index = total" "$OUT"
eq "violations left stage at verify" '"verify"' "$(jf stage)"
adv --to implement --unit phase:3/3:ship; eq "advance to 3/3 -> 0" "0" "$RC"
adv --to verify; adv --to code-review; eq "leaving the loop at 3/3 -> 0" "0" "$RC"
adv --to qc-gate; adv --to finish; eq "walk completes at finish" '"finish"' "$(jf stage)"
schema_ok "marker after the unit walk"
newsess; sm set --size L --repo-root "$R4" >/dev/null 2>&1
for n in intent proposal plan plan-review; do adv --to $n; done
adv --to implement --unit deliverable:1/2:x; eq "L unit kind must be phase -> 3" "3" "$RC"
adv --to implement --unit phase:1/3:a; adv --to verify
adv --to implement --unit phase:3/3:skip; eq "verify -> implement may not skip an index -> 3" "3" "$RC"

# ---------------------------------------------------------------- high_risk sampling (M urgent)
mk_m_urgent() { newsess; sm set --size M --urgent --repo-root "$R4" >/dev/null 2>&1; adv --to plan; adv --to implement; adv --to verify; : >"$STUB_LOG"; }
mk_m_urgent; STUB_RISK=low adv --to code-review
eq "M! low risk: verify -> code-review illegal (urgent-low order) -> 3" "3" "$RC"
STUB_RISK=low adv --to qc-gate
eq "M! low risk: verify -> qc-gate -> 0" "0" "$RC"
eq "M! low risk: high_risk stored false" "false" "$(jf high_risk)"
has "resolver received the classified flags" "--diff-lines 4242 --protected-path 1 --oracle-available 0 --security-surface 1" "$(cat "$STUB_LOG")"
has "resolver asked for review_risk" "--field review_risk" "$(cat "$STUB_LOG")"
STUB_RISK=low adv --to finish; adv --to code-review
eq "M! low risk: finish -> code-review terminal -> 0" "0" "$RC"
adv --to implement; eq "urgent-low code-review has no edge back to implement -> 3" "3" "$RC"
schema_ok "urgent-low marker"

mk_m_urgent; STUB_RISK=high adv --to code-review
eq "M! high risk: verify -> code-review -> 0" "0" "$RC"
eq "M! high risk: high_risk stored true" "true" "$(jf high_risk)"
adv --to qc-gate; adv --to finish; eq "M! high risk walk completes" '"finish"' "$(jf stage)"

mk_m_urgent; STUB_RISK=fail adv --to code-review
eq "sampling failure counts as high (never silently lowers review) -> 0" "0" "$RC"
eq "sampling failure stored high_risk true" "true" "$(jf high_risk)"
has "sampling failure is reported on stderr" "sampling failed" "$ERR"

newsess; sm set --size M --repo-root "$R4" >/dev/null 2>&1   # not urgent: never sampled
adv --to plan; adv --to implement; adv --to verify; : >"$STUB_LOG"; adv --to code-review
eq "non-urgent M: no sampling" "" "$(cat "$STUB_LOG")"
eq "non-urgent M: high_risk stays absent" "<absent>" "$(jf high_risk)"

# L! with units: sampled only when leaving the LAST verify
newsess; sm set --size L --urgent --repo-root "$R4" >/dev/null 2>&1
for n in intent proposal plan plan-review; do adv --to $n; done
adv --to implement --unit phase:1/2:a; adv --to verify; : >"$STUB_LOG"
adv --to implement --unit phase:2/2:b
eq "no sampling when verify -> implement" "" "$(cat "$STUB_LOG")"
adv --to verify; STUB_RISK=high adv --to code-review
eq "L! sampled leaving the last verify" "true" "$(jf high_risk)"

# real classify-diff-risk.sh flags reach the resolver (resolver stubbed)
R5="$TEST_TMP/r-real"; mkrepo "$R5"
newsess; sm set --size M --urgent --repo-root "$R5" >/dev/null 2>&1
adv --to plan --repo-root "$R5"; adv --to implement --repo-root "$R5"; adv --to verify --repo-root "$R5"
plant "$R5" 2 30 real
: >"$STUB_LOG"
( unset AUTOPILOT_STAGE_ADVANCE_CLASSIFY; export STUB_RISK=high; OUT=$(node "$SA" --to code-review --repo-root "$R5" 2>/dev/null); echo "$?" >"$TEST_TMP/rc" )
eq "real classify-diff-risk + stub resolver (rc)" "0" "$(cat "$TEST_TMP/rc")"
case "$(cat "$STUB_LOG")" in *"--diff-lines "[1-9]*) ok "real classify gave a positive diff_lines for the planted diff" ;; *) bad "real classify diff_lines: $(cat "$STUB_LOG")" ;; esac

# ---------------------------------------------------------------- E1 bump
nextfrom() { node "$SG" next --from "$1" --size "$2"; }

# boundary: equal fits, one over bumps; binary counts as 1 file / 0 lines
R6="$TEST_TMP/r-bound"; mkrepo "$R6"
newsess; sm set --size XS --repo-root "$R6" >/dev/null 2>&1
adv --to implement --repo-root "$R6"
plant "$R6" 2 10 eq      # 2 files, 20 lines == XS limits
adv --to qc-gate --repo-root "$R6"; eq "XS at exactly 2 files / 20 lines fits" "0" "$RC"
newsess; sm set --size XS --repo-root "$R6" >/dev/null 2>&1
adv --to implement --repo-root "$R6"
plant "$R6" 1 1 over     # base_ref is HEAD at init, so only this commit counts
adv --to qc-gate --repo-root "$R6"; eq "XS 1 file 1 line fits" "0" "$RC"
newsess; sm set --size XS --repo-root "$R6" >/dev/null 2>&1
adv --to implement --repo-root "$R6"
plant "$R6" 1 21 big
adv --to qc-gate --repo-root "$R6"; eq "XS 21 lines -> exit 4" "4" "$RC"
has "bump names the next size" '"bump_to":"S"' "$OUT"
eq "exit 4 writes nothing" '"implement"' "$(jf stage)"
newsess; sm set --size XS --repo-root "$R6" >/dev/null 2>&1
adv --to implement --repo-root "$R6"
head -c 4096 /dev/urandom >"$R6/bin1.dat"; head -c 4096 /dev/urandom >"$R6/bin2.dat"; head -c 4096 /dev/urandom >"$R6/bin3.dat"
git -C "$R6" add -A; git -C "$R6" commit -q -m bins
adv --to qc-gate --repo-root "$R6"
eq "3 binary files (1 file each, 0 lines) bump XS on file count" "4" "$RC"
has "binary files count as 0 lines" '"lines":0' "$OUT"

# working-tree counting: dev-flow gates BEFORE commit, so uncommitted + untracked work must count
wt_repo() { mkrepo "$1"; printf 'a\n' >"$1/tracked.txt"; printf 'ign.txt\n' >"$1/.gitignore"; git -C "$1" add -A; git -C "$1" commit -q -m base; }
wt_start() { newsess; sm set --size XS --repo-root "$1" >/dev/null 2>&1; adv --to implement --repo-root "$1"; }
RA="$TEST_TMP/r-wt-a"; wt_repo "$RA"; wt_start "$RA"
for _ in $(seq 1 21); do echo more >>"$RA/tracked.txt"; done
adv --to qc-gate --repo-root "$RA"; eq "XS (a) uncommitted tracked edits over the limit -> 4" "4" "$RC"
has "(a) counts the unstaged lines" '"lines":21' "$OUT"
git -C "$RA" add -A
adv --to qc-gate --repo-root "$RA"; eq "XS (a') staged-only edits over the limit -> 4" "4" "$RC"
RB="$TEST_TMP/r-wt-b"; wt_repo "$RB"; wt_start "$RB"
for _ in $(seq 1 21); do echo new >>"$RB/brand_new.txt"; done
adv --to qc-gate --repo-root "$RB"; eq "XS (b) untracked new file over the limit -> 4" "4" "$RC"
has "(b) untracked file counts as 1 file + its lines" '"files":1,"lines":21' "$OUT"
RC3="$TEST_TMP/r-wt-c"; wt_repo "$RC3"; wt_start "$RC3"
plant "$RC3" 1 21 committed
adv --to qc-gate --repo-root "$RC3"; eq "XS (c) committed change over the limit -> 4" "4" "$RC"
RD="$TEST_TMP/r-wt-d"; wt_repo "$RD"; wt_start "$RD"
for _ in $(seq 1 100); do echo ignored >>"$RD/ign.txt"; done
adv --to qc-gate --repo-root "$RD"; eq "XS (d) an ignored file does NOT count -> 0" "0" "$RC"
RE="$TEST_TMP/r-wt-e"; wt_repo "$RE"; wt_start "$RE"
head -c 2048 /dev/urandom >"$RE/blob.bin"; head -c 2048 /dev/urandom >"$RE/blob2.bin"; head -c 2048 /dev/urandom >"$RE/blob3.bin"
adv --to qc-gate --repo-root "$RE"; eq "XS (e) 3 untracked binaries -> 4 on file count" "4" "$RC"
has "(e) binaries count 0 lines" '"lines":0' "$OUT"
# high_risk sampling sees uncommitted work too (real classify via --diff-file, stub resolver)
RF="$TEST_TMP/r-wt-f"; wt_repo "$RF"
newsess; sm set --size M --urgent --repo-root "$RF" >/dev/null 2>&1
adv --to plan --repo-root "$RF"; adv --to implement --repo-root "$RF"; adv --to verify --repo-root "$RF"
for _ in $(seq 1 50); do echo risky >>"$RF/untracked_risk.txt"; done
for _ in $(seq 1 5); do echo edit >>"$RF/tracked.txt"; done
: >"$STUB_LOG"
( unset AUTOPILOT_STAGE_ADVANCE_CLASSIFY; export STUB_RISK=high; OUT=$(node "$SA" --to code-review --repo-root "$RF" 2>/dev/null); echo "$?" >"$TEST_TMP/rc" )
eq "uncommitted sampling (rc)" "0" "$(cat "$TEST_TMP/rc")"
DL=$(sed -n 's/.*--diff-lines \([0-9]*\).*/\1/p' "$STUB_LOG" | head -1)
[ "${DL:-0}" -ge 55 ] && ok "classify saw the uncommitted + untracked lines (diff_lines=$DL)" || bad "classify diff_lines=$DL, expected >= 55"

# XS -> S at qc-gate
R7="$TEST_TMP/r-xs"; mkrepo "$R7"
newsess; sm set --size XS --repo-root "$R7" >/dev/null 2>&1
adv --to implement --repo-root "$R7"; plant "$R7" 3 2 xs
adv --to qc-gate --repo-root "$R7"; eq "XS->S: qc-gate over 2 files -> 4" "4" "$RC"
has "XS->S: bump_to S" '"bump_to":"S"' "$OUT"
sm set --size S --repo-root "$R7" >/dev/null 2>&1
has "XS->S: next from implement under S offers verify" '"verify"' "$(nextfrom implement S)"
adv --to verify --repo-root "$R7"; eq "XS->S: verify (fits S)" "0" "$RC"
adv --to qc-gate --repo-root "$R7"; adv --to finish --repo-root "$R7"
eq "XS->S: reaches finish" '"finish"' "$(jf stage)"
eq "XS->S: base_ref survived the bump" "$(git -C "$R7" rev-parse HEAD~1)" "$(jf base_ref | tr -d '"')"

# S -> M at verify
R8="$TEST_TMP/r-s1"; mkrepo "$R8"
newsess; sm set --size S --repo-root "$R8" >/dev/null 2>&1
adv --to implement --repo-root "$R8"; plant "$R8" 7 1 s1
adv --to verify --repo-root "$R8"; eq "S->M at verify: 7 files -> 4" "4" "$RC"
has "S->M at verify: bump_to M" '"bump_to":"M"' "$OUT"
sm set --size M --repo-root "$R8" >/dev/null 2>&1
has "S->M at verify: next from implement under M offers verify" '"verify"' "$(nextfrom implement M)"
adv --to verify --repo-root "$R8"; eq "S->M at verify: verify (fits M)" "0" "$RC"
for n in code-review qc-gate finish; do adv --to $n --repo-root "$R8"; done
eq "S->M at verify: reaches finish (downstream review nodes kept)" '"finish"' "$(jf stage)"

# S -> M at qc-gate
R9="$TEST_TMP/r-s2"; mkrepo "$R9"
newsess; sm set --size S --repo-root "$R9" >/dev/null 2>&1
adv --to implement --repo-root "$R9"; adv --to verify --repo-root "$R9"
plant "$R9" 1 201 s2
adv --to qc-gate --repo-root "$R9"; eq "S->M at qc-gate: 201 lines -> 4" "4" "$RC"
has "S->M at qc-gate: bump_to M" '"bump_to":"M"' "$OUT"
sm set --size M --repo-root "$R9" >/dev/null 2>&1
has "S->M at qc-gate: next from verify under M offers code-review" '"code-review"' "$(nextfrom verify M)"
adv --to code-review --repo-root "$R9"; eq "S->M at qc-gate: code-review" "0" "$RC"
adv --to qc-gate --repo-root "$R9"; adv --to finish --repo-root "$R9"
eq "S->M at qc-gate: reaches finish" '"finish"' "$(jf stage)"

# M -> L at verify
R10="$TEST_TMP/r-m1"; mkrepo "$R10"
newsess; sm set --size M --repo-root "$R10" >/dev/null 2>&1
adv --to plan --repo-root "$R10"; adv --to implement --repo-root "$R10"; plant "$R10" 1 801 m1
adv --to verify --repo-root "$R10"; eq "M->L at verify: 801 lines -> 4" "4" "$RC"
has "M->L at verify: bump_to L" '"bump_to":"L"' "$OUT"
sm set --size L --repo-root "$R10" >/dev/null 2>&1
has "M->L at verify: next from implement under L offers verify" '"verify"' "$(nextfrom implement L)"
adv --to verify --repo-root "$R10"; eq "M->L at verify: verify (no limit)" "0" "$RC"
for n in code-review qc-gate finish; do adv --to $n --repo-root "$R10"; done
eq "M->L at verify: reaches finish" '"finish"' "$(jf stage)"
schema_ok "bumped marker"

# M -> L at qc-gate
R11="$TEST_TMP/r-m2"; mkrepo "$R11"
newsess; sm set --size M --repo-root "$R11" >/dev/null 2>&1
adv --to plan --repo-root "$R11"; adv --to implement --repo-root "$R11"; adv --to verify --repo-root "$R11"
adv --to code-review --repo-root "$R11"
plant "$R11" 21 1 m2
adv --to qc-gate --repo-root "$R11"; eq "M->L at qc-gate: 21 files -> 4" "4" "$RC"
has "M->L at qc-gate: bump_to L" '"bump_to":"L"' "$OUT"
sm set --size L --repo-root "$R11" >/dev/null 2>&1
has "M->L at qc-gate: next from code-review under L offers qc-gate" '"qc-gate"' "$(nextfrom code-review L)"
adv --to qc-gate --repo-root "$R11"; eq "M->L at qc-gate: qc-gate (no limit)" "0" "$RC"
adv --to finish --repo-root "$R11"
eq "M->L at qc-gate: reaches finish" '"finish"' "$(jf stage)"

# ---------------------------------------------------------------- full legal walk of every expected.json cell
R12="$TEST_TMP/r-walk"; mkrepo "$R12"
WALK=$(FIXTURE="$FIXTURE" SA="$SA" SM="$SM" R="$R12" node -e '
const { spawnSync } = require("child_process");
const sa = require(process.env.SA);
const d = require(process.env.FIXTURE);
const fails = [];
let n = 0, steps = 0;
for (const c of d.cells) {
  process.env.AUTOPILOT_SESSION_ID = "walk-" + n;
  process.env.STUB_RISK = c.urgency === "urgent-high" ? "high" : "low";
  const a = [process.env.SM, "set", "--size", c.size, "--repo-root", process.env.R];
  if (c.urgent) a.push("--urgent");
  if (c.bug) a.push("--bug");
  const s = spawnSync("node", a, { encoding: "utf8" });
  if (s.status !== 0) { fails.push(c.id + ":init"); n++; continue; }
  let unit = 0, last = null;
  for (const node of c.walk) {
    const argv = ["--to", node];
    if (c.unit_kind) {
      if (node === "implement") unit++;
      if (node === "implement" || node === "verify") argv.push("--unit", c.unit_kind + ":" + unit + "/" + c.units + ":u" + unit);
    }
    const r = sa.run(argv);
    steps++;
    if (r.code !== 0) { fails.push(c.id + ":" + node + ":rc" + r.code + ":" + JSON.stringify(r.out)); break; }
    last = node;
  }
  const m = JSON.parse(require("fs").readFileSync(process.env.AUTOPILOT_SESSION_MODE_DIR + "/walk-" + n + ".json", "utf8"));
  if (last !== c.walk[c.walk.length - 1] || m.stage !== last) fails.push(c.id + ":final=" + m.stage);
  if (c.urgent && c.walk.includes("code-review") && c.urgency === "urgent-high" && m.high_risk !== true) fails.push(c.id + ":high_risk");
  if (c.urgent && c.urgency === "urgent-low" && c.walk.includes("code-review") && m.high_risk !== false) fails.push(c.id + ":low_risk");
  n++;
}
console.log(n + " " + steps + " " + fails.length + " " + fails.slice(0, 4).join(" | "));
')
set -- $WALK
eq "all 84 fixture cells walk to their terminal (cells)" "84" "$1"
eq "walk failures" "0" "$3"
[ "$3" != "0" ] && echo "  first failures: $WALK" >&2
ok "walked $2 stage-advance steps"

# ---------------------------------------------------------------- set --new-task (second task in one live session)
RN="$TEST_TMP/r-newtask"; mkrepo "$RN"
newsess; sm set --level l4 --size L --repo-root "$RN" >/dev/null 2>&1
for n in intent proposal plan plan-review; do adv --to $n; done
adv --to implement --unit phase:1/3:a; adv --to verify; adv --to implement --unit phase:2/3:b; adv --to verify
adv --to implement --unit phase:3/3:c --review-families codex,grok; adv --to verify; adv --to code-review; adv --to qc-gate
adv --to finish; eq "fixture 2 at finish" '"finish"' "$(jf stage)"
ROOT0=$(jf root_run_id); STARTED0=$(jf started_at); EXP0=$(jf expires_at); IDENT0=$(jf repo_identity); BASE0=$(jf base_ref)
adv --to implement --unit phase:1/2:n; RC_OLD=$RC
eq "BEFORE: finish -> implement refused -> 3" "3" "$RC_OLD"
sm set --size XL --repo-root "$RN" >/dev/null 2>&1
eq "plain set --size leaves stage untouched" '"finish"' "$(jf stage)"
eq "plain set --size writes no task_seq" "<absent>" "$(jf task_seq)"
# new task from finish: no warning
sm set --new-task --size S --repo-root "$RN" >/dev/null 2>"$TEST_TMP/err"; RC=$?
eq "--new-task from finish (rc)" "0" "$RC"
eq "--new-task from finish: no warning" "" "$(cat "$TEST_TMP/err")"
for k in stage stage_set_at unit review_families high_risk; do eq "--new-task clears $k" "<absent>" "$(jf $k)"; done
eq "--new-task: new size" '"S"' "$(jf size)"
eq "--new-task keeps level" '"l4"' "$(jf level)"
eq "--new-task keeps root_run_id" "$ROOT0" "$(jf root_run_id)"
eq "--new-task keeps started_at" "$STARTED0" "$(jf started_at)"
eq "--new-task keeps expires_at" "$EXP0" "$(jf expires_at)"
eq "--new-task keeps repo_identity" "$IDENT0" "$(jf repo_identity)"
eq "--new-task re-derives base_ref" "$BASE0" "$(jf base_ref)"
eq "--new-task: task_seq 2 (first task had none)" "2" "$(jf task_seq)"
has "--new-task: task_started_at is iso" "T" "$(jf task_started_at)"
schema_ok "marker after --new-task"
adv --to implement; eq "AFTER: S entry node implement accepted (was refused at finish/qc-gate)" "0" "$RC"
eq "AFTER: stage implement" '"implement"' "$(jf stage)"
# unit rules start from scratch: L task with 3 units after a 3/3 task, index 1 accepted
newsess; sm set --size L --repo-root "$RN" >/dev/null 2>&1
for n in intent proposal plan plan-review; do adv --to $n; done
adv --to implement --unit phase:3/3:c; adv --to verify; adv --to code-review; adv --to qc-gate
adv --to implement --unit phase:1/3:a; eq "BEFORE: unit 1/3 after a 3/3 task refused (not an edge) -> 3" "3" "$RC"
sm set --new-task --size L --repo-root "$RN" >/dev/null 2>"$TEST_TMP/err"; RC=$?
eq "new-task from qc-gate (rc)" "0" "$RC"
has "warning when the previous task was not at finish" "was at stage qc-gate, not finish" "$(cat "$TEST_TMP/err")"
for n in intent proposal plan plan-review; do adv --to $n; done
adv --to implement --unit phase:1/2:a; eq "AFTER: unit 1/2 with a different total accepted" "0" "$RC"
eq "AFTER: unit written fresh" '{"kind":"phase","index":1,"total":2,"label":"a"}' "$(jf unit)"
sm set --new-task --size M --repo-root "$RN" >/dev/null 2>&1
eq "task_seq increments to 3" "3" "$(jf task_seq)"
# a tolerated first task: marker with no work yet counts as task 1
newsess; sm set --level none --repo-root "$RN" >/dev/null 2>&1
sm set --new-task --size M --repo-root "$RN" >/dev/null 2>&1
eq "workless marker + --new-task -> task_seq 1" "1" "$(jf task_seq)"
# no live marker at all
newsess; sm set --new-task --size XS --repo-root "$RN" >/dev/null 2>&1; RC=$?
eq "--new-task without a marker creates one (rc)" "0" "$RC"
eq "created marker: task_seq 1, level null, size XS" '1 null "XS"' "$(jf task_seq) $(jf level) $(jf size)"
# --level interplay
newsess; sm set --level l5 --size M --repo-root "$RN" >/dev/null 2>&1
sm set --new-task --level l5 --size S --repo-root "$RN" >/dev/null 2>&1; RC=$?
eq "--new-task --level <same> accepted" "0" "$RC"
eq "--level same: level kept, task_seq 2" '"l5" 2' "$(jf level) $(jf task_seq)"
sm set --new-task --level l3 --size S --repo-root "$RN" >/dev/null 2>"$TEST_TMP/err"; RC=$?
eq "--new-task --level <different> refused" "2" "$RC"
has "level refusal names the live level" "live marker is level l5" "$(cat "$TEST_TMP/err")"
sm set --new-task --level none --size S --repo-root "$RN" >/dev/null 2>"$TEST_TMP/err"; RC=$?
eq "--new-task --level none on a live l5 marker refused" "2" "$RC"
eq "refused --level none leaves the level" '"l5"' "$(jf level)"
newsess; sm set --new-task --level l4 --size S --repo-root "$RN" >/dev/null 2>&1; RC=$?
eq "--new-task --level l4 without a live marker refused" "2" "$RC"
sm set --new-task --size BIG --repo-root "$RN" >/dev/null 2>&1; eq "--new-task invalid --size exits 2" "2" "$?"
# high_risk and base_ref are task-scoped too (high_risk planted: it is normally sampled by stage-advance on an urgent walk)
newsess; sm set --size M --base-ref "$(printf 'b%.0s' $(seq 1 40))" --repo-root "$RN" >/dev/null 2>&1
node -e 'const fs=require("fs");const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));m.high_risk=true;fs.writeFileSync(process.argv[1],JSON.stringify(m))' "$MARKER"
eq "fixture: high_risk planted" "true" "$(jf high_risk)"
sm set --new-task --size M --repo-root "$RN" >/dev/null 2>&1
eq "--new-task clears high_risk" "<absent>" "$(jf high_risk)"
eq "--new-task re-derives base_ref instead of keeping the old task's" "\"$(git -C "$RN" rev-parse HEAD)\"" "$(jf base_ref)"
sm set --new-task --size M --base-ref "$(printf 'c%.0s' $(seq 1 40))" --repo-root "$RN" >/dev/null 2>&1
eq "--new-task --base-ref wins" "\"$(printf 'c%.0s' $(seq 1 40))\"" "$(jf base_ref)"
# urgent/bug are task-scoped
newsess; sm set --size M --urgent --bug --repo-root "$RN" >/dev/null 2>&1; sm set --new-task --size S --repo-root "$RN" >/dev/null 2>&1
eq "--new-task resets urgent/bug" "false false" "$(jf urgent) $(jf bug)"
sm set --new-task --size S --urgent --repo-root "$RN" >/dev/null 2>&1; eq "--new-task --urgent re-sets only urgent" "true false" "$(jf urgent) $(jf bug)"
# no --size: the new task is unsized
newsess; sm set --size M --repo-root "$RN" >/dev/null 2>&1; sm set --new-task --repo-root "$RN" >/dev/null 2>&1
eq "--new-task without --size clears size" "<absent>" "$(jf size)"
sm set --size L --repo-root "$RN" >/dev/null 2>&1; eq "later set --size on the new task works" '"L"' "$(jf size)"

# ---------------------------------------------------------------- D5: the marker follows the session into a linked worktree
# (plan docs/plans/2026-10-12-worktree-placement.md P1.1 / P1.2 d-f). No --repo-root: the cwd is what moves.
RA="$TEST_TMP/r-follow"; mkrepo "$RA"; plant "$RA" 1 1 seed
WA="$TEST_TMP/r-follow-wt"; git -C "$RA" worktree add -q -b feat/follow "$WA"
RB="$TEST_TMP/r-foreign"; mkrepo "$RB"; plant "$RB" 7 1 foreign
newsess; (cd "$RA" && node "$SM" set --size S >/dev/null 2>&1)
eq "fixture: marker created in the main checkout" "\"$RA\"" "$(jf repo_root)"
plant "$RA" 7 1 other    # other sessions' merges land on the main checkout's develop
plant "$WA" 1 1 mine     # this session's work, in the linked worktree
(cd "$WA" && node "$SA" --to implement >/dev/null 2>&1)
OUT=$(cd "$WA" && node "$SA" --to verify 2>"$TEST_TMP/err"); RC=$?
eq "E1 from a linked worktree measures that worktree (1 file fits S)" "0" "$RC"
# negative: a cwd in another repository measures marker.repo_root and leaves the marker alone
newsess; sm set --size S --repo-root "$RA" >/dev/null 2>&1
(cd "$RB" && node "$SA" --to implement >/dev/null 2>&1)
OUT=$(cd "$RB" && node "$SA" --to verify 2>"$TEST_TMP/err"); RC=$?
eq "E1 from a foreign repo measures marker.repo_root (clean, fits)" "0" "$RC"
eq "a foreign cwd leaves repo_root" "\"$RA\"" "$(jf repo_root)"
# set --new-task: follows a linked worktree of the same repo, ignores a foreign repo
newsess; (cd "$RA" && node "$SM" set --size S >/dev/null 2>&1)
(cd "$WA" && node "$SM" set --new-task --size S >/dev/null 2>&1)
eq "--new-task from a linked worktree: repo_root follows" "\"$WA\"" "$(jf repo_root)"
(cd "$RB" && node "$SM" set --new-task --size S >/dev/null 2>&1)
eq "--new-task from a foreign repo: repo_root unchanged" "\"$WA\"" "$(jf repo_root)"
eq "--new-task from a foreign repo: base_ref derived in repo_root, not the cwd" \
  "\"$(git -C "$WA" merge-base HEAD develop)\"" "$(jf base_ref)"
# set (merge path, no --new-task): follows in both directions, ignores a foreign repo
newsess; (cd "$RA" && node "$SM" set --size S >/dev/null 2>&1)
(cd "$WA" && node "$SM" set --size M >/dev/null 2>&1)
eq "set from a linked worktree: repo_root follows" "\"$WA\"" "$(jf repo_root)"
(cd "$RB" && node "$SM" set --size L >/dev/null 2>&1)
eq "set from a foreign repo: the write happened (size L)" '"L"' "$(jf size)"
eq "set from a foreign repo: repo_root unchanged" "\"$WA\"" "$(jf repo_root)"
(cd "$RA" && node "$SM" set --size XL >/dev/null 2>&1)
eq "set back in the main checkout: the write happened (size XL)" '"XL"' "$(jf size)"
eq "set back in the main checkout: repo_root follows back" "\"$RA\"" "$(jf repo_root)"

# ---------------------------------------------------------------- P3.1: --new-task advisory when the worktree name and branch share no word
# One stderr line, never a refusal: the exit code is 0 in every case.
ADV='shares no word with it'
newtask_in() { # dir -> RC: exit code of set --new-task run there, ERR: its stderr
  newsess; (cd "$RA" && node "$SM" set --size S >/dev/null 2>&1)
  (cd "$1" && node "$SM" set --new-task --size S >/dev/null 2>"$TEST_TMP/err"); RC=$?
  ERR=$(cat "$TEST_TMP/err")
}
W="$TEST_TMP/wt-login-form"; git -C "$RA" worktree add -q -b feat/login-form "$W"
newtask_in "$W"; eq "advisory: shared word -> exit 0" "0" "$RC"
eq "advisory: shared word -> silent" "" "$ERR"
W="$TEST_TMP/wt-autocompact-detect"; git -C "$RA" worktree add -q -b feat/worktree-placement-rule "$W"
newtask_in "$W"; eq "advisory: no shared word -> exit 0" "0" "$RC"
eq "advisory: no shared word -> one line" "1" "$(printf '%s\n' "$ERR" | grep -c "$ADV")"
has "advisory: names the worktree dir" "wt-autocompact-detect" "$ERR"
has "advisory: names the branch" "feat/worktree-placement-rule" "$ERR"
has "advisory: points at the rule" "references/worktree-placement.md" "$ERR"
git -C "$RA" checkout -q -b feat/unrelated-name; newtask_in "$RA"; git -C "$RA" checkout -q develop
eq "advisory: main checkout -> exit 0" "0" "$RC"
eq "advisory: main checkout -> silent" "" "$ERR"
W="$TEST_TMP/feat-1234"; git -C "$RA" worktree add -q -b feat/1234 "$W"
newtask_in "$W"; eq "advisory: only generic/digit tokens -> exit 0" "0" "$RC"
eq "advisory: only generic/digit tokens -> silent" "" "$ERR"
W="$TEST_TMP/Foo-bar"; git -C "$RA" worktree add -q -b foo-bar "$W"
newtask_in "$W"; eq "advisory: case differs only -> exit 0" "0" "$RC"
eq "advisory: case differs only -> silent" "" "$ERR"
W="$TEST_TMP/wt-detached"; git -C "$RA" worktree add -q --detach "$W"
newtask_in "$W"; eq "advisory: detached HEAD -> exit 0" "0" "$RC"
eq "advisory: detached HEAD -> silent" "" "$ERR"

# ---------------------------------------------------------------- D6: base_ref takes the newer of a local/remote pair
# (plan P1.2 a-c, g, h). origin/* refs are planted with update-ref; no remote, no fetch.
basesha() { sm set --size S --repo-root "$1" >/dev/null 2>&1; jf base_ref | tr -d '"'; }
# (a) local develop behind origin/develop -> the remote's merge-base
R="$TEST_TMP/r-behind"; mkrepo "$R"; plant "$R" 1 1 a; C1=$(git -C "$R" rev-parse HEAD)
plant "$R" 1 1 b; C2=$(git -C "$R" rev-parse HEAD)
git -C "$R" update-ref refs/remotes/origin/develop "$C2"; git -C "$R" checkout -q -b feat/x; plant "$R" 1 1 f
git -C "$R" branch -f develop "$C1"
newsess; eq "base_ref: local develop behind origin/develop -> remote" "$C2" "$(basesha "$R")"
# (b) local ahead -> local
R="$TEST_TMP/r-ahead"; mkrepo "$R"; plant "$R" 1 1 a; C1=$(git -C "$R" rev-parse HEAD)
plant "$R" 1 1 b; C2=$(git -C "$R" rev-parse HEAD)
git -C "$R" update-ref refs/remotes/origin/develop "$C1"; git -C "$R" checkout -q -b feat/x; plant "$R" 1 1 f
newsess; eq "base_ref: local develop ahead of origin/develop -> local" "$C2" "$(basesha "$R")"
# (c) diverged -> remote
R="$TEST_TMP/r-diverged"; mkrepo "$R"; plant "$R" 1 1 a
git -C "$R" checkout -q -b side; plant "$R" 1 1 r; CR=$(git -C "$R" rev-parse HEAD)
git -C "$R" update-ref refs/remotes/origin/develop "$CR"
git -C "$R" checkout -q develop; plant "$R" 1 1 l
git -C "$R" checkout -q -b feat/x "$CR"; plant "$R" 1 1 f
newsess; eq "base_ref: diverged develop / origin/develop -> remote" "$CR" "$(basesha "$R")"
# (g) only origin/develop plus a local main -> origin/develop (today's flat order picked main)
R="$TEST_TMP/r-onlyremote"; mkrepo "$R" main; plant "$R" 1 1 a; C1=$(git -C "$R" rev-parse HEAD)
plant "$R" 1 1 b; C2=$(git -C "$R" rev-parse HEAD)
git -C "$R" update-ref refs/remotes/origin/develop "$C2"; git -C "$R" checkout -q -b feat/x; plant "$R" 1 1 f
git -C "$R" branch -f main "$C1"
newsess; eq "base_ref: origin/develop beats a local main" "$C2" "$(basesha "$R")"
# (h) only a local develop -> develop
R="$TEST_TMP/r-onlylocal"; mkrepo "$R"; plant "$R" 1 1 a; C1=$(git -C "$R" rev-parse HEAD)
git -C "$R" checkout -q -b feat/x; plant "$R" 1 1 f
newsess; eq "base_ref: only a local develop -> develop" "$C1" "$(basesha "$R")"

# ---------------------------------------------------------------- --resume-from <old-session-id>
RR="$TEST_TMP/r-resume"; mkrepo "$RR"
newsess; OLD_ID="$AUTOPILOT_SESSION_ID"; OLD_MARKER="$MARKER"
sm set --size L --bug --repo-root "$RR" >/dev/null 2>&1
adv --to "$(node "$SG" nodes --size L --bug | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).entry)')"; eq "resume setup: old session writes its entry node" "0" "$RC"
for n in $(node "$SG" nodes --size L --bug | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log((j.nodes||j.walk||[]).slice(1,3).join(" "))'); do adv --to "$n"; done
OLD_STAGE=$(jf stage); OLD_SUM=$(cksum <"$OLD_MARKER")
[ "$OLD_STAGE" != "<absent>" ] && ok "resume setup: old marker has a stage ($OLD_STAGE)" || bad "resume setup: old marker has no stage"

# without --resume-from a fresh id is still refused (first write must be the entry node)
newsess; sm set --size L --bug --repo-root "$RR" >/dev/null 2>&1
adv --to "$(echo "$OLD_STAGE" | tr -d '"')"; eq "no --resume-from: mid-graph first write still refused (rc)" "3" "$RC"
eq "no --resume-from: stage stays absent" "<absent>" "$(jf stage)"

# with --resume-from the position carries over; the old marker is untouched
adv --resume-from "$OLD_ID"; eq "--resume-from continues (rc)" "0" "$RC"
eq "resume: stage copied" "$OLD_STAGE" "$(jf stage)"
eq "resume: size copied" '"L"' "$(jf size)"
eq "resume: bug copied" "true" "$(jf bug)"
eq "resume: old marker unchanged" "$OLD_SUM" "$(cksum <"$OLD_MARKER")"
adv --to plan-review; eq "resume: the next legal node from the copied stage is accepted (rc)" "0" "$RC"
adv --resume-from "$OLD_ID"; eq "target already has a stage refused (rc)" "6" "$RC"
has "target already has a stage: reason" "already has stage" "$ERR"

# fail closed
newsess; sm set --size L --bug --repo-root "$RR" >/dev/null 2>&1
adv --resume-from no-such-session; eq "missing old marker refused (rc)" "6" "$RC"
has "missing old marker names the re-walk fallback" "context-continuation.md" "$ERR"
eq "missing old marker: nothing written" "<absent>" "$(jf stage)"
adv --resume-from "$AUTOPILOT_SESSION_ID"; eq "resume from itself refused (rc)" "6" "$RC"
RO="$TEST_TMP/r-resume-other"; mkrepo "$RO"; newsess; sm set --size L --bug --repo-root "$RO" >/dev/null 2>&1
adv --resume-from "$OLD_ID"; eq "old marker from another repo refused (rc)" "6" "$RC"
eq "other repo: nothing written" "<absent>" "$(jf stage)"
newsess; sm set --size L --bug --repo-root "$RR" >/dev/null 2>&1; node -e 'require("fs").writeFileSync(process.argv[1],"{not json")' "$AUTOPILOT_SESSION_MODE_DIR/corrupt-old.json"
adv --resume-from corrupt-old; eq "unreadable old marker refused (rc)" "6" "$RC"
adv --resume-from "$OLD_ID" --to plan; eq "--resume-from with --to is a usage error" "1" "$RC"

# size / urgent / bug must match (a copy could never lower the new marker)
newsess; sm set --size XL --bug --repo-root "$RR" >/dev/null 2>&1
adv --resume-from "$OLD_ID"; eq "different size refused (rc)" "6" "$RC"
has "different size: reason" "differ" "$ERR"
eq "different size: nothing written" "<absent>" "$(jf stage)"
newsess; sm set --size L --bug --urgent --repo-root "$RR" >/dev/null 2>&1
adv --resume-from "$OLD_ID"; eq "different urgent refused (rc)" "6" "$RC"
newsess; sm set --size L --repo-root "$RR" >/dev/null 2>&1
adv --resume-from "$OLD_ID"; eq "different bug refused (rc)" "6" "$RC"

# high_risk and review_families ride along: an urgent high-risk session parked at code-review can still reach qc-gate
RH="$TEST_TMP/r-resume-hr"; mkrepo "$RH"
newsess; HR_OLD="$AUTOPILOT_SESSION_ID"; sm set --size M --urgent --repo-root "$RH" >/dev/null 2>&1
node -e 'const f=process.argv[1],m=JSON.parse(require("fs").readFileSync(f,"utf8"));Object.assign(m,{stage:"code-review",stage_set_at:new Date().toISOString(),high_risk:true,review_families:["fam-a"]});require("fs").writeFileSync(f,JSON.stringify(m))' "$MARKER"
newsess; sm set --size M --urgent --repo-root "$RH" >/dev/null 2>&1
adv --resume-from "$HR_OLD"; eq "high-risk resume (rc)" "0" "$RC"
eq "high_risk copied" "true" "$(jf high_risk)"
eq "review_families copied" '["fam-a"]' "$(jf review_families)"
STUB_RISK=high adv --to qc-gate; eq "high-risk resume: code-review -> qc-gate accepted (rc)" "0" "$RC"

echo "stage-advance.test: pass=$PASS fail=$FAIL"
[ "$FAIL" -eq 0 ]
