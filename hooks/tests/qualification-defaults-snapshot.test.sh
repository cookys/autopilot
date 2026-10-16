#!/usr/bin/env bash
# hooks/tests/qualification-defaults-snapshot.test.sh — BL-0194 P4a (B1):
# build-qualification-defaults.js --from-snapshot / --check-snapshot-age and the preflight wiring.
# Fixture snapshots only; the committed artifact and recipe are never rebuilt or touched.
. "$(dirname "$0")/lib.sh"

BUILD="$REPO_ROOT/scripts/build-qualification-defaults.js"
ARTIFACT="$REPO_ROOT/references/official-qualification-defaults.json"
RECIPE="$REPO_ROOT/references/official-qualification-defaults.recipe.json"
PREFLIGHT="$REPO_ROOT/scripts/preflight-release.sh"
W="$TEST_TMP/w"; mkdir -p "$W"

# A v1 feed snapshot wrapping the committed artifact's defaults (+ the producer-only keys a real feed adds),
# and a v2 variant (v2 is a superset: only `schema` and the new top-level keys differ).
mksnap() { # <out> <schema> <generated_at>
  node -e '
const fs = require("fs");
const a = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const defaults = a.defaults.map((d) => ({ ...d, feed: { first_seen: "x" }, board: { cell: "y" } }));
const doc = { schema: process.argv[3], artifact_type: "official-qualification-defaults", generated_at: process.argv[4], defaults, strikes: [], priors: [] };
if (process.argv[3].endsWith(".v2")) { doc.producer = "t"; doc.source_revision = "0".repeat(40); doc.seat_metrics = []; doc.strike_events = []; }
fs.writeFileSync(process.argv[2], JSON.stringify(doc, null, 2) + "\n");
' "$ARTIFACT" "$1" "$2" "$3"
}
SNAP1="$W/snap-v1.json"; SNAP2="$W/snap-v2.json"
mksnap "$SNAP1" model-dyno.qualification-feed.v1 2026-10-10T00:00:00Z
mksnap "$SNAP2" model-dyno.qualification-feed.v2 2026-10-10T00:00:00Z

fresh_recipe() { cp "$RECIPE" "$W/recipe.json"; }
b() { node "$BUILD" "$@" --recipe "$W/recipe.json" --out "$W/art.json" --artifact "$W/art.json"; }

# 1. v1 snapshot builds; the result equals the committed artifact (same defaults, same envelope); recipe records the digest.
fresh_recipe
b build --from-snapshot "$SNAP1" >"$W/o1" 2>&1; assert_exit_code "$?" "0" "build --from-snapshot (v1) succeeds"
assert_eq "$(cmp -s "$W/art.json" "$ARTIFACT" && echo same || echo differ)" "same" "snapshot-derived artifact is byte-equal to the artifact the snapshot wraps"
WANT_DIGEST="$(sha256sum "$SNAP1" | cut -d' ' -f1)"
GOT="$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1]));process.stdout.write([r.snapshot.digest,r.snapshot.generated_at,r.snapshot.feed_schema].join(" "))' "$W/recipe.json")"
assert_eq "$GOT" "$WANT_DIGEST 2026-10-10T00:00:00Z model-dyno.qualification-feed.v1" "recipe records sha256 + generated_at + schema"

# 2. --check on the same snapshot is byte-identical; building twice gives identical bytes.
b --check --from-snapshot "$SNAP1" >/dev/null 2>&1; assert_exit_code "$?" "0" "--check --from-snapshot matches"
cp "$W/art.json" "$W/art1.json"; b build --from-snapshot "$SNAP1" >/dev/null 2>&1
assert_eq "$(cmp -s "$W/art.json" "$W/art1.json" && echo same || echo differ)" "same" "rebuild is byte-identical"

# 3. v2 snapshot (superset) is accepted too (a different digest, same artifact).
fresh_recipe
b build --from-snapshot "$SNAP2" >/dev/null 2>&1; assert_exit_code "$?" "0" "v2 snapshot builds"
assert_eq "$(cmp -s "$W/art.json" "$ARTIFACT" && echo same || echo differ)" "same" "v2 snapshot yields the same artifact"

