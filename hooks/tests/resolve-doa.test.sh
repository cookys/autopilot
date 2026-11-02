#!/usr/bin/env bash
# resolve-doa.sh integration test — exercises preset selection, fail-closed
#
# RED at base 826236659845aa64603cd614e94a8f4512553336:
#   FAIL [resolve-doa] CHANGE-PINNING: foreign cwd uses code-embedded preset, not plugin .claude/: '"preset":"cloud-high-trust"' not found in output
#   FAIL [resolve-doa] CHANGE-PINNING: foreign cwd source=default: '"source":"default"' not found in output
# behaviour, project-override config, and malformed-override resilience.
# Uses the PATH-stub pattern from lib.sh; no network required.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/resolve-doa.sh"

# Wrapper: run script with DOA_CONFIG_OVERRIDE pointing at a temp config file
run_doa() {
  DOA_CONFIG_OVERRIDE="${OVERRIDE_FILE:-/dev/null/nonexistent}" \
    bash "$SCRIPT" "$@" 2>&1
}

# ── 1. --help exits 0 and mentions the presets ─────────────────────────────
HELP_OUT="$(bash "$SCRIPT" --help 2>&1)"; HELP_EXIT=$?
assert_eq "0" "$HELP_EXIT"         "--help exit code"
assert_contains "$HELP_OUT" "DOA"  "--help mentions DOA"

# ── 2. Missing required args → exit 2 ───────────────────────────────────────
OUT="$(bash "$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT"                     "no args exit code"
assert_contains "$OUT" "missing --role"   "no args error message"

OUT="$(bash "$SCRIPT" --role implementer 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT"                     "missing --tier exit code"
assert_contains "$OUT" "missing --tier"   "missing --tier error message"

OUT="$(bash "$SCRIPT" --tier sonnet 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT"                     "missing --role exit code"
assert_contains "$OUT" "missing --role"   "missing --role error message"

# ── 3. Unknown flag → exit 2 ────────────────────────────────────────────────
OUT="$(bash "$SCRIPT" --bogus foo 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT"              "unknown flag exit code"
assert_contains "$OUT" "unknown arg" "unknown flag error message"

# ── 4. cloud-high-trust: (implementer, sonnet) ──────────────────────────────
OUT="$(run_doa --role implementer --tier sonnet)"; EXIT=$?
assert_eq "0" "$EXIT"                         "implementer/sonnet exit code"
assert_contains "$OUT" '"preset":"cloud-high-trust"'   "implementer/sonnet preset"
assert_contains "$OUT" '"read_only":"autonomous"'       "implementer/sonnet read_only"
assert_contains "$OUT" '"reversible":"autonomous"'      "implementer/sonnet reversible"
assert_contains "$OUT" '"external":"logged"'            "implementer/sonnet external"
assert_contains "$OUT" '"irreversible":"escalate"'      "implementer/sonnet irreversible"
assert_contains "$OUT" '"source":"default"'             "implementer/sonnet source"

# ── 5. cloud-high-trust: fable-tier ─────────────────────────────────────────
OUT="$(run_doa --role manager --tier fable)"; EXIT=$?
assert_eq "0" "$EXIT"                                 "manager/fable exit code"
assert_contains "$OUT" '"preset":"cloud-high-trust"'  "manager/fable preset"
assert_contains "$OUT" '"external":"logged"'          "manager/fable external=logged"

# ── 6. cloud-high-trust: opus-tier ──────────────────────────────────────────
OUT="$(run_doa --role sub-orchestrator --tier opus)"; EXIT=$?
assert_eq "0" "$EXIT"                                   "sub-orchestrator/opus exit code"
assert_contains "$OUT" '"preset":"cloud-high-trust"'    "sub-orchestrator/opus preset"

# ── 7. local-low-trust: (judge, flash) ──────────────────────────────────────
OUT="$(run_doa --role judge --tier flash)"; EXIT=$?
assert_eq "0" "$EXIT"                                 "judge/flash exit code"
assert_contains "$OUT" '"preset":"local-low-trust"'   "judge/flash preset"
assert_contains "$OUT" '"read_only":"autonomous"'     "judge/flash read_only=autonomous"
assert_contains "$OUT" '"reversible":"escalate"'      "judge/flash reversible=escalate"
assert_contains "$OUT" '"external":"escalate"'        "judge/flash external=escalate"
assert_contains "$OUT" '"irreversible":"escalate"'    "judge/flash irreversible=escalate"
assert_contains "$OUT" '"source":"default"'           "judge/flash source=default"

