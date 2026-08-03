#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

CHECKER="$REPO_ROOT/scripts/check-plan-authority-ownership.js"
MANIFEST="$REPO_ROOT/docs/projects/_archive/2026-07-26-mission-convergence-portfolio/authority-ownership.json"

OUT="$(node "$CHECKER" "$MANIFEST" 2>&1)"
EXIT=$?
assert_exit_code "$EXIT" "0" "Consolidated portfolio has one owner per authority"
assert_contains "$OUT" "PASS (7 unique authorities)" \
  "Ownership checker covers the seven frozen authorities"

DUPLICATE="$TEST_TMP/duplicate.json"
node - "$MANIFEST" "$DUPLICATE" <<'NODE'
'use strict';
const fs = require('fs');
const [source, target] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(source, 'utf8'));
manifest.claims.push({
  authority: 'campaign_generation',
  owner: 'mission_convergence_supervisor',
  plan: 'docs/plans/2026-07-26-task-convergence-contract.md',
});
fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

OUT="$(node "$CHECKER" "$DUPLICATE" 2>&1)"
EXIT=$?
assert_exit_code "$EXIT" "1" "Duplicate authority ownership fails closed"
assert_contains "$OUT" 'duplicate authority "campaign_generation"' \
  "Duplicate report names the conflicting authority"
assert_contains "$OUT" '"implementation_campaign_controller" and "mission_convergence_supervisor"' \
  "Duplicate report names both claimants"

EMPTY_OWNER="$TEST_TMP/empty-owner.json"
node - "$MANIFEST" "$EMPTY_OWNER" <<'NODE'
'use strict';
const fs = require('fs');
const [source, target] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(source, 'utf8'));
manifest.claims[0].owner = '';
fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
NODE
OUT="$(node "$CHECKER" "$EMPTY_OWNER" 2>&1)"
EXIT=$?
assert_exit_code "$EXIT" "1" "Empty authority owner fails closed"
assert_contains "$OUT" "claim 0 is malformed" "Empty owner is reported as malformed"

OMITTED="$TEST_TMP/omitted-marker-owner.json"
node - "$MANIFEST" "$OMITTED" <<'NODE'
'use strict';
const fs = require('fs');
const [source, target] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(source, 'utf8'));
manifest.claims = manifest.claims.filter((claim) => claim.authority !== 'transcript_adapter');
fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
NODE
OUT="$(node "$CHECKER" "$OMITTED" 2>&1)"
EXIT=$?
assert_exit_code "$EXIT" "1" "Active-plan marker omitted from manifest fails closed"
assert_contains "$OUT" 'marker is absent from the ownership manifest' \
  "Checker discovers markers independently of manifest input"

finalize_test
