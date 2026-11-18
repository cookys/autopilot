#!/usr/bin/env bash
# pm-switchboard.test.sh — hermetic tests for scripts/pm-switchboard.js,
# scripts/pm-inbox-done.js, scripts/lib/pm-inbox-adapter.js,
# scripts/lib/pm-result-rules.js, and scripts/systemd/pm-switchboard.{service,timer}.

. "$(dirname "$0")/lib.sh"

unset AUTOPILOT_TOKEN_SEAT AUTOPILOT_SESSION_ID AUTOPILOT_CHILD_SESSION_ID
unset AUTOPILOT_PM_SWITCHBOARD AUTOPILOT_PM_INBOX_ADAPTER AUTOPILOT_FLEET_REPO
unset AUTOPILOT_PM_INBOX_MEMBER AUTOPILOT_PM_ACCEPT_CMD

export XDG_RUNTIME_DIR="$TEST_TMP/xdg-run"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

SWITCHBOARD_JS="$REPO_ROOT/scripts/pm-switchboard.js"
INBOX_DONE_JS="$REPO_ROOT/scripts/pm-inbox-done.js"
ADAPTER_JS="$REPO_ROOT/scripts/lib/pm-inbox-adapter.js"
RESULT_RULES_JS="$REPO_ROOT/scripts/lib/pm-result-rules.js"
SWB_SERVICE="$REPO_ROOT/scripts/systemd/pm-switchboard.service"
SWB_TIMER="$REPO_ROOT/scripts/systemd/pm-switchboard.timer"

# --- 0. Shipped files, Codex plugin mirrors, systemd templates, and forbidden strings ---
assert_file_exists "$SWITCHBOARD_JS" "scripts/pm-switchboard.js exists"
assert_file_exists "$INBOX_DONE_JS" "scripts/pm-inbox-done.js exists"
assert_file_exists "$ADAPTER_JS" "scripts/lib/pm-inbox-adapter.js exists"
assert_file_exists "$RESULT_RULES_JS" "scripts/lib/pm-result-rules.js exists"
assert_file_exists "$SWB_SERVICE" "scripts/systemd/pm-switchboard.service exists"
assert_file_exists "$SWB_TIMER" "scripts/systemd/pm-switchboard.timer exists"

for rel in \
  scripts/pm-switchboard.js \
  scripts/pm-inbox-done.js \
  scripts/lib/pm-inbox-adapter.js \
  scripts/lib/pm-result-rules.js \
  scripts/systemd/pm-switchboard.service \
  scripts/systemd/pm-switchboard.timer
do
  assert_file_exists "$REPO_ROOT/platforms/codex/plugin/$rel" "codex mirror exists for $rel"
  cmp -s "$REPO_ROOT/$rel" "$REPO_ROOT/platforms/codex/plugin/$rel"
  assert_eq "$?" "0" "$rel matches codex mirror byte-for-byte"
done

SERVICE_TEXT="$(cat "$SWB_SERVICE")"
TIMER_TEXT="$(cat "$SWB_TIMER")"
assert_contains "$SERVICE_TEXT" "@REPO_PATH@/scripts/pm-switchboard.js run" "service template uses @REPO_PATH@"
assert_contains "$SERVICE_TEXT" "AUTOPILOT_FLEET_REPO=@FLEET_REPO@" "service template uses @FLEET_REPO@"
assert_contains "$SERVICE_TEXT" "UnsetEnvironment=AUTOPILOT_TOKEN_SEAT AUTOPILOT_SESSION_ID" "service unsets session vars"
assert_contains "$SERVICE_TEXT" "StandardInput=null" "service sets StandardInput=null"
assert_contains "$TIMER_TEXT" "OnCalendar=*:0/10" "timer schedules every 10 minutes"
assert_contains "$TIMER_TEXT" "Persistent=true" "timer sets Persistent=true"

STATIC_SCAN="$(node - "$SWITCHBOARD_JS" "$INBOX_DONE_JS" "$ADAPTER_JS" "$RESULT_RULES_JS" <<'NODE'
'use strict';
const fs = require('fs');
const files = process.argv.slice(2);
const forbiddenAnywhere = ['sonnet', 'fleet send', 'approve', 'dispatch'];
const problems = [];
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  for (const tok of forbiddenAnywhere) {
    if (text.toLowerCase().includes(tok)) {
      problems.push(`${f}: contains forbidden token "${tok}"`);
    }
  }
  const isAdapter = f.endsWith('pm-inbox-adapter.js');
  if (!isAdapter && /claude/i.test(text)) {
    problems.push(`${f}: unexpected claude reference outside adapter`);
  }
  if (isAdapter) {
    const scrubbed = text
      .replace(/plugins\/claude\/src\/inbox-cli\.ts/g, '')
      .replace(/pm--claude/g, '');
    if (/claude/i.test(scrubbed)) {
      problems.push(`${f}: contains claude invocation string outside inbox-cli path / default member`);
    }
  }
}
if (problems.length > 0) {
  process.stdout.write(problems.join('\n'));
  process.exit(1);
}
process.stdout.write('clean');
NODE
)"
assert_eq "$STATIC_SCAN" "clean" "new scripts contain zero model/send/approve/dispatch invocation strings"