# ── 8. local-low-trust: haiku-tier ──────────────────────────────────────────
OUT="$(run_doa --role synthesizer --tier haiku)"; EXIT=$?
assert_eq "0" "$EXIT"                               "synthesizer/haiku exit code"
assert_contains "$OUT" '"preset":"local-low-trust"' "synthesizer/haiku preset"

# ── 9. Fail-closed: unknown tier → all escalate ─────────────────────────────
OUT="$(run_doa --role implementer --tier unknowntier)"; EXIT=$?
assert_eq "0" "$EXIT"                                   "unknown tier exit code (0, not crash)"
assert_contains "$OUT" '"preset":"fail-closed-default"' "unknown tier preset=fail-closed"
assert_contains "$OUT" '"read_only":"escalate"'         "unknown tier read_only=escalate"
assert_contains "$OUT" '"reversible":"escalate"'        "unknown tier reversible=escalate"
assert_contains "$OUT" '"external":"escalate"'          "unknown tier external=escalate"
assert_contains "$OUT" '"irreversible":"escalate"'      "unknown tier irreversible=escalate"
assert_contains "$OUT" '"source":"fail-closed-default"' "unknown tier source=fail-closed-default"

# ── 10. Fail-closed: unknown role with known tier ───────────────────────────
# Spec: "unknown role or unknown tier → escalate-by-default"
# Unknown role (even with a known tier) → fail-closed.
OUT="$(run_doa --role unknownrole --tier sonnet)"; EXIT=$?
assert_eq "0" "$EXIT"                                    "unknown role/known tier exit code"
assert_contains "$OUT" '"preset":"fail-closed-default"'  "unknown role/known tier preset"
assert_contains "$OUT" '"source":"fail-closed-default"'  "unknown role/known tier source"
assert_contains "$OUT" '"read_only":"escalate"'          "unknown role/known tier read_only=escalate"

# Unknown role + unknown tier → also fail-closed
OUT="$(run_doa --role unknownrole --tier unknowntier)"; EXIT=$?
assert_eq "0" "$EXIT"                                    "unknown role/tier exit code"
assert_contains "$OUT" '"preset":"fail-closed-default"'  "unknown role/tier preset"
assert_contains "$OUT" '"source":"fail-closed-default"'  "unknown role/tier source"

# ── 11. Positional args (role tier) work the same as flags ──────────────────
OUT="$(run_doa implementer sonnet)"; EXIT=$?
assert_eq "0" "$EXIT"                                  "positional args exit code"
assert_contains "$OUT" '"preset":"cloud-high-trust"'   "positional args preset"
assert_contains "$OUT" '"role":"implementer"'          "positional args role in JSON"
assert_contains "$OUT" '"model_tier":"sonnet"'         "positional args tier in JSON"

# ── 12. Project override config: honored ────────────────────────────────────
OVERRIDE_DIR="$TEST_TMP/project-override"
mkdir -p "$OVERRIDE_DIR"
OVERRIDE_FILE="$OVERRIDE_DIR/doa-config.md"
cat > "$OVERRIDE_FILE" <<'CFGEOF'
# Test override config
## Project Override

| Role | Model tier | Preset |
|------|-----------|--------|
| implementer | sonnet | local-low-trust |
CFGEOF

OUT="$(run_doa --role implementer --tier sonnet)"; EXIT=$?
assert_eq "0" "$EXIT"                                 "override: exit code"
assert_contains "$OUT" '"preset":"local-low-trust"'  "override: preset honoured"
assert_contains "$OUT" '"source":"project"'           "override: source=project"
# Non-overridden pair falls back to default
OUT="$(run_doa --role judge --tier flash)"; EXIT=$?
assert_contains "$OUT" '"source":"default"'           "override: non-overridden falls back to default"
unset OVERRIDE_FILE

# ── 13. Malformed override → fail-closed, not crash ─────────────────────────
MALFORMED_FILE="$TEST_TMP/malformed-doa.md"
cat > "$MALFORMED_FILE" <<'BEOF'
this file has no pipe-table rows at all
just random text with | half | pipes
BEOF

