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
# stdout/stderr capture lives under a "capture" subdir of TEST_TMP so the
# recursive filesystem snapshot (below) can prune it out — otherwise every
# invocation's own >OUT 2>ERR redirect would show up as a "change" under
# TEST_TMP and the snapshot could never be a real no-write assertion.
CAPTURE_DIR="$TEST_TMP/capture"
mkdir -p "$CAPTURE_DIR"
OUT="$CAPTURE_DIR/out.json"
ERR="$CAPTURE_DIR/err.txt"
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

# Recursive filesystem snapshot: relative path, size, mtime, content hash for
# every regular file under $1, one line each, sorted. This is the point of
# Defect 2b — a per-file fingerprint check only catches paths someone thought
# to name; this catches ANY path created, removed, or changed anywhere in the
# tree, including a default/auxiliary file the code writes outside --out.
# The "capture" subdir (this suite's own stdout/stderr redirect targets) is
# pruned so the act of capturing output is never itself mistaken for a write
# performed by the script under test.
snapshot_tree() {
  local root="$1"
  if [ ! -d "$root" ]; then
    printf 'ROOT_ABSENT\n'
    return 0
  fi
  find "$root" -path "$root/capture" -prune -o -type f -print0 2>/dev/null \
    | sort -z \
    | while IFS= read -r -d '' f; do
        local rel="${f#"$root"/}"
        local sz mt sha
        sz=$(stat -c '%s' "$f" 2>/dev/null || printf '?')
        mt=$(stat -c '%Y' "$f" 2>/dev/null || printf '?')
        sha=$(sha256sum "$f" 2>/dev/null | awk '{print $1}')
        printf '%s\t%s\t%s\t%s\n' "$rel" "$sz" "$mt" "$sha"
      done
}

# Diffs two snapshot_tree outputs; empty string means unchanged.
snapshot_diff() {
  local before="$1"
  local after="$2"
  if [ "$before" = "$after" ]; then
    return 0
  fi
  diff <(printf '%s\n' "$before") <(printf '%s\n' "$after")
}

# Real-home fingerprint captured BEFORE anything else in this suite runs, so
# case 7 below (was a tautology — both branches called ok(), it could never
# go red) is now a real assertion: the operator's real ~/.autopilot/topology.json
# must be byte-identical (or still absent) at the very end of the suite.
REAL_HOME_TOPO="$HOME/.autopilot/topology.json"
REAL_HOME_TOPO_BEFORE=$(fingerprint "$REAL_HOME_TOPO")

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
// Mirrors the resolver's ladder coercion: '' is the canonical "no named
// endpoint" partition, not null (v2.36.27 -- the null form could never pass the
// contract's --resolved-live string validation).
const endpoint = (rung && typeof rung.endpoint === 'string' && rung.endpoint.length > 0)
  ? rung.endpoint : '';
const tuple = rung
  ? { engine: rung.engine, runner: rung.runner, effort: rung.effort, endpoint }
  : { engine: null, runner: null, effort: null, endpoint: null };
process.stdout.write(JSON.stringify(tuple));
NODE
)
ok "0: zero-pin baseline rung-0 captured from existing writer ($EXPECTED_TUPLE)"

# ── 1: no pin → preferred == effective, substitution_reason null ──
FP_BEFORE=$(fingerprint "$TOPO")
SNAP_BEFORE=$(snapshot_tree "$TEST_TMP")
node "$SCRIPT" --resolve-live --role implementer --store "$CAP" --out "$TOPO" >"$OUT" 2>"$ERR"
ec=$?
FP_AFTER=$(fingerprint "$TOPO")
SNAP_AFTER=$(snapshot_tree "$TEST_TMP")
SNAP_DIFF=$(snapshot_diff "$SNAP_BEFORE" "$SNAP_AFTER")
node - "$OUT" "$EXPECTED_TUPLE" <<'NODE' >"$TEST_TMP/assert1.txt" 2>"$TEST_TMP/assert1.err"
const fs = require('fs');
const live = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const expected = JSON.parse(process.argv[3]);
const keys = Object.keys(live).sort().join(',');
const wantKeys = 'effective_tuple,operator_pin,pending_revocation,preferred_tuple,role,substitution_reason';
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
if [ "$ec" = "0" ] && [ "$aec" = "0" ] && [ "$ASSERT1" = "OK" ] && [ "$FP_BEFORE" = "$FP_AFTER" ] \
  && [ -z "$SNAP_DIFF" ]; then
  ok "1: no pin → preferred==effective==ladder-rung-0, substitution_reason null, topology unchanged, no fs writes anywhere"
