#!/usr/bin/env bash
# pm-switchboard.test.sh — hermetic tests for scripts/pm-switchboard.js,
# scripts/pm-inbox-done.js, scripts/lib/pm-inbox-adapter.js,
# scripts/lib/pm-result-rules.js, and scripts/systemd/pm-switchboard.{service,timer}.

. "$(dirname "$0")/lib.sh"

unset AUTOPILOT_TOKEN_SEAT AUTOPILOT_SESSION_ID AUTOPILOT_CHILD_SESSION_ID
unset AUTOPILOT_PM_SWITCHBOARD AUTOPILOT_PM_INBOX_ADAPTER AUTOPILOT_FLEET_REPO
unset AUTOPILOT_PM_INBOX_MEMBER AUTOPILOT_PM_ACCEPT_CMD AUTOPILOT_PM_TASK_SHOW_CMD
unset AUTOPILOT_PM_SWITCHBOARD_FALLBACK AUTOPILOT_PM_LEAK_STATUS_FILE AUTOPILOT_PM_AUTO_ACCEPT

export XDG_RUNTIME_DIR="$TEST_TMP/xdg-run"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

# Seed throwaway fake credentials (never ~/.claude) + put fake `claude` first on PATH.
FAKE_CLAUDE_SOURCE_CFG="$TEST_TMP/claude-source-cfg"
seed_fake_claude_credentials "$FAKE_CLAUDE_SOURCE_CFG"
printf '{"decoy":true}\n' > "$FAKE_CLAUDE_SOURCE_CFG/settings.json"
export CLAUDE_CONFIG_DIR="$FAKE_CLAUDE_SOURCE_CFG"

FAKE_BIN="$TEST_TMP/fake-bin"
mkdir -p "$FAKE_BIN"
FAKE_CLAUDE_LOG="$TEST_TMP/fake-claude-calls.jsonl"
export FAKE_CLAUDE_LOG
export FAKE_CLAUDE_MODE="classify"
# dispatch-author.sh gates on an open Fleet-Task: give it a stub fleet that reports one open task (never the real fleet).
printf '#!/bin/sh\necho "{\\"status\\":\\"in_progress\\"}"\n' > "$FAKE_BIN/fleet"
chmod +x "$FAKE_BIN/fleet"
export FLEET_BIN="$FAKE_BIN/fleet" AUTOPILOT_FLEET_TASK=01M8F07R5MJDHSPHDQNBJCSTN6

cat > "$FAKE_BIN/claude" <<'EOF'
#!/usr/bin/env node
'use strict';
const fs = require('fs');

const prompt = fs.readFileSync(0, 'utf8');
const cfgDir = process.env.CLAUDE_CONFIG_DIR || '';
let cfgEntries = [];
try {
  cfgEntries = fs.readdirSync(cfgDir).sort();
} catch {
  cfgEntries = [];
}

if (process.env.FAKE_CLAUDE_LOG) {
  fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({
    argv: process.argv.slice(2),
    config_dir: cfgDir,
    config_entries: cfgEntries,
    prompt_len: prompt.length,
    prompt,
  }) + '\n');
}

const beginMatch = prompt.match(/^<<<AUTOPILOT-AUTHOR-[0-9a-f]{32}>>>$/m);
const endMatch = prompt.match(/^<<<AUTOPILOT-END-[0-9a-f]{32}>>>$/m);
const begin = beginMatch ? beginMatch[0] : '';
const end = endMatch ? endMatch[0] : '';

let items = [];
const marker = '\nITEMS_JSON:\n';
const markerIdx = prompt.lastIndexOf(marker);
if (markerIdx >= 0) {
  const rawJson = prompt.slice(markerIdx + marker.length).trim();
  try {
    items = JSON.parse(rawJson);
  } catch {
    items = [];
  }
}

const mode = process.env.FAKE_CLAUDE_MODE || 'classify';
let bodyText = '';
if (mode === 'garbage') {
  bodyText = 'not-json {{{ unparseable output from model';
} else if (mode === 'try_done_accept') {
  bodyText = JSON.stringify(items.map((it, idx) => ({
    message_id: it.message_id,
    class: idx % 2 === 0 ? 'done' : 'accept',
    reason: 'attempted forbidden close or accept',
  })));
} else if (mode === 'custom_json') {
  bodyText = process.env.FAKE_CLAUDE_CUSTOM_JSON || '[]';
} else {
  bodyText = JSON.stringify(items.map((it) => {
    const content = String((it && it.content) || '');
    if (content.includes('[routine-note]')) {
      return { message_id: it.message_id, class: 'no_action', reason: 'routine note needs no PM action' };
    }
    return { message_id: it.message_id, class: 'pending_decision', reason: 'unclassified residue routed to PM' };
  }));
}

process.stdout.write(`${begin}\n${bodyText}\n${end}\n`);
EOF
chmod 755 "$FAKE_BIN/claude"
export PATH="$FAKE_BIN:$PATH"

SWITCHBOARD_JS="$REPO_ROOT/scripts/pm-switchboard.js"
INBOX_DONE_JS="$REPO_ROOT/scripts/pm-inbox-done.js"
ADAPTER_JS="$REPO_ROOT/scripts/lib/pm-inbox-adapter.js"
RESULT_RULES_JS="$REPO_ROOT/scripts/lib/pm-result-rules.js"
SWB_SERVICE="$REPO_ROOT/scripts/systemd/pm-switchboard.service"
SWB_TIMER="$REPO_ROOT/scripts/systemd/pm-switchboard.timer"

# --- 0. Shipped files, Codex plugin mirrors, systemd templates, and static boundary scan ---
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
  scripts/lib/config-keys.json \
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
assert_contains "$SERVICE_TEXT" "SuccessExitStatus=3" "service sets SuccessExitStatus=3 for waiting exit"
assert_contains "$TIMER_TEXT" "OnCalendar=*:0/10" "timer schedules every 10 minutes"
assert_contains "$TIMER_TEXT" "Persistent=true" "timer sets Persistent=true"

STATIC_SCAN="$(node - "$SWITCHBOARD_JS" "$INBOX_DONE_JS" "$ADAPTER_JS" "$RESULT_RULES_JS" <<'NODE'
'use strict';
const fs = require('fs');
const [swbFile, doneFile, adapterFile, rulesFile] = process.argv.slice(2);
const forbiddenAll = ['fleet send', 'approve'];
const problems = [];

for (const f of [swbFile, doneFile, adapterFile, rulesFile]) {
  const text = fs.readFileSync(f, 'utf8');
  for (const tok of forbiddenAll) {
    if (text.toLowerCase().includes(tok)) {
      problems.push(`${f}: contains forbidden token "${tok}"`);
    }
  }
}

for (const f of [doneFile, adapterFile, rulesFile]) {
  const text = fs.readFileSync(f, 'utf8');
  if (text.toLowerCase().includes('sonnet')) {
    problems.push(`${f}: unexpected sonnet reference outside pm-switchboard.js`);
  }
  const scrubbed = f === adapterFile
    ? text.replace(/plugins\/claude\/src\/inbox-cli\.ts/g, '').replace(/pm--claude/g, '')
    : text;
  if (/claude/i.test(scrubbed)) {
    problems.push(`${f}: unexpected claude reference`);
  }
}

const swbCode = fs.readFileSync(swbFile, 'utf8')
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n');
if (!swbCode.includes("path.join(__dirname, 'dispatch-author.sh')")) {
  problems.push('pm-switchboard.js must route fallback through scripts/dispatch-author.sh');
}
if (/(?:spawnSync|spawn|execFileSync|execSync)\s*\(\s*['"`]claude['"`]/.test(swbCode)) {
  problems.push('pm-switchboard.js must never spawn claude directly');
}
if (/\.claude\b/.test(swbCode)) {
  problems.push('pm-switchboard.js code must never reference ~/.claude');
}

if (problems.length > 0) {
  process.stdout.write(problems.join('\n'));
  process.exit(1);
}
process.stdout.write('clean');
NODE
)"
assert_eq "$STATIC_SCAN" "clean" "scripts respect send/approve/direct-claude/config-dir boundaries"

# --- 1. Throwaway git repo + bare origin remote for offline remote-commit & timestamp verification ---
ORIGIN_REPO="$TEST_TMP/origin-repo.git"
SAMPLE_REPO="$TEST_TMP/sample-repo"
mkdir -p "$ORIGIN_REPO" "$SAMPLE_REPO"
require_under_test_tmp "$ORIGIN_REPO"
require_under_test_tmp "$SAMPLE_REPO"
git -C "$ORIGIN_REPO" init --bare -q
git -C "$SAMPLE_REPO" init -q
git -C "$SAMPLE_REPO" remote add origin "$ORIGIN_REPO"
printf 'v1\n' > "$SAMPLE_REPO/app.txt"
git -C "$SAMPLE_REPO" add app.txt
git -C "$SAMPLE_REPO" commit -qm "initial commit"
DEFAULT_BRANCH="$(git -C "$SAMPLE_REPO" symbolic-ref --short HEAD)"
git -C "$SAMPLE_REPO" push -q -u origin "$DEFAULT_BRANCH"
REAL_SHA_FULL="$(git -C "$SAMPLE_REPO" rev-parse HEAD)"
REAL_SHA_SHORT="$(git -C "$SAMPLE_REPO" rev-parse --short=7 HEAD)"
COMMIT_EPOCH="$(git -C "$SAMPLE_REPO" show -s --format=%ct HEAD)"

git -C "$SAMPLE_REPO" checkout -qb unpushed-side
printf 'v2-local-only\n' > "$SAMPLE_REPO/local.txt"
git -C "$SAMPLE_REPO" add local.txt
git -C "$SAMPLE_REPO" commit -qm "unpushed local commit"
UNPUSHED_SHA_FULL="$(git -C "$SAMPLE_REPO" rev-parse HEAD)"
git -C "$SAMPLE_REPO" checkout -q "$DEFAULT_BRANCH"

DISPATCHED_BEFORE="$(node -e 'process.stdout.write(new Date((Number(process.argv[1]) - 120) * 1000).toISOString())' "$COMMIT_EPOCH")"
DISPATCHED_AFTER="$(node -e 'process.stdout.write(new Date((Number(process.argv[1]) + 120) * 1000).toISOString())' "$COMMIT_EPOCH")"

# --- 2. Full rule-routing, wake-kind rule, immediate-first ordering, and residue-only fallback ---
FX_RULES="$TEST_TMP/fx-rules"
mkdir -p "$FX_RULES"
RECEIPTS_RULES="$TEST_TMP/receipts-rules"
rm -f "$FAKE_CLAUDE_LOG"

node - "$FX_RULES/tasks.json" "$FX_RULES/inbox.json" "$SAMPLE_REPO" "$REAL_SHA_SHORT" "$DISPATCHED_BEFORE" <<'NODE'
'use strict';
const fs = require('fs');
const [tasksPath, inboxPath, repoPath, shaShort, dispatchedAt] = process.argv.slice(2);

fs.writeFileSync(tasksPath, JSON.stringify({
  '01M7TASK000000000000000001': {
    assignee: 'ns/h/lane-c',
    attempt: 1,
    dispatched_at: dispatchedAt,
    acceptance: ['pm-switchboard.test.sh green', 'sync-all.sh --check green'],
  },
}, null, 2) + '\n');

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
  { message_id: 'm-dec-req', from: 'ns/h/lane-b', category: 'decision_request', content: 'need architectural ruling?' },
  {
    message_id: 'm-res-ok',
    from: 'ns/h/lane-c',
    category: 'task_result',
    task_id: '01M7TASK000000000000000001',
    repo: repoPath,
    content: [
      'Status: done',
      'Attempt: 1',
      `Commit: ${shaShort}`,
      'Verify: rc=0 receipt=9f8e7d6c5b4a3210',
      '- [x] pm-switchboard.test.sh green',
      '- [x] sync-all.sh --check green',
      'Used: e2e verified inbox switchboard',
    ].join('\n'),
  },
  { message_id: 'm-inprog', from: 'ns/h/lane-d', category: 'chat_unclassified', content: 'Status: in_progress\n[stage:build/implement]' },
  { message_id: 'm-wait-other', from: 'ns/h/lane-d', category: 'chat_unclassified', content: 'waiting_on: ns/h/reviewer-lane' },
  { message_id: 'm-ack', from: 'ns/h/lane-d', category: 'ack', content: 'acknowledged task 01M7' },
  { message_id: 'm-automerged', from: 'ns/h/lane-d', category: 'chat_unclassified', content: '[auto] merged branch feat/x' },
  { message_id: 'm-fyi', from: 'ns/h/lane-d', category: 'chat_unclassified', fyi: true, content: 'FYI metrics snapshot complete' },
  { message_id: 'm-patrol', from: 'ns/h/lane-d', category: 'patrol_summary', content: 'patrol green: 0 stuck lanes' },
  { message_id: 'm-wake', from: 'ns/h/lane-d', kind: 'wake', category: 'chat_unclassified', content: 'scheduled wake heartbeat summary' },
  { message_id: 'm-unclass', from: 'ns/h/lane-e', category: 'chat_unclassified', content: '順手記錄一筆未符合任何固定規則的自由文字訊息' },
];
fs.writeFileSync(inboxPath, JSON.stringify(items, null, 2) + '\n');
NODE

