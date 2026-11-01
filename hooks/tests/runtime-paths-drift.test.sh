#!/usr/bin/env bash
# runtime-paths-drift.test.sh -- the dispatch-runs directory name lives in ONE place (BL-0336 U1, plan A "防漂移").
#
# The literal directory name may appear only in scripts/lib/runtime-paths.js, in tests, and in documentation. Every other
# file must ask runtime-paths.js (Node) or `node scripts/lib/runtime-paths.js runs-dir [--ensure]` (shell) for the path, so a
# fix to its trust rules reaches every caller. Allowed besides those:
#   - scripts/lib/tmp-residue-registry.json (+ its codex mirror): DATA the residue reaper reads to know which on-disk names are ours;
#     it cannot import a JS constant, and runtime-paths.test.js pins RUNS_DIR_NAME to it.
#   - evals/ (frozen eval packs, copies of old plugin snapshots) and platforms/ (generated mirror of the files above, checked for
#     drift by sync-codex-plugin-skills.sh --check).
# Negative control: a literal planted in a copy of a dispatch script (in a scratch git repo) is reported.
. "$(dirname "$0")/lib.sh"

NAME="autopilot-dispatch-runs"

# drift_hits <git work tree> -> prints offending "path:line" lines
drift_hits() {
  (cd "$1" && git ls-files -co --exclude-standard -z \
    | xargs -0 grep -nI -- "$NAME" 2> /dev/null \
    | grep -vE '^(evals/|platforms/|docs/|hooks/tests/)|^(scripts/lib/runtime-paths\.js|scripts/lib/tmp-residue-registry\.json|CHANGELOG\.md):|^[^:]*\.test\.(js|sh|ts):|^[^:]*\.md:' \
    || true)
}

hits="$(drift_hits "$REPO_ROOT")"
assert_eq "$hits" "" "no source file outside the allowed set spells out the runs directory name${hits:+: $hits}"

# the registry name is the module's constant
reg="$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1]+"/scripts/lib/tmp-residue-registry.json","utf8"));process.stdout.write(JSON.stringify(j).includes(process.argv[2])?"yes":"no")' "$REPO_ROOT" "$NAME")"
const_ok="$(node -e 'process.stdout.write(require(process.argv[1]+"/scripts/lib/runtime-paths.js").RUNS_DIR_NAME)' "$REPO_ROOT")"
assert_eq "$const_ok" "$NAME" "runtime-paths.js RUNS_DIR_NAME is the name the registry and this audit use"
assert_eq "$reg" "yes" "the residue registry names the same directory"

# negative control: plant the literal in a copy of a dispatch script
SCRATCH="$TEST_TMP/drift"
mkdir -p "$SCRATCH/scripts/lib"
git -C "$SCRATCH" init -q
cp "$REPO_ROOT/scripts/dispatch-author.sh" "$SCRATCH/scripts/dispatch-author.sh"
cp "$REPO_ROOT/scripts/lib/runtime-paths.js" "$SCRATCH/scripts/lib/runtime-paths.js"
assert_eq "$(drift_hits "$SCRATCH")" "" "control: the unmodified copy is clean"
printf '\ndir="${TMPDIR:-/tmp}/%s"\n' "$NAME" >> "$SCRATCH/scripts/dispatch-author.sh"
planted="$(drift_hits "$SCRATCH")"
assert_contains "$planted" "scripts/dispatch-author.sh" "negative control: a planted literal in a dispatch script is reported"

finalize_test
