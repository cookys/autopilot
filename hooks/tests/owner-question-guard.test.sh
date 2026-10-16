#!/usr/bin/env bash
# Test for owner-question-guard.js — Stop hook that blocks (once) a reply that waits for the owner
# without naming a decision card id. Transcript fixtures live in TEST_TMP only.
. "$(dirname "$0")/lib.sh"

mkdir -p "$TEST_TMP/t"
# mk <name> <assistant text> : transcript with one user turn then one assistant text entry.
mk() {
  node -e '
    const fs=require("fs");
    const [f,text]=process.argv.slice(1);
    const u={type:"user",message:{role:"user",content:"go"}};
    const a={type:"assistant",message:{role:"assistant",content:[{type:"tool_use",name:"Bash",input:{}},{type:"text",text}]}};
    fs.writeFileSync(f,JSON.stringify(u)+"\n"+JSON.stringify(a)+"\n");
  ' "$TEST_TMP/t/$1.jsonl" "$2"
}
payload() { printf '{"session_id":"s","transcript_path":"%s","stop_hook_active":%s}' "$TEST_TMP/t/$1.jsonl" "${2:-false}"; }
expect_block() { run_hook owner-question-guard.js "$(payload "$1" "${3:-false}")"; assert_eq 0 "$__RUN_EXIT" "$2: exit 0"; assert_contains "$__RUN_STDOUT" '"decision":"block"' "$2: blocks"; }
expect_pass() { run_hook owner-question-guard.js "$(payload "$1" "${3:-false}")"; assert_eq 0 "$__RUN_EXIT" "$2: exit 0"; assert_eq "" "$__RUN_STDOUT" "$2: silent"; }

mk zh '已完成清理。可以強制刪嗎？你說可以我再刪。'
expect_block zh "zh question without card"
assert_contains "$__RUN_STDOUT" "open-decision.js" "reason names open-decision.js"

mk en 'Cleanup finished. Should I force-delete the branch?'
expect_block en "en question without card"

mk zh_wait '分支還在，請你決定要不要刪。'
expect_block zh_wait "zh wait phrase"

mk please '請決定要不要刪。'
expect_block please "please-decide without 你"
mk look '請看 hooks/README.md 第三段，結果如下。'
expect_pass look "請看 is not a wait"
mk cardup '可以刪嗎？見 D-4290499D。'
expect_pass cardup "uppercase card id"
mk card '可以強制刪嗎？見待決 d-4290499d。'
expect_pass card "question with card id"

mk active '可以強制刪嗎？你說可以我再刪。'
expect_pass active "stop_hook_active=true" true

mk report '已完成。測試全綠，共 12 項，沒有待決事項。'
expect_pass report "report without question"

mk code 'Run `grep -c "a?"` then:
```
echo "你要不要?"
```
done.'
expect_pass code "question mark only in code"

mk relay_q 'fleet 問我：『這個 branch 要不要合？』我已轉給 owner 的卡片處理。'
expect_pass relay_q "quoted relay (corner quotes)"
mk relay_dq 'fleet asked me "should you merge this branch?" and I forwarded it.'
expect_pass relay_dq "quoted relay (double quotes)"
mk relay_bq 'fleet 的訊息如下：
> 這個 branch 要不要合？
已轉發。'
expect_pass relay_bq "markdown quote line relay"
mk relay_after '他說「先不用」，那你要不要我繼續？'
expect_block relay_after "question outside quotes still blocks"
mk relay_raw 'fleet 問我：這個 branch 要不要合？我已轉給 owner。'
expect_block relay_raw "unquoted relay still blocks (known false positive, documented)"

# only the LAST assistant text counts: older question, final report clean
node -e '
  const fs=require("fs");const f=process.argv[1];
  const L=[{type:"user",message:{role:"user",content:"a"}},
    {type:"assistant",message:{role:"assistant",content:[{type:"text",text:"要不要刪？"}]}},
    {type:"user",message:{role:"user",content:"刪"}},
    {type:"assistant",message:{role:"assistant",content:[{type:"text",text:"已刪除，完成。"}]}}];
  fs.writeFileSync(f,L.map(x=>JSON.stringify(x)).join("\n")+"\n");' "$TEST_TMP/t/old.jsonl"
expect_pass old "older question, clean last message"

# fail-open
run_hook owner-question-guard.js "$(payload missing)"
assert_eq 0 "$__RUN_EXIT" "missing transcript: exit 0"; assert_eq "" "$__RUN_STDOUT" "missing transcript: silent"
printf 'not json\n{broken\n' > "$TEST_TMP/t/bad.jsonl"
expect_pass bad "bad JSON transcript"
run_hook owner-question-guard.js 'garbage'
assert_eq 0 "$__RUN_EXIT" "bad stdin: exit 0"; assert_eq "" "$__RUN_STDOUT" "bad stdin: silent"

# opt-out
AUTOPILOT_OWNER_QUESTION_GUARD=off run_hook owner-question-guard.js "$(payload zh)"
assert_eq "" "$__RUN_STDOUT" "env off: silent"
mkdir -p "$HOOK_HOME/.autopilot"
printf '{"owner_question_guard":false}' > "$HOOK_HOME/.autopilot/config.json"
run_hook owner-question-guard.js "$(payload zh)"
assert_eq "" "$__RUN_STDOUT" "config false: silent"

finalize_test