RULES_OUT="$(AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_RULES" node "$SWITCHBOARD_JS" run --receipt-dir "$RECEIPTS_RULES" --state-file "$TEST_TMP/state-rules.json" < /dev/null 2>&1)"; RULES_RC=$?
assert_eq "$RULES_RC" "0" "switchboard run on full rule matrix exits 0"

RULES_VERIFY="$(node - "$FX_RULES" "$RULES_OUT" "$FAKE_CLAUDE_LOG" "$FAKE_CLAUDE_SOURCE_CFG" "$HOME" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const [fxDir, stdoutText, claudeLogPath, sourceCfg, homeDir] = process.argv.slice(2);
const doc = JSON.parse(stdoutText);
if (doc.schema !== 'autopilot.pm-switchboard/1') process.exit(10);
if (!fs.existsSync(doc.receipt_path)) process.exit(11);

const marks = fs.readFileSync(path.join(fxDir, 'marks.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const accepts = fs.readFileSync(path.join(fxDir, 'accepts.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const wakes = fs.readFileSync(path.join(fxDir, 'wakes.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);

if (marks.length !== 27) process.exit(12);
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
  'm-wake': ['no_action', 'wake'],
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

if (doc.processed !== 27 || doc.accepted !== 1 || doc.no_action !== 7 || doc.pending !== 19) process.exit(19);
if (doc.residue !== 1 || doc.hidden_pending !== 1) process.exit(20);
if (JSON.stringify(doc.decision_request_by_lane) !== JSON.stringify({ 'ns/h/lane-b': 1 })) process.exit(21);

// Merged-categories packing (MAX_PACKET_ITEMS=60): all 19 pending items fit into 1 packet with urgent/credential_redline items ordered first
if (doc.packets !== 1 || doc.woke !== true || doc.immediate_wake !== true) {
  process.exit(22);
}
if (JSON.stringify(doc.packet_item_counts) !== JSON.stringify([19])) process.exit(23);
const packetParts = wakes[0].content.trim().split('\n\n---\n\n');
if (packetParts.length !== 1) process.exit(24);
const firstBatchIdx = wakes[0].content.indexOf('m-dec-req');
if (firstBatchIdx < 0) process.exit(25);
for (const urgId of ['m-urg', 'm-cred-cat', 'm-cred-zh1', 'm-cred-zh2', 'm-cred-tok', 'm-cred-scp', 'm-cred-red']) {
  const urgIdx = wakes[0].content.indexOf(urgId);
  if (urgIdx < 0 || urgIdx > firstBatchIdx) process.exit(26);
}
if (!wakes[0].content.includes('「未分類」') || !wakes[0].content.includes('順手記錄一筆未符合任何固定規則的自由文字訊息')) {
  process.exit(27);
}

// Verify fake claude saw ONLY the 1 residue item, never any rule-matched item, and ran with seeded credentials-only dir
const claudeCalls = fs.readFileSync(claudeLogPath, 'utf8').trim().split('\n').map(JSON.parse);
if (claudeCalls.length !== 1) process.exit(28);
const call = claudeCalls[0];
if (!call.argv.includes('-p') || !call.argv.includes('sonnet')) process.exit(29);
if (!call.config_dir || call.config_dir === sourceCfg || call.config_dir === path.join(homeDir, '.claude')) process.exit(30);
if (JSON.stringify(call.config_entries) !== JSON.stringify(['.credentials.json'])) process.exit(31);
if (!call.prompt.includes('m-unclass')) process.exit(32);
for (const id of Object.keys(expected)) {
  if (id !== 'm-unclass' && call.prompt.includes(id)) {
    process.stderr.write(`fake claude saw rule-matched item ${id}\n`);
    process.exit(33);
  }
}

process.stdout.write('ok');
NODE
)"
assert_eq "$RULES_VERIFY" "ok" "every rule routes accurately, wake-kind is explicit no_action, urgent packets precede batch, and fake claude sees residue only"

# --- 3. Auto-accept 6 conditions: each missing => pending naming failed check; all present => accept once ---
FX_RES="$TEST_TMP/fx-results"
mkdir -p "$FX_RES"
RECEIPTS_RES="$TEST_TMP/receipts-results"

node - "$FX_RES/tasks.json" "$FX_RES/inbox.json" "$SAMPLE_REPO" "$REAL_SHA_FULL" "$REAL_SHA_SHORT" "$UNPUSHED_SHA_FULL" "$DISPATCHED_BEFORE" "$DISPATCHED_AFTER" <<'NODE'
'use strict';
const fs = require('fs');
const [tasksPath, inboxPath, repoPath, fullSha, shortSha, unpushedSha, dispatchedBefore, dispatchedAfter] = process.argv.slice(2);
const unknownSha = fullSha.startsWith('a') ? 'b123456789abcdef' : 'a123456789abcdef';

const baseTask = {
  assignee: 'ns/h/impl-ok',
  attempt: 2,
  dispatched_at: dispatchedBefore,
  acceptance: ['criterion-alpha verified', 'criterion-beta verified'],
};

const tasks = {};
for (let i = 1; i <= 14; i += 1) {
  const id = `01M7RES00000000000000000${String(i).padStart(2, '0')}`;
  tasks[id] = { ...baseTask };
}
tasks['01M7RES0000000000000000006'].dispatched_at = dispatchedAfter;
fs.writeFileSync(tasksPath, JSON.stringify(tasks, null, 2) + '\n');

function goodLines(overrides = {}) {
  return [
    `Repo: ${overrides.repo !== undefined ? overrides.repo : repoPath}`,
    `Status: ${overrides.status || 'done'}`,
    ...(overrides.omitAttempt ? [] : [`Attempt: ${overrides.attempt !== undefined ? overrides.attempt : 2}`]),
    `Commit: ${overrides.commit || fullSha}`,
    ...(overrides.omitVerify ? [] : [`Verify: ${overrides.verify || 'rc=0 receipt=ab12cd34ef567890'}`]),
    overrides.crit1 !== undefined ? overrides.crit1 : '- [x] criterion-alpha verified',
    overrides.crit2 !== undefined ? overrides.crit2 : '- [x] criterion-beta verified',
    ...(overrides.extraLine ? [overrides.extraLine] : []),
    ...(overrides.omitUsed ? [] : [`Used: ${overrides.used || 'e2e switchboard verification'}`]),
  ].filter(Boolean).join('\n');
}

const items = [
  {
    message_id: 'r-all-pass',
    from: 'ns/h/impl-ok',
    category: 'task_result',
    task_id: '01M7RES0000000000000000001',
    content: goodLines(),
  },
  {
    message_id: 'r-miss-assignee',
    from: 'ns/h/wrong-sender',
    category: 'task_result',
    task_id: '01M7RES0000000000000000002',
    content: goodLines(),
  },
  {
    message_id: 'r-miss-attempt-wrong',
    from: 'ns/h/impl-ok',
    category: 'task_result',
    task_id: '01M7RES0000000000000000003',
    content: goodLines({ attempt: 1 }),
  },
  {
    message_id: 'r-miss-attempt-absent',
    from: 'ns/h/impl-ok',
    category: 'task_result',
    task_id: '01M7RES0000000000000000004',
    content: goodLines({ omitAttempt: true }),
  },
  {
    message_id: 'r-miss-remote',
    from: 'ns/h/impl-ok',
    category: 'task_result',
    task_id: '01M7RES0000000000000000005',
    content: goodLines({ commit: unpushedSha }),
  },
  {
    message_id: 'r-miss-commit-time',
    from: 'ns/h/impl-ok',
    category: 'task_result',
    task_id: '01M7RES0000000000000000006',
    content: goodLines(),
  },
  {
    message_id: 'r-miss-verify-absent',
    from: 'ns/h/impl-ok',
    category: 'task_result',
    task_id: '01M7RES0000000000000000007',
    content: goodLines({ omitVerify: true }),
  },
  {
    message_id: 'r-miss-verify-same-sha',
    from: 'ns/h/impl-ok',
    category: 'task_result',
    task_id: '01M7RES0000000000000000008',
    content: goodLines({ verify: shortSha }),
  },
  {
    message_id: 'r-miss-acceptance',
    from: 'ns/h/impl-ok',
    category: 'task_result',
    task_id: '01M7RES0000000000000000009',
    content: goodLines({ crit2: '- [ ] criterion-beta verified' }),
  },
  {
    message_id: 'r-miss-used-na',
    from: 'ns/h/impl-ok',
    category: 'task_result',
    task_id: '01M7RES0000000000000000010',
    content: goodLines({ used: 'n/a' }),
  },
  {
    message_id: 'r-miss-used-unit',
    from: 'ns/h/impl-ok',
    category: 'task_result',
    task_id: '01M7RES0000000000000000011',
    content: goodLines({ used: 'unit tests only' }),
  },
  {
    message_id: 'r-bad-sha',
    from: 'ns/h/impl-ok',
    category: 'task_result',
    task_id: '01M7RES0000000000000000012',
    content: goodLines({ commit: unknownSha }),
  },
  {
    message_id: 'r-waiver',
    from: 'ns/h/impl-ok',
    category: 'task_result',
    task_id: '01M7RES0000000000000000013',
    content: goodLines({ extraLine: '本輪申請豁免一項整合檢查' }),
  },
  {
    message_id: 'r-thresh',
    from: 'ns/h/impl-ok',
    category: 'task_result',
    task_id: '01M7RES0000000000000000014',
    content: goodLines({ extraLine: 'lowered threshold to pass' }),
  },
];
fs.writeFileSync(inboxPath, JSON.stringify(items, null, 2) + '\n');
NODE

RES_OUT="$(AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_RES" node "$SWITCHBOARD_JS" run --receipt-dir "$RECEIPTS_RES" --state-file "$TEST_TMP/state-res.json" < /dev/null 2>&1)"; RES_RC=$?
assert_eq "$RES_RC" "0" "task_result 6-condition verification run exits 0"

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
const wakes = fs.readFileSync(path.join(fxDir, 'wakes.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const wakeText = wakes[0].content;

if (accepts.length !== 1 || accepts[0].task_id !== '01M7RES0000000000000000001') process.exit(1);
if (marks['r-all-pass'].disposition !== 'done' || marks['r-all-pass'].ref !== 'r-all-pass') process.exit(2);

const expectedFailed = {
  'r-miss-assignee': 'assignee_mismatch',
  'r-miss-attempt-wrong': 'attempt_mismatch',
  'r-miss-attempt-absent': 'attempt_mismatch',
  'r-miss-remote': 'commit_not_on_remote',
  'r-miss-commit-time': 'commit_before_dispatch',
  'r-miss-verify-absent': 'missing_independent_verify',
  'r-miss-verify-same-sha': 'missing_independent_verify',
  'r-miss-acceptance': 'acceptance_unmatched',
  'r-miss-used-na': 'used_line',
  'r-miss-used-unit': 'used_line',
  'r-bad-sha': 'sha_unresolved',
  'r-waiver': 'no_exception_words',
  'r-thresh': 'no_threshold_change',
};
for (const [id, checkName] of Object.entries(expectedFailed)) {
  const m = marks[id];
  if (!m || m.disposition !== 'pending_decision') {
    process.stderr.write(`expected pending_decision for ${id}, got ${JSON.stringify(m)}\n`);
    process.exit(3);
  }
  if (!Array.isArray(m.failed_checks) || !m.failed_checks.includes(checkName)) {
    process.stderr.write(`expected ${checkName} in ${id} failed_checks=${JSON.stringify(m.failed_checks)}\n`);
    process.exit(4);
  }
  if (!wakeText.includes(checkName)) {
    process.stderr.write(`wake packet missing check name ${checkName}\n`);
    process.exit(5);
  }
}
if (doc.accepted !== 1 || doc.pending !== 13 || doc.residue !== 0) process.exit(6);
process.stdout.write('ok');
NODE
)"
assert_eq "$RES_VERIFY" "ok" "auto-accept passes once when all 6 conditions hold and routes each missing condition to pending naming it"

# --- 4. Fallback suite: classify, forbidden close/accept refusal, garbage, >30k chunking, knob off, reopen, fallback-status ---
# 4a. Fake classifies residue (no_action vs pending_decision) & counts hidden_pending; never sees rule-matched items
FX_FB1="$TEST_TMP/fx-fb1"
mkdir -p "$FX_FB1"
rm -f "$FAKE_CLAUDE_LOG"
node - "$FX_FB1/inbox.json" <<'NODE'
'use strict';
const fs = require('fs');
fs.writeFileSync(process.argv[2], JSON.stringify([
  { message_id: 'fb-rule-ack', from: 'ns/h/lane-1', category: 'ack', content: 'SECRET_RULE_ACK_NEVER_SENT_TO_FALLBACK' },
  { message_id: 'fb-rule-wake', from: 'ns/h/lane-1', kind: 'wake', content: 'SECRET_WAKE_HEARTBEAT_NEVER_SENT' },
  { message_id: 'fb-res-na', from: 'ns/h/lane-2', category: 'chat_unclassified', content: '[routine-note] build cache warmed' },
  { message_id: 'fb-res-pend', from: 'ns/h/lane-3', category: 'chat_unclassified', content: 'unstructured note needing PM judgment' },
], null, 2) + '\n');
NODE

FB1_OUT="$(FAKE_CLAUDE_MODE=classify AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_FB1" node "$SWITCHBOARD_JS" run --receipt-dir "$TEST_TMP/r-fb1" --state-file "$TEST_TMP/s-fb1.json" < /dev/null 2>&1)"; FB1_RC=$?
assert_eq "$FB1_RC" "0" "fallback classify run exits 0"
FB1_CHECK="$(node - "$FX_FB1" "$FB1_OUT" "$FAKE_CLAUDE_LOG" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const [fxDir, outText, logPath] = process.argv.slice(2);
const doc = JSON.parse(outText);
const marks = Object.fromEntries(
  fs.readFileSync(path.join(fxDir, 'marks.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).map((m) => [m.id, m]),
);
const calls = fs.readFileSync(logPath, 'utf8').trim().split('\n').map(JSON.parse);
if (calls.length !== 1 || doc.fallback_calls !== 1) process.exit(1);
if (calls[0].prompt.includes('SECRET_RULE_ACK_NEVER_SENT_TO_FALLBACK') || calls[0].prompt.includes('SECRET_WAKE_HEARTBEAT_NEVER_SENT')) {
  process.exit(2);
}
if (!calls[0].prompt.includes('fb-res-na') || !calls[0].prompt.includes('fb-res-pend')) process.exit(3);
if (marks['fb-res-na'].disposition !== 'no_action' || marks['fb-res-na'].rule !== 'fallback_no_action') process.exit(4);
if (marks['fb-res-pend'].disposition !== 'pending_decision') process.exit(5);
if (doc.residue !== 2 || doc.hidden_pending !== 1 || doc.no_action !== 3 || doc.pending !== 1) process.exit(6);
process.stdout.write('ok');
NODE
)"
assert_eq "$FB1_CHECK" "ok" "fallback classifies residue, counts hidden_pending=1, and excludes rule-matched items"

# 4b. Model attempting done or accept is coerced to pending_decision; garbage => all pending_decision
FX_FB_BAD="$TEST_TMP/fx-fb-bad"
mkdir -p "$FX_FB_BAD"
node - "$FX_FB_BAD/inbox.json" <<'NODE'
'use strict';
const fs = require('fs');
fs.writeFileSync(process.argv[2], JSON.stringify([
  { message_id: 'fb-bad-1', from: 'ns/h/lane-1', category: 'chat_unclassified', content: '[routine-note] residue item one' },
  { message_id: 'fb-bad-2', from: 'ns/h/lane-2', category: 'chat_unclassified', content: '[routine-note] residue item two' },
], null, 2) + '\n');
NODE

FB_TRY_OUT="$(FAKE_CLAUDE_MODE=try_done_accept AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_FB_BAD" node "$SWITCHBOARD_JS" run --receipt-dir "$TEST_TMP/r-fb-try" --state-file "$TEST_TMP/s-fb-try.json" < /dev/null 2>&1)"; FB_TRY_RC=$?
assert_eq "$FB_TRY_RC" "0" "fallback forbidden-class coercion run exits 0"
assert_file_absent "$FX_FB_BAD/accepts.jsonl" "fallback model may never accept tasks"
FB_TRY_CHECK="$(node - "$FB_TRY_OUT" <<'NODE'
'use strict';
const doc = JSON.parse(process.argv[2]);
if (doc.accepted !== 0 || doc.no_action !== 0 || doc.pending !== 2 || doc.hidden_pending !== 2) process.exit(1);
process.stdout.write('ok');
NODE
)"
assert_eq "$FB_TRY_CHECK" "ok" "fallback model output done/accept coerced to pending_decision"

rm -f "$FX_FB_BAD/marks.jsonl" "$FX_FB_BAD/wakes.jsonl"
FB_GARB_OUT="$(FAKE_CLAUDE_MODE=garbage AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_FB_BAD" node "$SWITCHBOARD_JS" run --receipt-dir "$TEST_TMP/r-fb-garb" --state-file "$TEST_TMP/s-fb-garb.json" < /dev/null 2>&1)"; FB_GARB_RC=$?
assert_eq "$FB_GARB_RC" "0" "fallback garbage output run exits 0"
FB_GARB_CHECK="$(node - "$FB_GARB_OUT" <<'NODE'
'use strict';
const doc = JSON.parse(process.argv[2]);
if (doc.accepted !== 0 || doc.no_action !== 0 || doc.pending !== 2 || doc.hidden_pending !== 2) process.exit(1);
process.stdout.write('ok');
NODE
)"
assert_eq "$FB_GARB_CHECK" "ok" "garbage fallback output routes all residue items to pending_decision"