# --- 1. Throwaway git repo for real SHA verification ---
SAMPLE_REPO="$TEST_TMP/sample-repo"
mkdir -p "$SAMPLE_REPO"
require_under_test_tmp "$SAMPLE_REPO"
git -C "$SAMPLE_REPO" init -q
printf 'v1\n' > "$SAMPLE_REPO/app.txt"
git -C "$SAMPLE_REPO" add app.txt
git -C "$SAMPLE_REPO" commit -qm "initial commit"
REAL_SHA_FULL="$(git -C "$SAMPLE_REPO" rev-parse HEAD)"
REAL_SHA_SHORT="$(git -C "$SAMPLE_REPO" rev-parse --short=7 HEAD)"

# --- 2. Full rule-routing & priority order test (every rule named; redline/questions never no_action) ---
FX_RULES="$TEST_TMP/fx-rules"
mkdir -p "$FX_RULES"
RECEIPTS_RULES="$TEST_TMP/receipts-rules"

node - "$FX_RULES/inbox.json" "$SAMPLE_REPO" "$REAL_SHA_SHORT" <<'NODE'
'use strict';
const fs = require('fs');
const [outPath, repoPath, shaShort] = process.argv.slice(2);
const items = [
  { message_id: 'm-op', from: 'ns/h/operator', category: 'operator', fyi: true, content: 'operator instruction' },
  { message_id: 'm-urg', from: 'ns/h/lane-a', category: 'urgent', fyi: true, content: 'urgent alert' },
  { message_id: 'm-cred-cat', from: 'ns/h/lane-a', category: 'credential_redline', content: 'redline category item' },
  { message_id: 'm-cred-zh1', from: 'ns/h/lane-a', category: 'ack', fyi: true, content: '更新憑證路徑通知' },
  { message_id: 'm-cred-zh2', from: 'ns/h/lane-a', category: 'patrol_summary', content: '偵測到金鑰設定變動' },
  { message_id: 'm-cred-tok', from: 'ns/h/lane-a', category: 'ack', content: 'rotated service token on host' },
  { message_id: 'm-cred-scp', from: 'ns/h/lane-a', fyi: true, content: 'oauth scope needs expansion' },
  { message_id: 'm-cred-red', from: 'ns/h/lane-a', status: 'in_progress', content: '碰到紅線邊界回報' },
  { message_id: 'm-wait-pm', from: 'ns/h/lane-b', category: 'chat_unclassified', content: 'waiting_on: pm--claude' },
  { message_id: 'm-declined', from: 'ns/h/lane-b', category: 'chat_unclassified', content: 'Status: declined' },
  { message_id: 'm-failed', from: 'ns/h/lane-b', category: 'chat_unclassified', content: 'Status: failed\nstep exited 1' },
  { message_id: 'm-q-ascii', from: 'ns/h/lane-b', fyi: true, content: 'can we land this branch?' },
  { message_id: 'm-q-full', from: 'ns/h/lane-b', category: 'ack', content: '這個順序可以？' },
  { message_id: 'm-q-ma', from: 'ns/h/lane-b', status: 'in_progress', content: '需要先停掉舊 timer 嗎' },
  { message_id: 'm-q-cai', from: 'ns/h/lane-b', fyi: true, content: 'A 與 B 兩案請裁' },
  { message_id: 'm-q-yby', from: 'ns/h/lane-b', fyi: true, content: '要不要合併進 develop' },
  { message_id: 'm-q-go', from: 'ns/h/lane-b', category: 'ack', content: 'plan ready, go' + '?' },
  { message_id: 'm-dec-req', from: 'ns/h/lane-b', category: 'decision_request', content: 'need architectural ruling' },
  {
    message_id: 'm-res-ok',
    from: 'ns/h/lane-c',
    category: 'task_result',
    task_id: '01M7TASK000000000000000001',
    repo: repoPath,
    content: `Status: done\nCommit: ${shaShort}\nTests: 14 passed, 0 failed\nUsed: verified inbox switchboard e2e`,
  },
  { message_id: 'm-inprog', from: 'ns/h/lane-d', category: 'chat_unclassified', content: 'Status: in_progress\n[stage:build/implement]' },
  { message_id: 'm-wait-other', from: 'ns/h/lane-d', category: 'chat_unclassified', content: 'waiting_on: ns/h/reviewer-lane' },
  { message_id: 'm-ack', from: 'ns/h/lane-d', category: 'ack', content: 'acknowledged task 01M7' },
  { message_id: 'm-automerged', from: 'ns/h/lane-d', category: 'chat_unclassified', content: '[auto] merged branch feat/x' },
  { message_id: 'm-fyi', from: 'ns/h/lane-d', category: 'chat_unclassified', fyi: true, content: 'FYI metrics snapshot complete' },
  { message_id: 'm-patrol', from: 'ns/h/lane-d', category: 'patrol_summary', content: 'patrol green: 0 stuck lanes' },
  { message_id: 'm-unclass', from: 'ns/h/lane-e', category: 'chat_unclassified', content: '順手記錄一筆未符合任何固定規則的自由文字訊息' },
];
fs.writeFileSync(outPath, JSON.stringify(items, null, 2) + '\n');
NODE

