#!/usr/bin/env bash
# tmp-residue-registry.test.sh — scripts/lib/tmp-residue-registry.json is the single statement of
# which temp prefixes exist and who cleans them. This suite holds the registry and its readers
# honest:
#   - hooks/tests/lib/suite-residue-reap.sh's _SRR_PATTERNS equals the registry's test-lockgated
#     entries (parity), with a negative control on a mutated copy of the reaper;
#   - `tmp-residue.js patterns` emits only scratch/evidence (the age-deletable kinds);
#   - `tmp-residue.js new-since` labels each fresh entry with its kind (or `unregistered`),
#     --exclude-kind drops only the named kinds, --fail-on-entries exits 1 when entries remain.
. "$(dirname "$0")/lib.sh"

CLI="$REPO_ROOT/scripts/lib/tmp-residue.js"
REG="$REPO_ROOT/scripts/lib/tmp-residue-registry.json"
REAPER="$REPO_ROOT/hooks/tests/lib/suite-residue-reap.sh"

# Print the reaper's _SRR_PATTERNS, one per line, sorted (reads the file the way the gate will).
reaper_patterns() {
  bash -c 'source "$1" >/dev/null 2>&1; printf "%s\n" "${_SRR_PATTERNS[@]}"' _ "$1" | sort
}
registry_lockgated() {
  node -e '
    const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    console.log(d.entries.filter((e) => e.kind === "test-lockgated").map((e) => e.pattern).sort().join("\n"));
  ' "$REG"
}

# ── Case 1: parity on the real reaper ──
RP="$(reaper_patterns "$REAPER")"
GP="$(registry_lockgated)"
assert_eq "$RP" "$GP" "case1: _SRR_PATTERNS equals the registry's test-lockgated entries"
assert_contains "$RP" "apl1.*" "case1: apl1.* is lock-gated"
assert_contains "$RP" "apt.*" "case1: apt.* is lock-gated"

# ── Case 2: negative control — a reaper copy with one extra pattern must NOT match ──
MUT="$TEST_TMP/suite-residue-reap.mutated.sh"
sed "s#^  'apt\.\*'\$#  'apt.*'\n  'zz-extra-*'#" "$REAPER" >"$MUT"
RPM="$(reaper_patterns "$MUT")"
assert_contains "$RPM" "zz-extra-*" "case2: mutation actually changed the reaper's list (non-vacuous)"
if [ "$RPM" = "$GP" ]; then
  echo "FAIL case2: parity compare missed a reaper-only pattern" >&2
  exit 1
fi
echo "PASS case2: reaper-only pattern breaks parity"

# ── Case 3: registry shape ──
SHAPE="$(node -e '
  const { loadRegistry, KINDS } = require(process.argv[1]);
  const d = loadRegistry();
  const seen = new Set(d.entries.map((e) => e.kind));
  const missing = KINDS.filter((k) => !seen.has(k));
  const dup = d.entries.map((e) => e.pattern).filter((p, i, a) => a.indexOf(p) !== i);
  console.log(`missing=${missing.join(",")} dup=${dup.join(",")}`);
' "$CLI")"
assert_eq "$SHAPE" "missing= dup=" "case3: every kind is present, no duplicate patterns"

# ── Case 4: patterns emits only scratch/evidence ──
PAT="$(node "$CLI" patterns)"
ALLOWED="$(node -e '
  const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  console.log(d.entries.filter((e) => e.kind === "scratch" || e.kind === "evidence").map((e) => e.pattern).join("\n"));
' "$REG")"
assert_eq "$PAT" "$ALLOWED" "case4: patterns == scratch+evidence entries"
for forbidden in 'autopilot-foreman-runs' 'autopilot-dispatch-runs' 'hetero-*' 'apl1.*' '.autopilot-gc.lock' 'autopilot-verify-wt-*'; do
  if grep -qxF -- "$forbidden" <<<"$PAT"; then
    echo "FAIL case4: patterns emitted non-deletable kind: $forbidden" >&2
    exit 1
  fi
done
assert_contains "$PAT" "dispatch-review-*" "case4: scratch prefix present"
assert_contains "$PAT" "autopilot-kimi-raw-*" "case4: evidence prefix present"

# ── Case 5: new-since labelling, --exclude-kind, --fail-on-entries ──
FX="$TEST_TMP/fx"
mkdir -p "$FX"
STAMP="$TEST_TMP/stamp"
: >"$STAMP"
touch -d '-1 hour' "$STAMP"
mkdir "$FX/dispatch-review-abc123"            # scratch
mkdir "$FX/autopilot-dispatch-runs"           # live
: >"$FX/.autopilot-gc.lock"                   # lock
mkdir "$FX/apl1.Zz9"                          # test-lockgated
mkdir "$FX/never-heard-of-it.AbC"             # unregistered
mkdir "$FX/old-dir"; touch -d '-2 hour' "$FX/old-dir"   # older than the stamp: not listed
ln -s /nonexistent "$FX/link-new"             # unregistered symlink is reported too

