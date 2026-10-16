#!/usr/bin/env bash
# BL-0198: the strict /l5 provider policy (src/readiness/provider-bootstrap.js) must name the
# models the plugin ships as defaults, read from the shipped sources themselves, never from a
# literal list in this test:
#   openai  -> scripts/resolve-review-loop.sh DEF_REV_ENGINE
#   xai     -> scripts/resolve-review-loop.sh QC_ALL_CALIBRATED (the grok entry)
#   minimax -> scripts/resolve-review-loop.sh QC_ALL_CALIBRATED (the MiniMax-M3 review seat)
#   zhipu   -> references/official-qualification-defaults.json (highest-version GLM engine)
# Mechanism: the embedded check.js takes the policy file as argv[3]. It extracts the six
# `model:`/`family:` pairs by regex and compares each to the shipped model for that family
# (openai/zhipu/xai by lookup above; MiniMax by literal match on the entry `MiniMax-M3` in
# QC_ALL_CALIBRATED, so MiniMax-M3.1-* never satisfies a review seat).
# Negative control: the check is re-run on a copy of provider-bootstrap.js with one model
# reverted to its pre-2026-10-16 name (GLM-5.2, gpt-5.6-sol, grok-4.5); each must report DRIFT.
#
# Second half (probe driver binding): the node generator embedded in
# scripts/probe-harness-capabilities.sh is run with fake env. The D4 provider rows must bind to
# canonical-roster.json via D4_ROSTER_SHA; the D2 agy telemetry rows must keep their agy://
# locator and AGY_HELP_SHA. Negative control: a copy that makes D2 share the D4 locator is flagged.
. "$(dirname "$0")/lib.sh"

cat > "$TEST_TMP/check.js" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const policyFile = process.argv[3];
const script = fs.readFileSync(path.join(root, 'scripts/resolve-review-loop.sh'), 'utf8');
const defaults = JSON.parse(fs.readFileSync(path.join(root, 'references/official-qualification-defaults.json'), 'utf8'));
const shell = (name) => {
  const m = script.match(new RegExp(`^${name}="([^"]*)"`, 'm'));
  if (!m) throw new Error(`${name} not found in resolve-review-loop.sh`);
  return m[1];
};
const calibrated = shell('QC_ALL_CALIBRATED').split(',').map((s) => s.trim());
const versionKey = (m) => (m.match(/\d+(?:\.\d+)*/) || ['0'])[0].split('.').map(Number);
const cmp = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i += 1) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; };
const zhipu = [...new Set(defaults.defaults.filter((r) => r.administration.family === 'zhipu').map((r) => r.administration.engine))];
const newestZhipu = zhipu.sort((a, b) => cmp(versionKey(b), versionKey(a)))[0];
const expected = {
  openai: shell('DEF_REV_ENGINE'),
  xai: calibrated.find((m) => /^grok-/.test(m)),
  minimax: calibrated.find((m) => /^MiniMax-M3$/.test(m)),
  zhipu: newestZhipu,
};
const src = fs.readFileSync(policyFile, 'utf8');
const block = src.slice(src.indexOf('const STRICT_L5_PROVIDER_POLICY = '), src.indexOf('const STRICT_L5_PROVIDER_POLICY_DIGEST'));
const rows = [...block.matchAll(/model: '([^']+)',[\s\S]*?family: '([^']+)'/g)].map((m) => ({ model: m[1], family: m[2] }));
const bad = [];
if (rows.length !== 6) bad.push(`policy has ${rows.length} rows, expected 6`);
for (const r of rows) if (expected[r.family] !== r.model) bad.push(`${r.family}: policy ${r.model} != shipped ${expected[r.family]}`);
if (bad.length) { console.log(`DRIFT ${bad.join('; ')}`); process.exit(1); }
console.log(`CONSISTENT ${JSON.stringify(expected)}`);
NODE

OUT="$(node "$TEST_TMP/check.js" "$REPO_ROOT" "$REPO_ROOT/src/readiness/provider-bootstrap.js" 2>&1)"
assert_contains "$OUT" "CONSISTENT" "strict /l5 policy models equal the shipped defaults"

for old in "GLM-5.3:GLM-5.2" "gpt-6.1-sol:gpt-5.6-sol" "grok-4.7:grok-4.5"; do
  new_name="${old%%:*}"; old_name="${old##*:}"
  sed "0,/model: '${new_name}'/s//model: '${old_name}'/" "$REPO_ROOT/src/readiness/provider-bootstrap.js" > "$TEST_TMP/reverted.js"
  NEG="$(node "$TEST_TMP/check.js" "$REPO_ROOT" "$TEST_TMP/reverted.js" 2>&1)"
  assert_contains "$NEG" "DRIFT" "negative control: ${old_name} in the policy is flagged"
done

awk '/^node - "\$INPUT" <<.NODE.$/{f=1;next} /^NODE$/{f=0} f' "$REPO_ROOT/scripts/probe-harness-capabilities.sh" > "$TEST_TMP/gen.js"
a64() { printf "$1%.0s" $(seq 1 64); }
gen_check() {
  ( cd "$TEST_TMP" && env REPO=x AGY_BIN=/a AGY_VERSION=1.0.0 CODEX_BIN=/c CODEX_VERSION=1.0.0 GROK_BIN=/g GROK_VERSION=1.0.0 \
      OPENCODE_BIN=/o OPENCODE_VERSION=1.0.0 CLAUDE_BIN=/cl CLAUDE_VERSION=1.0.0 OBSERVED_AT=2026-10-16T00:00:00.000Z \
      AGY_HELP_SHA="$(a64 a)" AGY_JSON_SHA="$(a64 b)" CODEX_HELP_SHA="$(a64 c)" GROK_HELP_SHA="$(a64 d)" \
      OPENCODE_HELP_SHA="$(a64 e)" CLAUDE_HELP_SHA="$(a64 f)" D4_ROSTER_SHA="$(a64 1)" CLAUDE_HOOKS_SHA="$(a64 2)" \
      node "$1" "$TEST_TMP/gen-out.json" && node -e '
const c = require(process.argv[1]).claims;
const bad = [];
for (const x of c.filter((y) => y.consumer_id === "D2")) {
  if (!x.official_contract.locator.startsWith("agy://") || x.official_contract.document_sha256 !== "a".repeat(64)) bad.push(x.capability_id);
}
const d4 = c.filter((y) => y.consumer_id === "D4");
if (d4.length !== 6) bad.push("d4 count " + d4.length);
for (const x of d4) {
  if (!x.official_contract.locator.includes("canonical-roster.json") || x.official_contract.document_sha256 !== "1".repeat(64)) bad.push(x.capability_id);
}
console.log(bad.length ? "BINDING-DRIFT " + bad.join(",") : "BINDING-OK");' "$TEST_TMP/gen-out.json" ) 2>&1
}
assert_contains "$(gen_check "$TEST_TMP/gen.js")" "BINDING-OK" "D2 keeps agy locator, D4 binds to canonical-roster"
sed 's/AGY_HELP_SHA, assertion/D4_ROSTER_SHA, assertion/; s#`agy://cli-help/${env.AGY_VERSION}\#output-format-json`, env.AGY_HELP_SHA#d4RosterLocator, env.D4_ROSTER_SHA#' "$TEST_TMP/gen.js" > "$TEST_TMP/gen-shared.js"
assert_contains "$(gen_check "$TEST_TMP/gen-shared.js")" "BINDING-DRIFT" "negative control: D2 sharing the D4 locator and sha is flagged"

finalize_test