RULES_OUT="$(AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_RULES" node "$SWITCHBOARD_JS" run --receipt-dir "$RECEIPTS_RULES" < /dev/null 2>&1)"; RULES_RC=$?
assert_eq "$RULES_RC" "0" "switchboard run on full rule matrix exits 0"

RULES_VERIFY="$(node - "$FX_RULES" "$RULES_OUT" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const [fxDir, stdoutText] = process.argv.slice(2);
const doc = JSON.parse(stdoutText);
if (doc.schema !== 'autopilot.pm-switchboard/1') process.exit(10);
if (!fs.existsSync(doc.receipt_path)) process.exit(11);

const marks = fs.readFileSync(path.join(fxDir, 'marks.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const accepts = fs.readFileSync(path.join(fxDir, 'accepts.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const wakes = fs.readFileSync(path.join(fxDir, 'wakes.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);

if (marks.length !== 26) process.exit(12);
if (accepts.length !== 1 || accepts[0].task_id !== '01M7TASK000000000000000001') process.exit(13);
if (wakes.length !== 1) process.exit(14);

const byId = Object.fromEntries(marks.map((m) => [m.id, m]));
const expected = {
  'm-op': ['pending_decision', 'operator'],
  'm-urg': ['pending_decision', 'urgent'],
  'm-cred-cat': ['pending_decision', 'credential_redline'],
  'm-cred-zh1': ['pending_decision', 'credential_redline'],
  'm-cred-zh2': ['pending_decision', 'credential_redline'],
  'm-cred-tok': ['pending_decision', 'credential_redline'],
  'm-cred-scp': ['pending_decision', 'credential_redline'],
  'm-cred-red': ['pending_decision', 'credential_redline'],
  'm-wait-pm': ['pending_decision', 'waiting_on_pm'],
  'm-declined': ['pending_decision', 'declined'],
  'm-failed': ['pending_decision', 'failed'],
  'm-q-ascii': ['pending_decision', 'question_to_pm'],
  'm-q-full': ['pending_decision', 'question_to_pm'],
  'm-q-ma': ['pending_decision', 'question_to_pm'],
  'm-q-cai': ['pending_decision', 'question_to_pm'],
  'm-q-yby': ['pending_decision', 'question_to_pm'],
  'm-q-go': ['pending_decision', 'question_to_pm'],
  'm-dec-req': ['pending_decision', 'decision_request'],
  'm-res-ok': ['done', 'result_auto_accept'],
  'm-inprog': ['no_action', 'in_progress'],
  'm-wait-other': ['no_action', 'waiting_on_other'],
  'm-ack': ['no_action', 'ack'],
  'm-automerged': ['no_action', 'auto_merged'],
  'm-fyi': ['no_action', 'fyi'],
  'm-patrol': ['no_action', 'patrol_summary'],
  'm-unclass': ['pending_decision', 'unclassified'],
};

for (const [id, [wantDisp, wantRule]] of Object.entries(expected)) {
  const m = byId[id];
  if (!m || m.disposition !== wantDisp || m.rule !== wantRule) {
    process.stderr.write(`mismatch on ${id}: got ${JSON.stringify(m)}\n`);
    process.exit(15);
  }
  if (wantDisp === 'no_action' && m.reason !== wantRule) process.exit(16);
  if (wantDisp === 'done' && m.ref !== id) process.exit(17);
}

// Verify operator/urgent/credential/question items NEVER became no_action
for (const id of Object.keys(expected)) {
  if (id.startsWith('m-op') || id.startsWith('m-urg') || id.startsWith('m-cred') || id.startsWith('m-q-')) {
    if (byId[id].disposition === 'no_action') process.exit(18);
  }
}

// Verify residue count, residue_ratio, and full original content of unclassified item in wake packet
if (doc.processed !== 26 || doc.accepted !== 1 || doc.no_action !== 6 || doc.pending !== 19) process.exit(19);
if (doc.residue !== 1) process.exit(20);
const expectedRatio = Number((1 / 26).toFixed(6));
if (doc.residue_ratio !== expectedRatio) process.exit(21);
if (!wakes[0].content.includes('「未分類」')) process.exit(22);
if (!wakes[0].content.includes('順手記錄一筆未符合任何固定規則的自由文字訊息')) process.exit(23);
if (doc.packets !== 4 || doc.woke !== true) process.exit(24);
process.stdout.write('ok');
NODE
)"
assert_eq "$RULES_VERIFY" "ok" "every rule routes accurately, records its rule name, and counts residue_ratio"

# --- 3. task_result auto-accept vs failed checks (unknown sha, missing repo, missing Used, 豁免, 門檻, status) ---
FX_RES="$TEST_TMP/fx-results"
mkdir -p "$FX_RES"
RECEIPTS_RES="$TEST_TMP/receipts-results"

node - "$FX_RES/inbox.json" "$SAMPLE_REPO" "$REAL_SHA_FULL" <<'NODE'
'use strict';
const fs = require('fs');
const [outPath, repoPath, fullSha] = process.argv.slice(2);
const unknownSha = fullSha.startsWith('a') ? 'b123456789abcdef' : 'a123456789abcdef';
const items = [
  {
    message_id: 'r-pass',
    from: 'ns/h/impl-1',
    category: 'task_result',
    task_id: '01M7RES0000000000000000001',
    content: `Repo: ${repoPath}\nStatus: done\nCommit: ${fullSha}\nUsed: bash hooks/tests/pm-switchboard.test.sh`,
  },
  {
    message_id: 'r-bad-sha',
    from: 'ns/h/impl-2',
    category: 'task_result',
    task_id: '01M7RES0000000000000000002',
    repo: repoPath,
    content: `Status: done\nCommit: ${unknownSha}\nUsed: verified output`,
  },
  {
    message_id: 'r-no-repo',
    from: 'ns/h/impl-3',
    category: 'task_result',
    task_id: '01M7RES0000000000000000003',
    content: `Status: done\nCommit: ${fullSha}\nUsed: verified output`,
  },
  {
    message_id: 'r-no-used',
    from: 'ns/h/impl-4',
    category: 'task_result',
    task_id: '01M7RES0000000000000000004',
    repo: repoPath,
    content: `Status: done\nCommit: ${fullSha}\nAll tests green`,
  },
  {
    message_id: 'r-waiver',
    from: 'ns/h/impl-5',
    category: 'task_result',
    task_id: '01M7RES0000000000000000005',
    repo: repoPath,
    content: `Status: done\nCommit: ${fullSha}\n本輪申請豁免一項整合檢查\nUsed: verified locally`,
  },
  {
    message_id: 'r-thresh',
    from: 'ns/h/impl-6',
    category: 'task_result',
    task_id: '01M7RES0000000000000000006',
    repo: repoPath,
    content: `Status: done\nCommit: ${fullSha}\nlowered threshold to pass\nUsed: verified locally`,
  },
];
fs.writeFileSync(outPath, JSON.stringify(items, null, 2) + '\n');
NODE

RES_OUT="$(AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_RES" node "$SWITCHBOARD_JS" run --receipt-dir "$RECEIPTS_RES" < /dev/null 2>&1)"; RES_RC=$?
assert_eq "$RES_RC" "0" "task_result verification run exits 0"

RES_VERIFY="$(node - "$FX_RES" "$RES_OUT" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const [fxDir, stdoutText] = process.argv.slice(2);
const doc = JSON.parse(stdoutText);
const marks = Object.fromEntries(
  fs.readFileSync(path.join(fxDir, 'marks.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).map((m) => [m.id, m]),
);
const accepts = fs.readFileSync(path.join(fxDir, 'accepts.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const wakeText = JSON.parse(fs.readFileSync(path.join(fxDir, 'wakes.jsonl'), 'utf8').trim()).content;

if (accepts.length !== 1 || accepts[0].task_id !== '01M7RES0000000000000000001') process.exit(1);
if (marks['r-pass'].disposition !== 'done' || marks['r-pass'].ref !== 'r-pass') process.exit(2);

const expectedFailed = {
  'r-bad-sha': 'sha_unresolved',
  'r-no-repo': 'sha_unverifiable',
  'r-no-used': 'used_line',
  'r-waiver': 'no_exception_words',
  'r-thresh': 'no_threshold_change',
};
for (const [id, checkName] of Object.entries(expectedFailed)) {
  const m = marks[id];
  if (!m || m.disposition !== 'pending_decision') process.exit(3);
  if (!Array.isArray(m.failed_checks) || !m.failed_checks.includes(checkName)) process.exit(4);
  if (!wakeText.includes(checkName)) process.exit(5);
}
if (doc.accepted !== 1 || doc.pending !== 5 || doc.residue !== 0) process.exit(6);
process.stdout.write('ok');
NODE
)"
assert_eq "$RES_VERIFY" "ok" "task_result passes only when all 5 checks hold and names every failed check"

# --- 4a. 7 pending -> 2 packets (5+2) in ONE wake, each <= 1500 token estimate, zh-TW fields ---
FX_PKT7="$TEST_TMP/fx-pkt7"
mkdir -p "$FX_PKT7"
RECEIPTS_PKT="$TEST_TMP/receipts-pkt"

node - "$FX_PKT7/inbox.json" <<'NODE'
'use strict';
const fs = require('fs');
const items = [];
for (let i = 1; i <= 7; i += 1) {
  items.push({
    message_id: `p-${i}`,
    from: `ns/host/lane-${i}`,
    category: 'decision_request',
    task_id: i % 2 === 1 ? `01M7PKT000000000000000000${i}` : null,
    content: `需要裁示第 ${i} 項部署順序\n影響範圍為模組 ${i}`,
  });
}
fs.writeFileSync(process.argv[2], JSON.stringify(items, null, 2) + '\n');
NODE

PKT7_OUT="$(AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_PKT7" node "$SWITCHBOARD_JS" run --receipt-dir "$RECEIPTS_PKT" < /dev/null 2>&1)"; PKT7_RC=$?
assert_eq "$PKT7_RC" "0" "7-pending packet run exits 0"

PKT7_VERIFY="$(node - "$FX_PKT7" "$PKT7_OUT" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const [fxDir, stdoutText] = process.argv.slice(2);
const doc = JSON.parse(stdoutText);
const wakes = fs.readFileSync(path.join(fxDir, 'wakes.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
if (wakes.length !== 1) process.exit(1);
if (doc.packets !== 2) process.exit(2);
if (JSON.stringify(doc.packet_item_counts) !== JSON.stringify([5, 2])) process.exit(3);

const packetParts = wakes[0].content.trim().split('\n\n---\n\n');
if (packetParts.length !== 2) process.exit(4);
for (const part of packetParts) {
  const tokEst = Math.ceil(part.length / 3);
  if (tokEst > 1500) process.exit(5);
}
const fullWake = wakes[0].content;
for (const reqLabel of ['編號：', 'lane：', '工單：無', '類型：decision_request', '事實：', '[evidence: p-1]', '選項：', '「建議，不是決定」']) {
  if (!fullWake.includes(reqLabel)) {
    process.stderr.write(`missing label: ${reqLabel}\n`);
    process.exit(6);
  }
}
process.stdout.write('ok');
NODE
)"
assert_eq "$PKT7_VERIFY" "ok" "7 pending items produce 2 packets (5+2) in one wake, each <= 1500 tokens"

# --- 4b. Oversized single item is truncated with pointer to message_id and stays <= 1500 tokens ---
FX_HUGE="$TEST_TMP/fx-huge"
mkdir -p "$FX_HUGE"
node - "$FX_HUGE/inbox.json" <<'NODE'
'use strict';
const fs = require('fs');
const longBody = '長篇記錄內容段落。'.repeat(900);
fs.writeFileSync(process.argv[2], JSON.stringify([
  { message_id: 'm-oversized-99', from: 'ns/h/lane-z', category: 'chat_unclassified', content: longBody },
], null, 2) + '\n');
NODE

HUGE_OUT="$(AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_HUGE" node "$SWITCHBOARD_JS" run --receipt-dir "$RECEIPTS_PKT" < /dev/null 2>&1)"; HUGE_RC=$?
assert_eq "$HUGE_RC" "0" "oversized single item run exits 0"
HUGE_VERIFY="$(node - "$FX_HUGE" "$HUGE_OUT" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const [fxDir, stdoutText] = process.argv.slice(2);
const doc = JSON.parse(stdoutText);
const wake = JSON.parse(fs.readFileSync(path.join(fxDir, 'wakes.jsonl'), 'utf8').trim());
if (doc.packets !== 1 || doc.packet_token_estimates[0] > 1500) process.exit(1);
if (Math.ceil(wake.content.trim().length / 3) > 1500) process.exit(2);
if (!wake.content.includes('message_id=m-oversized-99')) process.exit(3);
process.stdout.write('ok');
NODE
)"
assert_eq "$HUGE_VERIFY" "ok" "oversized item is truncated with message_id pointer within 1500-token cap"

# --- 4c. Zero pending -> zero wakes; plus residue-report [--since 24h] single-line daily summary ---
FX_ZERO="$TEST_TMP/fx-zero"
mkdir -p "$FX_ZERO"
node - "$FX_ZERO/inbox.json" "$SAMPLE_REPO" "$REAL_SHA_SHORT" <<'NODE'
'use strict';
const fs = require('fs');
const [outPath, repoPath, shaShort] = process.argv.slice(2);
fs.writeFileSync(outPath, JSON.stringify([
  { message_id: 'z-1', from: 'ns/h/lane-1', category: 'ack', content: 'ack' },
  {
    message_id: 'z-2',
    from: 'ns/h/lane-2',
    category: 'task_result',
    task_id: '01M7ZERO000000000000000001',
    repo: repoPath,
    content: `Status: done\nCommit: ${shaShort}\nUsed: verified zero wake`,
  },
], null, 2) + '\n');
NODE

ZERO_OUT="$(AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_ZERO" node "$SWITCHBOARD_JS" run --receipt-dir "$RECEIPTS_PKT" < /dev/null 2>&1)"; ZERO_RC=$?
assert_eq "$ZERO_RC" "0" "zero-pending run exits 0"
assert_file_absent "$FX_ZERO/wakes.jsonl" "zero pending items emit zero wakes"

# Plant a stale 72h-old receipt in RECEIPTS_PKT to verify --since 24h filtering
node - "$RECEIPTS_PKT/2020-01-01T00-00-00-000Z.json" <<'NODE'
'use strict';
const fs = require('fs');
fs.writeFileSync(process.argv[2], JSON.stringify({
  schema: 'autopilot.pm-switchboard/1',
  at: new Date(Date.now() - 72 * 3600 * 1000).toISOString(),
  processed: 99,
  accepted: 99,
  pending: 0,
  no_action: 0,
  residue: 50,
  packets: 10,
  woke: true,
}) + '\n');
NODE

REPORT_LINE="$(node "$SWITCHBOARD_JS" residue-report --since 24h --receipt-dir "$RECEIPTS_PKT" < /dev/null 2>&1)"; REPORT_RC=$?
assert_eq "$REPORT_RC" "0" "residue-report exits 0"
REPORT_LINE_COUNT="$(printf '%s\n' "$REPORT_LINE" | wc -l | tr -d ' ')"
assert_eq "$REPORT_LINE_COUNT" "1" "residue-report emits exactly one line"
assert_contains "$REPORT_LINE" "runs=3 " "residue-report sums only the 3 receipts within 24h"
assert_contains "$REPORT_LINE" "processed=10 " "residue-report sums processed=7+1+2=10"
assert_contains "$REPORT_LINE" "accepted=1 " "residue-report sums accepted=1"
assert_contains "$REPORT_LINE" "pending=8 " "residue-report sums pending=7+1+0=8"
assert_contains "$REPORT_LINE" "no_action=1 " "residue-report sums no_action=1"
assert_contains "$REPORT_LINE" "residue=1 " "residue-report sums residue=1"
assert_contains "$REPORT_LINE" "residue_ratio=0.1 " "residue-report computes aggregate residue_ratio=1/10=0.1"
assert_contains "$REPORT_LINE" "packets=3 " "residue-report sums packets=2+1+0=3"
assert_contains "$REPORT_LINE" "wakes=2" "residue-report sums wakes=2"

# --- 5. pm-inbox-done, kill switch, fleet mode without AUTOPILOT_FLEET_REPO, and accept cmd unset ---
FX_DONE="$TEST_TMP/fx-done"
mkdir -p "$FX_DONE"
printf '[]\n' > "$FX_DONE/inbox.json"

NO_REF_OUT="$(AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_DONE" node "$INBOX_DONE_JS" msg-100 < /dev/null 2>&1)"; NO_REF_RC=$?
assert_eq "$NO_REF_RC" "2" "pm-inbox-done refuses closing done without --ref"
assert_file_absent "$FX_DONE/marks.jsonl" "refused pm-inbox-done writes no mark"

EMPTY_REF_OUT="$(AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_DONE" node "$INBOX_DONE_JS" msg-100 --ref "" < /dev/null 2>&1)"; EMPTY_REF_RC=$?
assert_eq "$EMPTY_REF_RC" "2" "pm-inbox-done refuses empty --ref"