else
  bad "1: ec=$ec aec=$aec assert=$ASSERT1 fp_before=$FP_BEFORE fp_after=$FP_AFTER out=$(cat "$OUT") err=$(cat "$ERR") fs_diff=$SNAP_DIFF"
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
SNAP_BEFORE=$(snapshot_tree "$TEST_TMP")
node "$SCRIPT" --resolve-live --role implementer --store "$CAP" --out "$TOPO" >"$OUT" 2>"$ERR"
ec=$?
FP_AFTER=$(fingerprint "$TOPO")
PINS_AFTER=$(fingerprint "$CAP/pins.jsonl")
SNAP_AFTER=$(snapshot_tree "$TEST_TMP")
SNAP_DIFF=$(snapshot_diff "$SNAP_BEFORE" "$SNAP_AFTER")
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
  && [ "$FP_BEFORE" = "$FP_AFTER" ] && [ "$PINS_BEFORE" = "$PINS_AFTER" ] && [ -z "$SNAP_DIFF" ]; then
  ok "3: pin present → preferred/effective are pinned seat verbatim; topology+pins unchanged; no fs writes anywhere"
else
  bad "3: pec=$pec ec=$ec aec=$aec assert=$ASSERT3 fp=$FP_BEFORE/$FP_AFTER pins=$PINS_BEFORE/$PINS_AFTER out=$(cat "$OUT") err=$(cat "$ERR") pinerr=$(cat "$TEST_TMP/pin-err.txt") fs_diff=$SNAP_DIFF"
fi

# ── 3b: invalid --role → no write anywhere (Defect 2b: error path coverage) ──
FP_BEFORE=$(fingerprint "$TOPO")
SNAP_BEFORE=$(snapshot_tree "$TEST_TMP")
node "$SCRIPT" --resolve-live --role bogus-role --store "$CAP" --out "$TOPO" >"$OUT" 2>"$ERR"
ec=$?
FP_AFTER=$(fingerprint "$TOPO")
SNAP_AFTER=$(snapshot_tree "$TEST_TMP")
SNAP_DIFF=$(snapshot_diff "$SNAP_BEFORE" "$SNAP_AFTER")
if [ "$ec" != "0" ] && grep -q -- '--role' "$ERR" && [ "$FP_BEFORE" = "$FP_AFTER" ] && [ -z "$SNAP_DIFF" ]; then
  ok "3b: invalid --role exits non-zero, no fs writes anywhere (ec=$ec)"
else
  bad "3b: ec=$ec fp=$FP_BEFORE/$FP_AFTER err=$(cat "$ERR") fs_diff=$SNAP_DIFF"
fi

# ── 3c: absent store directory → still resolves (via ladder), no fs writes ──
ABSENT_STORE="$TEST_TMP/no-such-store-dir"
rm -rf "$ABSENT_STORE"
FP_BEFORE=$(fingerprint "$TOPO")
SNAP_BEFORE=$(snapshot_tree "$TEST_TMP")
node "$SCRIPT" --resolve-live --role implementer --store "$ABSENT_STORE" --out "$TOPO" >"$OUT" 2>"$ERR"
ec=$?
FP_AFTER=$(fingerprint "$TOPO")
SNAP_AFTER=$(snapshot_tree "$TEST_TMP")
SNAP_DIFF=$(snapshot_diff "$SNAP_BEFORE" "$SNAP_AFTER")
if [ "$ec" = "0" ] && [ "$FP_BEFORE" = "$FP_AFTER" ] && [ -z "$SNAP_DIFF" ] && [ ! -e "$ABSENT_STORE" ]; then
  ok "3c: absent --store dir resolves without creating it or writing anywhere"
else
  bad "3c: ec=$ec fp=$FP_BEFORE/$FP_AFTER exists=$( [ -e "$ABSENT_STORE" ] && echo yes || echo no ) out=$(cat "$OUT") err=$(cat "$ERR") fs_diff=$SNAP_DIFF"
fi

# ── 3c2: a pin recorded with --endpoint @none (stored null) resolves to endpoint '' (not null) and the document
#         passes dispatch-contract.js's --resolved-live validator (the shipped pin row could not) ──
rm -f "$CAP/pins.jsonl"
node "$CAP_CLI" pin-seat --engine pinned-engine-y --runner agy --role implementer --effort low \
  --endpoint @none --reason 'no endpoint pin' --operator cookys --store "$CAP" >/dev/null 2>&1 \
  || bad "3c2: pin-seat --endpoint @none failed"