OUT="$(OVERRIDE_FILE="$MALFORMED_FILE" DOA_CONFIG_OVERRIDE="$MALFORMED_FILE" \
  bash "$SCRIPT" --role implementer --tier sonnet 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "malformed override: exit code (no crash)"
# Malformed file has no matching row → falls through to default tier mapping
assert_contains "$OUT" '"preset":"cloud-high-trust"' "malformed override: falls back to default"

# ── 14. Project override with unknown preset name → fail-closed ─────────────
BAD_PRESET_FILE="$TEST_TMP/bad-preset-doa.md"
cat > "$BAD_PRESET_FILE" <<'BPEOF'
## Project Override

| Role | Model tier | Preset |
|------|-----------|--------|
| implementer | sonnet | made-up-preset |
BPEOF

OUT="$(DOA_CONFIG_OVERRIDE="$BAD_PRESET_FILE" \
  bash "$SCRIPT" --role implementer --tier sonnet 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT"                                   "bad preset name: exit code (no crash)"
assert_contains "$OUT" '"preset":"fail-closed-default"' "bad preset name: fail-closed"
assert_contains "$OUT" '"source":"fail-closed-default"' "bad preset name: source=fail-closed-default"

# ── 14b. cwd resolution — $PWD/.claude/doa-config.md read when no env override ─
# Plugin-usage path: REPO_ROOT is the install dir, so the CONSUMING project's
# config must be found via cwd. Run with DOA_CONFIG_OVERRIDE unset, cd'd into a
# temp project that has its own .claude/doa-config.md.
CWD_PROJ="$TEST_TMP/cwd-proj"
mkdir -p "$CWD_PROJ/.claude"
cat > "$CWD_PROJ/.claude/doa-config.md" <<'CWDEOF'
## Project Override

| Role | Model tier | Preset |
|------|-----------|--------|
| implementer | sonnet | local-low-trust |
CWDEOF

OUT="$(cd "$CWD_PROJ" && env -u DOA_CONFIG_OVERRIDE bash "$SCRIPT" --role implementer --tier sonnet 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT"                                "cwd resolution: exit code"
assert_contains "$OUT" '"preset":"local-low-trust"'  "cwd resolution: project config honoured"
assert_contains "$OUT" '"source":"project"'          "cwd resolution: source=project"

# Negative: cwd has no .claude/doa-config.md → falls through to default mapping
NO_CFG_DIR="$TEST_TMP/cwd-no-config"
mkdir -p "$NO_CFG_DIR"
OUT="$(cd "$NO_CFG_DIR" && env -u DOA_CONFIG_OVERRIDE bash "$SCRIPT" --role implementer --tier sonnet 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT"                                 "cwd resolution (no config): exit code"
assert_contains "$OUT" '"source":"default"'           "cwd resolution (no config): falls back to default"

# CHANGE-PINNING foreign-repo negative (RED at base). Distinctive plugin-tree
# .claude/doa-config.md under TEST_TMP (do not write the real repo's .claude/).
# RED at base 826236659845aa64603cd614e94a8f4512553336: recorded after first run.
DOA_PLUGIN="$TEST_TMP/doa-plugin-tree"
mkdir -p "$DOA_PLUGIN/scripts" "$DOA_PLUGIN/.claude"
cp "$SCRIPT" "$DOA_PLUGIN/scripts/resolve-doa.sh"
cat > "$DOA_PLUGIN/.claude/doa-config.md" <<'DOAEOF'
## Project Override

| Role | Model tier | Preset |
|------|-----------|--------|
| implementer | sonnet | local-low-trust |
DOAEOF
DOA_FOREIGN="$TEST_TMP/doa-foreign-git"
mkdir -p "$DOA_FOREIGN"
git -C "$DOA_FOREIGN" init -q
OUT="$(cd "$DOA_FOREIGN" && env -u DOA_CONFIG_OVERRIDE bash "$DOA_PLUGIN/scripts/resolve-doa.sh" --role implementer --tier sonnet 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "CHANGE-PINNING: foreign cwd + plugin .claude/doa: exit 0"
assert_contains "$OUT" '"preset":"cloud-high-trust"' "CHANGE-PINNING: foreign cwd uses code-embedded preset, not plugin .claude/"
assert_contains "$OUT" '"source":"default"' "CHANGE-PINNING: foreign cwd source=default"

