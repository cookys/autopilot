#!/usr/bin/env bash
# hooks/tests/check-stage-vocab.test.sh — scripts/check-stage-vocab.js fixtures (stage-graph plan, P1; report-only).
# A scratch tree (not a git repo -> directory-walk mode) holds one hit per category plus decoys that must not hit.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CHK="$REPO_ROOT/scripts/check-stage-vocab.js"
TEST_TMP=$(mktemp -d -t "check-stage-vocab-test-XXXXXX")
trap 'rm -rf "$TEST_TMP"' EXIT
PASS=0; FAILS=0
ok() { PASS=$((PASS+1)); echo "ok: $*"; }
bad() { FAILS=$((FAILS+1)); echo "FAIL: $*" >&2; }

R="$TEST_TMP/tree"
mkdir -p "$R/skills/dev-flow" "$R/skills/other" "$R/docs/plans" "$R/docs/projects/_archive/x" \
  "$R/evals/skill-onoff/packs/p" "$R/scripts" "$R/hooks/tests" "$R/node_modules/m"

# old stage ids (hits) and decoys
printf 'Run finish-flow L-5.2 then H-9.3 and S-scope-gate.\n' > "$R/skills/dev-flow/SKILL.md"
printf 'See step F.2 of finish-flow.\n' >> "$R/skills/dev-flow/SKILL.md"
printf 'Version 2.5 and section 3.1, HTML-5, L-50, v2.L-5x are fine. Plain S.1 outside flow context.\n' > "$R/skills/other/notes.md"
# size enum
printf -- '- **Effort**: Fix\n- **Effort**: H\n- **Effort**: M\n' > "$R/docs/BACKLOG.md"
printf -- '---\ndescription: Size a task (S/L/H/Fix) first\n---\n' > "$R/skills/other/SKILL.md"
# marker phase
printf 'node scripts/session-mode.js set --phase L-3\nconst x = { phase_set_at: 1 };\n' > "$R/scripts/uses-phase.js"
printf 'node check-phase-review-receipt.js --phase p1\n' > "$R/scripts/receipt-usage.md"
printf 'node scripts/session-mode.js set --phase L-3 # stage-vocab-allow\nnode scripts/session-mode.js set --phase L-4\n' > "$R/scripts/allow-token.js"
mkdir -p "$R/evals/skill-onoff/lib"; printf 'node scripts/session-mode.js set --phase L-3\n' > "$R/evals/skill-onoff/lib/p1w-markers.sh"
# owner U4 semantic check
# positives: phrasings that DESCRIBE U4 as the owner rung (one file each)
i=0
for t in 'U4 owner' 'U4 = owner' 'U4 (owner)' 'owner rung (U4)' 'owner (U4)' 'owner rung is U4' 'U4 is the owner' 'U4 · owner' 'U4 as owner'; do
  i=$((i+1)); printf 'Ladder: %s when everything fails.\n' "$t" > "$R/scripts/u4-pos-$i.md"
done
# negatives: U4 experiment next to U5 owner, and negated descriptions
printf 'U1 consult · U4 experiment (spike) · U5 owner.\n' > "$R/scripts/u4-neg-1.md"
printf 'U4 is NOT the owner rung; U5 is.\n' > "$R/scripts/u4-neg-2.md"
printf 'The probe never emits U4 as owner.\n' > "$R/scripts/u4-neg-3.md"
printf 'U4 experiment.\nThe owner stops here and U5 escalates.\n' > "$R/scripts/u4-neg-4.md"
printf 'U4 runs an experiment on a branch.\nIt is cheap and fast.\n' > "$R/scripts/u4-experiment.md"
# excluded paths: each carries a hit that must be ignored
for f in CHANGELOG.md docs/plans/p.md docs/projects/_archive/x/r.md evals/skill-onoff/packs/p/a.md node_modules/m/i.md; do
  printf 'L-5.2 and H-9 and phase_set_at\n' > "$R/$f"
done
printf 'U4 owner stop\n' > "$R/hooks/tests/mission-convergence.test.sh"

OUT="$TEST_TMP/out.json"
rc=0; node "$CHK" --root "$R" > "$OUT" 2>/dev/null || rc=$?
[ "$rc" -eq 0 ] && ok "scan exits 0 (report-only)" || bad "scan exit $rc"

