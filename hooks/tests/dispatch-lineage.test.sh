#!/usr/bin/env bash
# dispatch-lineage.test.sh — trace-context lineage across the dispatch rails.
#
# ARTIFACT-NOT-SELF-REPORT: every lineage assertion reads the ACTUAL manifest
# JSON file written by the dispatcher (or the real watch-foreman/status output),
# never a worker's self-report. Stubbed engines (no network, no LLM).
#
# Covers:
#   1. hetero root manifest (no lineage env) → parent null, root=own, depth 0
#   2. hetero child manifest (lineage env set) → parent/root propagated, depth passed through
#   3. non-numeric depth coerced to 1
#   4. child-env propagation: the WORKER's env carries parent=<own run_id>, depth+1
#   5. detach path: lineage survives declare -p state serialization (the CRITICAL constraint)
#   6. AUTOPILOT_DISPATCH_MANIFEST=0 still writes NO manifest (additive escape hatch intact)
#   7. review manifest lineage (dispatch-review.sh)
#   8. dispatch-status.js --list surfaces lineage fields
#   9. watch-foreman.js --root filters by root_run_id with ZERO cross-attribution;
#      lineage-less manifests fall back to time-window + are tagged attribution=time-window;
#      WITHOUT --root behavior is unfiltered/untagged
#  10. autopilot status runs --tree folds parent→child + synthetic (external) root
. "$(dirname "$0")/lib.sh"

HETERO="$REPO_ROOT/scripts/dispatch-hetero.sh"
REVIEW="$REPO_ROOT/scripts/dispatch-review.sh"
STATUS="$REPO_ROOT/scripts/dispatch-status.js"
WF="$REPO_ROOT/scripts/watch-foreman.js"
CLI="$REPO_ROOT/bin/autopilot.js"

# --- sandbox git repo (never touch the real repo) ---
SBX="$TEST_TMP/repo"
mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base

PROMPT="$TEST_TMP/prompt.txt"
echo "create ok.txt" > "$PROMPT"

# --- stub agy: commits one file AND dumps its own AUTOPILOT_* env to a file (env test) ---
ENVDUMP="$TEST_TMP/worker-env.txt"
STUB_OK="$TEST_TMP/agy-ok"
cat > "$STUB_OK" <<EOF
#!/usr/bin/env bash
env | grep -E '^AUTOPILOT_(PARENT|ROOT|DISPATCH_DEPTH)' > "$ENVDUMP" 2>/dev/null || true
echo ok > ok.txt
git add ok.txt
git -c user.email=t@t -c user.name=t commit -q -m "test: smoke"
EOF
chmod +x "$STUB_OK"

RUNS="$TEST_TMP/runs"
mkdir -p "$RUNS"

json_field() { # file key  → prints value via node (numbers unquoted, strings raw, null literal)
  node -e 'const m=require(process.argv[1]);const v=m[process.argv[2]];process.stdout.write(v===null?"null":v===undefined?"undefined":String(v))' "$1" "$2"
}

