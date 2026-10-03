#!/usr/bin/env bash
# Final-panel seat artifacts (<git-common-dir>/autopilot/final-panel-seats/<campaign_id>/) are
# reaped by the store helper and by repo-residue-sweep, never for a resumable campaign, and
# never outside the seat root.
# RED at 8a338ccb (no reap helper, no sweep arm):
#   TypeError: store.reapCampaignSeats is not a function
#   FAIL reap: terminal campaign subtree removed / terminal_stop campaign subtree removed
#   FAIL scan: two terminal campaigns: expected '2', got '<undef>' (and the other scan classes)
#   FAIL reap: orphan with no live lease removed
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/repo-residue-sweep.js"
SBX="$TEST_TMP/repo"; mkdir -p "$SBX"
G() { git -C "$SBX" -c user.email=t@t -c user.name=t "$@"; }
G init -q -b develop; echo a > "$SBX/a.txt"; G add a.txt; G commit -q -m base
COMMON="$(cd "$SBX" && cd "$(git rev-parse --git-common-dir)" && pwd -P)"
ROOTD="$COMMON/autopilot/final-panel-seats"
LEDGER="$COMMON/autopilot/implementation-campaign.jsonl"
mkdir -p "$COMMON/autopilot"
field() { printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);let v=j;for(const k of process.argv[1].split(".")){v=v==null?undefined:v[k];}process.stdout.write(v===undefined?"<undef>":(typeof v==="object"?JSON.stringify(v):String(v)));})' "$2"; }

# journal rows: <campaign> <last event type>
node - "$LEDGER" <<'NODE'
const fs = require('fs');
const [ledger] = process.argv.slice(2);
const row = (id, op, event) => JSON.stringify({
  kind: 'journal', op, run_id: id, stage: 'campaign', status: 'applied',
  payload: JSON.stringify({ campaign_id: id, ...(event ? { event: { event_type: event, campaign_id: id } } : {}) }),
});
const rows = [];
for (const [id, evs] of Object.entries({
  'campaign-v1-term': ['implementation_started', 'review_completed', 'terminal_ready'],
  'campaign-v1-stop': ['implementation_started', 'terminal_stop'],
  'campaign-v1-parked': ['implementation_started', 'review_completed', 'awaiting_disposition'],
  'campaign-v1-bound': ['implementation_started', 'boundary_rejected'],
})) { rows.push(row(id, 'campaign_intake')); for (const e of evs) rows.push(row(id, 'campaign_event', e)); }
fs.writeFileSync(ledger, `${rows.join('\n')}\n`);
NODE
seat() { mkdir -p "$ROOTD/$1/panel-$(printf 'a%.0s' $(seq 64))"; echo '{}' > "$ROOTD/$1/panel-$(printf 'a%.0s' $(seq 64))/seat-1.json"; }
for c in campaign-v1-term campaign-v1-stop campaign-v1-parked campaign-v1-bound campaign-v1-orphan; do seat "$c"; done
mkdir -p "$COMMON/autopilot/victim"; echo keep > "$COMMON/autopilot/victim/f"

# ---------------------------------------------------------------- store helpers
OUT="$(node - "$REPO_ROOT" "$ROOTD" "$LEDGER" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const [root, rootd, ledger] = process.argv.slice(2);
const store = require(path.join(root, 'src', 'engine', 'final-panel-seat-store'));
// traversal-shaped ids are refused and nothing outside the root is touched
for (const bad of ['../victim', '..', 'a/b', '/etc', '', 'x/../../victim', '.hidden/..']) {
  const r = store.reapCampaignSeats({ root: rootd, campaignId: bad });
  assert.strictEqual(r.status, 'refused', `${JSON.stringify(bad)} refused: ${JSON.stringify(r)}`);
}
assert.ok(fs.existsSync(path.join(rootd, '..', 'victim', 'f')), 'victim untouched');
assert.strictEqual(store.reapCampaignSeats({ root: path.join(rootd, '..'), campaignId: 'victim' }).status, 'refused',
  'a root that is not the final-panel-seats dir is refused');