# ── 15. Input sanitization — shell-special chars rejected with exit 2 ──────
# Pipe in role value: 'implementer|judge' should not match the grep -iE pattern
OUT="$(bash "$SCRIPT" --role 'implementer|judge' --tier sonnet 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT"                                      "sanitize: pipe-in-role exits 2"
assert_contains "$OUT" "invalid --role"                    "sanitize: pipe-in-role error message"

# Wildcard in role: '.*' is a valid regex meta-char; must be rejected
OUT="$(bash "$SCRIPT" --role '.*' --tier sonnet 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT"                                      "sanitize: wildcard-role exits 2"
assert_contains "$OUT" "invalid --role"                    "sanitize: wildcard-role error message"

# Pipe in tier value
OUT="$(bash "$SCRIPT" --role implementer --tier 'sonnet|haiku' 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT"                                      "sanitize: pipe-in-tier exits 2"
assert_contains "$OUT" "invalid --tier"                    "sanitize: pipe-in-tier error message"

# Clean valid inputs still work (regression check)
OUT="$(run_doa --role implementer --tier sonnet)"; EXIT=$?
assert_eq "0" "$EXIT"                                      "sanitize: clean input still works"
assert_contains "$OUT" '"preset":"cloud-high-trust"'       "sanitize: clean input correct preset"

# ── 16. --target: production class (operator-console A2) ────────────────────
# RED when the production judgment is removed: (a) production_denied/exit 10 cases fail;
# RED when $DOA_CONFIG_OVERRIDE may read the Target table: (f) override cases fail.
PROD_REPO="$TEST_TMP/prod-repo"; mkdir -p "$PROD_REPO/.claude"; git -C "$PROD_REPO" init -q
cat > "$PROD_REPO/.claude/doa-config.md" <<'CFG'
# DOA

## Production Targets

| Target | Class |
|--------|-------|
| example-prod | production |
| example-staging | staging |
| both-ways | staging |
| both-ways | production |

## Other
CFG
tgt() { (cd "$PROD_REPO" && env -u DOA_CONFIG_OVERRIDE bash "$SCRIPT" --role implementer --tier sonnet "$@" 2>&1); }

# (a) listed production target
OUT="$(tgt --target example-prod)"; EXIT=$?
assert_eq "10" "$EXIT" "(a) production target: exit 10"
assert_contains "$OUT" '"decision":"production_denied"' "(a) production target: production_denied"
assert_not_contains "$OUT" '"actions"' "(a) production target: no action table (refused, not escalated)"
# duplicate name with conflicting classes: the strictest wins
OUT="$(tgt --target both-ways)"; EXIT=$?
assert_eq "10" "$EXIT" "(a) conflicting duplicate rows: production wins"
# (c) unlisted target fails closed, with a code distinct from production_denied
OUT="$(tgt --target not-on-the-list)"; EXIT=$?
assert_eq "11" "$EXIT" "(c) unlisted target: exit 11"
assert_contains "$OUT" '"decision":"target_unlisted"' "(c) unlisted target: target_unlisted"
assert_not_contains "$OUT" 'production_denied' "(c) unlisted is distinguishable from production_denied"
OUT="$(tgt --target Example-Prod)"; EXIT=$?
assert_eq "11" "$EXIT" "(c) names are exact: wrong case is unlisted"
OUT="$(tgt --target 'example-*')"; EXIT=$?
assert_eq "11" "$EXIT" "(c) no glob: wildcard is not a name"
OUT="$(tgt --target '')"; EXIT=$?
assert_eq "11" "$EXIT" "(c) empty target fails closed"
# (d) staging == the existing class (same bytes as a call without --target)
STG="$(tgt --target example-staging)"; STG_EXIT=$?
NOT="$(tgt)"; NOT_EXIT=$?
assert_eq "0" "$STG_EXIT" "(d) staging: exit 0"
assert_eq "$NOT" "$STG" "(d) staging output is byte-identical to the no-target result"
# no config file / no section at all: fail closed
NOCFG="$TEST_TMP/nocfg-repo"; mkdir -p "$NOCFG"; git -C "$NOCFG" init -q
OUT="$(cd "$NOCFG" && env -u DOA_CONFIG_OVERRIDE bash "$SCRIPT" --role implementer --tier sonnet --target example-staging 2>&1)"; EXIT=$?
assert_eq "11" "$EXIT" "(c) no config in the repo: fail closed"
# (g) malformed table: fail closed, even for a name that parses as staging
for bad in '| example-prod | prodution |' '| example-prod | production | extra |' '| example prod | production |'; do
  BADREPO="$TEST_TMP/bad-repo"; rm -rf "$BADREPO"; mkdir -p "$BADREPO/.claude"; git -C "$BADREPO" init -q
  printf '## Production Targets\n\n| Target | Class |\n|---|---|\n%s\n| example-staging | staging |\n' "$bad" > "$BADREPO/.claude/doa-config.md"
  OUT="$(cd "$BADREPO" && env -u DOA_CONFIG_OVERRIDE bash "$SCRIPT" --role implementer --tier sonnet --target example-staging 2>&1)"; EXIT=$?
  assert_eq "11" "$EXIT" "(g) malformed row [$bad]: fail closed"
  assert_contains "$OUT" 'malformed' "(g) malformed row [$bad]: reason says malformed"