q() { node -e '
const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const f = d.findings;
const has = (cat, file, match) => f.some((x) => x.category === cat && x.file === file && (!match || x.match === match));
const expr = process.argv[2];
console.log(eval(expr) ? "yes" : "no");
' "$OUT" "$1"; }
chk() { # name expr
  [ "$(q "$2")" = "yes" ] && ok "$1" || bad "$1"
}

chk "old stage L-5.2 detected" 'has("old_stage_id","skills/dev-flow/SKILL.md","L-5.2")'
chk "old stage H-9.3 detected" 'has("old_stage_id","skills/dev-flow/SKILL.md","H-9.3")'
chk "S-scope-gate detected" 'has("old_stage_id","skills/dev-flow/SKILL.md","S-scope-gate")'
chk "F.2 detected in flow context" 'has("old_stage_id","skills/dev-flow/SKILL.md","F.2")'
chk "decoys (semver, HTML-5, L-50, S.1 outside flow) not flagged" '!f.some((x) => x.file === "skills/other/notes.md")'
chk "Effort Fix detected" 'has("old_size_enum","docs/BACKLOG.md","Fix")'
chk "Effort H detected" 'has("old_size_enum","docs/BACKLOG.md","H")'
chk "Effort M not flagged" '!f.some((x) => x.file === "docs/BACKLOG.md" && x.text.includes("M"))'
chk "description H detected" 'f.some((x) => x.category === "old_size_enum" && x.file === "skills/other/SKILL.md")'
chk "phase_set_at detected" 'has("marker_phase","scripts/uses-phase.js","phase_set_at")'
chk "session-mode --phase detected" 'has("marker_phase","scripts/uses-phase.js","--phase")'
chk "allow token exempts only its own line" 'has("marker_phase","scripts/allow-token.js","--phase") && !f.some((x) => x.file === "scripts/allow-token.js" && x.category === "marker_phase" && x.line === 1)'
chk "frozen history path exempt from marker_phase" '!f.some((x) => x.file === "evals/skill-onoff/lib/p1w-markers.sh" && x.category === "marker_phase")'
chk "--phase of check-phase-review-receipt not flagged" '!f.some((x) => x.file === "scripts/receipt-usage.md")'
for n in 1 2 3 4 5 6 7 8 9; do chk "U4-as-owner phrasing $n flagged" "has(\"owner_u4\",\"scripts/u4-pos-$n.md\",\"U4\")"; done
for n in 1 2 3 4; do chk "U4 negative fixture $n not flagged" "!f.some((x) => x.file === \"scripts/u4-neg-$n.md\")"; done
chk "U4 experiment not flagged" '!f.some((x) => x.file === "scripts/u4-experiment.md")'
chk "U4 path exclusion (mission-convergence.test.sh)" '!f.some((x) => x.file === "hooks/tests/mission-convergence.test.sh")'
chk "excluded paths ignored" '!f.some((x) => /^(CHANGELOG\.md|docs\/plans\/|docs\/projects\/_archive\/|evals\/skill-onoff\/packs\/|node_modules\/)/.test(x.file))'
chk "counts present per category" '["old_stage_id","old_size_enum","marker_phase","owner_u4"].every((k) => Number.isInteger(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).counts[k]))'

# --- --repo consumer mode ---------------------------------------------------------
C="$TEST_TMP/consumer"; mkdir -p "$C/.claude" "$C/docs"
printf 'Merge during L-5.3 and quality at L-5.2.\n' > "$C/.claude/finish-flow-config.md"
printf -- '- **Effort**: Fix\n- **Effort**: H\n- **Effort**: L\n' > "$C/docs/BACKLOG.md"
printf 'L-5 in src is not scanned\n' > "$C/docs/other.md"
COUT="$TEST_TMP/repo.json"
rc=0; node "$CHK" --repo "$C" > "$COUT" 2>/dev/null || rc=$?
[ "$rc" -eq 0 ] && ok "--repo exits 0" || bad "--repo exit $rc"
node -e '
const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const f = d.findings;
const hint = (m, file) => (f.find((x) => x.match === m && x.file === file) || {}).hint;
const r = [
  d.mode === "repo",
  hint("L-5.3", ".claude/finish-flow-config.md") === "finish",
  hint("L-5.2", ".claude/finish-flow-config.md") === "qc-gate",
  hint("Fix", "docs/BACKLOG.md") === "S",
  hint("H", "docs/BACKLOG.md") === "S!",
  !f.some((x) => x.file === "docs/other.md"),
  f.length === 4,
];
console.log(r.every(Boolean) ? "yes" : "no " + JSON.stringify(r));
' "$COUT" > "$TEST_TMP/repo.verdict"
[ "$(cat "$TEST_TMP/repo.verdict")" = "yes" ] && ok "--repo hints and scope" || bad "--repo: $(cat "$TEST_TMP/repo.verdict")"

rc=0; node "$CHK" --bogus >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 2 ] && ok "unknown arg exits 2" || bad "unknown arg exit $rc"

echo "check-stage-vocab.test: pass=$PASS fail=$FAILS"
[ "$FAILS" -eq 0 ]
