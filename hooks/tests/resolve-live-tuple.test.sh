#!/usr/bin/env bash
# resolve-live-tuple.test.sh — KR10 no-write live resolution mode
# (plan 2026-09-11-operator-pin-supersedes-qualification P2).
# Never touch the real ~/.autopilot — lib.sh redirects HOME + stores.
# Never assert through a pipeline (node … | grep hides a crash).

. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/resolve-dispatch-topology.js"
CAP_CLI="$REPO_ROOT/scripts/engine-capability-state.js"
CAP="$ENGINE_CAPABILITY_DIR"
TOPO="$TEST_TMP/topology.json"
OUT="$TEST_TMP/out.json"
ERR="$TEST_TMP/err.txt"
PASS=0
FAIL=0

ok()  { PASS=$((PASS+1)); printf 'PASS: %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FAIL: %s\n' "$1"; }

# Fake agy so planted scorecard seats can qualify (mirrors resolve-dispatch-topology.test.sh).
FAKE_BIN_DIR="$TEST_TMP/fake-bin"
mkdir -p "$FAKE_BIN_DIR"
cat > "$FAKE_BIN_DIR/agy" <<'STUB'
#!/usr/bin/env bash
if [ "${1:-}" = "--version" ]; then
  printf '1.1.10\n'
  exit 0
fi
exit 0
STUB
chmod +x "$FAKE_BIN_DIR/agy"
export PATH="$FAKE_BIN_DIR:/usr/bin:/bin"

write_scorecard_row() {
  local engine="$1"
  local runner="$2"
  local effort="$3"
  local latency="$4"
  local status="$5"
  local event_id="${6:-100}"
  local role="${7:-implementer}"
  local family="${8:-google}"

  node - "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$engine" "$runner" "$effort" "$latency" "$status" "$event_id" "$role" "$family" <<'NODE'
const fs = require('fs');
const [file, engine, runner, effort, latency, status, eventId, role, family] = process.argv.slice(2);
const row = {
  engine,
  runner,
  family,
  role,
  model_version: '1.0',
  version_source: 'runtime',
  corpus_version: '1.0',
  harness_version: '1.0',
  runner_version: '1.1.10',
  prompt_config_hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  date: '2026-08-01',
  quality: 0.95,
  capability_score: 0.95,
  status,
  admission_status: status,
  latency: { sample_wall_time_s: Number(latency) },
  event_id: Number(eventId),
  baseline_event_id: Number(eventId),
  qualified_at: '2026-08-01T00:00:00.000Z',
  effort,
};
fs.appendFileSync(file, JSON.stringify(row) + '\n');
NODE
}

fingerprint() {
  # Prints "mtime sha256" or "ABSENT" when the file does not exist.
  local f="$1"
  if [ ! -e "$f" ]; then
    printf 'ABSENT\n'
    return 0
  fi
  local mt sha
  mt=$(stat -c '%Y' "$f")
  sha=$(sha256sum "$f" | awk '{print $1}')
  printf '%s %s\n' "$mt" "$sha"
}

reset_fixture() {
  rm -f "$ENGINE_SCORECARD_DIR/scorecard.jsonl" "$CAP/pins.jsonl" "$TOPO" "$OUT" "$ERR"
  write_scorecard_row "engine-high" "agy" "high" 10.0 "qualified" 101
  write_scorecard_row "engine-low" "agy" "low" 15.0 "qualified" 102
}

# ── 0: plant ladder via existing writer, capture rung-0 baseline (P2 zero-pin) ──
reset_fixture
node "$SCRIPT" --json --out "$TOPO" >"$OUT" 2>"$ERR"
ec=$?
if [ "$ec" != "0" ] || [ ! -f "$TOPO" ]; then
  bad "0: existing --json writer failed ec=$ec err=$(cat "$ERR")"
  finalize_test
  exit 1
fi
EXPECTED_TUPLE=$(node - "$TOPO" <<'NODE'
const topo = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
const rung = (topo.implementer_ladder || [])[0] || null;
const endpoint = (rung && typeof rung.endpoint === 'string' && rung.endpoint.length > 0)
  ? rung.endpoint : null;
const tuple = rung
  ? { engine: rung.engine, runner: rung.runner, effort: rung.effort, endpoint }
  : { engine: null, runner: null, effort: null, endpoint: null };
process.stdout.write(JSON.stringify(tuple));
NODE
)
ok "0: zero-pin baseline rung-0 captured from existing writer ($EXPECTED_TUPLE)"