# 4. NEGATIVE: a tampered snapshot (digest no longer the recorded one) fails --check.
fresh_recipe; b build --from-snapshot "$SNAP1" >/dev/null 2>&1
sed 's/"first_seen": "x"/"first_seen": "z"/' "$SNAP1" >"$W/tampered.json"
b --check --from-snapshot "$W/tampered.json" >"$W/o4" 2>&1; assert_exit_code "$?" "1" "tampered snapshot fails --check"
assert_contains "$(cat "$W/o4")" "snapshot digest mismatch" "tamper failure names the digest mismatch"
# NEGATIVE: a hand-edited artifact fails --check.
sed -i 's/"status": "failed"/"status": "qualified"/' "$W/art.json"
b --check --from-snapshot "$SNAP1" >/dev/null 2>&1; assert_exit_code "$?" "1" "hand-edited artifact fails --check from snapshot"
# NEGATIVE: recipe that records a snapshot cannot be checked without it.
b --check >"$W/o4b" 2>&1; assert_exit_code "$?" "1" "snapshot-recipe --check without --from-snapshot fails"

# 5. NEGATIVE: strict read — duplicate key, BOM, URL, missing generated_at, symlink.
printf '{"schema":"model-dyno.qualification-feed.v1","schema":"x"}' >"$W/dup.json"
fresh_recipe; b build --from-snapshot "$W/dup.json" >/dev/null 2>&1; assert_exit_code "$?" "1" "duplicate-key snapshot refused"
printf '\xef\xbb\xbf' >"$W/bom.json"; cat "$SNAP1" >>"$W/bom.json"
b build --from-snapshot "$W/bom.json" >/dev/null 2>&1; assert_exit_code "$?" "1" "BOM snapshot refused"
node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1]));delete d.generated_at;require("fs").writeFileSync(process.argv[2],JSON.stringify(d))' "$SNAP1" "$W/nogen.json"
b build --from-snapshot "$W/nogen.json" >/dev/null 2>&1; assert_exit_code "$?" "1" "snapshot without generated_at refused"
b build --from-snapshot "https://example.invalid/feed.json" >/dev/null 2>&1; assert_exit_code "$?" "2" "URL refused (usage)"
ln -sf "$SNAP1" "$W/link.json"; b build --from-snapshot "$W/link.json" >/dev/null 2>&1; assert_exit_code "$?" "1" "symlink snapshot refused"

# 6. Committed recipe is unchanged (legacy store path is covered by qualification-defaults.test.sh).
assert_eq "$(node -e 'process.stdout.write(String("snapshot" in JSON.parse(require("fs").readFileSync(process.argv[1]))))' "$RECIPE")" "false" "committed recipe records no snapshot"

# 7. Age gate: 31 days red, 29 days green, no snapshot green, future red.
NOW=2026-10-16T00:00:00Z
age() { node "$BUILD" --check-snapshot-age --recipe "$W/ar.json" --now "$NOW" >"$W/oa" 2>&1; }
setgen() { node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1]));r.snapshot={digest:"d",generated_at:process.argv[3],feed_schema:null};require("fs").writeFileSync(process.argv[2],JSON.stringify(r))' "$RECIPE" "$W/ar.json" "$1"; }
setgen 2026-09-15T00:00:00Z; age; assert_exit_code "$?" "1" "snapshot 31 days old fails"
setgen 2026-09-17T00:00:00Z; age; assert_exit_code "$?" "0" "snapshot 29 days old passes"
setgen 2026-11-01T00:00:00Z; age; assert_exit_code "$?" "1" "future generated_at fails"
setgen not-a-date; age; assert_exit_code "$?" "1" "malformed generated_at fails"
cp "$RECIPE" "$W/ar.json"; age; assert_exit_code "$?" "0" "no snapshot recorded: gate passes (legacy path)"

# 8. preflight runs the age check as a named check (wiring pin).
assert_contains "$(cat "$PREFLIGHT")" "build-qualification-defaults.js --check-snapshot-age" "preflight-release.sh invokes the snapshot age gate"
assert_contains "$(cat "$PREFLIGHT")" 'run_check "official defaults snapshot age' "preflight-release.sh registers it as a check"

finalize_test