EMPTY_REASON_OUT="$(AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_DONE" node "$INBOX_DONE_JS" msg-100 --no-action "   " < /dev/null 2>&1)"; EMPTY_REASON_RC=$?
assert_eq "$EMPTY_REASON_RC" "2" "pm-inbox-done refuses whitespace-only --no-action reason"

OK_DONE_OUT="$(AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_DONE" node "$INBOX_DONE_JS" msg-100 --ref "$REAL_SHA_SHORT" < /dev/null 2>&1)"; OK_DONE_RC=$?
assert_eq "$OK_DONE_RC" "0" "pm-inbox-done with --ref exits 0"

OK_NA_OUT="$(AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_DONE" node "$INBOX_DONE_JS" msg-101 --no-action "superseded by newer ask" < /dev/null 2>&1)"; OK_NA_RC=$?
assert_eq "$OK_NA_RC" "0" "pm-inbox-done with --no-action exits 0"

DONE_VERIFY="$(node - "$FX_DONE/marks.jsonl" "$REAL_SHA_SHORT" <<'NODE'
'use strict';
const fs = require('fs');
const [marksFile, shaShort] = process.argv.slice(2);
const rows = fs.readFileSync(marksFile, 'utf8').trim().split('\n').map(JSON.parse);
if (rows.length !== 2) process.exit(1);
if (rows[0].id !== 'msg-100' || rows[0].disposition !== 'done' || rows[0].ref !== shaShort) process.exit(2);
if (rows[1].id !== 'msg-101' || rows[1].disposition !== 'no_action' || rows[1].reason !== 'superseded by newer ask') process.exit(3);
process.stdout.write('ok');
NODE
)"
assert_eq "$DONE_VERIFY" "ok" "pm-inbox-done writes valid done and no_action marks through adapter"

