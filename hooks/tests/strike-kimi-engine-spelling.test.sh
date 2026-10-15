#!/usr/bin/env bash
# BL-0157: the Kimi Code seat is recorded as `kimi-code-k3` in the scorecard but `kimi-code/k3` in
# strikes.jsonl. engine feeds seat_hash, so strikes written under one spelling never reached a seat
# read under the other. The READ side now treats `kimi-code/X` and `kimi-code-X` as one engine;
# recorded rows are never rewritten. Fixture stores only; never ~/.autopilot.
set -uo pipefail
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SC="$ROOT/scripts/engine-scorecard.js"
CAP="$ROOT/scripts/engine-capability-state.js"
TESTDIR="$(mktemp -d)"
trap 'rm -rf "$TESTDIR"' EXIT
export ENGINE_SCORECARD_DIR="$TESTDIR/sc" ENGINE_CAPABILITY_DIR="$TESTDIR/cap"
export AUTOPILOT_STRIKE_ENFORCEMENT=enforce
mkdir -p "$ENGINE_SCORECARD_DIR" "$ENGINE_CAPABILITY_DIR"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'PASS: %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FAIL: %s\n' "$1"; }
field() { node -e "let d=JSON.parse(require('fs').readFileSync(0,'utf8'));const v=process.argv[1].split('.').reduce((o,k)=>o==null?o:o[k],d);process.stdout.write(String(v))" "$1"; }
sha_of() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }
NOW="2026-10-15T00:00:00Z"

# The qualified baseline is spelled with a hyphen, as scorecard events 157/166/182 are.
node -e '
const r = { event_id: 1, engine: "kimi-code-k3", runner: "kimi", role: "reviewer",
  status: "qualified", qualified_at: "2026-10-01", date: "2026-10-01", expires: "2026-12-14",
  capability_score: 1, family: "x", cost: { source: "unknown" }, model_version: "v1",
  corpus_version: "c1", harness_version: "h1", runner_version: "r1", prompt_config_hash: "p1" };
process.stdout.write(JSON.stringify(r) + "\n");' > "$ENGINE_SCORECARD_DIR/scorecard.jsonl"

strike() {  # <engine spelling> <dedup>
  node "$CAP" strike-seat --engine "$1" --runner kimi --role reviewer --class ordinary_strike \
    --cause-class engine_output --writer fuse --dedup-key "$2" --detector-id det --detector-version 1 \
    --artifact-sha256 "$(sha_of "$2")" --receipt-ref "r-$2" --now "$NOW" >>"$TESTDIR/strike.log" 2>&1
}
status_of() {  # <engine spelling> <field>
  node "$SC" seat-status --engine "$1" --runner kimi --role reviewer --now "$NOW" | field "$2"
}

# A: strikes recorded under the SLASH spelling reach the seat read under the HYPHEN spelling.
strike kimi-code/k3 s1; strike kimi-code/k3 s2; strike kimi-code/k3 s3
[ "$(status_of kimi-code-k3 strikes_since_pass)" = 3 ] && ok "A1 hyphen-read sees 3 slash-written strikes" || bad "A1 hyphen strikes=$(status_of kimi-code-k3 strikes_since_pass)"
[ "$(status_of kimi-code-k3 admission_status)" = requalify_required ] && ok "A2 hyphen seat requalify_required" || bad "A2 status=$(status_of kimi-code-k3 admission_status)"
# B: the slash-spelled query finds the hyphen-spelled baseline AND the same strikes.
[ "$(status_of kimi-code/k3 strikes_since_pass)" = 3 ] && ok "B1 slash-read sees the same 3 strikes" || bad "B1 slash strikes=$(status_of kimi-code/k3 strikes_since_pass)"
[ "$(status_of kimi-code/k3 admission_status)" = requalify_required ] && ok "B2 slash read finds the hyphen baseline" || bad "B2 status=$(status_of kimi-code/k3 admission_status)"
# C: a strike written under the hyphen spelling joins the same seat (dedup across spellings).
strike kimi-code-k3 s4
[ "$(status_of kimi-code/k3 strikes_since_pass)" = 4 ] && ok "C1 hyphen-written strike joins the same seat" || bad "C1 strikes=$(status_of kimi-code/k3 strikes_since_pass)"
strike kimi-code/k3 s4
[ "$(status_of kimi-code-k3 strikes_since_pass)" = 4 ] && ok "C2 same dedup key across spellings counts once" || bad "C2 strikes=$(status_of kimi-code-k3 strikes_since_pass)"

# D: negative control -- different engines are NOT aliased (other model; other provider prefix).
strike kimi-code/k3-256k n1
strike kimi-codex-k3 n2
[ "$(status_of kimi-code-k3 strikes_since_pass)" = 4 ] && ok "D1 k3-256k and kimi-codex-k3 strikes do not leak into k3" || bad "D1 strikes=$(status_of kimi-code-k3 strikes_since_pass)"

# E: recorded rows are never rewritten by reading.
H1="$(sha256sum "$ENGINE_CAPABILITY_DIR/strikes.jsonl" "$ENGINE_SCORECARD_DIR/scorecard.jsonl" | sha256sum)"
status_of kimi-code-k3 strikes_since_pass >/dev/null; status_of kimi-code/k3 strikes_since_pass >/dev/null
H2="$(sha256sum "$ENGINE_CAPABILITY_DIR/strikes.jsonl" "$ENGINE_SCORECARD_DIR/scorecard.jsonl" | sha256sum)"
[ "$H1" = "$H2" ] && ok "E1 reads leave strikes.jsonl and scorecard.jsonl byte-identical" || bad "E1 a read changed a store"

printf 'Summary: %s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