# 4c. Residue input > 30000 tokens (chars/3) splits into multiple calls each <= 30000 input tokens
FX_FB_SPLIT="$TEST_TMP/fx-fb-split"
mkdir -p "$FX_FB_SPLIT"
rm -f "$FAKE_CLAUDE_LOG"
node - "$FX_FB_SPLIT/inbox.json" <<'NODE'
'use strict';
const fs = require('fs');
const bigChunk = '[routine-note] ' + '長篇未分類觀察紀錄內容段落。'.repeat(3200);
fs.writeFileSync(process.argv[2], JSON.stringify([
  { message_id: 'fb-big-1', from: 'ns/h/lane-1', category: 'chat_unclassified', content: bigChunk },
  { message_id: 'fb-big-2', from: 'ns/h/lane-2', category: 'chat_unclassified', content: bigChunk },
  { message_id: 'fb-big-3', from: 'ns/h/lane-3', category: 'chat_unclassified', content: bigChunk },
], null, 2) + '\n');
NODE

FB_SPLIT_OUT="$(FAKE_CLAUDE_MODE=classify AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_FB_SPLIT" node "$SWITCHBOARD_JS" run --receipt-dir "$TEST_TMP/r-fb-split" --state-file "$TEST_TMP/s-fb-split.json" < /dev/null 2>&1)"; FB_SPLIT_RC=$?
assert_eq "$FB_SPLIT_RC" "0" ">30k token residue split run exits 0"
FB_SPLIT_CHECK="$(node - "$FB_SPLIT_OUT" "$FAKE_CLAUDE_LOG" <<'NODE'
'use strict';
const fs = require('fs');
const [outText, logPath] = process.argv.slice(2);
const doc = JSON.parse(outText);
const calls = fs.readFileSync(logPath, 'utf8').trim().split('\n').map(JSON.parse);
if (calls.length < 2 || doc.fallback_calls !== calls.length) process.exit(1);
for (const c of calls) {
  const markerIdx = c.prompt.indexOf('Engine: sonnet | Role: author');
  const innerPrompt = markerIdx >= 0 ? c.prompt.slice(markerIdx) : c.prompt;
  if (Math.ceil(innerPrompt.length / 3) > 30000) process.exit(2);
}
if (doc.no_action !== 3 || doc.pending !== 0) process.exit(3);
process.stdout.write('ok');
NODE
)"
assert_eq "$FB_SPLIT_CHECK" "ok" "residue batch >30000 tokens splits into multiple <=30000-token calls"

# 4d. Knob off => no call; > 3 residue in an hour => next run reopens fallback and records fallback_reopened: true
FX_REOPEN_1="$TEST_TMP/fx-reopen-1"
FX_REOPEN_2="$TEST_TMP/fx-reopen-2"
FX_REOPEN_3="$TEST_TMP/fx-reopen-3"
RECEIPTS_REOPEN="$TEST_TMP/receipts-reopen"
mkdir -p "$FX_REOPEN_1" "$FX_REOPEN_2" "$FX_REOPEN_3"
rm -f "$FAKE_CLAUDE_LOG"