# Kill switch: exits 0 doing nothing even when fleet repo is unset
RECEIPTS_KILL="$TEST_TMP/receipts-kill"
KILL_OUT="$(AUTOPILOT_PM_SWITCHBOARD=off AUTOPILOT_PM_INBOX_ADAPTER=fleet node "$SWITCHBOARD_JS" run --receipt-dir "$RECEIPTS_KILL" < /dev/null 2>&1)"; KILL_RC=$?
assert_eq "$KILL_RC" "0" "kill switch AUTOPILOT_PM_SWITCHBOARD=off exits 0"
assert_eq "$KILL_OUT" "" "kill switch produces no output"
assert_file_absent "$RECEIPTS_KILL" "kill switch creates no receipt directory"

# Fleet mode without AUTOPILOT_FLEET_REPO exits 2 with clear message
NO_FLEET_OUT="$(env -u AUTOPILOT_FLEET_REPO AUTOPILOT_PM_INBOX_ADAPTER=fleet node "$SWITCHBOARD_JS" run --receipt-dir "$TEST_TMP/r-nofleet" < /dev/null 2>&1)"; NO_FLEET_RC=$?
assert_eq "$NO_FLEET_RC" "2" "fleet mode without AUTOPILOT_FLEET_REPO exits 2"
assert_contains "$NO_FLEET_OUT" "AUTOPILOT_FLEET_REPO" "missing AUTOPILOT_FLEET_REPO error names the variable"

