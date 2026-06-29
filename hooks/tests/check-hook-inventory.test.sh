#!/usr/bin/env bash
# check-hook-inventory.js test — green path + COUNT and MEMBERSHIP drift detection.
#
# Sandbox pattern (the script resolves REPO via dirname/.. → the sandbox): copy the
# script + every file it reads (wiring sources + the docs it audits) into a mirror
# tree, then mutate copies for negatives. The headline case is #4: a *disabled* hook
# planted in the Tier-A table while every count still looks right — the exact
# count-blind class this guard exists to catch.
. "$(dirname "$0")/lib.sh"

SBX="$TEST_TMP/repo"
mkdir -p "$SBX/scripts" "$SBX/hooks" "$SBX/.claude-plugin"

cp "$REPO_ROOT/scripts/check-hook-inventory.js" "$SBX/scripts/"
# wiring sources (the derivation inputs)
cp "$REPO_ROOT/hooks/hooks.json"      "$SBX/hooks/hooks.json"
cp "$REPO_ROOT/hooks/opt-in-manifest.json" "$SBX/hooks/opt-in-manifest.json"  # opt-in tier source (v2.26.2+)
cp "$REPO_ROOT/settings.example.json" "$SBX/settings.example.json"
cp "$REPO_ROOT"/hooks/*.js "$SBX/hooks/" 2>/dev/null   # top-level only; NON_HOOK filter inside the script handles -lib/.test
cp "$REPO_ROOT"/hooks/*.sh "$SBX/hooks/" 2>/dev/null
# the docs it audits
cp "$REPO_ROOT/.claude-plugin/plugin.json"      "$SBX/.claude-plugin/plugin.json"
cp "$REPO_ROOT/.claude-plugin/marketplace.json" "$SBX/.claude-plugin/marketplace.json"
cp "$REPO_ROOT/plugin.json"     "$SBX/plugin.json"
cp "$REPO_ROOT/CLAUDE.md"       "$SBX/CLAUDE.md"
cp "$REPO_ROOT/README.md"       "$SBX/README.md"
cp "$REPO_ROOT/README.zh-TW.md" "$SBX/README.zh-TW.md"
cp "$REPO_ROOT/hooks/README.md" "$SBX/hooks/README.md"

SCRIPT="$SBX/scripts/check-hook-inventory.js"
restore() { cp "$REPO_ROOT/$1" "$SBX/$1"; }

# 1. clean mirror → exit 0 (positive)
OUT="$(node "$SCRIPT" --check 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "clean sandbox --check exit 0"
assert_contains "$OUT" "in sync" "clean sandbox reports in sync"

# 2. --help → exit 0
node "$SCRIPT" --help >/dev/null 2>&1
assert_eq "0" "$?" "--help exit 0"

# 3. default print = regeneration oracle (derived counts + real names)
OUT="$(node "$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "default print exit 0"
assert_contains "$OUT" "default-on (10)" "default print shows 10 default-on"
assert_contains "$OUT" "disabled   (0)" "default print shows 0 disabled"
assert_contains "$OUT" "audit-log" "default print lists a real wired hook"

# 4. MEMBERSHIP drift (headline class): swap a default-on hook OUT of the Tier-A
#    table for a non-default-on one (cost-tracker is opt-in since v2.25.2). Counts
#    elsewhere stay correct — only the membership check catches the gap (the
#    displaced default-on hook is now MISSING from Tier-A). As of v2.25.12 the asserted
#    hooks doc is hooks/README.md (README is now a slim onboarding page with no Tier
#    table); failure-escalation lives only inside the Tier-A block, so a global swap
#    cleanly evicts it from that block.
sed -i 's/failure-escalation/cost-tracker/g' "$SBX/hooks/README.md"
OUT="$(node "$SCRIPT" --check 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "membership drift exit 1"
assert_contains "$OUT" "failure-escalation" "membership drift names the displaced default-on hook"
assert_contains "$OUT" "Tier-A" "membership drift identifies the Tier-A placement"
restore "hooks/README.md"

# 5. COUNT drift: canonical default-on count wrong in the description
sed -i 's/10 default-on/11 default-on/' "$SBX/.claude-plugin/plugin.json"
OUT="$(node "$SCRIPT" --check 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "count drift exit 1"
assert_contains "$OUT" "defaultOn" "count drift names the field"
restore ".claude-plugin/plugin.json"

# 6. TIER-HEADER count drift in hooks/README.md
sed -i 's/Default-On (10 hooks)/Default-On (11 hooks)/' "$SBX/hooks/README.md"
OUT="$(node "$SCRIPT" --check 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "tier-header count drift exit 1"
assert_contains "$OUT" "hooks/README.md" "tier-header drift names the file"
restore "hooks/README.md"

# 7. TIER-B MEMBERSHIP drift (v2.25.12 — symmetric to case 4 for the opt-in tier):
#    rename an opt-in hook in hooks/README.md's Tier-B block. Counts stay correct;
#    only the Tier-B membership check catches the now-missing opt-in name.
sed -i 's/cost-tracker/ghost-hook/g' "$SBX/hooks/README.md"
OUT="$(node "$SCRIPT" --check 2>&1)"; EXIT=$?
assert_eq "1" "$EXIT" "tier-B membership drift exit 1"
assert_contains "$OUT" "cost-tracker" "tier-B membership drift names the missing opt-in hook"
assert_contains "$OUT" "Tier-B" "tier-B membership drift identifies the Tier-B placement"
restore "hooks/README.md"

# 8. post-restore clean re-check → exit 0 (restores held)
node "$SCRIPT" --check >/dev/null 2>&1
assert_eq "0" "$?" "post-restore clean --check exit 0"

finalize_test
