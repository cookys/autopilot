#!/usr/bin/env bash
# qc-gate.test.sh — resolve-qc-gate.sh + .githooks/pre-push regression suite.
#
# Covers the anti-skip forcing function: config resolution + fail-closed enum +
# CSV-space normalization (the v2.22.0 review's fail-OPEN Major), and the hook's
# block/warn/off/trailer/artifact/docs-only/zero-SHA paths against a sandbox repo.
. "$(dirname "$0")/lib.sh"

RESOLVE="$REPO_ROOT/scripts/resolve-qc-gate.sh"
HOOK="$REPO_ROOT/.githooks/pre-push"
CFG="$TEST_TMP/cfg.md"

# ---- resolve-qc-gate.sh ----
printf -- '- mode: block\n- protected_paths: skills/,agents/\n- evidence: trailer\n' > "$CFG"
assert_eq "$(QC_GATE_CONFIG_OVERRIDE=$CFG "$RESOLVE" --field mode)" "block" "resolve: block"

printf -- '- mode: warn\n' > "$CFG"
assert_eq "$(QC_GATE_CONFIG_OVERRIDE=$CFG "$RESOLVE" --field mode)" "warn" "resolve: warn"

printf -- '- mode: chaos\n- evidence: telepathy\n' > "$CFG"
assert_eq "$(QC_GATE_CONFIG_OVERRIDE=$CFG "$RESOLVE" --field mode)" "block" "resolve: garbage mode → fail-closed block"
assert_eq "$(QC_GATE_CONFIG_OVERRIDE=$CFG "$RESOLVE" --field evidence)" "trailer" "resolve: garbage evidence → trailer"

# CSV normalization (the Major fail-OPEN fix): space-after-comma must not survive
printf -- '- protected_paths: skills/, agents/ , scripts/\n' > "$CFG"
assert_eq "$(QC_GATE_CONFIG_OVERRIDE=$CFG "$RESOLVE" --field protected_paths)" "skills/,agents/,scripts/" "resolve: CSV spaces normalized"

# no config readable → template/built-in default is block
assert_eq "$(QC_GATE_CONFIG_OVERRIDE=/nonexistent/nope.md "$RESOLVE" --field mode)" "block" "resolve: missing config → block"

# ---- pre-push hook (sandbox git repo) ----
SBX="$TEST_TMP/repo"
mkdir -p "$SBX/scripts" "$SBX/.githooks"
cp "$RESOLVE" "$SBX/scripts/resolve-qc-gate.sh"; chmod +x "$SBX/scripts/resolve-qc-gate.sh"
# resolve-qc-gate.sh sources its sibling libs (scripts/lib/{json-emit,resolve-config}.sh);
# the sandbox must replicate that layout or the source fails and the gate reads fail-open.
mkdir -p "$SBX/scripts/lib"
cp "$REPO_ROOT/scripts/lib/json-emit.sh" "$SBX/scripts/lib/json-emit.sh"
cp "$REPO_ROOT/scripts/lib/resolve-config.sh" "$SBX/scripts/lib/resolve-config.sh"
cp "$HOOK" "$SBX/.githooks/pre-push"; chmod +x "$SBX/.githooks/pre-push"
git -C "$SBX" init -q
git -C "$SBX" config user.email t@local; git -C "$SBX" config user.name t

commit() { # <path> <content> <msg...>
  local p="$1" c="$2"; shift 2
  mkdir -p "$SBX/$(dirname "$p")"; printf '%s\n' "$c" >> "$SBX/$p"
  git -C "$SBX" add -A; git -C "$SBX" commit -q -m "$*"
  git -C "$SBX" rev-parse HEAD
}
run_pre_push() { # <local_sha> <remote_sha> [config-override]
  local override="${3:-}"
  echo "refs/heads/main $1 refs/heads/main $2" | \
    ( cd "$SBX" && QC_GATE_CONFIG_OVERRIDE="$override" bash .githooks/pre-push 2>&1 )
}

BASE="$(commit README.md base "base commit")"

# T1: protected path, no trailer, block → exit 1
TIP="$(commit scripts/x.sh 'echo hi' 'touch scripts no trailer')"
printf -- '- mode: block\n- protected_paths: scripts/,skills/\n- evidence: trailer\n' > "$TEST_TMP/block.md"
OUT="$(run_pre_push "$TIP" "$BASE" "$TEST_TMP/block.md")"; EX=$?
assert_eq "$EX" "1" "hook: protected+no-trailer+block → exit 1"
assert_contains "$OUT" "without review evidence" "hook: block prints banner"

# T2: same range, warn → exit 0
printf -- '- mode: warn\n- protected_paths: scripts/\n' > "$TEST_TMP/warn.md"
OUT="$(run_pre_push "$TIP" "$BASE" "$TEST_TMP/warn.md")"; EX=$?
assert_eq "$EX" "0" "hook: warn → exit 0"
assert_contains "$OUT" "warn" "hook: warn names the mode"

# T3: off → exit 0
printf -- '- mode: off\n' > "$TEST_TMP/off.md"
OUT="$(run_pre_push "$TIP" "$BASE" "$TEST_TMP/off.md")"; EX=$?
assert_eq "$EX" "0" "hook: off → exit 0"

# T4: space-CSV config (the Major regression) still BLOCKS a protected change
printf -- '- mode: block\n- protected_paths: skills/, scripts/\n' > "$TEST_TMP/space.md"
OUT="$(run_pre_push "$TIP" "$BASE" "$TEST_TMP/space.md")"; EX=$?
assert_eq "$EX" "1" "hook: space-CSV still blocks protected (fail-OPEN regression)"

# T5: trailer present → exit 0
TIP2="$(commit scripts/y.sh 'echo y' "with verdict

QC-Verdict: PASS (reviewer test, 2026-06-23)")"
OUT="$(run_pre_push "$TIP2" "$TIP" "$TEST_TMP/block.md")"; EX=$?
assert_eq "$EX" "0" "hook: QC-Verdict trailer in range → exit 0"

# T6: docs-only range (no protected path) → exit 0
TIP3="$(commit CHANGELOG.md x 'docs only')"
OUT="$(run_pre_push "$TIP3" "$TIP2" "$TEST_TMP/block.md")"; EX=$?
assert_eq "$EX" "0" "hook: docs-only range → exit 0"

# T7: artifact evidence
TIP4="$(commit scripts/z.sh 'echo z' 'touch scripts again no trailer')"
printf -- '- mode: block\n- protected_paths: scripts/\n- evidence: artifact\n' > "$TEST_TMP/art.md"
OUT="$(run_pre_push "$TIP4" "$TIP3" "$TEST_TMP/art.md")"; EX=$?
assert_eq "$EX" "1" "hook: artifact mode, no artifact → block"
mkdir -p "$SBX/.qc"; : > "$SBX/.qc/${TIP4}.verdict.json"
OUT="$(run_pre_push "$TIP4" "$TIP3" "$TEST_TMP/art.md")"; EX=$?
assert_eq "$EX" "0" "hook: artifact present → exit 0"

# T8: branch-delete (local all-zero) → exit 0 (nothing to gate)
OUT="$(run_pre_push "0000000000000000000000000000000000000000" "$TIP4" "$TEST_TMP/block.md")"; EX=$?
assert_eq "$EX" "0" "hook: branch-delete (zero local) → exit 0"

finalize_test