assert.ok(fs.existsSync(path.join(rootd, '..', 'victim', 'f')), 'victim untouched by a wrong root');
console.log('traversal_refused=true');
// terminal -> removed; parked / boundary-rejected / unjournaled -> kept
const ev = (id) => store.reapIfCampaignTerminal({ root: rootd, campaignId: id, ledgerPath: ledger });
assert.strictEqual(ev('campaign-v1-term').status, 'removed');
assert.strictEqual(ev('campaign-v1-stop').status, 'removed');
assert.ok(!fs.existsSync(path.join(rootd, 'campaign-v1-term')) && !fs.existsSync(path.join(rootd, 'campaign-v1-stop')));
const parked = ev('campaign-v1-parked');
assert.strictEqual(parked.status, 'kept');
assert.match(parked.reason, /^campaign_not_terminal:awaiting_disposition$/);
assert.strictEqual(ev('campaign-v1-bound').status, 'kept');
assert.strictEqual(ev('campaign-v1-orphan').status, 'kept', 'unjournaled campaign is not provably terminal');
assert.ok(fs.existsSync(path.join(rootd, 'campaign-v1-parked')) && fs.existsSync(path.join(rootd, 'campaign-v1-bound')));
assert.strictEqual(store.reapIfCampaignTerminal({ root: rootd, campaignId: 'campaign-v1-parked', ledgerPath: null }).reason, 'campaign_ledger_unknown');
console.log('terminal_removed_parked_kept=true');
// rebuild the two removed so the sweep arm has terminal candidates too
for (const c of ['campaign-v1-term', 'campaign-v1-stop']) {
  fs.mkdirSync(path.join(rootd, c, 'panel-x'), { recursive: true });
  fs.writeFileSync(path.join(rootd, c, 'panel-x', 'seat-1.json'), '{}');
}
NODE
)"
assert_exit_code "$?" "0" "store helpers: $OUT"
assert_contains "$OUT" "traversal_refused=true" "store: traversal refused"
assert_contains "$OUT" "terminal_removed_parked_kept=true" "store: terminal removed, parked kept"

# ---------------------------------------------------------------- sweep: scan classifies, touches nothing
mkdir -p "$ROOTD/..tricky" "$ROOTD/bad name"
exec 9>"$TEST_TMP/lock-holder"  # (no worktree lock yet)
OUT="$(node "$SCRIPT" scan --repo "$SBX")"; RC=$?
assert_eq "$RC" "0" "scan exit 0"
assert_eq "$(field "$OUT" summary.final_panel_seats.terminal)" "2" "scan: two terminal campaigns"
assert_eq "$(field "$OUT" summary.final_panel_seats.active)" "2" "scan: parked + boundary-rejected are active"
assert_eq "$(field "$OUT" summary.final_panel_seats.unknown)" "1" "scan: orphan is unknown"
assert_eq "$(field "$OUT" summary.final_panel_seats.unsafe-name)" "2" "scan: non-token directory names are unsafe-name"
[ -d "$ROOTD/campaign-v1-term" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "scan is read-only"

# ---------------------------------------------------------------- sweep: a held worktree lock protects an UNKNOWN campaign
G worktree add -q "$TEST_TMP/wt-live" -b live-one 2>/dev/null
exec 8>"$TEST_TMP/wt-live/.autopilot-worktree.lock"; flock -n 8
OUT="$(node "$SCRIPT" reap --repo "$SBX" --yes)"; RC=$?
assert_eq "$RC" "0" "reap exit 0"
[ -d "$ROOTD/campaign-v1-term" ] && fail "reap: terminal campaign subtree removed" || __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1))
[ -d "$ROOTD/campaign-v1-stop" ] && fail "reap: terminal_stop campaign subtree removed" || __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1))
[ -d "$ROOTD/campaign-v1-parked" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "reap: parked campaign kept"
[ -d "$ROOTD/campaign-v1-bound" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "reap: boundary-rejected campaign kept"
[ -d "$ROOTD/campaign-v1-orphan" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "reap: unknown campaign kept while a rail holds a live lock"
[ -d "$ROOTD/bad name" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "reap: unsafe-name entry kept"
[ -d "$ROOTD/..tricky" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "reap: dotted entry kept"
assert_file_exists "$COMMON/autopilot/victim/f" "reap: nothing outside the seat root touched"
assert_contains "$(field "$OUT" actions.final_panel_seats_kept)" 'live_lock_held' "reap: unknown kept for a named live-lock reason"
assert_contains "$(field "$OUT" actions.final_panel_seats_removed)" 'campaign-v1-term' "reap: removal reported"

# ---------------------------------------------------------------- sweep: no live lock -> the orphan goes; --older-than-days narrows
flock -u 8; exec 8>&-; rm -f "$TEST_TMP/wt-live/.autopilot-worktree.lock"
OUT="$(node "$SCRIPT" reap --repo "$SBX" --yes --older-than-days 3650)"; RC=$?
[ -d "$ROOTD/campaign-v1-orphan" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "reap: --older-than-days keeps a young orphan"
OUT="$(node "$SCRIPT" reap --repo "$SBX" --yes)"; RC=$?
assert_eq "$RC" "0" "reap exit 0 (no lock)"
[ -d "$ROOTD/campaign-v1-orphan" ] && fail "reap: orphan with no live lease removed" || __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1))
[ -d "$ROOTD/campaign-v1-parked" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "reap: parked campaign still kept"
assert_file_exists "$COMMON/autopilot/victim/f" "reap: victim still intact"
finalize_test