done
# (f) $DOA_CONFIG_OVERRIDE can never relax the table
O1="$TEST_TMP/ov-relax.md"; printf '## Production Targets\n\n| Target | Class |\n|---|---|\n| example-prod | staging |\n' > "$O1"
O2="$TEST_TMP/ov-empty.md"; printf '| Role | Model tier | Preset |\n|---|---|---|\n| implementer | sonnet | cloud-high-trust |\n' > "$O2"
for ov in "$O1" "$O2" /dev/null/nonexistent; do
  OUT="$(cd "$PROD_REPO" && DOA_CONFIG_OVERRIDE="$ov" bash "$SCRIPT" --role implementer --tier sonnet --target example-prod 2>&1)"; EXIT=$?
  assert_eq "10" "$EXIT" "(f) override [$ov] cannot relax production"
  assert_contains "$OUT" 'production_denied' "(f) override [$ov]: still production_denied"
done
# the override cannot ADD a staging name either
OUT="$(cd "$PROD_REPO" && DOA_CONFIG_OVERRIDE="$O1" bash "$SCRIPT" --role implementer --tier sonnet --target only-in-override 2>&1)"; EXIT=$?
assert_eq "11" "$EXIT" "(f) a target only the override lists stays unlisted"
# --target without a value is a usage error
OUT="$(bash "$SCRIPT" --role implementer --tier sonnet --target 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "--target without a value: exit 2"
# the repo's own committed config lists the production section (shipped file is parseable)
OUT="$(cd "$REPO_ROOT" && env -u DOA_CONFIG_OVERRIDE bash "$SCRIPT" --role implementer --tier sonnet --target example-prod 2>&1)"; EXIT=$?
assert_eq "10" "$EXIT" "repo's own .claude/doa-config.md lists example-prod as production"

# (e) no --target: byte-identical to the pre-change script (develop version), stdout+stderr+exit
BASE_SCRIPT="$TEST_TMP/resolve-doa.base.sh"
if git -C "$REPO_ROOT" show 39c180e35:scripts/resolve-doa.sh > "$BASE_SCRIPT" 2>/dev/null; then
  mkdir -p "$TEST_TMP/base/scripts"; cp "$BASE_SCRIPT" "$TEST_TMP/base/scripts/resolve-doa.sh"
  cmp_one() {
    local a b
    a="$(cd "$PROD_REPO" && env -u DOA_CONFIG_OVERRIDE bash "$SCRIPT" "$@" 2>&1; echo "rc=$?")"
    b="$(cd "$PROD_REPO" && env -u DOA_CONFIG_OVERRIDE bash "$TEST_TMP/base/scripts/resolve-doa.sh" "$@" 2>&1; echo "rc=$?")"
    assert_eq "$b" "$a" "(e) no --target, byte-identical to base: $*"
  }
  cmp_one --role implementer --tier sonnet
  cmp_one --role manager --tier haiku
  cmp_one --role bogus --tier sonnet
  cmp_one --role implementer --tier mystery
  cmp_one implementer sonnet
  cmp_one --role 'a|b' --tier sonnet
  cmp_one --help
  cmp_one --bogus
  cmp_one
else
  echo "SKIP (e): base commit not available in this checkout"
fi

finalize_test
