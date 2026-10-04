#!/usr/bin/env bash
# dispatch-job-root.test.sh — mods P1W W1f: ad-hoc dispatches from ONE marked session share
# the session's job root (marker root_run_id) instead of each becoming its own lineage root.
#
# RED record (before implementation): 26 passed, 11 failed — every marker/job-root assertion failed
# (mint, `root` subcommand, hetero/review/author shared root, review worker env); only the
# "unchanged" controls (no marker, explicit parent, ROOT-without-parent, expired marker) passed.
# GREEN after implementation: 37 assertions.
#
# Reason the rail ignores AUTOPILOT_ROOT_RUN_ID without a parent (dispatch-hetero.sh:1893-1903):
# rehydration/campaign re-attach set ROOT without PARENT; that configuration must keep its
# old behaviour. So the job root is adopted ONLY when ROOT env is empty AND no parent.
. "$(dirname "$0")/lib.sh"

SM="$REPO_ROOT/scripts/session-mode.js"
HETERO="$REPO_ROOT/scripts/dispatch-hetero.sh"
REVIEW="$REPO_ROOT/scripts/dispatch-review.sh"
AUTHOR="$REPO_ROOT/scripts/dispatch-author.sh"

LIVE_FIX="$(mktemp -d -p /dev/shm autopilot-test-jobroot-XXXXXX)"
chmod 700 "$LIVE_FIX"
export AUTOPILOT_LIVE_DIR="$LIVE_FIX"
trap 'rm -rf "$LIVE_FIX"; cleanup_test_tmp' EXIT
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/markers"
mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
unset AUTOPILOT_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID AUTOPILOT_DISPATCH_DEPTH AUTOPILOT_SESSION_ID
RUNS="$TEST_TMP/runs"; mkdir -p "$RUNS"
export AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" DISPATCH_DETACH=0 DISPATCH_QUIET=1

SBX="$TEST_TMP/repo"; mkdir -p "$SBX"
git -C "$SBX" init -q -b develop
git -C "$SBX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
PROMPT="$TEST_TMP/prompt.txt"; echo "create ok.txt" > "$PROMPT"
STUB_OK="$TEST_TMP/agy-ok"
cat > "$STUB_OK" <<'STUB'
#!/usr/bin/env bash
echo ok > ok.txt
git add ok.txt
git -c user.email=t@t -c user.name=t commit -q -m "test: smoke"
STUB
chmod +x "$STUB_OK"; make_agy_stub_versioned "$STUB_OK"
DIFF="$TEST_TMP/x.diff"
printf 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -0,0 +1 @@\n+x\n' > "$DIFF"
STUB_REV="$TEST_TMP/eng-rev"
cat > "$STUB_REV" <<'STUB'
#!/usr/bin/env bash
in="$(cat 2>/dev/null)"
marker="$(printf '%s' "$in" | grep -oE 'AUTOPILOT-REVIEW-[A-Za-z0-9]+' | head -1)"
printf '%s\nVERDICT: SHIP-AS-IS\nFINDINGS: none\n' "$marker"
STUB
chmod +x "$STUB_REV"
STUB_AUTH="$TEST_TMP/runner-auth"
cat > "$STUB_AUTH" <<'STUB'
#!/usr/bin/env bash
prompt=$(cat || true)
begin=$(printf '%s\n' "$prompt" | grep -E '^<<<AUTOPILOT-AUTHOR-[0-9a-f]{32}>>>$' | head -n1)
end=$(printf '%s\n' "$prompt" | grep -E '^<<<AUTOPILOT-END-[0-9a-f]{32}>>>$' | head -n1)
if [ -n "$begin" ] && [ -n "$end" ]; then printf '%s\n%s\n%s\n' "$begin" "OK-WRITTEN" "$end"; else echo "OK-WRITTEN"; fi
STUB
chmod +x "$STUB_AUTH"