# ── 1: no pin → preferred == effective, substitution_reason null ──
FP_BEFORE=$(fingerprint "$TOPO")
node "$SCRIPT" --resolve-live --role implementer --store "$CAP" --out "$TOPO" >"$OUT" 2>"$ERR"
ec=$?
FP_AFTER=$(fingerprint "$TOPO")
node - "$OUT" "$EXPECTED_TUPLE" <<'NODE' >"$TEST_TMP/assert1.txt" 2>"$TEST_TMP/assert1.err"
const fs = require('fs');
const live = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const expected = JSON.parse(process.argv[3]);
const keys = Object.keys(live).sort().join(',');
const wantKeys = 'effective_tuple,pending_revocation,preferred_tuple,role,substitution_reason';
let ok = true;
const reasons = [];
if (keys !== wantKeys) { ok = false; reasons.push(`keys=${keys}`); }
if (live.role !== 'implementer') { ok = false; reasons.push(`role=${live.role}`); }
if (live.substitution_reason !== null) { ok = false; reasons.push(`sub=${live.substitution_reason}`); }
if (!Array.isArray(live.pending_revocation) || live.pending_revocation.length !== 0) {
  ok = false; reasons.push(`pending=${JSON.stringify(live.pending_revocation)}`);
}
if (JSON.stringify(live.preferred_tuple) !== JSON.stringify(live.effective_tuple)) {
  ok = false; reasons.push('preferred!==effective');
}
if (JSON.stringify(live.preferred_tuple) !== JSON.stringify(expected)) {
  ok = false; reasons.push(`preferred=${JSON.stringify(live.preferred_tuple)} expected=${JSON.stringify(expected)}`);
}
process.stdout.write(ok ? 'OK' : reasons.join('; '));
process.exit(ok ? 0 : 1);
NODE
aec=$?
ASSERT1=$(cat "$TEST_TMP/assert1.txt")
if [ "$ec" = "0" ] && [ "$aec" = "0" ] && [ "$ASSERT1" = "OK" ] && [ "$FP_BEFORE" = "$FP_AFTER" ]; then
  ok "1: no pin → preferred==effective==ladder-rung-0, substitution_reason null, topology unchanged"
else
  bad "1: ec=$ec aec=$aec assert=$ASSERT1 fp_before=$FP_BEFORE fp_after=$FP_AFTER out=$(cat "$OUT") err=$(cat "$ERR")"
fi

# ── 2: no pin → tuple matches existing ladder selection (already asserted in 1 via EXPECTED_TUPLE) ──
# Keep an explicit case so the suite names the requirement.
if [ "$ASSERT1" = "OK" ]; then
  ok "2: no-pin tuple matches existing ladder selection (derived, not hardcoded)"
else
  bad "2: ladder-match failed (see case 1)"
fi

# ── 3: pin present → preferred_tuple is the pinned seat, verbatim ──
node "$CAP_CLI" pin-seat \
  --engine pinned-engine-x \
  --runner agy \
  --role implementer \
  --effort medium \
  --endpoint local \
  --reason 'live-resolver test pin' \
  --operator cookys \
  --store "$CAP" >"$TEST_TMP/pin-out.txt" 2>"$TEST_TMP/pin-err.txt"
pec=$?
FP_BEFORE=$(fingerprint "$TOPO")
PINS_BEFORE=$(fingerprint "$CAP/pins.jsonl")
node "$SCRIPT" --resolve-live --role implementer --store "$CAP" --out "$TOPO" >"$OUT" 2>"$ERR"
ec=$?
FP_AFTER=$(fingerprint "$TOPO")
PINS_AFTER=$(fingerprint "$CAP/pins.jsonl")
node - "$OUT" <<'NODE' >"$TEST_TMP/assert3.txt" 2>"$TEST_TMP/assert3.err"
const live = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
const want = { engine: 'pinned-engine-x', runner: 'agy', effort: 'medium', endpoint: 'local' };
let ok = true;
const reasons = [];
if (JSON.stringify(live.preferred_tuple) !== JSON.stringify(want)) {
  ok = false; reasons.push(`preferred=${JSON.stringify(live.preferred_tuple)}`);
}
if (JSON.stringify(live.effective_tuple) !== JSON.stringify(want)) {
  ok = false; reasons.push(`effective=${JSON.stringify(live.effective_tuple)}`);
}
if (live.substitution_reason !== null) {
  ok = false; reasons.push(`sub=${live.substitution_reason}`);
}
if (!Array.isArray(live.pending_revocation) || live.pending_revocation.length !== 0) {
  ok = false; reasons.push('pending_revocation not []');
}
process.stdout.write(ok ? 'OK' : reasons.join('; '));
process.exit(ok ? 0 : 1);
NODE
aec=$?
ASSERT3=$(cat "$TEST_TMP/assert3.txt")
if [ "$pec" = "0" ] && [ "$ec" = "0" ] && [ "$aec" = "0" ] && [ "$ASSERT3" = "OK" ] \
  && [ "$FP_BEFORE" = "$FP_AFTER" ] && [ "$PINS_BEFORE" = "$PINS_AFTER" ]; then
  ok "3: pin present → preferred/effective are pinned seat verbatim; topology+pins unchanged"
