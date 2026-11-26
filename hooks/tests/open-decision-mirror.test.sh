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
RECEIPTS="$("$HIPPO_BIN" --json -C "$R" list --tag 'source:pm-ruling' --history | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>console.log(JSON.stringify(JSON.parse(s).data.records)))')"
assert_eq "$(node -e 'console.log(JSON.parse(process.argv[1]).length)' "$RECEIPTS")" 1 'answer creates one ruling receipt'
RECEIPT_ID="$(node -e 'console.log((JSON.parse(process.argv[1])[0] || {}).id || "")' "$RECEIPTS")"
if [ -n "$RECEIPT_ID" ]; then
  RECEIPT_BODY="$("$HIPPO_BIN" --json -C "$R" show "$RECEIPT_ID" | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>console.log(JSON.parse(s).data.record.body))')"
  assert_contains "$RECEIPT_BODY" 'A clear answer' 'receipt contains the ruling'
  assert_contains "$RECEIPT_BODY" "$ID" 'receipt references the card'
fi
PANEL="$(node -e 'const x=require(process.argv[1]).openDecision({cwd:process.argv[2],question:"Panel question?",executor:"test/test/test"}); console.log(JSON.stringify(x))' "$PLUGIN/scripts/open-decision.js" "$R")"
PANEL_ID="$(node -e 'console.log(JSON.parse(process.argv[1]).id)' "$PANEL")"
PANEL_FILE="$(node -e 'console.log(JSON.parse(process.argv[1]).file)' "$PANEL")"
deliver_panel() {
  node -e 'const m=require(process.argv[1]); const r=m.deliverAnswer(process.argv[2],process.argv[3],{answer_id:"answer:Test",answer:{option:"A",free_text:"Panel ruling"}},()=>({ok:true,message_id:"test-message"})); if (!["sent","already"].includes(r.status)) process.exit(1)' "$PLUGIN/scripts/open-decision.js" "$PANEL_FILE" "$PANEL_ID"
}
deliver_panel
PANEL_RECEIPT="$("$HIPPO_BIN" --json -C "$R" list --tag 'source:pm-ruling' --history | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>console.log(JSON.parse(s).data.records.find(r=>r.tags.includes("key:receipt:"+require("crypto").createHash("sha256").update("answer:Test").digest("hex").slice(0,32))).id))')"
PANEL_BODY="$("$HIPPO_BIN" --json -C "$R" show "$PANEL_RECEIPT" | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>console.log(JSON.parse(s).data.record.body))')"
assert_contains "$PANEL_BODY" 'Panel ruling' 'panel receipt contains free text'
assert_contains "$PANEL_BODY" 'Option: A' 'panel receipt contains chosen option'
assert_contains "$PANEL_BODY" "$PANEL_ID" 'panel receipt references card'
BEFORE_PANEL="$(find "$R/.hippo" -type f -exec sha256sum {} + | sort)"
deliver_panel
AFTER_PANEL="$(find "$R/.hippo" -type f -exec sha256sum {} + | sort)"
assert_eq "$AFTER_PANEL" "$BEFORE_PANEL" 'redelivered answer writes no store operations'
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
assert_contains "$(cat "$TEST_TMP/broken.err")" '(card, detect, repo=' 'broken store names the failing branch and repo'
assert_contains "$(cat "$TEST_TMP/broken.err")" "$R" 'broken store hint carries the repo path'
FILES_REPO="$(hs_mkrepo files)"
cat > "$TEST_TMP/hippo-spy" <<'EOF'
#!/bin/sh
printf 'called\n' >> "$HIPPO_SPY_LOG"
exit 1
EOF
chmod +x "$TEST_TMP/hippo-spy"
export HIPPO_SPY_LOG="$TEST_TMP/hippo-spy.log"
FILES_ID="$(HIPPO_BIN="$TEST_TMP/hippo-spy" node -e 'const x=require(process.argv[1]).openDecision({cwd:process.argv[2],question:"Files question?"}); console.log(x.id)' "$PLUGIN/scripts/open-decision.js" "$FILES_REPO")"
HIPPO_BIN="$TEST_TMP/hippo-spy" node "$PLUGIN/scripts/open-decision.js" close --cwd "$FILES_REPO" --id "$FILES_ID" --answer 'Files answer' >/dev/null
assert_eq "$([ -e "$HIPPO_SPY_LOG" ] && echo called || echo untouched)" untouched 'files state makes no store call'
# A seat whose git user.name carries a host name: without HIPPO_ACTOR the mirror must still pass the leak guard.
printf 'patterns = [{ id = "local-test", regex = "hostxyz" }]\n' > "$HIPPO_CONFIG_DIR/leak-guard.toml"
LEAK_REPO="$(hs_mkrepo leak store)"
git -C "$LEAK_REPO" config user.name 'cookys hostxyz'
env -u HIPPO_ACTOR node -e 'require(process.argv[1]).openDecision({cwd:process.argv[2],question:"Leak question?",executor:"test/test/test"})' "$PLUGIN/scripts/open-decision.js" "$LEAK_REPO" >/dev/null 2>"$TEST_TMP/leak.err"
assert_eq "$(command grep -c 'mirror failed' "$TEST_TMP/leak.err")" 0 'host-named seat mirrors without a leak refusal'
assert_eq "$(command grep -ho '"actor":"[^"]*"' "$LEAK_REPO"/.hippo/ops/*.jsonl | sort -u | command grep -c 'seat/open-decision')" 1 'mirror ops carry the role actor'
hs_exit_check
finalize_test
