#!/usr/bin/env bash
# BL-0198: the strict /l5 provider policy (src/readiness/provider-bootstrap.js) must name the
# models the plugin ships as defaults, read from the shipped sources themselves, never from a
# literal list in this test:
#   openai  -> scripts/resolve-review-loop.sh DEF_REV_ENGINE
#   xai     -> scripts/resolve-review-loop.sh QC_ALL_CALIBRATED (the grok entry)
#   minimax -> scripts/resolve-review-loop.sh QC_ALL_CALIBRATED (the MiniMax-M3 review seat)
#   zhipu   -> references/official-qualification-defaults.json (highest-version GLM engine)
# Negative control: STRICT_POLICY_FILE_OVERRIDE points the check at a copy of provider-bootstrap.js
# with one model reverted to its pre-2026-10-16 name; the check must go red on it.
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

finalize_test