node - "$FX_REOPEN_1/inbox.json" "$FX_REOPEN_2/inbox.json" "$FX_REOPEN_3/inbox.json" <<'NODE'
'use strict';
const fs = require('fs');
const [p1, p2, p3] = process.argv.slice(2);
fs.writeFileSync(p1, JSON.stringify([
  { message_id: 'ro-1', from: 'ns/h/l1', category: 'chat_unclassified', content: '[routine-note] residue 1' },
  { message_id: 'ro-2', from: 'ns/h/l1', category: 'chat_unclassified', content: '[routine-note] residue 2' },
  { message_id: 'ro-3', from: 'ns/h/l1', category: 'chat_unclassified', content: '[routine-note] residue 3' },
  { message_id: 'ro-4', from: 'ns/h/l1', category: 'chat_unclassified', content: '[routine-note] residue 4' },
], null, 2) + '\n');
fs.writeFileSync(p2, JSON.stringify([
  { message_id: 'ro-next', from: 'ns/h/l2', category: 'chat_unclassified', content: '[routine-note] reopened run item' },
], null, 2) + '\n');
fs.writeFileSync(p3, JSON.stringify([
  { message_id: 'ro-after', from: 'ns/h/l3', category: 'chat_unclassified', content: '[routine-note] post-reopen item' },
], null, 2) + '\n');
NODE

RO_OUT_1="$(AUTOPILOT_PM_SWITCHBOARD_FALLBACK=off AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_REOPEN_1" node "$SWITCHBOARD_JS" run --receipt-dir "$RECEIPTS_REOPEN" --state-file "$TEST_TMP/s-reopen.json" < /dev/null 2>&1)"; RO_RC_1=$?
assert_eq "$RO_RC_1" "0" "knob=off run exits 0"
assert_file_absent "$FAKE_CLAUDE_LOG" "AUTOPILOT_PM_SWITCHBOARD_FALLBACK=off makes zero claude calls"

RO_OUT_2="$(FAKE_CLAUDE_MODE=classify AUTOPILOT_PM_SWITCHBOARD_FALLBACK=off AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_REOPEN_2" node "$SWITCHBOARD_JS" run --receipt-dir "$RECEIPTS_REOPEN" --state-file "$TEST_TMP/s-reopen.json" < /dev/null 2>&1)"; RO_RC_2=$?
assert_eq "$RO_RC_2" "0" "reopen run after >3 hourly residue exits 0"

RO_OUT_3="$(FAKE_CLAUDE_MODE=classify AUTOPILOT_PM_SWITCHBOARD_FALLBACK=off AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_REOPEN_3" node "$SWITCHBOARD_JS" run --receipt-dir "$RECEIPTS_REOPEN" --state-file "$TEST_TMP/s-reopen.json" < /dev/null 2>&1)"; RO_RC_3=$?
assert_eq "$RO_RC_3" "0" "post-reopen run without new >3 burst exits 0"

REOPEN_CHECK="$(node - "$RO_OUT_1" "$RO_OUT_2" "$RO_OUT_3" "$FAKE_CLAUDE_LOG" <<'NODE'
'use strict';
const fs = require('fs');
const [o1, o2, o3, logPath] = process.argv.slice(2);
const d1 = JSON.parse(o1);
const d2 = JSON.parse(o2);
const d3 = JSON.parse(o3);
const calls = fs.readFileSync(logPath, 'utf8').trim().split('\n').map(JSON.parse);
if (d1.fallback_enabled !== false || d1.fallback_reopened !== false || d1.fallback_calls !== 0 || d1.pending !== 4) {
  process.exit(1);
}
if (d2.fallback_enabled !== true || d2.fallback_reopened !== true || d2.fallback_calls !== 1 || d2.no_action !== 1) {
  process.exit(2);
}
if (d3.fallback_enabled !== false || d3.fallback_reopened !== false || d3.fallback_calls !== 0 || d3.pending !== 1) {
  process.exit(3);
}
if (calls.length !== 1) process.exit(4);
process.stdout.write('ok');
NODE
)"
assert_eq "$REOPEN_CHECK" "ok" "knob off skips fallback, >3 residue in an hour reopens next run once with fallback_reopened=true"

# 4e. fallback-status: retirable ONLY when all 4 conditions hold (>=500 non-operator, residue<2%, hidden_pending==0, 4 leak checks==0)
RECEIPTS_RET_OK="$TEST_TMP/r-ret-ok"
RECEIPTS_RET_LOWMSG="$TEST_TMP/r-ret-lowmsg"
RECEIPTS_RET_HIGHRES="$TEST_TMP/r-ret-highres"
RECEIPTS_RET_HIDPEND="$TEST_TMP/r-ret-hidpend"
mkdir -p "$RECEIPTS_RET_OK" "$RECEIPTS_RET_LOWMSG" "$RECEIPTS_RET_HIGHRES" "$RECEIPTS_RET_HIDPEND"
LEAK_ZERO="$TEST_TMP/leak-zero.json"
LEAK_NONZERO="$TEST_TMP/leak-nonzero.json"

node - "$RECEIPTS_RET_OK" "$RECEIPTS_RET_LOWMSG" "$RECEIPTS_RET_HIGHRES" "$RECEIPTS_RET_HIDPEND" "$LEAK_ZERO" "$LEAK_NONZERO" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const [dOk, dLow, dHighRes, dHidPend, leakZero, leakNonZero] = process.argv.slice(2);
const nowIso = new Date().toISOString();

function writeReceipt(dir, overrides) {
  fs.writeFileSync(path.join(dir, '2026-11-19T00-00-00-000Z.json'), JSON.stringify({
    schema: 'autopilot.pm-switchboard/1',
    at: nowIso,
    processed: 520,
    non_operator_processed: 510,
    counts_by_rule: { operator: 10 },
    accepted: 300,
    pending: 10,
    no_action: 210,
    residue: 5,
    hidden_pending: 0,
    packets: 2,
    woke: true,
    ...overrides,
  }) + '\n');
}

writeReceipt(dOk, {});
writeReceipt(dLow, { processed: 520, non_operator_processed: 499, counts_by_rule: { operator: 21 }, residue: 2, hidden_pending: 0 });
writeReceipt(dHighRes, { processed: 500, non_operator_processed: 500, counts_by_rule: {}, residue: 10, hidden_pending: 0 });
writeReceipt(dHidPend, { processed: 520, non_operator_processed: 510, residue: 3, hidden_pending: 1 });

fs.writeFileSync(leakZero, JSON.stringify({ check_a: 0, check_b: 0, check_c: 0, check_d: 0 }) + '\n');
fs.writeFileSync(leakNonZero, JSON.stringify({ check_a: 0, check_b: 1, check_c: 0, check_d: 0 }) + '\n');
NODE

FB_ST_OK="$(AUTOPILOT_PM_LEAK_STATUS_FILE="$LEAK_ZERO" node "$SWITCHBOARD_JS" fallback-status --since 24h --receipt-dir "$RECEIPTS_RET_OK" --json < /dev/null 2>&1)"; FB_ST_OK_RC=$?
assert_eq "$FB_ST_OK_RC" "0" "fallback-status exits 0"
FB_ST_UNSET="$(env -u AUTOPILOT_PM_LEAK_STATUS_FILE node "$SWITCHBOARD_JS" fallback-status --since 24h --receipt-dir "$RECEIPTS_RET_OK" --json < /dev/null 2>&1)"
FB_ST_LEAK1="$(AUTOPILOT_PM_LEAK_STATUS_FILE="$LEAK_NONZERO" node "$SWITCHBOARD_JS" fallback-status --since 24h --receipt-dir "$RECEIPTS_RET_OK" --json < /dev/null 2>&1)"
FB_ST_LOW="$(AUTOPILOT_PM_LEAK_STATUS_FILE="$LEAK_ZERO" node "$SWITCHBOARD_JS" fallback-status --since 24h --receipt-dir "$RECEIPTS_RET_LOWMSG" --json < /dev/null 2>&1)"
FB_ST_HIGHRES="$(AUTOPILOT_PM_LEAK_STATUS_FILE="$LEAK_ZERO" node "$SWITCHBOARD_JS" fallback-status --since 24h --receipt-dir "$RECEIPTS_RET_HIGHRES" --json < /dev/null 2>&1)"
FB_ST_HID="$(AUTOPILOT_PM_LEAK_STATUS_FILE="$LEAK_ZERO" node "$SWITCHBOARD_JS" fallback-status --since 24h --receipt-dir "$RECEIPTS_RET_HIDPEND" --json < /dev/null 2>&1)"
FB_ST_LINE="$(AUTOPILOT_PM_LEAK_STATUS_FILE="$LEAK_ZERO" node "$SWITCHBOARD_JS" fallback-status --since 24h --receipt-dir "$RECEIPTS_RET_OK" < /dev/null 2>&1)"

FB_STATUS_CHECK="$(node - "$FB_ST_OK" "$FB_ST_UNSET" "$FB_ST_LEAK1" "$FB_ST_LOW" "$FB_ST_HIGHRES" "$FB_ST_HID" "$FB_ST_LINE" <<'NODE'
'use strict';
const [okRaw, unsetRaw, leak1Raw, lowRaw, highResRaw, hidRaw, lineRaw] = process.argv.slice(2);
const okDoc = JSON.parse(okRaw);
const unsetDoc = JSON.parse(unsetRaw);
const leak1Doc = JSON.parse(leak1Raw);
const lowDoc = JSON.parse(lowRaw);
const highResDoc = JSON.parse(highResRaw);
const hidDoc = JSON.parse(hidRaw);

if (okDoc.retirable !== true || okDoc.knob !== 'on') process.exit(1);
if (unsetDoc.retirable !== false || unsetDoc.leak_checks !== 'unknown') process.exit(2);
if (leak1Doc.retirable !== false || leak1Doc.conditions.leak_checks_zero !== false) process.exit(3);
if (lowDoc.retirable !== false || lowDoc.conditions.min_non_operator_messages !== false) process.exit(4);
if (highResDoc.retirable !== false || highResDoc.conditions.residue_under_2pct !== false) process.exit(5);
if (hidDoc.retirable !== false || hidDoc.conditions.hidden_pending_zero !== false) process.exit(6);
if (!lineRaw.includes('retirable=true') || !lineRaw.includes('knob=on')) process.exit(7);
process.stdout.write('ok');
NODE
)"
assert_eq "$FB_STATUS_CHECK" "ok" "fallback-status reports retirable=true iff all four retire conditions hold and never flips knob"

# --- 5. Non-Anthropic fallback model id refused (hard-coded + cn-model-dispatch-gate agreement) ---
rm -f "$FAKE_CLAUDE_LOG"
for bad_model in \
  "gpt-5" \
  "gemini-4-carbon-high" \
  "grok-4.7" \
  "kimi-code/k3" \
  "GLM-5.3" \
  "Qwen3.8-Max" \
  "deepseek-v4" \
  "MiniMax-M3"
do
  REF_OUT="$(AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_FB1" node "$SWITCHBOARD_JS" run --fallback-model "$bad_model" --receipt-dir "$TEST_TMP/r-refuse" --state-file "$TEST_TMP/s-refuse.json" < /dev/null 2>&1)"; REF_RC=$?
  assert_eq "$REF_RC" "2" "non-Anthropic model $bad_model refused with exit 2"
  assert_contains "$REF_OUT" "non-Anthropic" "refusal names non-Anthropic policy for $bad_model"
