#!/usr/bin/env bash
# Final-panel seat artifacts (<git-common-dir>/autopilot/final-panel-seats/<campaign_id>/) are
# reaped by the store helper and by repo-residue-sweep, never for a resumable campaign, and
# never outside the seat root.
# RED at 8a338ccb (no reap helper, no sweep arm):
#   TypeError: store.reapCampaignSeats is not a function
#   FAIL reap: terminal campaign subtree removed / terminal_stop campaign subtree removed
#   FAIL scan: two terminal campaigns: expected '2', got '<undef>' (and the other scan classes)
#   FAIL reap: orphan with no live lease removed
# RED at bf81332c (reader hard-codes .1-.4; unknown subtrees reaped with no age floor):
#   AssertionError: reader follows the writer: l.jsonl.5 (actual undefined, expected 'terminal_ready')
#   FAIL scan: every row carries a keep/reap decision / the floor is stated / young unknown kept for the floor reason
#   FAIL reap: young unknown subtree kept by the default age floor
#   FAIL reap: report.after carries final_panel_seats
# RED at f1b8985e: unsafe-name / unverifiable rows have decision_reason '' (kept entries why: "").
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

# ---------------------------------------------------------------- reader follows the REAL ledger writer's rotation
OUT="$(RUN_LEDGER_MAX_BYTES=1200 RUN_LEDGER_MAX_ROTATIONS=6 node - "$REPO_ROOT" "$TEST_TMP/rot" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const [root, dir] = process.argv.slice(2);
fs.mkdirSync(dir, { recursive: true });
const ledger = path.join(dir, 'l.jsonl');
const rl = (...a) => {
  const r = spawnSync('bash', [path.join(root, 'scripts', 'run-ledger.sh'), ...a], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, `${a[0]}: ${r.stderr}`);
  return r.stdout.trim().split('\n').map((l) => { try { return JSON.parse(l); } catch (_e) { return null; } }).filter(Boolean).pop();
};
rl('init', '--ledger', ledger);
let n = 0;
const add = (id, lease, event) => rl('journal-add', '--ledger', ledger, '--run-id', id, '--stage', 'campaign',
  '--generation', String(lease.generation), '--nonce', lease.nonce, '--idempotency-key', `k-${n += 1}`,
  '--op', 'campaign_event', '--payload', JSON.stringify({ campaign_id: id, event: { event_type: event } }));