# Fleet mode with fake inbox-cli.ts: test accept command unset -> pending_decision, then accept command set -> done
FAKE_FLEET="$TEST_TMP/fake-fleet"
mkdir -p "$FAKE_FLEET/plugins/claude/src"
FAKE_FLEET_STATE="$TEST_TMP/fake-fleet-state"
mkdir -p "$FAKE_FLEET_STATE"

cat > "$FAKE_FLEET/plugins/claude/src/inbox-cli.ts" <<'EOF'
import * as fs from 'node:fs';
import * as path from 'node:path';

const stateDir = process.env.FAKE_FLEET_STATE_DIR || '';
const args = process.argv.slice(2);
const sub = args[0];

function flagVal(name: string): string {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : '';
}

if (sub === 'list') {
  const raw = fs.readFileSync(path.join(stateDir, 'inbox.json'), 'utf8');
  process.stdout.write(raw);
  process.exit(0);
}
if (sub === 'mark') {
  const disp = flagVal('--disposition');
  const ref = flagVal('--ref');
  const reason = flagVal('--reason');
  if (disp === 'done' && !ref) process.exit(2);
  if (disp === 'no_action' && !reason) process.exit(2);
  fs.appendFileSync(path.join(stateDir, 'cli-marks.jsonl'), JSON.stringify({
    member: flagVal('--member'),
    id: flagVal('--id'),
    disposition: disp,
    ref: ref || null,
    reason: reason || null,
  }) + '\n');
  process.exit(0);
}
if (sub === 'wake') {
  const pfile = flagVal('--packet-file');
  fs.appendFileSync(path.join(stateDir, 'cli-wakes.jsonl'), JSON.stringify({
    member: flagVal('--member'),
    packet_file: pfile,
    content: fs.readFileSync(pfile, 'utf8'),
  }) + '\n');
  process.exit(0);
}
process.exit(2);
EOF