done
assert_file_absent "$FAKE_CLAUDE_LOG" "refused non-Anthropic models spawn zero claude processes"

# --- 6. decision_request batched (no immediate wake); urgent wakes immediately; per-lane counts ---
FX_DEC_IMM="$TEST_TMP/fx-dec-imm"
mkdir -p "$FX_DEC_IMM"
STATE_DEC_IMM="$TEST_TMP/state-dec-imm.json"
RECEIPTS_DEC_IMM="$TEST_TMP/receipts-dec-imm"

node - "$FX_DEC_IMM/inbox.json" <<'NODE'
'use strict';
const fs = require('fs');
fs.writeFileSync(process.argv[2], JSON.stringify([
  { message_id: 'dr-1', from: 'ns/h/lane-alpha', category: 'decision_request', content: 'Choose rollout order A or B?' },
  { message_id: 'dr-2', from: 'ns/h/lane-alpha', category: 'decision_request', content: 'Approve schema v2?' },
  { message_id: 'dr-3', from: 'ns/h/lane-beta', category: 'decision_request', content: 'Confirm archive retention?' },
], null, 2) + '\n');
NODE

DEC_IMM_OUT="$(AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_DEC_IMM" node "$SWITCHBOARD_JS" run --immediate --receipt-dir "$RECEIPTS_DEC_IMM" --state-file "$STATE_DEC_IMM" < /dev/null 2>&1)"; DEC_IMM_RC=$?
assert_eq "$DEC_IMM_RC" "0" "immediate mode on decision_request-only inbox exits 0"
assert_file_absent "$FX_DEC_IMM/wakes.jsonl" "decision_request does NOT trigger an immediate wake"

# Now an urgent item arrives in immediate mode -> wakes immediately with ONLY the urgent item
node - "$FX_DEC_IMM/inbox.json" <<'NODE'
'use strict';
const fs = require('fs');
fs.writeFileSync(process.argv[2], JSON.stringify([
  { message_id: 'urg-now-1', from: 'ns/h/lane-gamma', category: 'urgent', content: 'production courier down!' },
], null, 2) + '\n');
NODE

URG_IMM_OUT="$(AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_DEC_IMM" node "$SWITCHBOARD_JS" run --immediate --receipt-dir "$RECEIPTS_DEC_IMM" --state-file "$STATE_DEC_IMM" < /dev/null 2>&1)"; URG_IMM_RC=$?
assert_eq "$URG_IMM_RC" "0" "immediate mode with urgent item exits 0"

# Subsequent 10-minute batch tick flushes the deferred decision_request items into 1 batch packet
printf '[]\n' > "$FX_DEC_IMM/inbox.json"
BATCH_FLUSH_OUT="$(AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_DEC_IMM" node "$SWITCHBOARD_JS" run --receipt-dir "$RECEIPTS_DEC_IMM" --state-file "$STATE_DEC_IMM" < /dev/null 2>&1)"; BATCH_FLUSH_RC=$?
assert_eq "$BATCH_FLUSH_RC" "0" "10-minute batch flush exits 0"

DEC_WAKE_VERIFY="$(node - "$FX_DEC_IMM/wakes.jsonl" "$DEC_IMM_OUT" "$URG_IMM_OUT" "$BATCH_FLUSH_OUT" <<'NODE'
'use strict';
const fs = require('fs');
const [wakesPath, decOut, urgOut, flushOut] = process.argv.slice(2);
const dDec = JSON.parse(decOut);
const dUrg = JSON.parse(urgOut);
const dFlush = JSON.parse(flushOut);
const wakes = fs.readFileSync(wakesPath, 'utf8').trim().split('\n').map(JSON.parse);

if (dDec.woke !== false || dDec.packets !== 0) process.exit(1);
if (JSON.stringify(dDec.decision_request_by_lane) !== JSON.stringify({ 'ns/h/lane-alpha': 2, 'ns/h/lane-beta': 1 })) {
  process.exit(2);
}
if (dUrg.woke !== true || dUrg.immediate_wake !== true || dUrg.immediate_packets !== 1 || dUrg.batch_packets !== 0) {
  process.exit(3);
}
if (!wakes[0].content.includes('urg-now-1') || wakes[0].content.includes('dr-1')) process.exit(4);
if (dFlush.woke !== true || dFlush.immediate_wake !== false || dFlush.batch_packets !== 1 || dFlush.immediate_packets !== 0) {
  process.exit(5);
}
if (!wakes[1].content.includes('dr-1') || !wakes[1].content.includes('dr-2') || !wakes[1].content.includes('dr-3')) {
  process.exit(6);
}
if (wakes[1].content.includes('urg-now-1')) process.exit(7);
process.stdout.write('ok');
NODE
)"
assert_eq "$DEC_WAKE_VERIFY" "ok" "decision_request is batched for 10m tick with per-lane counts while urgent wakes immediately"

# --- 7. Dedupe: state.json under $XDG_RUNTIME_DIR/autopilot/pm-switchboard/state.json prevents repeat wakes ---
FX_DEDUPE="$TEST_TMP/fx-dedupe"
mkdir -p "$FX_DEDUPE"
DEFAULT_STATE_FILE="$XDG_RUNTIME_DIR/autopilot/pm-switchboard/state.json"
rm -f "$DEFAULT_STATE_FILE"

node - "$FX_DEDUPE/inbox.json" <<'NODE'
'use strict';
const fs = require('fs');
fs.writeFileSync(process.argv[2], JSON.stringify([
  {
    message_id: 'dup-msg-1',
    from: 'ns/h/lane-dup',
    category: 'decision_request',
    task_id: '01M7DUP0000000000000000001',
    content: 'Need ruling on task 01M7DUP',
  },
], null, 2) + '\n');
NODE

DUP_OUT_1="$(AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_DEDUPE" node "$SWITCHBOARD_JS" run --receipt-dir "$TEST_TMP/r-dup" < /dev/null 2>&1)"; DUP_RC_1=$?
assert_eq "$DUP_RC_1" "0" "first dedupe run exits 0"
assert_file_exists "$DEFAULT_STATE_FILE" "default state.json written under XDG_RUNTIME_DIR/autopilot/pm-switchboard/"

# Second run with the exact same message_id -> does NOT wake again
DUP_OUT_2="$(AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_DEDUPE" node "$SWITCHBOARD_JS" run --receipt-dir "$TEST_TMP/r-dup" < /dev/null 2>&1)"; DUP_RC_2=$?
assert_eq "$DUP_RC_2" "0" "second dedupe run (same message_id) exits 0"

# Third run with a new message_id but same task_id + same rule -> ALSO deduped
node - "$FX_DEDUPE/inbox.json" <<'NODE'
'use strict';
const fs = require('fs');
fs.writeFileSync(process.argv[2], JSON.stringify([
  {
    message_id: 'dup-msg-2-new-id',
    from: 'ns/h/lane-dup',
    category: 'decision_request',
    task_id: '01M7DUP0000000000000000001',
    content: 'Repeated ping on same task_id and rule',
  },
], null, 2) + '\n');
NODE
DUP_OUT_3="$(AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_DEDUPE" node "$SWITCHBOARD_JS" run --receipt-dir "$TEST_TMP/r-dup" < /dev/null 2>&1)"; DUP_RC_3=$?
assert_eq "$DUP_RC_3" "0" "third dedupe run (same task_id + rule) exits 0"

DEDUPE_VERIFY="$(node - "$FX_DEDUPE/wakes.jsonl" "$DUP_OUT_1" "$DUP_OUT_2" "$DUP_OUT_3" <<'NODE'
'use strict';
const fs = require('fs');
const [wakesPath, o1, o2, o3] = process.argv.slice(2);
const d1 = JSON.parse(o1);
const d2 = JSON.parse(o2);
const d3 = JSON.parse(o3);
const wakes = fs.readFileSync(wakesPath, 'utf8').trim().split('\n').map(JSON.parse);
if (wakes.length !== 1) process.exit(1);
if (d1.woke !== true || d1.deduped !== 0) process.exit(2);
if (d2.woke !== false || d2.deduped !== 1 || d2.packets !== 0) process.exit(3);
if (d3.woke !== false || d3.deduped !== 1 || d3.packets !== 0) process.exit(4);
process.stdout.write('ok');
NODE
)"
assert_eq "$DEDUPE_VERIFY" "ok" "dedupe prevents waking twice on same message_id or same task_id + rule"

# --- 8a. Paging: 12 pending items => 1 packet, >60 pending items => 2 packets, zero item text truncated ---
FX_PKT12="$TEST_TMP/fx-pkt12"
mkdir -p "$FX_PKT12"
RECEIPTS_PKT="$TEST_TMP/receipts-pkt"

node - "$FX_PKT12/inbox.json" <<'NODE'
'use strict';
const fs = require('fs');
const items = [];
for (let i = 1; i <= 12; i += 1) {
  items.push({
    message_id: `p-${i}`,
    from: `ns/host/lane-${i}`,
    category: 'decision_request',
    task_id: i % 2 === 1 ? `01M7PKT00000000000000000${String(i).padStart(2, '0')}` : null,
    content: `需要裁示第 ${i} 項部署順序\n影響範圍為模組 ${i} — FULL-TEXT-SENTINEL-${i}-END`,
  });
}
fs.writeFileSync(process.argv[2], JSON.stringify(items, null, 2) + '\n');
NODE

PKT12_OUT="$(AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_PKT12" node "$SWITCHBOARD_JS" run --receipt-dir "$RECEIPTS_PKT" --state-file "$TEST_TMP/s-pkt12.json" < /dev/null 2>&1)"; PKT12_RC=$?
assert_eq "$PKT12_RC" "0" "12-pending paging run exits 0"