# =========================================================================
# 1. ROOT manifest: no lineage env
# =========================================================================
run_hetero() { # runid extra-env...  (DETACH off unless overridden)
  local runid="$1"; shift
  ( cd "$SBX" && env "$@" AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" DISPATCH_DETACH=0 DISPATCH_QUIET=1 \
      "$HETERO" --branch "feat/$runid" --prompt-file "$PROMPT" --agy-bin "$STUB_OK" --run-id "$runid" >/dev/null 2>&1 )
}

run_hetero root1
M_ROOT="$RUNS/root1.manifest.json"
assert_file_exists "$M_ROOT" "root manifest written"
assert_eq "null" "$(json_field "$M_ROOT" parent_run_id)" "root: parent_run_id null"
assert_eq "root1" "$(json_field "$M_ROOT" root_run_id)" "root: root_run_id = own run_id"
assert_eq "0" "$(json_field "$M_ROOT" depth)" "root: depth 0"

# =========================================================================
# 2. CHILD manifest: lineage env set (parent + root + depth)
# =========================================================================
run_hetero child1 AUTOPILOT_PARENT_RUN_ID=foreman-A AUTOPILOT_ROOT_RUN_ID=root-A AUTOPILOT_DISPATCH_DEPTH=1
M_CHILD="$RUNS/child1.manifest.json"
assert_eq "foreman-A" "$(json_field "$M_CHILD" parent_run_id)" "child: parent_run_id = parent"
assert_eq "root-A" "$(json_field "$M_CHILD" root_run_id)" "child: root_run_id = given root"
assert_eq "1" "$(json_field "$M_CHILD" depth)" "child: depth passed through"

# 2b. parent set, ROOT unset → root falls back to parent
run_hetero child2 AUTOPILOT_PARENT_RUN_ID=foreman-B
M_C2="$RUNS/child2.manifest.json"
assert_eq "foreman-B" "$(json_field "$M_C2" parent_run_id)" "child2: parent set"
assert_eq "foreman-B" "$(json_field "$M_C2" root_run_id)" "child2: root falls back to parent"
assert_eq "1" "$(json_field "$M_C2" depth)" "child2: depth default 1 (parent set, depth unset)"

# =========================================================================
# 3. non-numeric depth coerced to 1
# =========================================================================
run_hetero child3 AUTOPILOT_PARENT_RUN_ID=foreman-C AUTOPILOT_DISPATCH_DEPTH=not-a-number
assert_eq "1" "$(json_field "$RUNS/child3.manifest.json" depth)" "non-numeric depth coerced to 1"

# =========================================================================
# 4. child-env propagation: WORKER env carries parent=<own run_id>, depth+1
# =========================================================================
# child1 ran at depth 1 → worker should see parent=child1, root=root-A, depth=2
assert_file_exists "$ENVDUMP" "worker env dump captured"
# (ENVDUMP is overwritten each run; last run was child3 at depth 1 → worker depth 2)
assert_contains "$(cat "$ENVDUMP")" "AUTOPILOT_PARENT_RUN_ID=child3" "worker parent = own run_id"
assert_contains "$(cat "$ENVDUMP")" "AUTOPILOT_DISPATCH_DEPTH=2" "worker depth = own depth + 1"

# =========================================================================
# 5. DETACH path: lineage survives declare -p serialization (CRITICAL)
# =========================================================================
if command -v setsid >/dev/null 2>&1; then
  LEDGER="$TEST_TMP/detach-ledger.jsonl"
  ( cd "$SBX" && env AUTOPILOT_PARENT_RUN_ID=foreman-D AUTOPILOT_ROOT_RUN_ID=root-D AUTOPILOT_DISPATCH_DEPTH=2 \
      AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" DISPATCH_QUIET=1 \
      "$HETERO" --branch feat/detach1 --prompt-file "$PROMPT" --agy-bin "$STUB_OK" \
      --run-id detach1 --ledger "$LEDGER" --stage implement >/dev/null 2>&1 )
  M_DET="$RUNS/detach1.manifest.json"
  assert_file_exists "$M_DET" "detach manifest written by detached child"
  assert_eq "foreman-D" "$(json_field "$M_DET" parent_run_id)" "detach: parent survived declare -p"
  assert_eq "root-D" "$(json_field "$M_DET" root_run_id)" "detach: root survived declare -p"
  assert_eq "2" "$(json_field "$M_DET" depth)" "detach: depth survived declare -p"
else
  echo "  (skip detach test: setsid unavailable)"
fi

# =========================================================================
# 6. AUTOPILOT_DISPATCH_MANIFEST=0 writes NO manifest
# =========================================================================
( cd "$SBX" && env AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" DISPATCH_DETACH=0 DISPATCH_QUIET=1 AUTOPILOT_DISPATCH_MANIFEST=0 \
    "$HETERO" --branch feat/nomani --prompt-file "$PROMPT" --agy-bin "$STUB_OK" --run-id nomani1 >/dev/null 2>&1 )
assert_file_absent "$RUNS/nomani1.manifest.json" "AUTOPILOT_DISPATCH_MANIFEST=0 writes no manifest"

# =========================================================================
# 7. review manifest lineage
# =========================================================================
DIFF="$TEST_TMP/x.diff"
printf 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -0,0 +1 @@\n+x\n' > "$DIFF"
STUB_REV="$TEST_TMP/eng-rev"
cat > "$STUB_REV" <<'EOF'
#!/usr/bin/env bash
in="$(cat 2>/dev/null)"
# echo the fresh-nonce marker back as a prefix so the wrapped-block parser accepts it
marker="$(printf '%s' "$in" | grep -oE 'AUTOPILOT-REVIEW-[A-Za-z0-9]+' | head -1)"
printf '%s\nVERDICT: SHIP-AS-IS\nFINDINGS: none\n' "$marker"
EOF
chmod +x "$STUB_REV"
( env AUTOPILOT_PARENT_RUN_ID=foreman-R AUTOPILOT_ROOT_RUN_ID=root-R AUTOPILOT_DISPATCH_DEPTH=1 \
    AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" DISPATCH_DETACH=0 DISPATCH_QUIET=1 \
    "$REVIEW" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_REV" --run-id rev1 >/dev/null 2>&1 )
M_REV="$RUNS/rev1.manifest.json"
assert_file_exists "$M_REV" "review manifest written"
assert_eq "foreman-R" "$(json_field "$M_REV" parent_run_id)" "review: parent_run_id propagated"
assert_eq "root-R" "$(json_field "$M_REV" root_run_id)" "review: root_run_id propagated"
assert_eq "1" "$(json_field "$M_REV" depth)" "review: depth propagated"

# =========================================================================
# 8. dispatch-status.js --list surfaces lineage fields
# =========================================================================
LIST="$(node "$STATUS" --list --dir "$RUNS" 2>/dev/null)"
CHILD_ROW="$(printf '%s' "$LIST" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s);const r=a.find(x=>x.run_id==="child1");process.stdout.write(JSON.stringify(r||{}))})')"
assert_contains "$CHILD_ROW" '"parent_run_id":"foreman-A"' "list row carries parent_run_id"
assert_contains "$CHILD_ROW" '"root_run_id":"root-A"' "list row carries root_run_id"
assert_contains "$CHILD_ROW" '"depth":1' "list row carries depth"

# =========================================================================
# 9. watch-foreman --root: zero cross-attribution + time-window tagging
# =========================================================================
WFR="$TEST_TMP/wf-runs"; mkdir -p "$WFR"
LG="$TEST_TMP/wf-ledger.jsonl"; : > "$LG"; touch "$LG"
mk_m() { # id root(-null-for-none) log
  local id="$1" root="$2" log="$3" rootjson
  if [ "$root" = "-" ]; then rootjson="null"; else rootjson="\"$root\""; fi
  printf '{"schema":1,"run_id":"%s","role":"implementer","runner":"agy","model":"m","log_path":"%s","started_epoch":%s,"root_run_id":%s,"parent_run_id":"p","depth":1}\n' \
    "$id" "$log" "$(date +%s)" "$rootjson" > "$WFR/$id.manifest.json"
}
: > "$WFR/l.log"
mk_m leaf-mine root-X "$WFR/l.log"      # matches --root root-X
mk_m leaf-other root-Y "$WFR/l.log"     # different root → must NOT appear
mk_m leaf-legacy - "$WFR/l.log"         # no lineage → time-window fallback (tagged)

OUT_ROOT="$(node "$WF" --ledger "$LG" --runs-dir "$WFR" --root root-X --quiet-secs 600 --once 2>&1)"
assert_contains "$OUT_ROOT" "LEAF_START leaf-mine" "--root: matching-root leaf appears"
assert_not_contains "$OUT_ROOT" "leaf-other" "--root: non-matching root leaf ZERO cross-attribution"
assert_contains "$OUT_ROOT" "LEAF_START leaf-legacy" "--root: lineage-less leaf falls back to time-window"
assert_contains "$OUT_ROOT" "leaf-legacy role=implementer agy/m attribution=time-window" "--root: legacy leaf tagged attribution=time-window"
assert_not_contains "$OUT_ROOT" "leaf-mine role=implementer agy/m attribution=time-window" "--root: lineage-true leaf NOT tagged as a guess"

# WITHOUT --root: unfiltered + untagged (byte-compatible behavior)
OUT_NOROOT="$(node "$WF" --ledger "$LG" --runs-dir "$WFR" --quiet-secs 600 --once 2>&1)"
assert_contains "$OUT_NOROOT" "LEAF_START leaf-other" "no --root: all leaves appear (unfiltered)"
assert_not_contains "$OUT_NOROOT" "attribution=time-window" "no --root: no attribution tag anywhere"

# =========================================================================
# 10. autopilot status runs --tree: fold parent→child + synthetic external root
# =========================================================================
TREE_RUNS="$TEST_TMP/tree-runs"; mkdir -p "$TREE_RUNS"
tm() { # id parent root depth
  local id="$1" parent="$2" root="$3" depth="$4" pjson
  if [ "$parent" = "-" ]; then pjson="null"; else pjson="\"$parent\""; fi
  printf '{"schema":1,"run_id":"%s","role":"implementer","runner":"agy","model":"m","started_at":"2026-07-15T00:00:0%s","ended_at":"2026-07-15T00:00:0%s","final_status":"committed","parent_run_id":%s,"root_run_id":"%s","depth":%s}\n' \
    "$id" "$depth" "$depth" "$pjson" "$root" "$depth" > "$TREE_RUNS/$id.manifest.json"
}
tm rootrun - rootrun 0
tm kidrun rootrun rootrun 1
tm orphan ext-foreman ext-foreman 1   # parent ext-foreman has NO manifest → synthetic external
TREE_JSON="$(AUTOPILOT_DISPATCH_RUNS_DIR="$TREE_RUNS" node "$CLI" status runs --tree --json 2>/dev/null)"
# rootrun is a root with kidrun as child; ext-foreman is a synthetic external root with orphan child
assert_contains "$TREE_JSON" '"synthetic_external": true' "tree: synthetic external node present"
assert_contains "$TREE_JSON" '"run_id": "ext-foreman"' "tree: external root id is the referenced parent"
CHILD_UNDER_ROOT="$(printf '%s' "$TREE_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s);const r=a.find(n=>n.run_id==="rootrun");process.stdout.write(r&&r.children&&r.children.some(c=>c.run_id==="kidrun")?"yes":"no")})')"
assert_eq "yes" "$CHILD_UNDER_ROOT" "tree: kidrun folded under rootrun"
EXT_CHILD="$(printf '%s' "$TREE_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s);const r=a.find(n=>n.synthetic_external);process.stdout.write(r&&r.children&&r.children.some(c=>c.run_id==="orphan")?"yes":"no")})')"
assert_eq "yes" "$EXT_CHILD" "tree: orphan folded under synthetic external root"

# default runs (no --tree) stays flat — no synthetic nodes leak in
FLAT_JSON="$(AUTOPILOT_DISPATCH_RUNS_DIR="$TREE_RUNS" node "$CLI" status runs --json 2>/dev/null)"
assert_not_contains "$FLAT_JSON" "synthetic_external" "default runs --json stays flat (no synthetic nodes)"

finalize_test
