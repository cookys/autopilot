#!/usr/bin/env bash
# hooks/tests/open-decision-pending-close.test.sh — duplicated-scope winners, stale-copy closing,
# close --dispatched-msg, done --note on pending_dispatch, and 1-line refusal text (PM 01M79XFR).
set -euo pipefail

. "$(dirname "$0")/lib.sh"

export HOME="$TEST_TMP/home"
mkdir -p "$HOME"
unset AUTOPILOT_ROOT_RUN_ID AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID CODEX_THREAD_ID AUTOPILOT_PARENT_SESSION_ID || true
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/modes"
mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export AUTOPILOT_RUNS_WATCH_AUTOSTART=0
export AUTOPILOT_CARD_NOTIFY=off

OD="$REPO_ROOT/scripts/open-decision.js"
SCHEMA_FILE="$REPO_ROOT/schemas/decision.schema.json"
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"

init_repo() {
  local name="$1"
  local repo="$TEST_TMP/$name"
  mkdir -p "$repo"
  $GIT -C "$repo" init -q
  $GIT -C "$repo" commit -q --allow-empty -m base
  echo "$repo"
}

decisions_dir() {
  local repo="$1"
  node -e '
    const path = require("path");
    const { scopeFromCwd } = require(process.argv[1]);
    const { commonDirOf } = require(process.argv[2]);
    const s = scopeFromCwd(process.argv[3]);
    console.log(path.join(commonDirOf(s.repo_identity), "autopilot", "decisions"));
  ' "$REPO_ROOT/src/status/project-key.js" "$REPO_ROOT/src/status/scope-key.js" "$repo"
}

project_key() {
  local repo="$1"
  node -e 'console.log(require(process.argv[1]).scopeFromCwd(process.argv[2]).project_key)' "$REPO_ROOT/src/status/project-key.js" "$repo"
}