PKT12_VERIFY="$(node - "$FX_PKT12" "$PKT12_OUT" "$SWITCHBOARD_JS" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const [fxDir, stdoutText, swbPath] = process.argv.slice(2);
const { MAX_PACKET_TOKENS } = require(swbPath);
const doc = JSON.parse(stdoutText);
const wakes = fs.readFileSync(path.join(fxDir, 'wakes.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
if (wakes.length !== 1) process.exit(1);
// Merged-categories packing (MAX_PACKET_ITEMS=60): 12 items now fit into 1 packet
if (doc.packets !== 1) process.exit(2);
if (JSON.stringify(doc.packet_item_counts) !== JSON.stringify([12])) process.exit(3);

const packetParts = wakes[0].content.trim().split('\n\n---\n\n');
if (packetParts.length !== 1) process.exit(4);
for (const part of packetParts) {
  const tokEst = Math.ceil(part.length / 3);
  if (tokEst > MAX_PACKET_TOKENS) process.exit(5);
}
const fullWake = wakes[0].content;
for (let i = 1; i <= 12; i += 1) {
  if (!fullWake.includes(`FULL-TEXT-SENTINEL-${i}-END`)) process.exit(6);
}
for (const reqLabel of ['編號：', 'lane：', '工單：無', '類型：decision_request', '事實：', '[evidence: p-1]', '選項：', '「建議，不是決定」']) {
  if (!fullWake.includes(reqLabel)) process.exit(7);
}
process.stdout.write('ok');
NODE
)"
assert_eq "$PKT12_VERIFY" "ok" "12 pending items fit into 1 packet <=MAX_PACKET_TOKENS with zero item text truncated"

FX_PKT65="$TEST_TMP/fx-pkt65"
mkdir -p "$FX_PKT65"
node - "$FX_PKT65/inbox.json" <<'NODE'
'use strict';
const fs = require('fs');
const items = [];
for (let i = 1; i <= 65; i += 1) {
  items.push({
    message_id: `p65-${i}`,
    from: `ns/host/lane-${i}`,
    category: 'decision_request',
    content: `item ${i} — P65-SENTINEL-${i}-END`,
  });
}
fs.writeFileSync(process.argv[2], JSON.stringify(items, null, 2) + '\n');
NODE

PKT65_OUT="$(AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_PKT65" node "$SWITCHBOARD_JS" run --receipt-dir "$TEST_TMP/receipts-pkt65" --state-file "$TEST_TMP/s-pkt65.json" < /dev/null 2>&1)"; PKT65_RC=$?
assert_eq "$PKT65_RC" "0" "65-pending paging run exits 0"
PKT65_VERIFY="$(node - "$FX_PKT65" "$PKT65_OUT" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const [fxDir, stdoutText] = process.argv.slice(2);
const doc = JSON.parse(stdoutText);
const wakes = fs.readFileSync(path.join(fxDir, 'wakes.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
if (wakes.length !== 1) process.exit(1);
if (doc.packets !== 2 || JSON.stringify(doc.packet_item_counts) !== JSON.stringify([60, 5])) process.exit(2);
const fullWake = wakes[0].content;
for (let i = 1; i <= 65; i += 1) {
  if (!fullWake.includes(`P65-SENTINEL-${i}-END`)) process.exit(3);
}
process.stdout.write('ok');
NODE
)"
assert_eq "$PKT65_VERIFY" "ok" "65 pending items page into 2 packets (60 + 5) with zero item text truncated"

# --- 8b. Oversized item (> MAX_PACKET_TOKENS) gets its own packet and is NEVER truncated ---
FX_HUGE="$TEST_TMP/fx-huge"
mkdir -p "$FX_HUGE"
node - "$FX_HUGE/inbox.json" "$SWITCHBOARD_JS" <<'NODE'
'use strict';
const fs = require('fs');
const [outPath, swbPath] = process.argv.slice(2);
const { MAX_PACKET_TOKENS } = require(swbPath);
// Build oversized body dynamically from MAX_PACKET_TOKENS (48 KB cap) so it never drifts
const unit = '長篇記錄內容段落完整保留不截斷。';
const repeats = Math.ceil((MAX_PACKET_TOKENS * 3 + 300) / unit.length);
const longBody = 'HEAD-OVERSIZED-MARKER-' + unit.repeat(repeats) + '-TAIL-OVERSIZED-MARKER';
fs.writeFileSync(outPath, JSON.stringify([
  { message_id: 'm-normal-1', from: 'ns/h/lane-a', category: 'decision_request', content: 'short item before oversized' },
  { message_id: 'm-oversized-99', from: 'ns/h/lane-z', category: 'decision_request', content: longBody },
  { message_id: 'm-normal-2', from: 'ns/h/lane-b', category: 'decision_request', content: 'short item after oversized' },
], null, 2) + '\n');
NODE

HUGE_OUT="$(AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_HUGE" node "$SWITCHBOARD_JS" run --receipt-dir "$RECEIPTS_PKT" --state-file "$TEST_TMP/s-huge.json" < /dev/null 2>&1)"; HUGE_RC=$?
assert_eq "$HUGE_RC" "0" "oversized item paging run exits 0"
HUGE_VERIFY="$(node - "$FX_HUGE" "$HUGE_OUT" "$SWITCHBOARD_JS" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const [fxDir, stdoutText, swbPath] = process.argv.slice(2);
const { MAX_PACKET_TOKENS } = require(swbPath);
const doc = JSON.parse(stdoutText);
const inbox = JSON.parse(fs.readFileSync(path.join(fxDir, 'inbox.json'), 'utf8'));
const longBody = inbox[1].content;
const wake = JSON.parse(fs.readFileSync(path.join(fxDir, 'wakes.jsonl'), 'utf8').trim());
const parts = wake.content.trim().split('\n\n---\n\n');

// m-normal-1 -> packet 1 (<=MAX_PACKET_TOKENS), m-oversized-99 -> own packet 2 (untruncated), m-normal-2 -> packet 3 (<=MAX_PACKET_TOKENS)
if (doc.packets !== 3 || JSON.stringify(doc.packet_item_counts) !== JSON.stringify([1, 1, 1])) process.exit(1);
if (Math.ceil(parts[0].length / 3) > MAX_PACKET_TOKENS || Math.ceil(parts[2].length / 3) > MAX_PACKET_TOKENS) process.exit(2);
if (!parts[1].includes(longBody)) process.exit(3);
if (parts[1].includes('m-normal-1') || parts[1].includes('m-normal-2')) process.exit(4);
process.stdout.write('ok');
NODE
)"
assert_eq "$HUGE_VERIFY" "ok" "item over MAX_PACKET_TOKENS gets its own packet with 100% intact text"

# --- 8c. Zero pending -> zero wakes; plus residue-report [--since 24h] single-line summary ---
FX_ZERO="$TEST_TMP/fx-zero"
mkdir -p "$FX_ZERO"
node - "$FX_ZERO/tasks.json" "$FX_ZERO/inbox.json" "$SAMPLE_REPO" "$REAL_SHA_SHORT" "$DISPATCHED_BEFORE" <<'NODE'
'use strict';
const fs = require('fs');
const [tasksPath, inboxPath, repoPath, shaShort, dispatchedAt] = process.argv.slice(2);
fs.writeFileSync(tasksPath, JSON.stringify({
  '01M7ZERO000000000000000001': {
    assignee: 'ns/h/lane-2',
    attempt: 1,
    dispatched_at: dispatchedAt,
    acceptance: ['zero wake check passed'],
  },
}, null, 2) + '\n');
fs.writeFileSync(inboxPath, JSON.stringify([
  { message_id: 'z-1', from: 'ns/h/lane-1', category: 'ack', content: 'ack' },
  {
    message_id: 'z-2',
    from: 'ns/h/lane-2',
    category: 'task_result',
    task_id: '01M7ZERO000000000000000001',
    repo: repoPath,
    content: `Status: done\nAttempt: 1\nCommit: ${shaShort}\nVerify: rc=0 receipt=1122334455667788\n- [x] zero wake check passed\nUsed: e2e verified zero wake`,
  },
], null, 2) + '\n');
NODE

ZERO_OUT="$(AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_ZERO" node "$SWITCHBOARD_JS" run --receipt-dir "$RECEIPTS_PKT" --state-file "$TEST_TMP/s-zero.json" < /dev/null 2>&1)"; ZERO_RC=$?
assert_eq "$ZERO_RC" "0" "zero-pending run exits 0"
assert_file_absent "$FX_ZERO/wakes.jsonl" "zero pending items emit zero wakes"

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
assert_contains "$REPORT_LINE" "processed=17 " "residue-report sums processed=12+3+2=17"
assert_contains "$REPORT_LINE" "accepted=1 " "residue-report sums accepted=1"
assert_contains "$REPORT_LINE" "pending=15 " "residue-report sums pending=12+3+0=15"
assert_contains "$REPORT_LINE" "no_action=1 " "residue-report sums no_action=1"
assert_contains "$REPORT_LINE" "wakes=2" "residue-report sums wakes=2"

# --- 9. Rollback: AUTOPILOT_PM_AUTO_ACCEPT=off stops auto-accept and batches into one wake ---
FX_NOACC="$TEST_TMP/fx-noacc"
mkdir -p "$FX_NOACC"
cp "$FX_ZERO/tasks.json" "$FX_NOACC/tasks.json"
node - "$FX_NOACC/tasks.json" "$FX_NOACC/inbox.json" "$SAMPLE_REPO" "$REAL_SHA_SHORT" "$DISPATCHED_BEFORE" <<'NODE'
'use strict';
const fs = require('fs');
const [tasksPath, inboxPath, repoPath, shaShort, dispatchedAt] = process.argv.slice(2);
fs.writeFileSync(tasksPath, JSON.stringify({
  '01M7RBK0000000000000000001': { assignee: 'ns/h/l1', attempt: 1, dispatched_at: dispatchedAt, acceptance: ['crit ok'] },
  '01M7RBK0000000000000000002': { assignee: 'ns/h/l2', attempt: 1, dispatched_at: dispatchedAt, acceptance: ['crit ok'] },
}, null, 2) + '\n');
fs.writeFileSync(inboxPath, JSON.stringify([
  {
    message_id: 'rbk-1',
    from: 'ns/h/l1',
    category: 'task_result',
    task_id: '01M7RBK0000000000000000001',
    repo: repoPath,
    content: `Status: done\nAttempt: 1\nCommit: ${shaShort}\nVerify: rc=0 receipt=aa11bb22cc33dd44\n- [x] crit ok\nUsed: e2e verified`,
  },
  {
    message_id: 'rbk-2',
    from: 'ns/h/l2',
    category: 'task_result',
    task_id: '01M7RBK0000000000000000002',
    repo: repoPath,
    content: `Status: done\nAttempt: 1\nCommit: ${shaShort}\nVerify: rc=0 receipt=ee55ff6677889900\n- [x] crit ok\nUsed: user verified`,
  },
], null, 2) + '\n');
NODE

RBK_OUT="$(AUTOPILOT_PM_AUTO_ACCEPT=off AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_NOACC" node "$SWITCHBOARD_JS" run --receipt-dir "$TEST_TMP/r-rbk" --state-file "$TEST_TMP/s-rbk.json" < /dev/null 2>&1)"; RBK_RC=$?
assert_eq "$RBK_RC" "0" "AUTOPILOT_PM_AUTO_ACCEPT=off run exits 0"
assert_file_absent "$FX_NOACC/accepts.jsonl" "AUTOPILOT_PM_AUTO_ACCEPT=off makes zero accept calls"
RBK_VERIFY="$(node - "$FX_NOACC/wakes.jsonl" "$RBK_OUT" <<'NODE'
'use strict';
const fs = require('fs');
const [wakesPath, outText] = process.argv.slice(2);
const doc = JSON.parse(outText);
const wakes = fs.readFileSync(wakesPath, 'utf8').trim().split('\n').map(JSON.parse);
if (doc.accepted !== 0 || doc.pending !== 2 || doc.packets !== 1) process.exit(1);
if (wakes.length !== 1) process.exit(2);
process.stdout.write('ok');
NODE
)"
assert_eq "$RBK_VERIFY" "ok" "AUTOPILOT_PM_AUTO_ACCEPT=off routes verified results to pending in one batched wake"

# --- 10. pm-inbox-done, kill switch, and fleet mode (AUTOPILOT_PM_TASK_SHOW_CMD + AUTOPILOT_PM_ACCEPT_CMD) ---
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