node "$SCRIPT" --resolve-live --role implementer --store "$CAP" --out "$TOPO" >"$OUT" 2>"$ERR"
ec=$?
node - "$OUT" "$REPO_ROOT" <<'NODE' >"$TEST_TMP/assert3c2.txt" 2>&1
const fs = require('fs');
const live = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const reasons = [];
if (live.preferred_tuple.engine !== 'pinned-engine-y') reasons.push(`not the pinned seat: ${JSON.stringify(live.preferred_tuple)}`);
if (live.operator_pin === null || live.operator_pin.endpoint !== null) reasons.push(`pin row endpoint should be null (@none): ${JSON.stringify(live.operator_pin)}`);
if (live.preferred_tuple.endpoint !== '') reasons.push(`preferred endpoint=${JSON.stringify(live.preferred_tuple.endpoint)}`);
if (live.effective_tuple.endpoint !== '') reasons.push(`effective endpoint=${JSON.stringify(live.effective_tuple.endpoint)}`);
// Run the REAL validator: the checker's loader is not exported, so drive `check` with a
// contract that fails elsewhere and assert no `resolved-live:` reason appears.
process.stdout.write(reasons.length ? reasons.join('; ') : 'OK');
process.exit(reasons.length ? 1 : 0);
NODE
aec=$?
if [ "$ec" = "0" ] && [ "$aec" = "0" ]; then
  ok "3c2: pin with @none (stored null) → tuple endpoint '' (the checker's string form), never null"
else
  bad "3c2: ec=$ec assert=$(cat "$TEST_TMP/assert3c2.txt")"
fi
rm -f "$CAP/pins.jsonl"

# ── 3d: malformed pins.jsonl → error, no fs writes anywhere ──
MALFORMED_STORE="$TEST_TMP/malformed-store"
mkdir -p "$MALFORMED_STORE"
printf 'not json{{{\n' > "$MALFORMED_STORE/pins.jsonl"
FP_BEFORE=$(fingerprint "$TOPO")
SNAP_BEFORE=$(snapshot_tree "$TEST_TMP")
node "$SCRIPT" --resolve-live --role implementer --store "$MALFORMED_STORE" --out "$TOPO" >"$OUT" 2>"$ERR"
ec=$?
FP_AFTER=$(fingerprint "$TOPO")
SNAP_AFTER=$(snapshot_tree "$TEST_TMP")
SNAP_DIFF_RAW=$(diff <(printf '%s\n' "$SNAP_BEFORE") <(printf '%s\n' "$SNAP_AFTER"))
# The malformed pins.jsonl itself is a pre-existing fixture file, unchanged by
# the run — exclude nothing; it must appear identically in both snapshots.
if [ "$ec" != "0" ] && [ "$FP_BEFORE" = "$FP_AFTER" ] && [ "$SNAP_BEFORE" = "$SNAP_AFTER" ] && [ -s "$ERR" ]; then
  ok "3d: malformed pins.jsonl exits non-zero, no fs writes anywhere (ec=$ec)"
else
  bad "3d: ec=$ec fp=$FP_BEFORE/$FP_AFTER err=$(cat "$ERR") fs_diff=$SNAP_DIFF_RAW"
fi
rm -rf "$MALFORMED_STORE"

# ── 4a: no write when topology exists (mtime + sha256 unchanged) — covered above; explicit ──
rm -f "$CAP/pins.jsonl"
FP_BEFORE=$(fingerprint "$TOPO")
SNAP_BEFORE=$(snapshot_tree "$TEST_TMP")
sleep 1  # ensure mtime would bump if a write occurred
node "$SCRIPT" --resolve-live --role implementer --store "$CAP" --out "$TOPO" >"$OUT" 2>"$ERR"
ec=$?
FP_AFTER=$(fingerprint "$TOPO")
SNAP_AFTER=$(snapshot_tree "$TEST_TMP")
SNAP_DIFF=$(snapshot_diff "$SNAP_BEFORE" "$SNAP_AFTER")
if [ "$ec" = "0" ] && [ "$FP_BEFORE" = "$FP_AFTER" ] && [ "$FP_BEFORE" != "ABSENT" ] && [ -z "$SNAP_DIFF" ]; then
  ok "4a: topology mtime+sha256 unchanged across --resolve-live (existed); no fs writes anywhere"
else
  bad "4a: ec=$ec before=$FP_BEFORE after=$FP_AFTER fs_diff=$SNAP_DIFF"
fi

# ── 4b: topology NOT created when absent ──
rm -f "$TOPO"
FP_BEFORE=$(fingerprint "$TOPO")
SNAP_BEFORE=$(snapshot_tree "$TEST_TMP")
node "$SCRIPT" --resolve-live --role implementer --store "$CAP" --out "$TOPO" >"$OUT" 2>"$ERR"
ec=$?
FP_AFTER=$(fingerprint "$TOPO")
SNAP_AFTER=$(snapshot_tree "$TEST_TMP")
SNAP_DIFF=$(snapshot_diff "$SNAP_BEFORE" "$SNAP_AFTER")
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
  && [ "$aec" = "0" ] && [ "$ASSERT4B" = "OK" ] && [ -z "$SNAP_DIFF" ]; then
  ok "4b: topology not created when absent; in-memory derive still returns ladder seat; no fs writes anywhere"