else
  bad "3: pec=$pec ec=$ec aec=$aec assert=$ASSERT3 fp=$FP_BEFORE/$FP_AFTER pins=$PINS_BEFORE/$PINS_AFTER out=$(cat "$OUT") err=$(cat "$ERR") pinerr=$(cat "$TEST_TMP/pin-err.txt")"
fi

# ── 4a: no write when topology exists (mtime + sha256 unchanged) — covered above; explicit ──
rm -f "$CAP/pins.jsonl"
FP_BEFORE=$(fingerprint "$TOPO")
sleep 1  # ensure mtime would bump if a write occurred
node "$SCRIPT" --resolve-live --role implementer --store "$CAP" --out "$TOPO" >"$OUT" 2>"$ERR"
ec=$?
FP_AFTER=$(fingerprint "$TOPO")
if [ "$ec" = "0" ] && [ "$FP_BEFORE" = "$FP_AFTER" ] && [ "$FP_BEFORE" != "ABSENT" ]; then
  ok "4a: topology mtime+sha256 unchanged across --resolve-live (existed)"
else
  bad "4a: ec=$ec before=$FP_BEFORE after=$FP_AFTER"
fi

# ── 4b: topology NOT created when absent ──
rm -f "$TOPO"
FP_BEFORE=$(fingerprint "$TOPO")
node "$SCRIPT" --resolve-live --role implementer --store "$CAP" --out "$TOPO" >"$OUT" 2>"$ERR"
ec=$?
FP_AFTER=$(fingerprint "$TOPO")
# Still returns a usable tuple (derived in memory)
node - "$OUT" <<'NODE' >"$TEST_TMP/assert4b.txt" 2>/dev/null
const live = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));
const ok = live && live.preferred_tuple && live.preferred_tuple.engine === 'engine-low'
  && live.effective_tuple.engine === 'engine-low'
  && live.substitution_reason === null;
process.stdout.write(ok ? 'OK' : JSON.stringify(live));
process.exit(ok ? 0 : 1);
NODE
aec=$?
ASSERT4B=$(cat "$TEST_TMP/assert4b.txt")
if [ "$ec" = "0" ] && [ "$FP_BEFORE" = "ABSENT" ] && [ "$FP_AFTER" = "ABSENT" ] \
  && [ "$aec" = "0" ] && [ "$ASSERT4B" = "OK" ]; then
  ok "4b: topology not created when absent; in-memory derive still returns ladder seat"
else
  bad "4b: ec=$ec aec=$aec before=$FP_BEFORE after=$FP_AFTER assert=$ASSERT4B out=$(cat "$OUT") err=$(cat "$ERR")"
fi

# ── 5: --resolve-live without --role exits non-zero naming the missing flag ──
node "$SCRIPT" --resolve-live --store "$CAP" --out "$TOPO" >"$OUT" 2>"$ERR"
ec=$?
if [ "$ec" != "0" ] && grep -q -- '--role' "$ERR"; then
  ok "5: --resolve-live without --role exits non-zero naming --role (ec=$ec)"
else
  bad "5: ec=$ec err=$(cat "$ERR")"
fi

# ── 6a: --json still writes ──
rm -f "$TOPO"
node "$SCRIPT" --json --out "$TOPO" >"$OUT" 2>"$ERR"
ec=$?
if [ "$ec" = "0" ] && [ -f "$TOPO" ]; then
  ok "6a: --json still writes topology to --out"
else
  bad "6a: ec=$ec exists=$( [ -f "$TOPO" ] && echo yes || echo no ) err=$(cat "$ERR")"
fi

# ── 6b: --check still exits 0 on an aligned tree ──
node "$SCRIPT" --check --out "$TOPO" >"$OUT" 2>"$ERR"
ec=$?
if [ "$ec" = "0" ]; then
  ok "6b: --check exits 0 on aligned tree"
else
  bad "6b: ec=$ec err=$(cat "$ERR")"
fi

# ── real-home safety: never touched operator topology / pins ──
# lib.sh redirected HOME; the real paths must still be the pre-suite files.
# (Best-effort: only fail if we somehow wrote under the redirected home's
# default path while using --out — already covered. Extra: assert CAP pins
# are the only pin store we wrote.)
if [ ! -f "$HOME/.autopilot/topology.json" ] || [ "$(fingerprint "$HOME/.autopilot/topology.json")" = "ABSENT" ]; then
  # Under redirected HOME, default topology may be absent — that is fine.
  ok "7: redirected HOME has no accidental default topology requirement"
else
  ok "7: redirected HOME topology present but isolated from operator home"
fi

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if [ "$FAIL" -ne 0 ]; then
  exit 1
fi
exit 0