# Write a v2 scope file with a single decision entry in any chosen state.
write_scope_card() {
  local repo="$1" root="$2" id="$3" status="$4" extra_json="${5:-"{}"}"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const { scopeFromCwd } = require(process.argv[1]);
    const { scopeKeyOf, commonDirOf } = require(process.argv[2]);
    const repo = process.argv[3];
    const root = process.argv[4] || null;
    const id = process.argv[5];
    const status = process.argv[6];
    const extra = JSON.parse(process.argv[7] || "{}");
    const sc = scopeFromCwd(repo);
    const dir = path.join(commonDirOf(sc.repo_identity), "autopilot", "decisions");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${scopeKeyOf(sc.project_key, root)}.json`);
    const entry = {
      id,
      question: `Question for ${id}`,
      background: null,
      options: [{ label: "Ship", description: "go" }, { label: "Wait", description: "hold" }],
      recommendation: "Ship",
      why: "default",
      blocks: null,
      not_authorized: "external:test",
      source: "test",
      opened_at: "2026-11-11T08:00:00.000Z",
      opened_by_session: "sess-test",
      executor: "ns/c/worker",
      status,
      ...extra,
    };
    fs.writeFileSync(file, JSON.stringify({
      schema: "autopilot.decision/2",
      root_run_id: root,
      repo_identity: sc.repo_identity,
      project_key: sc.project_key,
      decisions: [entry],
    }, null, 2) + "\n", { mode: 0o600 });
  ' "$REPO_ROOT/src/status/project-key.js" "$REPO_ROOT/src/status/scope-key.js" "$repo" "$root" "$id" "$status" "$extra_json"
}

assert_readers_closed_agreement() {
  local repo="$1" id="$2" label="$3"
  local show_out show_rc=0
  show_out=$(node "$OD" show --cwd "$repo" 2>&1) || show_rc=$?
  assert_eq "$show_rc" "1" "$label: show exits 1 when no live cards remain"
  assert_contains "$show_out" "no open decision" "$label: show reports no open decision"

  local all_json
  all_json=$(node "$OD" show --all --json --cwd "$repo")
  node -e '
    const assert = require("assert");
    const j = JSON.parse(process.argv[1]);
    const id = process.argv[2];
    const label = process.argv[3];
    const matches = j.decisions.filter((d) => d.id === id);
    assert.strictEqual(matches.length, 1, `${label}: show --all must list ${id} once, got ${matches.length}`);
    assert.strictEqual(matches[0].status, "closed", `${label}: show --all status must be closed`);
  ' "$all_json" "$id" "$label"

  local one_json
  one_json=$(node "$OD" show --id "$id" --json --cwd "$repo")
  node -e '
    const assert = require("assert");
    const j = JSON.parse(process.argv[1]);
    const label = process.argv[2];
    assert.strictEqual(j.decisions.length, 1, `${label}: show --id count`);
    assert.strictEqual(j.decisions[0].status, "closed", `${label}: show --id status`);
  ' "$one_json" "$label"

  local di_state
  di_state=$(node -e '
    const { scopeFromCwd } = require(process.argv[1]);
    const { commonDirOf } = require(process.argv[2]);
    const { readDecision, hasOpenDecision } = require(process.argv[3]);
    const s = scopeFromCwd(process.argv[4]);
    const commonDir = commonDirOf(s.repo_identity);
    const rd = readDecision({ commonDir, key: s.project_key, identity: s.repo_identity, nowMs: Date.now() });
    const ho = hasOpenDecision({ identity: s.repo_identity, key: s.project_key, nowMs: Date.now() });
    console.log(JSON.stringify({ readDecision: rd, hasOpenDecision: ho }));
  ' "$REPO_ROOT/src/status/project-key.js" "$REPO_ROOT/src/status/scope-key.js" "$REPO_ROOT/src/status/decision-input.js" "$repo")
  node -e '
    const assert = require("assert");
    const s = JSON.parse(process.argv[1]);
    const label = process.argv[2];
    assert.strictEqual(s.readDecision, null, `${label}: decision-input readDecision must be null`);
    assert.strictEqual(s.hasOpenDecision, false, `${label}: decision-input hasOpenDecision must be false`);
  ' "$di_state" "$label"
}

assert_all_copies_match() {
  local dir="$1" key="$2" id="$3" expected_via="$4" extra_field="$5" extra_val="$6" label="$7"
  node -e '
    const assert = require("assert");
    const fs = require("fs");
    const { listScopeFiles } = require(process.argv[1]);
    const files = listScopeFiles(process.argv[2], process.argv[3]);
    const id = process.argv[4];
    const expectedVia = process.argv[5];
    const extraField = process.argv[6];
    const extraVal = process.argv[7];
    const label = process.argv[8];
    const found = [];
    for (const f of files) {
      const body = JSON.parse(fs.readFileSync(f, "utf8"));
      for (const d of body.decisions || []) {
        if (d.id === id) found.push({ f, d });
      }
    }
    assert.ok(found.length >= 2, `${label}: expected >=2 scope copies for ${id}, got ${found.length}`);
    const closedAt = found[0].d.closed_at;
    assert.ok(typeof closedAt === "string" && closedAt.length > 0, `${label}: closed_at set`);
    for (const { f, d } of found) {
      assert.strictEqual(d.status, "closed", `${label}: ${f} status must be closed`);
      assert.strictEqual(d.closed_at, closedAt, `${label}: ${f} closed_at must match winner`);
      assert.strictEqual(d.reask_at, undefined, `${label}: ${f} reask_at cleared`);
      if (expectedVia) assert.strictEqual(d.closed_via, expectedVia, `${label}: ${f} closed_via`);
      if (extraField) assert.strictEqual(d[extraField], extraVal, `${label}: ${f} ${extraField}`);
    }
  ' "$REPO_ROOT/src/status/scope-key.js" "$dir" "$key" "$id" "$expected_via" "$extra_field" "$extra_val" "$label"
}

# ---- 1. Unbound `open` + root `pending_dispatch`: done --note closes both copies & show/show --all agree ----
R1="$(init_repo r1)"
D1="$(decisions_dir "$R1")"
K1="$(project_key "$R1")"
ID1="d-076daf85"
write_scope_card "$R1" "" "$ID1" "open" '{}'
write_scope_card "$R1" "root-pd1" "$ID1" "pending_dispatch" '{"answer":"Ship","pending_dispatch_at":"2026-11-11T09:00:00.000Z"}'

pre1=$(node "$OD" show --id "$ID1" --json --cwd "$R1")
assert_contains "$pre1" '"status": "pending_dispatch"' "fixture 1 pre: winner is pending_dispatch"

out1=$(node "$OD" done --id "$ID1" --note "executed directly without dispatch" --cwd "$R1")
assert_contains "$out1" "closed $ID1 (done without dispatch)" "done --note closes duplicated pending_dispatch card without --root-run-id"
assert_all_copies_match "$D1" "$K1" "$ID1" "done_without_dispatch" "done_note" "executed directly without dispatch" "done --note unbound+root"
assert_readers_closed_agreement "$R1" "$ID1" "done --note unbound+root"

# ---- 2. Earlier-sorting root `open` + later-sorting `pending_dispatch` (where naive first-hit fails) ----
R2="$(init_repo r2)"
D2="$(decisions_dir "$R2")"
K2="$(project_key "$R2")"

# 2a. root-a (open, sorts before unbound) + unbound (pending_dispatch): done --note without --root-run-id
ID2A="d-2222bbbb"
write_scope_card "$R2" "root-a" "$ID2A" "open" '{}'
write_scope_card "$R2" "" "$ID2A" "pending_dispatch" '{"answer":"Ship","pending_dispatch_at":"2026-11-11T09:10:00.000Z"}'
out2a=$(node "$OD" done --id "$ID2A" --note "verified evidence" --cwd "$R2")
assert_contains "$out2a" "closed $ID2A (done without dispatch)" "done --note acts on winner even when earlier-sorting scope copy is open"
assert_all_copies_match "$D2" "$K2" "$ID2A" "done_without_dispatch" "done_note" "verified evidence" "done --note root-a+unbound"
assert_readers_closed_agreement "$R2" "$ID2A" "done --note root-a+unbound"

# 2b. root-c (open, sorts before root-d) + root-d (pending_dispatch): close --dispatched-msg WITH --root-run-id root-c
ID2B="d-ba065562"
write_scope_card "$R2" "root-c" "$ID2B" "open" '{}'
write_scope_card "$R2" "root-d" "$ID2B" "pending_dispatch" '{"answer":"Ship","pending_dispatch_at":"2026-11-11T09:20:00.000Z"}'
out2b=$(node "$OD" close --id "$ID2B" --root-run-id root-c --dispatched-msg "msg-01M79XFR.fleet:1" --cwd "$R2")
assert_contains "$out2b" "closed $ID2B (dispatched-msg msg-01M79XFR.fleet:1)" "close --dispatched-msg with --root-run-id acts on pickCards winner"
assert_all_copies_match "$D2" "$K2" "$ID2B" "fleet_message" "dispatched_msg_id" "msg-01M79XFR.fleet:1" "close --dispatched-msg with --root-run-id"
assert_readers_closed_agreement "$R2" "$ID2B" "close --dispatched-msg with --root-run-id"

# 2c. unbound (open) + root-e (pending_dispatch): close --dispatched-msg WITHOUT --root-run-id
ID2C="d-3333cccc"
write_scope_card "$R2" "" "$ID2C" "open" '{}'
write_scope_card "$R2" "root-e" "$ID2C" "pending_dispatch" '{"answer":"Ship","pending_dispatch_at":"2026-11-11T09:30:00.000Z"}'
out2c=$(node "$OD" close --id "$ID2C" --dispatched-msg "msg-unbound-99" --cwd "$R2")
assert_contains "$out2c" "closed $ID2C (dispatched-msg msg-unbound-99)" "close --dispatched-msg without --root-run-id closes winner and unbound copy"
assert_all_copies_match "$D2" "$K2" "$ID2C" "fleet_message" "dispatched_msg_id" "msg-unbound-99" "close --dispatched-msg unbound+root"
assert_readers_closed_agreement "$R2" "$ID2C" "close --dispatched-msg unbound+root"

# ---- 3. close --dispatched, redeliver --id, and findCard() library export on duplicated scopes ----
R3="$(init_repo r3)"
D3="$(decisions_dir "$R3")"
K3="$(project_key "$R3")"

ID3A="d-4444dddd"
write_scope_card "$R3" "root-a" "$ID3A" "open" '{}'
write_scope_card "$R3" "root-b" "$ID3A" "pending_dispatch" '{"answer":"Ship","pending_dispatch_at":"2026-11-11T10:00:00.000Z"}'
out3a=$(node "$OD" close --id "$ID3A" --dispatched "task-abc_123" --cwd "$R3")
assert_contains "$out3a" "closed $ID3A (dispatched task-abc_123)" "close --dispatched closes winner even when earlier copy is open"
assert_all_copies_match "$D3" "$K3" "$ID3A" "" "dispatched_task_id" "task-abc_123" "close --dispatched duplicated"
assert_readers_closed_agreement "$R3" "$ID3A" "close --dispatched duplicated"

# Check findCard() returns the closed winner (not stale open if one existed) and works across callers
node -e '
  const assert = require("assert");
  const { findCard } = require(process.argv[1]);
  const w = findCard(process.argv[2], process.argv[3], { all: true });
  assert.ok(w && w.entry && w.entry.status === "closed", "findCard({ all: true }) returns closed winner");
  assert.strictEqual(findCard(process.argv[2], process.argv[3]), null, "findCard() default returns null when winner is closed");
  assert.strictEqual(findCard(process.argv[2], process.argv[3], { live: true }), null, "findCard({ live: true }) returns null when winner is closed");
' "$OD" "$R3" "$ID3A"

# redeliver --id with stub fleet binary: earlier root-c open, later root-d pending_dispatch with answer_id
ID3B="d-5555eeee"
write_scope_card "$R3" "root-c" "$ID3B" "open" '{}'
write_scope_card "$R3" "root-d" "$ID3B" "pending_dispatch" '{"answer":"Ship","answer_id":"ans-1","answer_option":"Ship","answer_free_text":null,"answer_digest":"deadbeef","pending_dispatch_at":"2026-11-11T10:10:00.000Z"}'
cat > "$TEST_TMP/fleet-stub" <<'EOF'
#!/bin/sh
echo '{"ok":true,"message_id":"msg-redeliver-001"}'
EOF
chmod +x "$TEST_TMP/fleet-stub"
out3b=$(AUTOPILOT_FLEET_BIN="$TEST_TMP/fleet-stub" node "$OD" redeliver --id "$ID3B" --cwd "$R3")
assert_contains "$out3b" "msg-redeliver-001" "redeliver --id delivers pending_dispatch winner"
assert_all_copies_match "$D3" "$K3" "$ID3B" "" "dispatched_message_id" "msg-redeliver-001" "redeliver --id closes stale copy"
assert_readers_closed_agreement "$R3" "$ID3B" "redeliver --id duplicated"

# ---- 4. Refusal text on pending_dispatch: 1 line, no usage dump, names all 3 ways out ----
R4="$(init_repo r4)"
ID4="d-6666ffff"
write_scope_card "$R4" "" "$ID4" "open" '{}'
write_scope_card "$R4" "root-p" "$ID4" "pending_dispatch" '{"answer":"Ship","pending_dispatch_at":"2026-11-11T11:00:00.000Z"}'

check_refusal() {
  local label="$1"; shift
  local out_f="$TEST_TMP/refuse.out" err_f="$TEST_TMP/refuse.err" rc=0
  "$@" >"$out_f" 2>"$err_f" || rc=$?
  assert_eq "$rc" "2" "$label: exits 2"
  local err
  err="$(cat "$err_f")"
  local lines
  lines="$(wc -l < "$err_f" | tr -d ' ')"
  assert_eq "$lines" "1" "$label: prints exactly 1 stderr line (got: $err)"
  assert_not_contains "$err" "usage: open-decision.js" "$label: omits full usage dump"
  assert_contains "$err" "--dispatched <task_id>" "$label: names --dispatched <task_id>"
  assert_contains "$err" "--dispatched-msg <message_id>" "$label: names --dispatched-msg <message_id>"
  assert_contains "$err" "done --id $ID4 --note <evidence>" "$label: names done --id ... --note <evidence>"
}

check_refusal "plain close on pending_dispatch" node "$OD" close --id "$ID4" --cwd "$R4"
check_refusal "done without --note on pending_dispatch" node "$OD" done --id "$ID4" --cwd "$R4"
check_refusal "done with whitespace --note on pending_dispatch" node "$OD" done --id "$ID4" --note "   " --cwd "$R4"

# Confirm card is still pending_dispatch after refusals
still_pd=$(node "$OD" show --id "$ID4" --json --cwd "$R4")
assert_contains "$still_pd" '"status": "pending_dispatch"' "refusals leave card pending_dispatch"

# ---- 5. Validation of --dispatched-msg token, mutual exclusivity, state guards, and schema ----
R5="$(init_repo r5)"
ID5="d-7777aaaa"
write_scope_card "$R5" "root-v" "$ID5" "pending_dispatch" '{"answer":"Ship","pending_dispatch_at":"2026-11-11T12:00:00.000Z"}'

expect_exit2() {
  local label="$1"; shift
  local rc=0
  "$@" >/dev/null 2>"$TEST_TMP/val.err" || rc=$?
  assert_eq "$rc" "2" "$label: exits 2"
}

expect_exit2 "empty --dispatched-msg" node "$OD" close --id "$ID5" --dispatched-msg "" --cwd "$R5"
expect_exit2 "leading-dash --dispatched-msg" node "$OD" close --id "$ID5" --dispatched-msg "-bad" --cwd "$R5"
expect_exit2 "space/bang --dispatched-msg" node "$OD" close --id "$ID5" --dispatched-msg "bad msg!" --cwd "$R5"
expect_exit2 "both --dispatched and --dispatched-msg" node "$OD" close --id "$ID5" --dispatched t-1 --dispatched-msg m-1 --cwd "$R5"
expect_exit2 "--dispatched-msg with --answer" node "$OD" close --id "$ID5" --dispatched-msg m-1 --answer yes --cwd "$R5"
expect_exit2 "--dispatched-msg on show" node "$OD" show --dispatched-msg m-1 --cwd "$R5"
expect_exit2 "--dispatched-msg on done" node "$OD" done --id "$ID5" --dispatched-msg m-1 --cwd "$R5"
expect_exit2 "--dispatched-msg on open" node "$OD" open --question "Q?" --option A::a --option B::b --not-authorized external:x --executor ns/c/w --dispatched-msg m-1 --cwd "$R5"

# State refusals for --dispatched-msg
ID5_OPEN="d-8888bbbb"
ID5_AWAIT="d-9999cccc"
ID5_CLOSED="d-aaaadddd"
write_scope_card "$R5" "root-open" "$ID5_OPEN" "open" '{}'
write_scope_card "$R5" "root-await" "$ID5_AWAIT" "awaiting_operator_action" '{"answer":"Ship","answered_at":"2026-11-11T12:00:00.000Z","awaiting_operator":"do step"}'
write_scope_card "$R5" "root-closed" "$ID5_CLOSED" "closed" '{"answer":"Ship","closed_at":"2026-11-11T12:00:00.000Z"}'

expect_exit2 "--dispatched-msg on open card" node "$OD" close --id "$ID5_OPEN" --dispatched-msg m-1 --cwd "$R5"
assert_contains "$(cat "$TEST_TMP/val.err")" "is open, not pending_dispatch" "error names open state"
expect_exit2 "--dispatched-msg on awaiting card" node "$OD" close --id "$ID5_AWAIT" --dispatched-msg m-1 --cwd "$R5"
assert_contains "$(cat "$TEST_TMP/val.err")" "is awaiting_operator_action, not pending_dispatch" "error names awaiting state"
expect_exit2 "--dispatched-msg on closed card" node "$OD" close --id "$ID5_CLOSED" --dispatched-msg m-1 --cwd "$R5"
assert_contains "$(cat "$TEST_TMP/val.err")" "is closed, not pending_dispatch" "error names closed state"

# Usage text mentions --dispatched-msg and done --note
rc_u=0
node "$OD" 2>"$TEST_TMP/usage.err" || rc_u=$?
assert_eq "$rc_u" "2" "no-args usage exits 2"
assert_contains "$(cat "$TEST_TMP/usage.err")" "close --id <id> --dispatched-msg <message_id>" "usage lists --dispatched-msg"
assert_contains "$(cat "$TEST_TMP/usage.err")" "done --id <id> [--note <evidence>]" "usage lists done --note"

# Schema includes new trail fields
node -e '
  const assert = require("assert");
  const fs = require("fs");
  const schema = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const props = schema.properties.decisions.items.properties;
  for (const k of ["dispatched_msg_id", "closed_via", "done_note"]) {
    assert.ok(props[k], `schemas/decision.schema.json missing property ${k}`);
  }
' "$SCHEMA_FILE"

finalize_test