const lifecycle = (id, events) => {
  const lease = rl('stage-acquire', '--ledger', ledger, '--run-id', id, '--stage', 'campaign', '--resources', `campaign:${id}`);
  for (const e of events) add(id, lease, e);
  rl('stage-transition', '--ledger', ledger, '--run-id', id, '--stage', 'campaign', '--generation', String(lease.generation),
    '--nonce', lease.nonce, '--to-state', 'dead', '--idempotency-key', `dead-${id}`);
};
lifecycle('rot-old', ['implementation_started', 'terminal_ready']);
// filler campaigns push rot-old's rows out of the live file, through several rotations
for (let i = 0; i < 40 && !fs.existsSync(`${ledger}.5`); i += 1) lifecycle(`rot-fill-${i}`, ['implementation_started', 'review_completed']);
assert.ok(fs.existsSync(`${ledger}.5`), 'writer rotated past .4 under RUN_LEDGER_MAX_ROTATIONS=6');
assert.ok(!fs.existsSync(`${ledger}.7`), 'writer never exceeds RUN_LEDGER_MAX_ROTATIONS');
const gens = [ledger, ...[1, 2, 3, 4, 5, 6].map((k) => `${ledger}.${k}`)].filter((f) => fs.existsSync(f));
const holders = gens.filter((f) => fs.readFileSync(f, 'utf8').includes('rot-old'));
assert.ok(holders.length > 0 && !holders.includes(ledger), `rot-old lives only in rotated files: ${holders}`);
const store = require(path.join(root, 'src', 'engine', 'final-panel-seat-store'));
const last = store.campaignLastEvents(ledger);
assert.strictEqual(last.get('rot-old'), 'terminal_ready', `reader follows the writer: ${holders.map((h) => path.basename(h))}`);
assert.strictEqual(last.get('rot-fill-0') === undefined, false);
console.log('reader_follows_writer_rotation=true');
NODE
)"
assert_exit_code "$?" "0" "rotation pin: $OUT"
assert_contains "$OUT" "reader_follows_writer_rotation=true" "reader matches run-ledger rotation (suffixes, count, order)"

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
# an OLD unknown subtree (newest mtime 30 days back) beside the young orphan
mkdir -p "$ROOTD/campaign-v1-old/panel-x"; echo '{}' > "$ROOTD/campaign-v1-old/panel-x/seat-1.json"
touch -d '30 days ago' "$ROOTD/campaign-v1-old/panel-x/seat-1.json" "$ROOTD/campaign-v1-old/panel-x" "$ROOTD/campaign-v1-old"
OUT="$(node "$SCRIPT" scan --repo "$SBX")"
assert_contains "$OUT" '"campaign_id":"campaign-v1-old"' "scan lists the old unknown subtree"
assert_contains "$OUT" '"decision":"keep"' "scan: every row carries a keep/reap decision"
assert_contains "$OUT" 'younger than the 14-day unknown-subtree floor' "scan: a young unknown subtree is kept for the floor reason"
assert_contains "$OUT" '"unknown_min_age_days":14' "scan: the floor is stated"
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
[ -d "$ROOTD/campaign-v1-old" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "reap: old unknown subtree kept while a lock is held"
assert_contains "$(field "$OUT" actions.final_panel_seats_kept)" 'live_lock_held' "reap: unknown kept for a named live-lock reason"
assert_contains "$(field "$OUT" actions.final_panel_seats_removed)" 'campaign-v1-term' "reap: removal reported"

# ---------------------------------------------------------------- sweep: no live lock -> the orphan goes; --older-than-days narrows
flock -u 8; exec 8>&-; rm -f "$TEST_TMP/wt-live/.autopilot-worktree.lock"
OUT="$(node "$SCRIPT" reap --repo "$SBX" --yes --older-than-days 3650)"; RC=$?
[ -d "$ROOTD/campaign-v1-old" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "reap: --older-than-days 3650 keeps a 30-day-old unknown subtree"
OUT="$(node "$SCRIPT" reap --repo "$SBX" --yes)"; RC=$?
assert_eq "$RC" "0" "reap exit 0 (no lock)"
[ -d "$ROOTD/campaign-v1-old" ] && fail "reap: old unknown subtree with no lock removed" || __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1))
[ -d "$ROOTD/campaign-v1-orphan" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "reap: young unknown subtree kept by the default age floor"
OUT="$(node "$SCRIPT" reap --repo "$SBX" --yes --older-than-days 0)"
[ -d "$ROOTD/campaign-v1-orphan" ] && fail "reap: --older-than-days 0 overrides the floor" || __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1))
assert_contains "$(field "$OUT" after.final_panel_seats)" 'active' "reap: report.after carries final_panel_seats"
[ -d "$ROOTD/campaign-v1-parked" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "reap: parked campaign still kept"
assert_file_exists "$COMMON/autopilot/victim/f" "reap: victim still intact"

# ---------------------------------------------------------------- early-continue rows keep a named reason
OUT="$(node "$SCRIPT" scan --repo "$SBX")"
node -e 'const j=JSON.parse(process.argv[1]);const r=j.final_panel_seats.filter(x=>x.class==="unsafe-name");if(!r.length||r.some(x=>x.decision!=="keep"||!x.decision_reason))process.exit(1)' "$OUT"
assert_exit_code "$?" "0" "scan: unsafe-name rows carry decision keep and a non-empty reason"
OUT="$(node "$SCRIPT" reap --repo "$SBX" --yes)"
node -e 'const k=JSON.parse(process.argv[1]).actions.final_panel_seats_kept.filter(x=>x.class==="unsafe-name");if(!k.length||k.some(x=>!x.why))process.exit(1)' "$OUT"
assert_exit_code "$?" "0" "reap: unsafe-name kept entries carry a non-empty why"
SB2="$TEST_TMP/repo2"; mkdir -p "$SB2"; git -C "$SB2" init -q -b develop; git -C "$SB2" -c user.email=t@t -c user.name=t commit -q --allow-empty -m b
C2="$(cd "$SB2/.git" && pwd -P)"; mkdir -p "$C2/autopilot/final-panel-seats/campaign-v1-x" "$C2/autopilot/implementation-campaign.jsonl"
OUT="$(node "$SCRIPT" scan --repo "$SB2")"
node -e 'const r=JSON.parse(process.argv[1]).final_panel_seats.filter(x=>x.class==="unverifiable");if(r.length!==1||r[0].decision!=="keep"||!r[0].decision_reason)process.exit(1)' "$OUT"
assert_exit_code "$?" "0" "scan: unverifiable row carries decision keep and a non-empty reason"
OUT="$(node "$SCRIPT" reap --repo "$SB2" --yes)"
node -e 'const k=JSON.parse(process.argv[1]).actions.final_panel_seats_kept;if(k.length!==1||!k[0].why)process.exit(1)' "$OUT"
assert_exit_code "$?" "0" "reap: unverifiable kept entry carries a non-empty why"
[ -d "$C2/autopilot/final-panel-seats/campaign-v1-x" ] && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT+1)) || fail "unverifiable subtree kept"
finalize_test
