#!/usr/bin/env bash
# BL-0109: the runs-enrich cursor file is shared without a lock; saveState must merge (newer probe per live run wins) instead
# of letting the last writer erase another caller's probes. Negative control: with a plain overwrite, case 1 goes red.
. "$(dirname "$0")/lib.sh"

D="$TEST_TMP/rsm"; mkdir -p "$D"
F="$D/cursor.json"
trap 'cleanup_test_tmp' EXIT

run() { node -e '
  const rf = require(process.argv[1] + "/src/status/runs-fields.js");
  const [file, mode] = process.argv.slice(2);
  const p = (t) => ({ observed_at: t, phase: "x", alive: true, stall: null, last_event_age_s: 1 });
  if (mode === "a") rf.saveState(file, "d", { cursor: "r1", order: ["r1", "r2"], probes: { r1: p("2026-10-16T10:00:00.000Z"), r2: p("2026-10-16T10:00:00.000Z") } });
  if (mode === "b") rf.saveState(file, "d", { cursor: "r2", order: ["r1", "r2"], probes: { r1: p("2026-10-16T09:00:00.000Z"), r2: p("2026-10-16T11:00:00.000Z") } });
  if (mode === "c") rf.saveState(file, "d", { cursor: "r1", order: ["r1"], probes: { r1: p("2026-10-16T08:00:00.000Z") } });
' "$REPO_ROOT" "$F" "$1"; }
field() { node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const [id,f]=process.argv[2].split("."); process.stdout.write(String(f==="cursor"?s.cursor:(s.probes[id]?s.probes[id].observed_at:"none")))' "$F" "$1"; }

run a; run b
assert_eq "$(field r1.observed_at)" "2026-10-16T10:00:00.000Z" "newer probe already on disk survives a later writer's older one (r1)"
assert_eq "$(field r2.observed_at)" "2026-10-16T11:00:00.000Z" "the writer's own newer probe wins (r2)"
assert_eq "$(field x.cursor)" "r2" "cursor stays the last writer's own"
run c
assert_eq "$(field r2.observed_at)" "none" "a run this writer no longer considers live is dropped"
assert_eq "$(field r1.observed_at)" "2026-10-16T10:00:00.000Z" "r1 keeps the newer probe from disk"
finalize_test