RECEIPTS_KILL="$TEST_TMP/receipts-kill"
KILL_OUT="$(AUTOPILOT_PM_SWITCHBOARD=off AUTOPILOT_PM_INBOX_ADAPTER=fleet node "$SWITCHBOARD_JS" run --receipt-dir "$RECEIPTS_KILL" < /dev/null 2>&1)"; KILL_RC=$?
assert_eq "$KILL_RC" "0" "kill switch AUTOPILOT_PM_SWITCHBOARD=off exits 0"
assert_eq "$KILL_OUT" "" "kill switch produces no output"
assert_file_absent "$RECEIPTS_KILL" "kill switch creates no receipt directory"

NO_FLEET_STDOUT="$TEST_TMP/nofleet.stdout"
NO_FLEET_STDERR="$TEST_TMP/nofleet.stderr"
NO_FLEET_STATE="$TEST_TMP/s-nofleet.json"
RECEIPTS_NOFLEET="$TEST_TMP/r-nofleet"
env -u AUTOPILOT_FLEET_REPO AUTOPILOT_PM_INBOX_ADAPTER=fleet node "$SWITCHBOARD_JS" run --receipt-dir "$RECEIPTS_NOFLEET" --state-file "$NO_FLEET_STATE" >"$NO_FLEET_STDOUT" 2>"$NO_FLEET_STDERR" < /dev/null
NO_FLEET_RC=$?
NO_FLEET_OUT="$(cat "$NO_FLEET_STDERR")"
NO_FLEET_LINES="$(wc -l < "$NO_FLEET_STDERR" | tr -d ' ')"
assert_eq "$NO_FLEET_RC" "3" "fleet mode without AUTOPILOT_FLEET_REPO exits 3"
assert_eq "$NO_FLEET_LINES" "1" "unset AUTOPILOT_FLEET_REPO prints one line to stderr"
assert_eq "$(cat "$NO_FLEET_STDOUT")" "" "unset AUTOPILOT_FLEET_REPO writes nothing to stdout"
assert_eq "$NO_FLEET_OUT" "pm-switchboard: waiting_on fleet 01M7R4FA (AUTOPILOT_FLEET_REPO unset)" "unset AUTOPILOT_FLEET_REPO prints waiting_on message"
assert_file_absent "$RECEIPTS_NOFLEET" "unset AUTOPILOT_FLEET_REPO creates no receipt dir"
assert_file_absent "$NO_FLEET_STATE" "unset AUTOPILOT_FLEET_REPO writes no state file"

MISSING_FLEET_REPO="$TEST_TMP/empty-fleet-repo"
mkdir -p "$MISSING_FLEET_REPO"
EXPECTED_CLI_PATH="$MISSING_FLEET_REPO/plugins/claude/src/inbox-cli.ts"
NO_CLI_STDOUT="$TEST_TMP/nocli.stdout"
NO_CLI_STDERR="$TEST_TMP/nocli.stderr"
NO_CLI_STATE="$TEST_TMP/s-nocli.json"
RECEIPTS_NOCLI="$TEST_TMP/r-nocli"
AUTOPILOT_FLEET_REPO="$MISSING_FLEET_REPO" AUTOPILOT_PM_INBOX_ADAPTER=fleet node "$SWITCHBOARD_JS" run --receipt-dir "$RECEIPTS_NOCLI" --state-file "$NO_CLI_STATE" >"$NO_CLI_STDOUT" 2>"$NO_CLI_STDERR" < /dev/null
NO_CLI_RC=$?
NO_CLI_OUT="$(cat "$NO_CLI_STDERR")"
NO_CLI_LINES="$(wc -l < "$NO_CLI_STDERR" | tr -d ' ')"
assert_eq "$NO_CLI_RC" "3" "fleet mode with missing inbox-cli.ts exits 3"
assert_eq "$NO_CLI_LINES" "1" "missing inbox-cli.ts prints one line to stderr"
assert_eq "$(cat "$NO_CLI_STDOUT")" "" "missing inbox-cli.ts writes nothing to stdout"
assert_eq "$NO_CLI_OUT" "pm-switchboard: waiting_on fleet 01M7R4FA (inbox CLI missing at $EXPECTED_CLI_PATH)" "missing inbox-cli.ts prints waiting_on message with path"
assert_file_absent "$RECEIPTS_NOCLI" "missing inbox-cli.ts creates no receipt dir"
assert_file_absent "$NO_CLI_STATE" "missing inbox-cli.ts writes no state file"

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
    content: `Status: done\nAttempt: 3\nCommit: ${shaShort}\nVerify: rc=0 receipt=f1e2d3c4b5a69788\n- [x] fleet acceptance met\nUsed: e2e fleet mode test`,
  },
], null, 2) + '\n');
NODE

TASK_SHOW_STUB="$TEST_TMP/task-show-stub.js"
cat > "$TASK_SHOW_STUB" <<'EOF'
'use strict';
const taskId = process.argv[process.argv.length - 1];
process.stdout.write(JSON.stringify({
  task_id: taskId,
  assignee: 'ns/h/lane-f',
  attempt: 3,
  dispatched_at: process.env.FAKE_DISPATCHED_AT,
  acceptance: ['fleet acceptance met'],
}) + '\n');
EOF
TASK_SHOW_CMD_JSON="$(node -e 'process.stdout.write(JSON.stringify([process.execPath, process.argv[1], "--show-task"]))' "$TASK_SHOW_STUB")"

ACCEPT_STUB="$TEST_TMP/accept-stub.js"
ACCEPT_LOG="$TEST_TMP/accept-stub.jsonl"
cat > "$ACCEPT_STUB" <<'EOF'
'use strict';
const fs = require('fs');
fs.appendFileSync(process.env.ACCEPT_STUB_LOG, JSON.stringify({ argv: process.argv.slice(2) }) + '\n');
EOF
ACCEPT_CMD_JSON="$(node -e 'process.stdout.write(JSON.stringify([process.execPath, process.argv[1], "--accept-task"]))' "$ACCEPT_STUB")"

# Fleet mode with AUTOPILOT_PM_TASK_SHOW_CMD unset -> cannot accept => pending_decision naming task_show_unavailable
FLEET_NOSHOW_OUT="$(ACCEPT_STUB_LOG="$ACCEPT_LOG" FAKE_FLEET_STATE_DIR="$FAKE_FLEET_STATE" AUTOPILOT_FLEET_REPO="$FAKE_FLEET" AUTOPILOT_PM_INBOX_ADAPTER=fleet AUTOPILOT_PM_ACCEPT_CMD="$ACCEPT_CMD_JSON" env -u AUTOPILOT_PM_TASK_SHOW_CMD node "$SWITCHBOARD_JS" run --receipt-dir "$TEST_TMP/r-fleet-noshow" --state-file "$TEST_TMP/s-fleet-noshow.json" < /dev/null 2>&1)"; FLEET_NOSHOW_RC=$?
assert_eq "$FLEET_NOSHOW_RC" "0" "fleet mode with unset AUTOPILOT_PM_TASK_SHOW_CMD exits 0"
assert_file_absent "$ACCEPT_LOG" "unset AUTOPILOT_PM_TASK_SHOW_CMD prevents accept"
FLEET_NOSHOW_CHECK="$(node - "$FAKE_FLEET_STATE/cli-wakes.jsonl" "$FLEET_NOSHOW_OUT" <<'NODE'
'use strict';
const fs = require('fs');
const [wakesPath, outText] = process.argv.slice(2);
const doc = JSON.parse(outText);
const wakes = fs.readFileSync(wakesPath, 'utf8').trim().split('\n').map(JSON.parse);
if (doc.accepted !== 0 || doc.pending !== 1) process.exit(1);
if (wakes.length !== 1 || !wakes[0].content.includes('task_show_unavailable')) process.exit(2);
process.stdout.write('ok');
NODE
)"
assert_eq "$FLEET_NOSHOW_CHECK" "ok" "fleet mode without AUTOPILOT_PM_TASK_SHOW_CMD routes result to pending naming task_show_unavailable"

# Fleet mode with AUTOPILOT_PM_TASK_SHOW_CMD set and AUTOPILOT_PM_ACCEPT_CMD unset -> pending naming accept_unavailable
rm -f "$FAKE_FLEET_STATE/cli-marks.jsonl" "$FAKE_FLEET_STATE/cli-wakes.jsonl"
FLEET_NOACC_OUT="$(FAKE_DISPATCHED_AT="$DISPATCHED_BEFORE" FAKE_FLEET_STATE_DIR="$FAKE_FLEET_STATE" AUTOPILOT_FLEET_REPO="$FAKE_FLEET" AUTOPILOT_PM_INBOX_ADAPTER=fleet AUTOPILOT_PM_TASK_SHOW_CMD="$TASK_SHOW_CMD_JSON" env -u AUTOPILOT_PM_ACCEPT_CMD node "$SWITCHBOARD_JS" run --receipt-dir "$TEST_TMP/r-fleet-noacc" --state-file "$TEST_TMP/s-fleet-noacc.json" < /dev/null 2>&1)"; FLEET_NOACC_RC=$?
assert_eq "$FLEET_NOACC_RC" "0" "fleet mode with unset AUTOPILOT_PM_ACCEPT_CMD exits 0"
FLEET_NOACC_CHECK="$(node - "$FAKE_FLEET_STATE/cli-wakes.jsonl" "$FLEET_NOACC_OUT" <<'NODE'
'use strict';
const fs = require('fs');
const [wakesPath, outText] = process.argv.slice(2);
const doc = JSON.parse(outText);
const wakes = fs.readFileSync(wakesPath, 'utf8').trim().split('\n').map(JSON.parse);
if (doc.accepted !== 0 || doc.pending !== 1) process.exit(1);
if (wakes.length !== 1 || !wakes[0].content.includes('accept_unavailable')) process.exit(2);
process.stdout.write('ok');
NODE
)"
assert_eq "$FLEET_NOACC_CHECK" "ok" "fleet mode without AUTOPILOT_PM_ACCEPT_CMD routes result to pending naming accept_unavailable"

# Fleet mode with both AUTOPILOT_PM_TASK_SHOW_CMD and AUTOPILOT_PM_ACCEPT_CMD set -> accepts once
rm -f "$FAKE_FLEET_STATE/cli-marks.jsonl" "$FAKE_FLEET_STATE/cli-wakes.jsonl"
FLEET_SET_OUT="$(FAKE_DISPATCHED_AT="$DISPATCHED_BEFORE" ACCEPT_STUB_LOG="$ACCEPT_LOG" FAKE_FLEET_STATE_DIR="$FAKE_FLEET_STATE" AUTOPILOT_FLEET_REPO="$FAKE_FLEET" AUTOPILOT_PM_INBOX_ADAPTER=fleet AUTOPILOT_PM_TASK_SHOW_CMD="$TASK_SHOW_CMD_JSON" AUTOPILOT_PM_ACCEPT_CMD="$ACCEPT_CMD_JSON" node "$SWITCHBOARD_JS" run --receipt-dir "$TEST_TMP/r-fleet-set" --state-file "$TEST_TMP/s-fleet-set.json" < /dev/null 2>&1)"; FLEET_SET_RC=$?
assert_eq "$FLEET_SET_RC" "0" "fleet mode with both show and accept commands set exits 0"
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
assert_eq "$FLEET_SET_CHECK" "ok" "fleet mode reads task via AUTOPILOT_PM_TASK_SHOW_CMD and accepts once via AUTOPILOT_PM_ACCEPT_CMD"