node - "$FAKE_FLEET_STATE/inbox.json" "$SAMPLE_REPO" "$REAL_SHA_SHORT" <<'NODE'
'use strict';
const fs = require('fs');
const [outPath, repoPath, shaShort] = process.argv.slice(2);
fs.writeFileSync(outPath, JSON.stringify([
  {
    message_id: 'f-res-1',
    from: 'ns/h/lane-f',
    category: 'task_result',
    task_id: '01M7FLEET00000000000000001',
    repo: repoPath,
    content: `Status: done\nCommit: ${shaShort}\nUsed: fleet mode test`,
  },
], null, 2) + '\n');
NODE

FLEET_UNSET_OUT="$(FAKE_FLEET_STATE_DIR="$FAKE_FLEET_STATE" AUTOPILOT_FLEET_REPO="$FAKE_FLEET" AUTOPILOT_PM_INBOX_ADAPTER=fleet env -u AUTOPILOT_PM_ACCEPT_CMD node "$SWITCHBOARD_JS" run --receipt-dir "$TEST_TMP/r-fleet-unset" < /dev/null 2>&1)"; FLEET_UNSET_RC=$?
assert_eq "$FLEET_UNSET_RC" "0" "fleet mode with unset AUTOPILOT_PM_ACCEPT_CMD exits 0"
FLEET_UNSET_CHECK="$(node - "$FAKE_FLEET_STATE" "$FLEET_UNSET_OUT" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const [stateDir, outText] = process.argv.slice(2);
const doc = JSON.parse(outText);
const marks = fs.readFileSync(path.join(stateDir, 'cli-marks.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const wakes = fs.readFileSync(path.join(stateDir, 'cli-wakes.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
if (doc.accepted !== 0 || doc.pending !== 1) process.exit(1);
if (marks.length !== 1 || marks[0].disposition !== 'pending_decision' || marks[0].member !== 'pm--claude') process.exit(2);
if (wakes.length !== 1 || !wakes[0].content.includes('accept_unavailable')) process.exit(3);
process.stdout.write('ok');
NODE
)"
assert_eq "$FLEET_UNSET_CHECK" "ok" "fleet mode without AUTOPILOT_PM_ACCEPT_CMD routes verified result to pending_decision"

rm -f "$FAKE_FLEET_STATE/cli-marks.jsonl" "$FAKE_FLEET_STATE/cli-wakes.jsonl"
ACCEPT_STUB="$TEST_TMP/accept-stub.js"
ACCEPT_LOG="$TEST_TMP/accept-stub.jsonl"
cat > "$ACCEPT_STUB" <<'EOF'
'use strict';
const fs = require('fs');
fs.appendFileSync(process.env.ACCEPT_STUB_LOG, JSON.stringify({ argv: process.argv.slice(2) }) + '\n');
EOF
ACCEPT_CMD_JSON="$(node -e 'process.stdout.write(JSON.stringify([process.execPath, process.argv[1], "--accept-task"]))' "$ACCEPT_STUB")"

FLEET_SET_OUT="$(ACCEPT_STUB_LOG="$ACCEPT_LOG" FAKE_FLEET_STATE_DIR="$FAKE_FLEET_STATE" AUTOPILOT_FLEET_REPO="$FAKE_FLEET" AUTOPILOT_PM_INBOX_ADAPTER=fleet AUTOPILOT_PM_ACCEPT_CMD="$ACCEPT_CMD_JSON" node "$SWITCHBOARD_JS" run --receipt-dir "$TEST_TMP/r-fleet-set" < /dev/null 2>&1)"; FLEET_SET_RC=$?
assert_eq "$FLEET_SET_RC" "0" "fleet mode with AUTOPILOT_PM_ACCEPT_CMD set exits 0"
assert_file_absent "$FAKE_FLEET_STATE/cli-wakes.jsonl" "fleet auto-accepted result triggers zero wakes"
FLEET_SET_CHECK="$(node - "$FAKE_FLEET_STATE/cli-marks.jsonl" "$ACCEPT_LOG" <<'NODE'
'use strict';
const fs = require('fs');
const [marksPath, acceptLogPath] = process.argv.slice(2);
const marks = fs.readFileSync(marksPath, 'utf8').trim().split('\n').map(JSON.parse);
const accepts = fs.readFileSync(acceptLogPath, 'utf8').trim().split('\n').map(JSON.parse);
if (marks.length !== 1 || marks[0].disposition !== 'done' || marks[0].ref !== 'f-res-1') process.exit(1);
if (accepts.length !== 1 || JSON.stringify(accepts[0].argv) !== JSON.stringify(['--accept-task', '01M7FLEET00000000000000001'])) process.exit(2);
process.stdout.write('ok');
NODE
)"
assert_eq "$FLEET_SET_CHECK" "ok" "fleet mode invokes AUTOPILOT_PM_ACCEPT_CMD with task id appended and marks done"