OUT="$(node "$CLI" new-since --stamp "$STAMP" --tmpdir "$FX")"
assert_contains "$OUT" "scratch	dir	$FX/dispatch-review-abc123" "case5: scratch labelled"
assert_contains "$OUT" "live	dir	$FX/autopilot-dispatch-runs" "case5: live labelled"
assert_contains "$OUT" "lock	file	$FX/.autopilot-gc.lock" "case5: lock labelled"
assert_contains "$OUT" "test-lockgated	dir	$FX/apl1.Zz9" "case5: test-lockgated labelled"
assert_contains "$OUT" "unregistered	dir	$FX/never-heard-of-it.AbC" "case5: unregistered labelled"
assert_contains "$OUT" "unregistered	symlink	$FX/link-new" "case5: symlink reported"
assert_not_contains "$OUT" "old-dir" "case5: entry older than the stamp not listed"

OUT="$(node "$CLI" new-since --stamp "$STAMP" --tmpdir "$FX" --exclude-kind live,lock)"
assert_not_contains "$OUT" "autopilot-dispatch-runs" "case5: --exclude-kind live drops live"
assert_not_contains "$OUT" ".autopilot-gc.lock" "case5: --exclude-kind lock drops lock"
assert_contains "$OUT" "never-heard-of-it" "case5: unregistered survives --exclude-kind"
assert_contains "$OUT" "apl1.Zz9" "case5: test-lockgated survives --exclude-kind live,lock"

node "$CLI" new-since --stamp "$STAMP" --tmpdir "$FX" --exclude-kind live,lock --fail-on-entries >/dev/null
assert_eq "$?" "1" "case5: --fail-on-entries exits 1 while entries remain"

node "$CLI" new-since --stamp "$STAMP" --tmpdir "$FX" --exclude-kind live,lock,scratch,test-lockgated,unregistered --fail-on-entries >/dev/null
assert_eq "$?" "0" "case5: --fail-on-entries exits 0 once everything is excluded"

OUT="$(node "$CLI" new-since --stamp "$STAMP" --tmpdir "$FX" --exclude-path "$FX/never-heard-of-it.AbC" --exclude-path "$FX/link-new" --exclude-kind live,lock,scratch,test-lockgated --fail-on-entries)"
assert_eq "$?" "0" "case5: --exclude-path drops exact paths"

node "$CLI" bogus >/dev/null 2>&1
assert_eq "$?" "2" "case5: unknown subcommand is a usage error (exit 2)"

# ── Case 6: --exclude-source drops registry entries by their `source` label (session-hook counters) ──
: > "$FX/claude-tool-count-sessX"; : > "$FX/claude-intent-tool-count-sessX"; : > "$FX/claude-edited-sessX.txt"
OUT="$(node "$CLI" new-since --stamp "$STAMP" --tmpdir "$FX" --exclude-kind live,lock)"
assert_contains "$OUT" "claude-tool-count-sessX" "case6: without --exclude-source the session-hook counter is reported"
assert_contains "$OUT" "claude-edited-sessX.txt" "case6: claude-edited-* is a registered scratch entry"
OUT="$(node "$CLI" new-since --stamp "$STAMP" --tmpdir "$FX" --exclude-kind live,lock --exclude-source session-hook)"
assert_not_contains "$OUT" "claude-tool-count-sessX" "case6: --exclude-source session-hook drops claude-tool-count-*"
assert_not_contains "$OUT" "claude-intent-tool-count-sessX" "case6: ... and claude-intent-tool-count-*"
assert_not_contains "$OUT" "claude-edited-sessX.txt" "case6: ... and claude-edited-*"
assert_contains "$OUT" "dispatch-review-abc123" "case6: other scratch entries stay reported (only the named source is dropped)"
assert_contains "$OUT" "never-heard-of-it.AbC" "case6: unregistered entries stay reported"
OUT="$(node "$CLI" new-since --stamp "$STAMP" --tmpdir "$FX" --exclude-kind live,lock --exclude-source no-such-source)"
assert_contains "$OUT" "claude-tool-count-sessX" "case6: an unrelated source name drops nothing"

# ── Case 7: external /tmp/sessions is registered as live (never pruned) ──
mkdir "$FX/sessions"
OUT="$(node "$CLI" new-since --stamp "$STAMP" --tmpdir "$FX")"
assert_contains "$OUT" "live	dir	$FX/sessions" "case7: sessions is labelled kind live"
OUT="$(node "$CLI" new-since --stamp "$STAMP" --tmpdir "$FX" --exclude-kind live)"
assert_not_contains "$OUT" "$FX/sessions" "case7: --exclude-kind live drops sessions"

finalize_test "tmp-residue-registry"