# --- 11. Negative controls (sed_mutant): prove gates fail when checks are weakened ---
MUT_DIR="$TEST_TMP/mutants"
mkdir -p "$MUT_DIR/scripts/lib"
for lib_f in "$REPO_ROOT"/scripts/lib/*; do
  [ -f "$lib_f" ] && ln -s "$lib_f" "$MUT_DIR/scripts/lib/$(basename "$lib_f")"
done

rm -f "$MUT_DIR/scripts/lib/pm-result-rules.js"
sed_mutant "$RESULT_RULES_JS" "$MUT_DIR/scripts/lib/pm-result-rules.js" "s/'豁免'/'__MUTATED_NEVER__'/"
MUT_WAIVER_PASS="$(node - "$MUT_DIR/scripts/lib/pm-result-rules.js" "$SAMPLE_REPO" "$REAL_SHA_FULL" "$DISPATCHED_BEFORE" <<'NODE'
'use strict';
const { evaluateTaskResult } = require(process.argv[2]);
const res = evaluateTaskResult({
  from: 'ns/h/impl-ok',
  task_id: '01M7MUT0000000000000000001',
  repo: process.argv[3],
  content: `Status: done\nAttempt: 1\nCommit: ${process.argv[4]}\nVerify: rc=0 receipt=1234567890abcdef\n- [x] crit-1\n申請豁免\nUsed: e2e test`,
}, {
  task: {
    task_id: '01M7MUT0000000000000000001',
    assignee: 'ns/h/impl-ok',
    attempt: 1,
    dispatched_at: process.argv[5],
    acceptance: ['crit-1'],
  },
});
process.stdout.write(String(res.pass));
NODE
)"
assert_eq "$MUT_WAIVER_PASS" "true" "negative control: mutating 豁免 out of pm-result-rules lets a waiver slip through"

rm -f "$MUT_DIR/scripts/lib/pm-result-rules.js"
sed_mutant "$RESULT_RULES_JS" "$MUT_DIR/scripts/lib/pm-result-rules.js" 's/if (!sender || !assignee || sender !== assignee)/if (false)/'
MUT_ASSIGNEE_PASS="$(node - "$MUT_DIR/scripts/lib/pm-result-rules.js" "$SAMPLE_REPO" "$REAL_SHA_FULL" "$DISPATCHED_BEFORE" <<'NODE'
'use strict';
const { evaluateTaskResult } = require(process.argv[2]);
const res = evaluateTaskResult({
  from: 'ns/h/intruder',
  task_id: '01M7MUT0000000000000000002',
  repo: process.argv[3],
  content: `Status: done\nAttempt: 1\nCommit: ${process.argv[4]}\nVerify: rc=0 receipt=1234567890abcdef\n- [x] crit-1\nUsed: e2e test`,
}, {
  task: {
    task_id: '01M7MUT0000000000000000002',
    assignee: 'ns/h/impl-ok',
    attempt: 1,
    dispatched_at: process.argv[5],
    acceptance: ['crit-1'],
  },
});
process.stdout.write(String(res.pass));
NODE
)"
assert_eq "$MUT_ASSIGNEE_PASS" "true" "negative control: mutating assignee check out lets wrong sender pass"

sed_mutant "$SWITCHBOARD_JS" "$MUT_DIR/scripts/pm-switchboard.js" 's/if (!m || !ANTHROPIC_FALLBACK_MODEL_RE.test(m) || !isClaudeNativeModel(m))/if (false)/'
MUT_MODEL_OUT="$(node - "$MUT_DIR/scripts/pm-switchboard.js" <<'NODE'
'use strict';
const { assertAnthropicFallbackModel } = require(process.argv[2]);
try {
  assertAnthropicFallbackModel('kimi-code/k3');
  process.stdout.write('allowed');
} catch (err) {
  process.stdout.write(`blocked:${err.exitCode}`);
}
NODE
)"
assert_eq "$MUT_MODEL_OUT" "blocked:2" "defense-in-depth: cn-model-dispatch-gate blocks Chinese models even when regex check is mutated out"

rm -f "$MUT_DIR/scripts/pm-switchboard.js"
sed_mutant "$SWITCHBOARD_JS" "$MUT_DIR/scripts/pm-switchboard.js" 's/function assertAnthropicFallbackModel(model, env = process.env) {/function assertAnthropicFallbackModel(model, env = process.env) { return String(model);/'
MUT_BYPASS_OUT="$(node - "$MUT_DIR/scripts/pm-switchboard.js" <<'NODE'
'use strict';
const { assertAnthropicFallbackModel } = require(process.argv[2]);
process.stdout.write(assertAnthropicFallbackModel('gpt-5'));
NODE
)"
assert_eq "$MUT_BYPASS_OUT" "gpt-5" "negative control: bypassing assertAnthropicFallbackModel lets non-Anthropic model through"

sed_mutant "$INBOX_DONE_JS" "$MUT_DIR/scripts/pm-inbox-done.js" 's/!hasRefFlag && !hasNoActionFlag/false/'
FX_MUT_DONE="$TEST_TMP/fx-mut-done"
mkdir -p "$FX_MUT_DONE"
printf '[]\n' > "$FX_MUT_DONE/inbox.json"
MUT_DONE_OUT="$(AUTOPILOT_PM_INBOX_ADAPTER="fixture:$FX_MUT_DONE" node "$MUT_DIR/scripts/pm-inbox-done.js" msg-999 < /dev/null 2>&1)"; MUT_DONE_RC=$?
assert_neq "$MUT_DONE_OUT" "" "negative control: mutating pm-inbox-done flag guard shifts failure downstream to adapter mark guard"

rm -f "$MUT_DIR/scripts/pm-switchboard.js" "$MUT_DIR/scripts/lib/pm-inbox-adapter.js"
cp "$SWITCHBOARD_JS" "$MUT_DIR/scripts/pm-switchboard.js"
sed_mutant "$ADAPTER_JS" "$TEST_TMP/adapter-mut1.js" "s/^        3,$/        2,/" && sed_mutant "$TEST_TMP/adapter-mut1.js" "$MUT_DIR/scripts/lib/pm-inbox-adapter.js" "s/^        'FLEET_REPO_UNSET'$/        'FLEET_REPO_UNSET_MUT'/"
MUT_NOFLEET_OUT="$(env -u AUTOPILOT_FLEET_REPO AUTOPILOT_PM_INBOX_ADAPTER=fleet node "$MUT_DIR/scripts/pm-switchboard.js" run --receipt-dir "$TEST_TMP/r-mut-nofleet" --state-file "$TEST_TMP/s-mut-nofleet.json" < /dev/null 2>&1)"; MUT_NOFLEET_RC=$?
assert_eq "$MUT_NOFLEET_RC" "2" "negative control: reverting FLEET_REPO_UNSET exit code returns 2 instead of 3"
assert_not_contains "$MUT_NOFLEET_OUT" "waiting_on fleet 01M7R4FA" "negative control: reverting FLEET_REPO_UNSET drops waiting_on message"

rm -f "$MUT_DIR/scripts/lib/pm-inbox-adapter.js"
sed_mutant "$ADAPTER_JS" "$MUT_DIR/scripts/lib/pm-inbox-adapter.js" "s/, 3, 'FLEET_CLI_MISSING'/, 2, 'FLEET_CLI_MISSING_MUT'/g"
MUT_NOCLI_OUT="$(AUTOPILOT_FLEET_REPO="$MISSING_FLEET_REPO" AUTOPILOT_PM_INBOX_ADAPTER=fleet node "$MUT_DIR/scripts/pm-switchboard.js" run --receipt-dir "$TEST_TMP/r-mut-nocli" --state-file "$TEST_TMP/s-mut-nocli.json" < /dev/null 2>&1)"; MUT_NOCLI_RC=$?
assert_eq "$MUT_NOCLI_RC" "2" "negative control: reverting FLEET_CLI_MISSING exit code returns 2 instead of 3"
assert_not_contains "$MUT_NOCLI_OUT" "waiting_on fleet 01M7R4FA" "negative control: reverting FLEET_CLI_MISSING drops waiting_on message"

# Regression inbox-wake-608: 7 items in 3 categories merge into 1 packet (urgent first, category headings); 61 items -> 2 packets (60 + 1).
PACK_608_OUT="$(node - "$SWITCHBOARD_JS" <<'NODE'
'use strict';
const assert = require('assert');
const { buildPackets } = require(process.argv[2]);

const entries7 = [
  { rule: 'decision_request', immediate: false, isResidue: false, failedChecks: [], item: { message_id: 'm1', from: 'lane-a', task_id: 't1', content: 'dec 1' } },
  { rule: 'task_result', immediate: false, isResidue: false, failedChecks: [], item: { message_id: 'm2', from: 'lane-b', task_id: 't2', content: 'res 1' } },
  { rule: 'decision_request', immediate: false, isResidue: false, failedChecks: [], item: { message_id: 'm3', from: 'lane-a', task_id: 't3', content: 'dec 2' } },
  { rule: 'credential_redline', immediate: true, isResidue: false, failedChecks: [], item: { message_id: 'm-urgent', from: 'lane-sec', task_id: 't-urg', content: 'urgent redline' } },
  { rule: 'task_result', immediate: false, isResidue: false, failedChecks: [], item: { message_id: 'm4', from: 'lane-b', task_id: 't4', content: 'res 2' } },
  { rule: 'decision_request', immediate: false, isResidue: false, failedChecks: [], item: { message_id: 'm5', from: 'lane-a', task_id: 't5', content: 'dec 3' } },
  { rule: 'task_result', immediate: false, isResidue: false, failedChecks: [], item: { message_id: 'm6', from: 'lane-b', task_id: 't6', content: 'res 3' } },
];

const pkts7 = buildPackets(entries7);
assert.strictEqual(pkts7.length, 1, `expected 1 packet for 7 items, got ${pkts7.length}`);
assert.strictEqual(pkts7[0].item_count, 7, `expected item_count 7, got ${pkts7[0].item_count}`);
const text7 = pkts7[0].text;
const idxUrgent = text7.indexOf('m-urgent');
const idxFirstBatch = text7.indexOf('m1');
assert.ok(idxUrgent >= 0 && idxFirstBatch >= 0 && idxUrgent < idxFirstBatch, 'urgent item must appear before batch items');
assert.ok(text7.includes('#### 分類：credential_redline'), 'missing credential_redline category heading');
assert.ok(text7.includes('#### 分類：decision_request'), 'missing decision_request category heading');
assert.ok(text7.includes('#### 分類：task_result'), 'missing task_result category heading');

const entries61 = Array.from({ length: 61 }, (_, i) => ({
  rule: 'decision_request',
  immediate: false,
  isResidue: false,
  failedChecks: [],
  item: { message_id: `m-${i + 1}`, from: 'lane-a', task_id: `t-${i + 1}`, content: `item ${i + 1}` },
}));
const pkts61 = buildPackets(entries61);
assert.strictEqual(pkts61.length, 2, `expected 2 packets for 61 items, got ${pkts61.length}`);
assert.strictEqual(pkts61[0].item_count, 60, `expected first packet 60 items, got ${pkts61[0].item_count}`);
assert.strictEqual(pkts61[1].item_count, 1, `expected second packet 1 item, got ${pkts61[1].item_count}`);
process.stdout.write('ok\n');
NODE
)"
assert_eq "$PACK_608_OUT" "ok" "inbox-wake-608: 7 items in 3 categories -> 1 packet (urgent first, headings); 61 items -> 2 packets (60 + 1)"

finalize_test