# --- 6. Negative controls (sed_mutant): prove gates fail when checks are weakened ---
MUT_DIR="$TEST_TMP/mutants"
mkdir -p "$MUT_DIR/scripts/lib"
cp "$ADAPTER_JS" "$MUT_DIR/scripts/lib/pm-inbox-adapter.js"
sed_mutant "$RESULT_RULES_JS" "$MUT_DIR/scripts/lib/pm-result-rules.js" "s/'豁免'/'__MUTATED_NEVER__'/"
MUT_WAIVER_PASS="$(node - "$MUT_DIR/scripts/lib/pm-result-rules.js" "$SAMPLE_REPO" "$REAL_SHA_FULL" <<'NODE'
'use strict';
const { evaluateTaskResult } = require(process.argv[2]);
const res = evaluateTaskResult({
  repo: process.argv[3],
  content: `Status: done\nCommit: ${process.argv[4]}\n申請豁免\nUsed: test`,
});
process.stdout.write(String(res.pass));
NODE
)"
assert_eq "$MUT_WAIVER_PASS" "true" "negative control: mutating 豁免 out of pm-result-rules lets a waiver slip through"

sed_mutant "$INBOX_DONE_JS" "$MUT_DIR/scripts/pm-inbox-done.js" 's/!hasRefFlag && !hasNoActionFlag/false/'
FX_MUT_DONE="$TEST_TMP/fx-mut-done"
mkdir -p "$FX_MUT_DONE"
printf '[]\n' > "$FX_MUT_DONE/inbox.json"
MUT_DONE_OUT="$(AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_MUT_DONE" node "$MUT_DIR/scripts/pm-inbox-done.js" msg-999 < /dev/null 2>&1)"; MUT_DONE_RC=$?
assert_neq "$MUT_DONE_OUT" "" "negative control: mutating pm-inbox-done flag guard shifts failure downstream to adapter mark guard"

finalize_test
