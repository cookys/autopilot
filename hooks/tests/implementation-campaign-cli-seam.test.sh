#!/usr/bin/env bash
# Seam test for the campaign-check CLI ↔ dispatch-hetero.sh boundary.
#
# Why this file exists: `campaign-dispatch-projection.test.sh` proves the
# projection helper binds an ICC v1 leaf identity, but it derives that identity
# INSIDE the fixture (`campaignIdFor(...)`) and hands it straight to
# `verifyCampaignDispatchUnit`. It therefore never crosses the one boundary that
# a real dispatch crosses: `dispatch-hetero.sh` shells out to
# `implementation-campaign-check.js check` and reads the identity back out of
# that CLI's JSON. Every field dropped at the CLI's emit projection is invisible
# to the whole suite — which is how the sealed-campaign rail came to be
# unreachable while every test stayed green.
#
# The field list is ENUMERATED FROM dispatch-hetero.sh, never hand-written: a
# hand-copied list silently stops covering the seam the moment the caller reads
# one more field.
. "$(dirname "$0")/lib.sh"

CHECKER="$REPO_ROOT/scripts/implementation-campaign-check.js"
HETERO="$REPO_ROOT/scripts/dispatch-hetero.sh"
SBX="$TEST_TMP/repo"

mkdir -p "$SBX"
git -C "$SBX" init -q
git -C "$SBX" config user.email "campaign-seam@example.invalid"
git -C "$SBX" config user.name "Campaign Seam Test"
mkdir -p "$SBX/.claude"
write_mission_governance "$SBX/.claude/owner-kernel-governance.json" shadow
printf 'first\n' > "$SBX/README.md"
git -C "$SBX" add README.md .claude/owner-kernel-governance.json
git -C "$SBX" commit -qm "first"