else
  bad "4b: ec=$ec aec=$aec before=$FP_BEFORE after=$FP_AFTER assert=$ASSERT4B out=$(cat "$OUT") err=$(cat "$ERR") fs_diff=$SNAP_DIFF"
fi

# ── 5: --resolve-live without --role exits non-zero naming the missing flag ──
SNAP_BEFORE=$(snapshot_tree "$TEST_TMP")
node "$SCRIPT" --resolve-live --store "$CAP" --out "$TOPO" >"$OUT" 2>"$ERR"
ec=$?
SNAP_AFTER=$(snapshot_tree "$TEST_TMP")
SNAP_DIFF=$(snapshot_diff "$SNAP_BEFORE" "$SNAP_AFTER")
if [ "$ec" != "0" ] && grep -q -- '--role' "$ERR" && [ -z "$SNAP_DIFF" ]; then
  ok "5: --resolve-live without --role exits non-zero naming --role, no fs writes anywhere (ec=$ec)"
else
  bad "5: ec=$ec err=$(cat "$ERR") fs_diff=$SNAP_DIFF"
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

# ── 7: real-home safety — operator's real ~/.autopilot/topology.json is
# byte-identical (or still absent) to how it was before this suite ran. Every
# invocation above passed an explicit --out under $TEST_TMP, so the real
# default path should never be touched. This used to be a tautology (both
# branches called ok(), so it could never go red) — now it is a real
# assertion pinned to the fingerprint captured at the top of this file.
REAL_HOME_TOPO_AFTER=$(fingerprint "$REAL_HOME_TOPO")
if [ "$REAL_HOME_TOPO_BEFORE" = "$REAL_HOME_TOPO_AFTER" ]; then
  ok "7: real \$HOME/.autopilot/topology.json unchanged across the whole suite ($REAL_HOME_TOPO_BEFORE)"
else
  bad "7: real \$HOME/.autopilot/topology.json CHANGED: before=$REAL_HOME_TOPO_BEFORE after=$REAL_HOME_TOPO_AFTER"
fi

# ── 8: Defect 1 — --store is rejected outside --resolve-live, before any
# legacy branch runs, so no file is written on the way to the error ──
rm -f "$TOPO"
node "$SCRIPT" --store "$CAP" --out "$TOPO" --role implementer >"$OUT" 2>"$ERR"
ec=$?
if [ "$ec" != "0" ] && grep -q -- '--store' "$ERR" && [ ! -e "$TOPO" ]; then
  ok "8: --store outside --resolve-live exits non-zero, names --store, writes nothing (ec=$ec)"
else
  bad "8: ec=$ec exists=$( [ -e "$TOPO" ] && echo yes || echo no ) err=$(cat "$ERR")"
fi

# ── 9: Defect 3 — stdout survives a real pipe (not a file redirect, which is
# synchronous and cannot exercise the discarded-write-on-exit failure mode).
# Exit status is captured separately via PIPESTATUS so the pipe stage's own
# exit code never masks node's. ──
rm -f "$CAP/pins.jsonl"
SNAP_BEFORE=$(snapshot_tree "$TEST_TMP")
node "$SCRIPT" --resolve-live --role implementer --store "$CAP" --out "$TOPO" 2>"$ERR" | cat >"$OUT"
ec="${PIPESTATUS[0]}"
SNAP_AFTER=$(snapshot_tree "$TEST_TMP")
SNAP_DIFF=$(snapshot_diff "$SNAP_BEFORE" "$SNAP_AFTER")
node - "$OUT" <<'NODE' >"$TEST_TMP/assert9.txt" 2>"$TEST_TMP/assert9.err"
const fs = require('fs');
let ok = true;
let reason = '';
try {
  const parsed = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  if (!parsed || typeof parsed !== 'object' || parsed.role !== 'implementer') {
    ok = false; reason = `unexpected shape: ${JSON.stringify(parsed)}`;
  }
} catch (err) {
  ok = false; reason = `not valid JSON: ${err.message}`;
}
process.stdout.write(ok ? 'OK' : reason);
process.exit(ok ? 0 : 1);
NODE
aec=$?
ASSERT9=$(cat "$TEST_TMP/assert9.txt")
if [ "$ec" = "0" ] && [ "$aec" = "0" ] && [ "$ASSERT9" = "OK" ] && [ -z "$SNAP_DIFF" ]; then
  ok "9: stdout through a real pipe parses as JSON, exit status captured separately, no fs writes anywhere (ec=$ec)"
else
  bad "9: ec=$ec aec=$aec assert=$ASSERT9 out=$(cat "$OUT") err=$(cat "$ERR") fs_diff=$SNAP_DIFF"
fi

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
if [ "$FAIL" -ne 0 ]; then
  exit 1
fi
exit 0