eq() { assert_eq "$2" "$1" "$3"; }
jf() { node -e 'const m=require(process.argv[1]);const v=m[process.argv[2]];process.stdout.write(v===null?"null":v===undefined?"undefined":String(v))' "$1" "$2"; }
run_hetero() { local id="$1"; shift; ( cd "$SBX" && env "$@" "$HETERO" --branch "feat/$id" --prompt-file "$PROMPT" --agy-bin "$STUB_OK" --run-id "$id" >/dev/null 2>&1 ); }
run_review() { local id="$1"; shift; ( env "$@" "$REVIEW" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_REV" --run-id "$id" >/dev/null 2>&1 ); }
run_author() { local id="$1"; shift; ( env "$@" "$AUTHOR" --runner claude-native --model claude-fable-5-1 --prompt-file "$PROMPT" --bin "$STUB_AUTH" --run-id "$id" >/dev/null 2>&1 ); }

# --- A. no marker: old behaviour (each dispatch its own root), `root` prints nothing ---
export CLAUDE_CODE_SESSION_ID="jobroot-sess-A"
eq "" "$(node "$SM" root)" "root: no marker prints empty"
run_hetero nm1; run_review nmr1; run_author nma1
eq "nm1" "$(jf "$RUNS/nm1.manifest.json" root_run_id)" "no marker: hetero root = own run id"
eq "nmr1" "$(jf "$RUNS/nmr1.manifest.json" root_run_id)" "no marker: review root = own run id"
eq "nma1" "$(jf "$RUNS/nma1.manifest.json" root_run_id)" "no marker: author root = own run id"

# --- B. set mints a job root; marker stores it; `root` prints it ---
node "$SM" set --level l3 --repo-root "$SBX" >/dev/null 2>&1
MARK="$AUTOPILOT_SESSION_MODE_DIR/jobroot-sess-A.json"
MROOT="$(jf "$MARK" root_run_id)"
MINT_OK=no; printf '%s' "$MROOT" | grep -Eq '^job-[0-9]+-[0-9a-f]{8}$' && MINT_OK=yes
eq "yes" "$MINT_OK" "set mints job-<ts>-<rand> root (got: $MROOT)"
eq "$MROOT" "$(node "$SM" root)" "root subcommand prints marker root"
# re-set keeps nothing stale: explicit --root-run-id wins and env wins over mint
node "$SM" set --level l3 --repo-root "$SBX" --root-run-id job-explicit-1 >/dev/null 2>&1
eq "job-explicit-1" "$(node "$SM" root)" "set --root-run-id explicit"
AUTOPILOT_ROOT_RUN_ID=mission-envroot node "$SM" set --level l3 --repo-root "$SBX" >/dev/null 2>&1
eq "mission-envroot" "$(node "$SM" root)" "set keeps AUTOPILOT_ROOT_RUN_ID (campaign root untouched)"
node "$SM" set --level l3 --repo-root "$SBX" --root-run-id job-shared-1 >/dev/null 2>&1

# --- C. two dispatches per rail from one marked session share the marker root ---
run_hetero h1; run_hetero h2; run_review r1; run_review r2; run_author a1; run_author a2
for id in h1 h2 r1 r2 a1 a2; do
  eq "job-shared-1" "$(jf "$RUNS/$id.manifest.json" root_run_id)" "marked session: $id root = job root"
  eq "null" "$(jf "$RUNS/$id.manifest.json" parent_run_id)" "marked session: $id parent stays null"
  eq "0" "$(jf "$RUNS/$id.manifest.json" depth)" "marked session: $id depth stays 0"
done

# --- D. explicit parent wins (child keeps given root / falls back to parent) ---
run_hetero e1 AUTOPILOT_PARENT_RUN_ID=foreman-X AUTOPILOT_ROOT_RUN_ID=root-X AUTOPILOT_DISPATCH_DEPTH=1
eq "root-X" "$(jf "$RUNS/e1.manifest.json" root_run_id)" "explicit parent+root wins over marker (hetero)"
run_hetero e2 AUTOPILOT_PARENT_RUN_ID=foreman-Y
eq "foreman-Y" "$(jf "$RUNS/e2.manifest.json" root_run_id)" "explicit parent falls back to parent, not marker (hetero)"
run_review e3 AUTOPILOT_PARENT_RUN_ID=foreman-Z
eq "foreman-Z" "$(jf "$RUNS/e3.manifest.json" root_run_id)" "explicit parent wins (review)"
run_author e4 AUTOPILOT_PARENT_RUN_ID=foreman-W
eq "foreman-W" "$(jf "$RUNS/e4.manifest.json" root_run_id)" "explicit parent wins (author)"

# --- E. campaign / rehydration shape: ROOT env without parent keeps old behaviour ---
run_review c1 AUTOPILOT_ROOT_RUN_ID=campaign-v1-abc
eq "c1" "$(jf "$RUNS/c1.manifest.json" root_run_id)" "ROOT env without parent: review unchanged (own root)"
run_author c2 AUTOPILOT_ROOT_RUN_ID=mission-abc
eq "c2" "$(jf "$RUNS/c2.manifest.json" root_run_id)" "ROOT env without parent: author unchanged (own root)"
run_hetero c3 AUTOPILOT_ROOT_RUN_ID=mission-abc
eq "c3" "$(jf "$RUNS/c3.manifest.json" root_run_id)" "ROOT env without parent: hetero unchanged (own root)"

# --- F. expired marker is ignored ---
node -e 'const fs=require("fs");const f=process.argv[1];const m=JSON.parse(fs.readFileSync(f));m.expires_at="2000-01-01T00:00:00Z";fs.writeFileSync(f,JSON.stringify(m))' "$MARK"
eq "" "$(node "$SM" root)" "root: expired marker prints empty"
run_review x1
eq "x1" "$(jf "$RUNS/x1.manifest.json" root_run_id)" "expired marker: old behaviour"

# --- G. children of a marked review inherit the job root via exported env ---
node "$SM" set --level l3 --repo-root "$SBX" --root-run-id job-shared-2 >/dev/null 2>&1
ENVDUMP="$TEST_TMP/rev-env.txt"
STUB_REV2="$TEST_TMP/eng-rev2"
cat > "$STUB_REV2" <<STUB
#!/usr/bin/env bash
env | grep -E '^AUTOPILOT_(PARENT|ROOT)_RUN_ID' > "$ENVDUMP"
in="\$(cat 2>/dev/null)"
marker="\$(printf '%s' "\$in" | grep -oE 'AUTOPILOT-REVIEW-[A-Za-z0-9]+' | head -1)"
printf '%s\nVERDICT: SHIP-AS-IS\nFINDINGS: none\n' "\$marker"
STUB
chmod +x "$STUB_REV2"
( "$REVIEW" --runner codex --model gpt-5.5 --diff-file "$DIFF" --bin "$STUB_REV2" --run-id rv9 >/dev/null 2>&1 )
assert_contains "$(cat "$ENVDUMP" 2>/dev/null)" "AUTOPILOT_ROOT_RUN_ID=job-shared-2" "review worker env carries job root"
assert_contains "$(cat "$ENVDUMP" 2>/dev/null)" "AUTOPILOT_PARENT_RUN_ID=rv9" "review worker env parent = own run id"

finalize_test
