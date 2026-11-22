#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
require_hippo_or_skip open-decision-mirror
. "$(dirname "$0")/lib/hippo-sandbox.sh"
hs_setup
PLUGIN="${AP_PLUGIN_ROOT:-$REPO_ROOT}"
R="$(hs_mkrepo card store)"
ID="$(node -e 'const x=require(process.argv[1]).openDecision({cwd:process.argv[2],question:"Mirror question?",executor:"test/test/test"}); console.log(x.id)' "$PLUGIN/scripts/open-decision.js" "$R")"
COUNT="$("$HIPPO_BIN" --json -C "$R" list --tag "key:card:$ID" --history | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>console.log(JSON.parse(s).data.records.length))')"
assert_eq "$COUNT" 1 'open creates one keyed decision'
OPENREC="$("$HIPPO_BIN" --json -C "$R" list --tag "key:card:$ID" --history | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>console.log(JSON.stringify(JSON.parse(s).data.records[0])))')"
assert_contains "$OPENREC" 'source:open-decision' 'open has source tag'
OPENID="$(node -e 'console.log(JSON.parse(process.argv[1]).id)' "$OPENREC")"
OPENBODY="$("$HIPPO_BIN" --json -C "$R" show "$OPENID" | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>console.log(JSON.parse(s).data.record.body.trimEnd()))')"
assert_eq "$OPENBODY" 'Mirror question?' 'open body is question'
node "$PLUGIN/scripts/open-decision.js" close --cwd "$R" --id "$ID" --answer 'A clear answer' >/dev/null 2>"$TEST_TMP/answer.err"
REC="$("$HIPPO_BIN" --json -C "$R" list --tag "key:card:$ID" --history | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>console.log(JSON.parse(s).data.records[0].id))')"
BODY="$("$HIPPO_BIN" --json -C "$R" show "$REC" | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>console.log(JSON.parse(s).data.record.body))')"
assert_contains "$BODY" 'A clear answer' 'answer is mirrored'
node "$PLUGIN/scripts/open-decision.js" done --cwd "$R" --id "$ID" --note 'executed' >/dev/null 2>"$TEST_TMP/done.err"
STATUS="$("$HIPPO_BIN" --json -C "$R" show "$REC" | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>console.log(JSON.parse(s).data.record.status))')"
assert_eq "$STATUS" done 'done is mirrored'
ID2="$(node -e 'const x=require(process.argv[1]).openDecision({cwd:process.argv[2],question:"Withdraw question?"}); console.log(x.id)' "$PLUGIN/scripts/open-decision.js" "$R")"
node "$PLUGIN/scripts/open-decision.js" close --cwd "$R" --id "$ID2" --withdraw obsolete --by test >/dev/null 2>"$TEST_TMP/withdraw.err"
REC2="$("$HIPPO_BIN" --json -C "$R" list --tag "key:card:$ID2" --history | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>console.log(JSON.parse(s).data.records[0].id))')"
STATUS2="$("$HIPPO_BIN" --json -C "$R" show "$REC2" | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>console.log(JSON.parse(s).data.record.status))')"
assert_eq "$STATUS2" cancelled 'withdrawal is mirrored'
BEFORE="$(find "$R/.hippo" -type f -exec sha256sum {} + | sort)"
node "$PLUGIN/scripts/open-decision.js" close --cwd "$R" --id "$ID2" --withdraw obsolete --by test >/dev/null 2>"$TEST_TMP/retry.err"
AFTER="$(find "$R/.hippo" -type f -exec sha256sum {} + | sort)"
assert_eq "$AFTER" "$BEFORE" 'repeated close writes no store operations'
BROKEN="$(HIPPO_BIN="$TEST_TMP/missing-hippo" node -e 'const x=require(process.argv[1]).openDecision({cwd:process.argv[2],question:"Broken store?"}); console.log(JSON.stringify(x))' "$PLUGIN/scripts/open-decision.js" "$R" 2>"$TEST_TMP/broken.err")"; RC=$?
assert_eq "$RC" 0 'broken store preserves exit code'
assert_contains "$BROKEN" '"status":"ok"' 'broken store preserves card creation'
assert_contains "$(cat "$TEST_TMP/broken.err")" 'decision store mirror failed' 'broken store gives hint'
hs_exit_check
finalize_test