BASE_SHA="$(git -C "$SBX" rev-parse HEAD)"
COMMON_RAW="$(git -C "$SBX" rev-parse --git-common-dir)"
if [[ "$COMMON_RAW" = /* ]]; then
  COMMON_DIR="$(realpath "$COMMON_RAW")"
else
  COMMON_DIR="$(realpath "$SBX/$COMMON_RAW")"
fi
REPO_ID="git-common-dir:$COMMON_DIR"

# ---------------------------------------------------------------------------
# 1. Which fields does the caller actually read on its SUCCESS path?
#
# Keys read before the `verdict` extraction belong to the rc!=0 failure branch
# (`reasons`) and are deliberately excluded: the success-path contract is what a
# real dispatch depends on.
# ---------------------------------------------------------------------------
READ_KEYS="$(python3 - "$HETERO" <<'PY'
import re, sys
text = open(sys.argv[1], encoding="utf-8").read()
pat = re.compile(r'extract_json_value\s+"\$campaign_check_json"\s+([A-Za-z_][A-Za-z0-9_]*)')
hits = [(m.start(), m.group(1)) for m in pat.finditer(text)]
if not hits:
    sys.exit("no campaign_check_json reads found — parser is stale, not the caller")
start = next((off for off, key in hits if key == "verdict"), None)
if start is None:
    sys.exit("caller no longer extracts 'verdict' — success-path anchor is gone")
keys = []
for off, key in hits:
    if off >= start and key not in keys:
        keys.append(key)
print("\n".join(keys))
PY
)"
assert_neq "$READ_KEYS" "" "enumerated the caller's success-path field reads"
# Positive control: the anchor itself must be in the enumeration, otherwise the
# parser matched nothing meaningful and every assertion below would be vacuous.
assert_contains "$READ_KEYS" "verdict" "enumeration includes the success-path anchor"
assert_contains "$READ_KEYS" "campaign_id" "caller reads the campaign identity"

# ---------------------------------------------------------------------------
# 2. A sealed, non-strict campaign contract (mission_runtime absent).
# ---------------------------------------------------------------------------
write_contract() {
  node - "$1" "$REPO_ID" "$BASE_SHA" "${2:-plain}" <<'NODE'
const fs = require('fs');
const [target, repoIdentity, baseSha, variant] = process.argv.slice(2);
const value = {
  schema_version: 1,
  ticket: 'seam-p0',
  profile: 'poc',
  mission_grant_ref: null,
  repo_identity: repoIdentity,
  base_sha: baseSha,
  branch: 'impl/seam-p0',
  vertical_acceptance: ['one bounded vertical slice is verified'],
  allowed_path_prefixes: ['src/'],
  max_changed_files: 4,
  baseline_churn: 900,
  max_growth_ratio: 1.5,
  max_extra_churn: 450,
  max_repair_generations: 2,
  max_wall_seconds: 7200,
  verify_cmd: 'true',
  rubric_ids: ['R1'],
};
if (variant === 'strict') {
  value.mission_runtime = {
    schema_version: 1,
    root_run_id: 'seam-root-run',
    mission_lineage_id: `lineage-v1-${'1'.repeat(64)}`,
    mission_policy_digest: '2'.repeat(64),
    mission_graph_digest: '3'.repeat(64),
    graph_node_id: 'seam-node',
    graph_node_digest: '4'.repeat(64),
  };
  // The checker enforces cross-field equality between strict_dispatch and the
  // campaign envelope, so these mirror the top-level values exactly rather than
  // carrying independent (and rejected) numbers.
  value.strict_dispatch = {
    schema_version: 1,
    spec: { path: 'src/spec.md', section: 'Seam' },
    required_paths: ['src/spec.md'],
    output_paths: ['src/out.txt'],
    allowed_path_prefixes: value.allowed_path_prefixes,
    budget: {
      max_changed_files: value.max_changed_files,
      max_wall_seconds: value.max_wall_seconds,
      max_output_bytes: 4096,
      max_tool_calls: 10,
      max_engine_attempts: 2,
    },
    verification_commands: ['true'],
  };
}
fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
NODE
}

# Runs the checker and asserts rc, folding BOTH streams into the failure
# message. The checker reports rejections as JSON on stdout via emit(payload,3),
# so a stderr-only diagnostic reads as an empty reason and sends the next reader
# hunting for a cause that was printed all along.
run_checker_ok() {
  local label="$1" out="$2"; shift 2
  local err="$TEST_TMP/$(basename "$out").err" rc=0
  HOME="$HOOK_HOME" node "$CHECKER" "$@" >"$out" 2>"$err" || rc=$?
  if [ "$rc" -ne 0 ]; then
    label="$label [rc=$rc stdout: $(tr '\n' ' ' < "$out") stderr: $(tr '\n' ' ' < "$err")]"
  fi
  assert_exit_code "$rc" 0 "$label"
}

CONTRACT="$TEST_TMP/campaign.json"
SEAL="$TEST_TMP/campaign.seal.json"
write_contract "$CONTRACT" plain

run_checker_ok "seal a non-strict campaign contract" "$TEST_TMP/seal.out" \
  seal --contract "$CONTRACT" --repo "$SBX" --mission-mode shadow --out "$SEAL"
run_checker_ok "check the sealed campaign contract" "$TEST_TMP/check.json" \
  check --contract "$CONTRACT" --repo "$SBX" --mission-mode shadow --seal "$SEAL"
assert_contains "$(cat "$TEST_TMP/check.json")" '"verdict": "VALID"' "check verdict is VALID"

# ---------------------------------------------------------------------------
# 3. THE SEAM: every success-path field the caller reads must be emitted.
# ---------------------------------------------------------------------------
while IFS= read -r key; do
  [ -n "$key" ] || continue
  present="$(node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(Object.prototype.hasOwnProperty.call(data, process.argv[2]) ? "yes" : "no");
  ' "$TEST_TMP/check.json" "$key")"
  assert_eq "$present" "yes" "check CLI emits '$key' (read by dispatch-hetero.sh success path)"
done <<< "$READ_KEYS"

# ---------------------------------------------------------------------------
# 4. The emitted identity must be the ICC v1 leaf identity the caller demands,
#    compared against an INDEPENDENTLY computed value — not merely a regex.
#    A regex-only assertion would pass on any well-formed but wrong digest.
# ---------------------------------------------------------------------------
EXPECTED_ICC="$(node - "$REPO_ROOT" "$REPO_ID" "$CONTRACT" <<'NODE'
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const [root, repoIdentity, contractPath] = process.argv.slice(2);
const { campaignIdFor } = require(path.join(root, 'src', 'engine', 'implementation-campaign'));
const bytes = fs.readFileSync(contractPath);
const digest = crypto.createHash('sha256').update(bytes).digest('hex');
const value = JSON.parse(bytes.toString('utf8'));
process.stdout.write(campaignIdFor(repoIdentity, value.ticket, digest));
NODE
)"
assert_contains "$EXPECTED_ICC" "campaign-v1-" "fixture derives an ICC v1 identity to compare against"

EMITTED_ID="$(node -e '
  const fs = require("fs");
  const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(String(d.campaign_id === undefined ? "" : d.campaign_id));
' "$TEST_TMP/check.json")"
assert_eq "$EMITTED_ID" "$EXPECTED_ICC" \
  "check CLI emits the ICC v1 identity the caller's ^campaign-v1- guard requires"

EMITTED_MODE="$(node -e '
  const fs = require("fs");
  const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(String(d.mission_mode === undefined ? "" : d.mission_mode));
' "$TEST_TMP/check.json")"
assert_eq "$EMITTED_MODE" "shadow" "check CLI emits the authoritative mission mode"

# ---------------------------------------------------------------------------
# 5. strict_authority must reflect the contract, both ways. A single-direction
#    assertion would pass against a hardcoded constant.
# ---------------------------------------------------------------------------
read_bool() {
  node -e '
    const fs = require("fs");
    const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(String(d.strict_authority));
  ' "$1"
}
assert_eq "$(read_bool "$TEST_TMP/check.json")" "false" \
  "strict_authority is false without mission_runtime/strict_dispatch"

STRICT_CONTRACT="$TEST_TMP/campaign-strict.json"
STRICT_SEAL="$TEST_TMP/campaign-strict.seal.json"
write_contract "$STRICT_CONTRACT" strict
run_checker_ok "seal a strict-authority campaign contract" "$TEST_TMP/seal2.out" \
  seal --contract "$STRICT_CONTRACT" --repo "$SBX" --mission-mode shadow --out "$STRICT_SEAL"
run_checker_ok "check the strict-authority campaign contract" "$TEST_TMP/check-strict.json" \
  check --contract "$STRICT_CONTRACT" --repo "$SBX" --mission-mode shadow --seal "$STRICT_SEAL"
assert_eq "$(read_bool "$TEST_TMP/check-strict.json")" "true" \
  "strict_authority is true with mission_runtime + strict_dispatch"

finalize_test
