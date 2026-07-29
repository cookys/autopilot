#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

PROJECT="docs/projects/2026-07-20-owner-kernel-governance"

# Compatibility aliases must still exist; retirement is not authorized in U6.
for level in l3 l4 l5 l6; do
  assert_file_exists "$REPO_ROOT/skills/$level/SKILL.md" \
    "compatibility alias skill /$level remains present"
done

OUT="$(node "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js" \
  --project "$PROJECT" \
  --repo-root "$REPO_ROOT" 2>&1)"
EXIT=$?
assert_eq "0" "$EXIT" "alias-retirement readiness report emits without tool failure"

assert_contains "$OUT" '"alias_retirement"' "alias retirement section present"
# alias-test-masking: inspect the exact alias_retirement subsection, never aggregate HOLD.
node - "$OUT" <<'NODE'
const report = JSON.parse(process.argv[2]);
const alias = report.alias_retirement;
if (!alias || typeof alias !== 'object') {
  console.error('alias_retirement section missing');
  process.exit(1);
}
if (alias.status !== 'HOLD') {
  console.error('alias_retirement.status must be HOLD before real 14-day gate; got', alias.status);
  process.exit(1);
}
const reasons = (alias.blocking_reasons || []).join('\n');
if (!/trusted|authority|witness|telemetry|14|manufacture/i.test(reasons)) {
  console.error('alias HOLD must cite trusted-authority or telemetry blockers; got:', reasons);
  process.exit(1);
}
if (alias.trusted_authority_present === true) {
  // Project default has no trusted authority journal — must be absent/false.
  console.error('default project must not claim trusted_authority_present without config');
  process.exit(1);
}
console.log('alias_subsection_hold=ok');
NODE
assert_eq "0" "$?" "alias_retirement.status HOLD asserted on subsection"
assert_contains "$OUT" '"aliases_present"' "present aliases are enumerated"
assert_contains "$OUT" 'l3' "l3 alias readiness is reported"
assert_contains "$OUT" 'l4' "l4 alias readiness is reported"
assert_contains "$OUT" 'l5' "l5 alias readiness is reported"
assert_contains "$OUT" 'l6' "l6 alias readiness is reported"
assert_contains "$OUT" 'required_witnessed_days": 14' "14 complete witnessed days remain required"
assert_contains "$OUT" 'refusing to manufacture 14 elapsed days' \
  "missing production telemetry cannot fabricate a pass"
assert_contains "$OUT" 'still present' \
  "aliases are not deleted by release tooling"

# Negative control: inventing production telemetry inline is not a checker API.
# There is no --assume-14-days or --waive flag.
HELP="$(node "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js" --help 2>&1 || true)"
assert_contains "$HELP" '--project' "checker help documents --project"
assert_not_contains "$HELP" 'waive' "checker has no waiver flag"
assert_not_contains "$HELP" 'assume-14' "checker has no elapsed-day fabrication flag"
assert_not_contains "$HELP" 'delete-alias' "checker has no alias deletion flag"

# Translation surface still exists for shadow/compat (not production zero-use proof).
assert_file_exists "$REPO_ROOT/src/engine/owner-kernel/compatibility.js" \
  "compatibility translation module remains (aliases not retired)"

# kr10-shell-evidence / alias authority surface checks in checker source.
CHECKER_SRC="$(cat "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js")"
assert_contains "$CHECKER_SRC" "bash', ['-n'" \
  "KR10 runs deterministic bash -n for shell members"
assert_contains "$CHECKER_SRC" 'assertWitnessAdapter' \
  "alias retirement uses trusted installed witness-authority API"
assert_contains "$CHECKER_SRC" 'loadTrustedInstalledWitnessAuthority' \
  "alias retirement loads independently configured installed witness authority"
assert_contains "$CHECKER_SRC" 'verifyWithTrustedInstalledWitnessAuthority' \
  "alias retirement calls trusted witness-authority verification"
assert_contains "$CHECKER_SRC" 'authority.verify(receipt)' \
  "alias retirement authenticates via witness.verify authority API"
assert_contains "$CHECKER_SRC" 'AUTOPILOT_TRUSTED_INSTALLED_WITNESS_AUTHORITY' \
  "authority path is independently configured (not project-local co-located journal)"
assert_contains "$CHECKER_SRC" 'executeDeterministicCallerMigrationScan' \
  "caller migration is mechanically executed"
assert_contains "$CHECKER_SRC" 'requiredWitnessedDayKeys' \
  "14-day window binds to host-clock timestamps outside the evidence"
assert_not_contains "$CHECKER_SRC" 'compatibility_cycle_signer_binding' \
  "telemetry-supplied signer bindings are not a trust root"
# Must not construct MemoryWitness from telemetry receipt.stream_id as trust root.
if printf '%s' "$CHECKER_SRC" | grep -q "new MemoryWitness({ streamId: receipt.stream_id })"; then
  echo "FAIL: telemetry-stream-derived fresh MemoryWitness is forbidden" >&2
  exit 1
fi

# alias-receipt-self-authentication / alias-authority-bootstrap:
# internally consistent forged chains HOLD; absent trusted state HOLDs.
FAB_DIR="$(mktemp -d "${TMPDIR:-/tmp}/alias-retire-fab.XXXXXX")"
mkdir -p "$FAB_DIR/production-telemetry"
node - "$REPO_ROOT" "$FAB_DIR" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const dir = process.argv[3];
const { sha256, canonicalJson } = require(path.join(root, 'src/engine/owner-kernel/canonical'));

function witnessHead(fields) {
  return sha256(canonicalJson({
    run_id: fields.run_id,
    stream_id: fields.stream_id,
    sequence: fields.sequence,
    event_hash: fields.event_hash,
    previous_witness_head: fields.previous_witness_head,
  }));
}

const runId = 'fabricated-run';
const streamId = 'fabricated-signer-stream';
const cycleBody = { compatibility_cycle_id: 'fabricated-cycle' };
const cycleEventHash = sha256(canonicalJson(cycleBody));
const cycleBase = {
  run_id: runId,
  stream_id: streamId,
  sequence: 1,
  event_hash: cycleEventHash,
  previous_witness_head: null,
};
const cycleHead = witnessHead(cycleBase);
const cycleReceipt = { ...cycleBase, witness_head: cycleHead };

const days = [];
let previousHead = cycleHead;
for (let i = 1; i <= 14; i += 1) {
  const day = `2020-01-${String(i).padStart(2, '0')}`;
  const dayBody = {
    day,
    translation_used_events: 0,
    unresolved_translation_deltas: 0,
    prior_witness_head: previousHead,
  };
  const eventHash = sha256(canonicalJson(dayBody));
  const base = {
    run_id: runId,
    stream_id: streamId,
    sequence: i + 1,
    event_hash: eventHash,
    previous_witness_head: previousHead,
  };
  const head = witnessHead(base);
  days.push({
    day,
    translation_used_events: 0,
    unresolved_translation_deltas: 0,
    witness_head: head,
    witness_receipt: { ...base, witness_head: head },
  });
  previousHead = head;
}

const migrationBody = { complete: true, callers_migrated: ['l3', 'l4', 'l5', 'l6'] };
const telemetry = {
  compatibility_cycle_id: 'fabricated-cycle',
  shipped_compatibility_cycle: true,
  compatibility_cycle_signer_binding: {
    identity: 'fabricated-signer',
    attestation_hash: 'c'.repeat(64),
    protocol_version: 1,
  },
  compatibility_cycle_receipt_body: cycleBody,
  compatibility_cycle_ship_receipt: cycleReceipt,
  witnessed_zero_use_days: 14,
  translation_used_events: 0,
  unresolved_translation_deltas: 0,
  deterministic_caller_migration: true,
  caller_migration_complete: true,
  caller_migration_scan_body: migrationBody,
  caller_migration_scan_hash: sha256(canonicalJson(migrationBody)),
  witnessed_day_records: days,
};
fs.writeFileSync(
  path.join(dir, 'production-telemetry', 'alias-retirement.json'),
  JSON.stringify(telemetry, null, 2),
);
NODE

FAB_OUT="$(node "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js" \
  --project "$FAB_DIR" \
  --repo-root "$REPO_ROOT" 2>&1)"
FAB_EXIT=$?
assert_eq "0" "$FAB_EXIT" "internally consistent forged telemetry still emits a report"
# alias-test-masking: parse JSON and assert alias_retirement.status + trusted-authority blocker.
node - "$FAB_OUT" <<'NODE'
const report = JSON.parse(process.argv[2]);
const alias = report.alias_retirement;
if (!alias || alias.status !== 'HOLD') {
  console.error('forged chains must HOLD alias_retirement.status; got', alias && alias.status);
  process.exit(1);
}
const reasons = (alias.blocking_reasons || []).join('\n');
if (!/trusted|authority|witness/i.test(reasons)) {
  console.error('HOLD reasons must cite trusted witness-authority verification; got:', reasons);
  process.exit(1);
}
// KR8/KR10 HOLD cannot mask an erroneous alias PASS — we already require alias HOLD.
if (alias.status === 'PASS') {
  console.error('alias PASS masked by other gates is forbidden');
  process.exit(1);
}
console.log('alias_forged_hold=ok');
NODE
assert_eq "0" "$?" "internally consistent forged chains HOLD alias retirement subsection"
rm -rf "$FAB_DIR"

# alias-cogen-backdated: freshly generated project-local journal + backdated
# 14-day chain + self-hashed deterministic_caller_migration cannot fund PASS.
COGEN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/alias-cogen.XXXXXX")"
mkdir -p "$COGEN_DIR/production-telemetry"
node - "$REPO_ROOT" "$COGEN_DIR" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const dir = process.argv[3];
const { sha256, canonicalJson } = require(path.join(root, 'src/engine/owner-kernel/canonical'));
const { MemoryWitness } = require(path.join(root, 'src/engine/owner-kernel/witness'));

const streamId = 'alias-cogen-stream';
const runId = 'alias-cogen-run';
const witness = new MemoryWitness({ streamId });
const cycleBody = { compatibility_cycle_id: 'alias-cogen-cycle' };
const cycleReceipt = witness.append({
  run_id: runId,
  sequence: 1,
  event_hash: sha256(canonicalJson(cycleBody)),
});
const days = [];
for (let i = 1; i <= 14; i += 1) {
  const day = `2020-01-${String(i).padStart(2, '0')}`;
  const previousHead = witness.getHead();
  const dayBody = {
    day,
    translation_used_events: 0,
    unresolved_translation_deltas: 0,
    prior_witness_head: previousHead,
  };
  const receipt = witness.append({
    run_id: runId,
    sequence: i + 1,
    event_hash: sha256(canonicalJson(dayBody)),
  });
  days.push({
    day,
    translation_used_events: 0,
    unresolved_translation_deltas: 0,
    witness_head: receipt.witness_head,
    witness_receipt: receipt,
  });
}
const migrationBody = { complete: true, callers_migrated: ['l3', 'l4', 'l5', 'l6'] };
const migrationHash = sha256(canonicalJson(migrationBody));
const migrationReceipt = witness.append({
  run_id: runId,
  sequence: 16,
  event_hash: migrationHash,
});

fs.writeFileSync(
  path.join(dir, 'trusted-installed-witness-authority.json'),
  JSON.stringify({
    kind: 'trusted_installed_witness_authority',
    stream_id: streamId,
    receipts: witness._receipts,
  }, null, 2),
);
fs.writeFileSync(
  path.join(dir, 'production-telemetry', 'alias-retirement.json'),
  JSON.stringify({
    compatibility_cycle_id: 'alias-cogen-cycle',
    shipped_compatibility_cycle: true,
    compatibility_cycle_receipt_body: cycleBody,
    compatibility_cycle_ship_receipt: cycleReceipt,
    witnessed_zero_use_days: 14,
    translation_used_events: 0,
    unresolved_translation_deltas: 0,
    deterministic_caller_migration: true,
    caller_migration_complete: true,
    caller_migration_scan_body: migrationBody,
    caller_migration_scan_hash: migrationHash,
    caller_migration_witness_receipt: migrationReceipt,
    witnessed_day_records: days,
  }, null, 2),
);
NODE

COGEN_OUT="$(node "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js" \
  --project "$COGEN_DIR" \
  --repo-root "$REPO_ROOT" 2>&1)"
node - "$COGEN_OUT" <<'NODE'
const report = JSON.parse(process.argv[2]);
const alias = report.alias_retirement;
if (!alias || alias.status !== 'HOLD') {
  console.error('backdated co-gen alias evidence must HOLD; got', alias && alias.status);
  process.exit(1);
}
const reasons = (alias.blocking_reasons || []).join('\n');
if (!/independent|untrusted|project-local|authority|self-hashed|migration|backdated|host-clock/i.test(reasons)) {
  console.error('alias co-gen HOLD must cite independent authority/migration/backdating; got:', reasons);
  process.exit(1);
}
if (alias.deterministic_caller_migration === true) {
  console.error('self-hashed migration must not set deterministic_caller_migration true');
  process.exit(1);
}
console.log('alias_cogen_backdated_hold=ok');
NODE
assert_eq "0" "$?" "backdated co-gen alias evidence HOLD"
rm -rf "$COGEN_DIR"

# ---------------------------------------------------------------------------
# Finding 1 — Authority path containment: realpath before read; reject any
# authority whose resolved path is inside repoRoot / project trust boundary,
# including direct in-repo paths and outside-symlink-into-repo.
# ---------------------------------------------------------------------------
INREPO_AUTH="$REPO_ROOT/scripts/.tmp-inrepo-authority-$$.json"
node - "$REPO_ROOT" "$INREPO_AUTH" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const out = process.argv[3];
const { sha256, canonicalJson } = require(path.join(root, 'src/engine/owner-kernel/canonical'));
const { MemoryWitness } = require(path.join(root, 'src/engine/owner-kernel/witness'));
const witness = new MemoryWitness({ streamId: 'inrepo-auth-stream' });
const receipt = witness.append({
  run_id: 'inrepo-auth-run',
  sequence: 1,
  event_hash: sha256(canonicalJson({ kind: 'inrepo' })),
});
fs.writeFileSync(out, JSON.stringify({
  kind: 'trusted_installed_witness_authority',
  stream_id: 'inrepo-auth-stream',
  receipts: [receipt],
}, null, 2));
NODE
INREPO_DIR="$(mktemp -d "${TMPDIR:-/tmp}/alias-inrepo-auth.XXXXXX")"
mkdir -p "$INREPO_DIR/production-telemetry"
printf '%s\n' '{
  "shipped_compatibility_cycle": true,
  "witnessed_zero_use_days": 0,
  "translation_used_events": 0,
  "unresolved_translation_deltas": 0
}' >"$INREPO_DIR/production-telemetry/alias-retirement.json"
# Isolate from operator HOME authority so only the in-repo candidate is considered.
INREPO_HOME="$(mktemp -d "${TMPDIR:-/tmp}/alias-inrepo-home.XXXXXX")"
INREPO_OUT="$(
  HOME="$INREPO_HOME" \
  AUTOPILOT_TRUSTED_INSTALLED_WITNESS_AUTHORITY="$INREPO_AUTH" \
  node "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js" \
    --project "$INREPO_DIR" \
    --repo-root "$REPO_ROOT" 2>&1
)"
node - "$INREPO_OUT" <<'NODE'
const report = JSON.parse(process.argv[2]);
const alias = report.alias_retirement;
if (!alias || alias.status !== 'HOLD') {
  console.error('in-repo authority path must HOLD; got', alias && alias.status);
  process.exit(1);
}
if (alias.trusted_authority_present === true) {
  console.error('in-repo authority must not set trusted_authority_present');
  process.exit(1);
}
const reasons = (alias.blocking_reasons || []).join('\n');
if (!/independent|authority|absent|untrusted/i.test(reasons)) {
  console.error('in-repo authority HOLD must cite independent authority absence; got:', reasons);
  process.exit(1);
}
console.log('alias_inrepo_authority_hold=ok');
NODE
assert_eq "0" "$?" "direct in-repo authority path rejected"
rm -f "$INREPO_AUTH"
rm -rf "$INREPO_DIR" "$INREPO_HOME"

# Outside symlink whose realpath lands inside repoRoot must also be rejected.
SYMLINK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/alias-symlink-auth.XXXXXX")"
TARGET_IN_REPO="$REPO_ROOT/scripts/.tmp-symlink-target-$$.json"
node - "$REPO_ROOT" "$TARGET_IN_REPO" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const out = process.argv[3];
const { sha256, canonicalJson } = require(path.join(root, 'src/engine/owner-kernel/canonical'));
const { MemoryWitness } = require(path.join(root, 'src/engine/owner-kernel/witness'));
const witness = new MemoryWitness({ streamId: 'symlink-auth-stream' });
const receipt = witness.append({
  run_id: 'symlink-auth-run',
  sequence: 1,
  event_hash: sha256(canonicalJson({ kind: 'symlink-into-repo' })),
});
fs.writeFileSync(out, JSON.stringify({
  kind: 'trusted_installed_witness_authority',
  stream_id: 'symlink-auth-stream',
  receipts: [receipt],
}, null, 2));
NODE
LINK_PATH="$SYMLINK_DIR/outside-link-authority.json"
ln -s "$TARGET_IN_REPO" "$LINK_PATH"
SYMLINK_PROJ="$(mktemp -d "${TMPDIR:-/tmp}/alias-symlink-proj.XXXXXX")"
mkdir -p "$SYMLINK_PROJ/production-telemetry"
printf '%s\n' '{
  "shipped_compatibility_cycle": true,
  "witnessed_zero_use_days": 0,
  "translation_used_events": 0,
  "unresolved_translation_deltas": 0
}' >"$SYMLINK_PROJ/production-telemetry/alias-retirement.json"
SYMLINK_HOME="$(mktemp -d "${TMPDIR:-/tmp}/alias-symlink-home.XXXXXX")"
SYMLINK_OUT="$(
  HOME="$SYMLINK_HOME" \
  AUTOPILOT_TRUSTED_INSTALLED_WITNESS_AUTHORITY="$LINK_PATH" \
  node "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js" \
    --project "$SYMLINK_PROJ" \
    --repo-root "$REPO_ROOT" 2>&1
)"
node - "$SYMLINK_OUT" <<'NODE'
const report = JSON.parse(process.argv[2]);
const alias = report.alias_retirement;
if (!alias || alias.status !== 'HOLD') {
  console.error('outside-symlink-into-repo authority must HOLD; got', alias && alias.status);
  process.exit(1);
}
if (alias.trusted_authority_present === true) {
  console.error('symlink-into-repo authority must not set trusted_authority_present');
  process.exit(1);
}
console.log('alias_symlink_into_repo_hold=ok');
NODE
assert_eq "0" "$?" "outside-symlink-into-repo authority path rejected"
rm -f "$TARGET_IN_REPO" "$LINK_PATH"
rm -rf "$SYMLINK_DIR" "$SYMLINK_PROJ" "$SYMLINK_HOME"

# ---------------------------------------------------------------------------
# Finding 2 — fourteen-created-today / backdated-label + pass-through rejection:
# even with an external adapter binding, journal-supplied append timestamps and
# a pass-through getAppendTimestamp cannot manufacture 14 elapsed days.
# Authority-owned anchored timestamps (deployment binding) are required.
# ---------------------------------------------------------------------------
TODAY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/alias-today-backdate.XXXXXX")"
AUTH_OUTSIDE="$(mktemp -d "${TMPDIR:-/tmp}/alias-today-auth.XXXXXX")"
mkdir -p "$TODAY_DIR/production-telemetry"
TODAY_AUTH="$(node - "$REPO_ROOT" "$TODAY_DIR" "$AUTH_OUTSIDE" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = process.argv[2];
const dir = process.argv[3];
const authDir = process.argv[4];
const { sha256, canonicalJson } = require(path.join(root, 'src/engine/owner-kernel/canonical'));
const streamId = 'alias-today-backdate-stream';
const runId = 'alias-today-backdate-run';
function headOf(base) { return sha256(canonicalJson(base)); }
const cycleBody = { compatibility_cycle_id: 'alias-today-cycle' };
const cycleEventHash = sha256(canonicalJson(cycleBody));
const cycleBase = {
  run_id: runId, stream_id: streamId, sequence: 1,
  event_hash: cycleEventHash, previous_witness_head: null,
};
const cycleHead = headOf(cycleBase);
const todayIso = new Date().toISOString();
// Caller puts backdated labels but journal append_timestamp fields claim historical days
// (pass-through attack). Adapter re-emits journal timestamps if present — must still HOLD
// because journal timestamps are stripped and no deployment anchored timestamps are set.
const cycleReceipt = { ...cycleBase, witness_head: cycleHead, append_timestamp: todayIso };
const now = Date.now();
const todayUtc = new Date(now).toISOString().slice(0, 10);
const [year, month, dayNum] = todayUtc.split('-').map(Number);
const requiredDays = [];
for (let offset = 1; offset <= 14; offset += 1) {
  requiredDays.push(new Date(Date.UTC(year, month - 1, dayNum - offset)).toISOString().slice(0, 10));
}
requiredDays.reverse();
const journal = [cycleReceipt];
const days = [];
let previousHead = cycleHead;
for (let i = 0; i < 14; i += 1) {
  const day = requiredDays[i];
  // Fabricate "historical" journal timestamps matching labels (pass-through bait).
  const fakeHistorical = new Date(Date.UTC(year, month - 1, dayNum - (14 - i), 12, 0, 0)).toISOString();
  const dayBody = {
    day, translation_used_events: 0,
    unresolved_translation_deltas: 0, prior_witness_head: previousHead,
  };
  const base = {
    run_id: runId, stream_id: streamId, sequence: i + 2,
    event_hash: sha256(canonicalJson(dayBody)), previous_witness_head: previousHead,
  };
  const h = headOf(base);
  const receipt = { ...base, witness_head: h, append_timestamp: fakeHistorical };
  journal.push(receipt);
  days.push({
    day, translation_used_events: 0, unresolved_translation_deltas: 0,
    witness_head: h, witness_receipt: receipt,
  });
  previousHead = h;
}
const migrationBody = { complete: true, callers_migrated: ['l3', 'l4', 'l5', 'l6'] };
const migrationHash = sha256(canonicalJson(migrationBody));
const migBase = {
  run_id: runId, stream_id: streamId, sequence: 16,
  event_hash: migrationHash, previous_witness_head: previousHead,
};
const migHead = headOf(migBase);
const migrationReceipt = { ...migBase, witness_head: migHead, append_timestamp: todayIso };
journal.push(migrationReceipt);

// Pass-through adapter: re-emits receipt.append_timestamp if present (must not work
// because checker strips those fields before factory).
const adapterPath = path.join(authDir, 'external-witness-adapter.js');
fs.writeFileSync(adapterPath, `'use strict';
const crypto = require('crypto');
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
}
function createAuthority({ streamId, receipts, anchored_append_timestamps }) {
  const known = new Map();
  const passThrough = new Map();
  for (const entry of receipts || []) {
    const head = String(entry.witness_head).toLowerCase();
    known.set(head, entry);
    // Pass-through of caller journal timestamps (stripped input => empty).
    if (typeof entry.append_timestamp === 'string') passThrough.set(head, entry.append_timestamp);
  }
  const anchored = new Map(Object.entries(anchored_append_timestamps || {}).map(([k, v]) => [String(k).toLowerCase(), v]));
  return {
    streamId, trustTier: 'external',
    identity: 'external-adapter:' + streamId,
    attestation_hash: sha256('external-adapter:' + streamId),
    protocol_version: 1,
    getAppendTimestamp(r) {
      const head = String(r.witness_head).toLowerCase();
      // Prefer pass-through of input journal timestamps (must not manufacture 14 days).
      return passThrough.get(head) || anchored.get(head) || null;
    },
    append() { throw new Error('unused'); },
    verify(receipt) {
      if (!receipt || receipt.stream_id !== streamId) return false;
      const head = String(receipt.witness_head).toLowerCase();
      if (!known.has(head)) return false;
      const expected = sha256(canonicalJson({
        run_id: receipt.run_id, stream_id: receipt.stream_id, sequence: receipt.sequence,
        event_hash: receipt.event_hash, previous_witness_head: receipt.previous_witness_head,
      }));
      return expected === receipt.witness_head;
    },
  };
}
module.exports = { createAuthority };
`);
const adapterPin = crypto.createHash('sha256').update(fs.readFileSync(adapterPath)).digest('hex');
const authPath = path.join(authDir, 'trusted-installed-witness-authority.json');
fs.writeFileSync(authPath, JSON.stringify({
  kind: 'trusted_installed_witness_authority',
  authority_id: 'alias-today-1',
  stream_id: streamId,
  receipts: journal,
}, null, 2));
// Binding without anchored timestamps — pass-through cannot invent days.
const bindingPath = path.join(authDir, 'trusted-witness-adapter-binding.json');
fs.writeFileSync(bindingPath, JSON.stringify({
  kind: 'trusted_installed_witness_adapter_binding',
  authority_id: 'alias-today-1',
  adapter_module: adapterPath,
  adapter_sha256: adapterPin,
  anchored_append_timestamps: {},
}, null, 2));
fs.writeFileSync(path.join(dir, 'production-telemetry', 'alias-retirement.json'), JSON.stringify({
  compatibility_cycle_id: 'alias-today-cycle', shipped_compatibility_cycle: true,
  compatibility_cycle_receipt_body: cycleBody, compatibility_cycle_ship_receipt: cycleReceipt,
  witnessed_zero_use_days: 14, translation_used_events: 0, unresolved_translation_deltas: 0,
  deterministic_caller_migration: true, caller_migration_complete: true,
  caller_migration_scan_body: migrationBody, caller_migration_scan_hash: migrationHash,
  caller_migration_witness_receipt: migrationReceipt, witnessed_day_records: days,
}, null, 2));
process.stdout.write(JSON.stringify({ auth: authPath, binding: bindingPath }));
NODE
)"
TODAY_AUTH_PATH="$(node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(j.auth)' "$TODAY_AUTH")"
TODAY_BINDING_PATH="$(node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(j.binding)' "$TODAY_AUTH")"
TODAY_OUT="$(
  AUTOPILOT_TRUSTED_INSTALLED_WITNESS_AUTHORITY="$TODAY_AUTH_PATH" \
  AUTOPILOT_TRUSTED_WITNESS_ADAPTER_BINDING="$TODAY_BINDING_PATH" \
  node "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js" \
    --project "$TODAY_DIR" \
    --repo-root "$REPO_ROOT" 2>&1
)"
node - "$TODAY_OUT" <<'NODE'
const report = JSON.parse(process.argv[2]);
const alias = report.alias_retirement;
if (!alias || alias.status !== 'HOLD') {
  console.error('fourteen-created-today/pass-through must HOLD; got', alias && alias.status);
  process.exit(1);
}
if (alias.trusted_authority_present !== true) {
  console.error('fixture must load pinned adapter binding; got', alias.trusted_authority_present, alias.blocking_reasons);
  process.exit(1);
}
const reasons = (alias.blocking_reasons || []).join('\n');
if (!/append.?timestamp|timestamp|backdated|host-clock|created-today|required UTC day|14|anchored|pass-through|journal/i.test(reasons)) {
  console.error('must cite timestamp/elapsed-day rejection; got:', reasons);
  process.exit(1);
}
console.log('alias_fourteen_created_today_hold=ok');
NODE
assert_eq "0" "$?" "fourteen-created-today/pass-through timestamp rejection"
rm -rf "$TODAY_DIR" "$AUTH_OUTSIDE"

# timestamp-direct-pass-through: adapter returns argument.append_timestamp directly
# (caller-controlled receipt field). Must HOLD and manufacture zero witnessed days.
DIRECT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/alias-direct-ts.XXXXXX")"
DIRECT_AUTH_DIR="$(mktemp -d "${TMPDIR:-/tmp}/alias-direct-auth.XXXXXX")"
mkdir -p "$DIRECT_DIR/production-telemetry"
DIRECT_META="$(node - "$REPO_ROOT" "$DIRECT_DIR" "$DIRECT_AUTH_DIR" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = process.argv[2];
const dir = process.argv[3];
const authDir = process.argv[4];
const { sha256, canonicalJson } = require(path.join(root, 'src/engine/owner-kernel/canonical'));
const streamId = 'alias-direct-ts';
const runId = 'alias-direct-run';
function headOf(base) { return sha256(canonicalJson(base)); }
const cycleBody = { compatibility_cycle_id: 'alias-direct-cycle' };
const cycleBase = {
  run_id: runId, stream_id: streamId, sequence: 1,
  event_hash: sha256(canonicalJson(cycleBody)), previous_witness_head: null,
};
const cycleHead = headOf(cycleBase);
const cycleReceipt = { ...cycleBase, witness_head: cycleHead };
const now = Date.now();
const todayUtc = new Date(now).toISOString().slice(0, 10);
const [year, month, dayNum] = todayUtc.split('-').map(Number);
const requiredDays = [];
for (let offset = 1; offset <= 14; offset += 1) {
  requiredDays.push(new Date(Date.UTC(year, month - 1, dayNum - offset)).toISOString().slice(0, 10));
}
requiredDays.reverse();
const journal = [cycleReceipt];
const days = [];
let previousHead = cycleHead;
for (let i = 0; i < 14; i += 1) {
  const day = requiredDays[i];
  const historical = new Date(Date.UTC(year, month - 1, dayNum - (14 - i), 12)).toISOString();
  const dayBody = {
    day, translation_used_events: 0,
    unresolved_translation_deltas: 0, prior_witness_head: previousHead,
  };
  const base = {
    run_id: runId, stream_id: streamId, sequence: i + 2,
    event_hash: sha256(canonicalJson(dayBody)), previous_witness_head: previousHead,
  };
  const h = headOf(base);
  // Put free-choice time on the receipt the adapter will try to re-read.
  const receipt = { ...base, witness_head: h, append_timestamp: historical };
  journal.push(receipt);
  days.push({
    day, translation_used_events: 0, unresolved_translation_deltas: 0,
    witness_head: h, witness_receipt: receipt,
  });
  previousHead = h;
}
const migrationBody = { complete: true, callers_migrated: ['l3', 'l4', 'l5', 'l6'] };
const migrationHash = sha256(canonicalJson(migrationBody));
const migBase = {
  run_id: runId, stream_id: streamId, sequence: 16,
  event_hash: migrationHash, previous_witness_head: previousHead,
};
const migHead = headOf(migBase);
const migrationReceipt = { ...migBase, witness_head: migHead };
journal.push(migrationReceipt);
const adapterPath = path.join(authDir, 'adapter.js');
// Adapter directly returns argument.append_timestamp — must not manufacture days
// because evaluateAliasRetirement sanitizes the receipt before lookup.
fs.writeFileSync(adapterPath, `'use strict';
const crypto = require('crypto');
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
}
function createAuthority({ streamId, receipts }) {
  const known = new Map();
  for (const entry of receipts || []) known.set(String(entry.witness_head).toLowerCase(), entry);
  return {
    streamId, trustTier: 'external',
    identity: 'external-adapter:' + streamId,
    attestation_hash: sha256('external-adapter:' + streamId),
    protocol_version: 1,
    getAppendTimestamp(r) {
      return r && typeof r.append_timestamp === 'string' ? r.append_timestamp : null;
    },
    append() { throw new Error('unused'); },
    verify(receipt) {
      if (!receipt || receipt.stream_id !== streamId) return false;
      const head = String(receipt.witness_head).toLowerCase();
      if (!known.has(head)) return false;
      const expected = sha256(canonicalJson({
        run_id: receipt.run_id, stream_id: receipt.stream_id, sequence: receipt.sequence,
        event_hash: receipt.event_hash, previous_witness_head: receipt.previous_witness_head,
      }));
      return expected === receipt.witness_head;
    },
  };
}
module.exports = { createAuthority };
`);
const pin = crypto.createHash('sha256').update(fs.readFileSync(adapterPath)).digest('hex');
const authPath = path.join(authDir, 'authority.json');
fs.writeFileSync(authPath, JSON.stringify({
  kind: 'trusted_installed_witness_authority', authority_id: 'alias-direct-1',
  stream_id: streamId, receipts: journal,
}, null, 2));
const bindingPath = path.join(authDir, 'binding.json');
fs.writeFileSync(bindingPath, JSON.stringify({
  kind: 'trusted_installed_witness_adapter_binding', authority_id: 'alias-direct-1',
  adapter_module: adapterPath, adapter_sha256: pin, anchored_append_timestamps: {},
}, null, 2));
fs.writeFileSync(path.join(dir, 'production-telemetry', 'alias-retirement.json'), JSON.stringify({
  compatibility_cycle_id: 'alias-direct-cycle', shipped_compatibility_cycle: true,
  compatibility_cycle_receipt_body: cycleBody, compatibility_cycle_ship_receipt: cycleReceipt,
  witnessed_zero_use_days: 14, translation_used_events: 0, unresolved_translation_deltas: 0,
  deterministic_caller_migration: true, caller_migration_complete: true,
  caller_migration_scan_body: migrationBody, caller_migration_scan_hash: migrationHash,
  caller_migration_witness_receipt: migrationReceipt, witnessed_day_records: days,
}, null, 2));
process.stdout.write(JSON.stringify({ auth: authPath, binding: bindingPath }));
NODE
)"
DIRECT_AUTH="$(node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(j.auth)' "$DIRECT_META")"
DIRECT_BIND="$(node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(j.binding)' "$DIRECT_META")"
DIRECT_OUT="$(
  AUTOPILOT_TRUSTED_INSTALLED_WITNESS_AUTHORITY="$DIRECT_AUTH" \
  AUTOPILOT_TRUSTED_WITNESS_ADAPTER_BINDING="$DIRECT_BIND" \
  node "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js" \
    --project "$DIRECT_DIR" --repo-root "$REPO_ROOT" 2>&1
)"
node - "$DIRECT_OUT" <<'NODE'
const report = JSON.parse(process.argv[2]);
const alias = report.alias_retirement;
if (!alias || alias.status !== 'HOLD') {
  console.error('direct pass-through append_timestamp must HOLD; got', alias && alias.status);
  process.exit(1);
}
if (alias.trusted_authority_present !== true) {
  console.error('direct pass-through fixture must authenticate adapter; got', alias.blocking_reasons);
  process.exit(1);
}
// Must not manufacture any validated witnessed day via argument pass-through.
const reasons = (alias.blocking_reasons || []).join('\n');
if (!/only 0 complete|append.?timestamp|timestamp|14|host-clock|anchored|required UTC/i.test(reasons)) {
  console.error('must reject direct receipt timestamp pass-through; got:', reasons);
  process.exit(1);
}
if (/only 14 complete witnessed/i.test(reasons)) {
  console.error('must not accept all 14 days via pass-through');
  process.exit(1);
}
console.log('alias_direct_append_timestamp_pass_through_hold=ok');
NODE
assert_eq "0" "$?" "direct getAppendTimestamp(receipt.append_timestamp) cannot forge days"
rm -rf "$DIRECT_DIR" "$DIRECT_AUTH_DIR"

# alias-window-order: cycle after window HOLD; nonchronological day timestamps HOLD.
# Positive shape: cycle before day one with strictly increasing day anchors.
ORDER_DIR="$(mktemp -d "${TMPDIR:-/tmp}/alias-order.XXXXXX")"
ORDER_AUTH_DIR="$(mktemp -d "${TMPDIR:-/tmp}/alias-order-auth.XXXXXX")"
mkdir -p "$ORDER_DIR/production-telemetry"
ORDER_META="$(node - "$REPO_ROOT" "$ORDER_DIR" "$ORDER_AUTH_DIR" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = process.argv[2];
const dir = process.argv[3];
const authDir = process.argv[4];
const { sha256, canonicalJson } = require(path.join(root, 'src/engine/owner-kernel/canonical'));
function headOf(base) { return sha256(canonicalJson(base)); }
const streamId = 'alias-order-stream';
const runId = 'alias-order-run';
const now = Date.now();
const todayUtc = new Date(now).toISOString().slice(0, 10);
const [year, month, dayNum] = todayUtc.split('-').map(Number);
const requiredDays = [];
for (let offset = 1; offset <= 14; offset += 1) {
  requiredDays.push(new Date(Date.UTC(year, month - 1, dayNum - offset)).toISOString().slice(0, 10));
}
requiredDays.reverse();
// Cycle day is after the window (today) — must HOLD.
const cycleBody = { compatibility_cycle_id: 'alias-order-cycle' };
const cycleBase = {
  run_id: runId, stream_id: streamId, sequence: 1,
  event_hash: sha256(canonicalJson(cycleBody)), previous_witness_head: null,
};
const cycleHead = headOf(cycleBase);
const cycleReceipt = { ...cycleBase, witness_head: cycleHead };
const journal = [cycleReceipt];
const days = [];
const anchored = {};
const cycleTs = new Date().toISOString(); // after window
anchored[cycleHead] = cycleTs;
let previousHead = cycleHead;
for (let i = 0; i < 14; i += 1) {
  const day = requiredDays[i];
  // Historical timestamps matching each day (would pass day match if cycle ok).
  const dayTs = new Date(Date.UTC(year, month - 1, dayNum - (14 - i), 12)).toISOString();
  const dayBody = {
    day, translation_used_events: 0,
    unresolved_translation_deltas: 0, prior_witness_head: previousHead,
  };
  const base = {
    run_id: runId, stream_id: streamId, sequence: i + 2,
    event_hash: sha256(canonicalJson(dayBody)), previous_witness_head: previousHead,
  };
  const h = headOf(base);
  const receipt = { ...base, witness_head: h };
  journal.push(receipt);
  days.push({
    day, translation_used_events: 0, unresolved_translation_deltas: 0,
    witness_head: h, witness_receipt: receipt,
  });
  anchored[h] = dayTs;
  previousHead = h;
}
const migrationBody = { complete: true, callers_migrated: ['l3', 'l4', 'l5', 'l6'] };
const migrationHash = sha256(canonicalJson(migrationBody));
const migBase = {
  run_id: runId, stream_id: streamId, sequence: 16,
  event_hash: migrationHash, previous_witness_head: previousHead,
};
const migHead = headOf(migBase);
journal.push({ ...migBase, witness_head: migHead });
const adapterPath = path.join(authDir, 'adapter.js');
fs.writeFileSync(adapterPath, `'use strict';
const crypto = require('crypto');
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
}
function createAuthority({ streamId, receipts, anchored_append_timestamps }) {
  const known = new Map();
  for (const entry of receipts || []) known.set(String(entry.witness_head).toLowerCase(), entry);
  const anchored = new Map(Object.entries(anchored_append_timestamps || {}).map(([k, v]) => [String(k).toLowerCase(), v]));
  return {
    streamId, trustTier: 'external',
    identity: 'external-adapter:' + streamId,
    attestation_hash: sha256('external-adapter:' + streamId),
    protocol_version: 1,
    getAppendTimestamp(r) { return anchored.get(String(r.witness_head).toLowerCase()) || null; },
    append() { throw new Error('unused'); },
    verify(receipt) {
      if (!receipt || receipt.stream_id !== streamId) return false;
      const head = String(receipt.witness_head).toLowerCase();
      if (!known.has(head)) return false;
      const expected = sha256(canonicalJson({
        run_id: receipt.run_id, stream_id: receipt.stream_id, sequence: receipt.sequence,
        event_hash: receipt.event_hash, previous_witness_head: receipt.previous_witness_head,
      }));
      return expected === receipt.witness_head;
    },
  };
}
module.exports = { createAuthority };
`);
const pin = crypto.createHash('sha256').update(fs.readFileSync(adapterPath)).digest('hex');
const authPath = path.join(authDir, 'authority.json');
fs.writeFileSync(authPath, JSON.stringify({
  kind: 'trusted_installed_witness_authority', authority_id: 'alias-order-1',
  stream_id: streamId, receipts: journal,
}, null, 2));
const bindingPath = path.join(authDir, 'binding.json');
fs.writeFileSync(bindingPath, JSON.stringify({
  kind: 'trusted_installed_witness_adapter_binding', authority_id: 'alias-order-1',
  adapter_module: adapterPath, adapter_sha256: pin,
  anchored_append_timestamps: anchored,
}, null, 2));
fs.writeFileSync(path.join(dir, 'production-telemetry', 'alias-retirement.json'), JSON.stringify({
  compatibility_cycle_id: 'alias-order-cycle', shipped_compatibility_cycle: true,
  compatibility_cycle_receipt_body: cycleBody, compatibility_cycle_ship_receipt: cycleReceipt,
  witnessed_zero_use_days: 14, translation_used_events: 0, unresolved_translation_deltas: 0,
  deterministic_caller_migration: true, caller_migration_complete: true,
  caller_migration_scan_body: migrationBody, caller_migration_scan_hash: migrationHash,
  caller_migration_witness_receipt: { ...migBase, witness_head: migHead },
  witnessed_day_records: days,
}, null, 2));
// Second fixture: nonmonotonic day timestamps (cycle before window, but days reversed times).
const dir2 = path.join(authDir, 'nonmono-proj');
fs.mkdirSync(path.join(dir2, 'production-telemetry'), { recursive: true });
const anchored2 = {};
const cycleTs2 = new Date(Date.UTC(year, month - 1, dayNum - 20, 12)).toISOString();
anchored2[cycleHead] = cycleTs2;
// Reverse timestamps: later required days get earlier wall times.
for (let i = 0; i < 14; i += 1) {
  const h = days[i].witness_head;
  const dayTs = new Date(Date.UTC(year, month - 1, dayNum - 1 - i, 12)).toISOString();
  anchored2[h] = dayTs;
}
const bind2 = path.join(authDir, 'binding-nonmono.json');
fs.writeFileSync(bind2, JSON.stringify({
  kind: 'trusted_installed_witness_adapter_binding', authority_id: 'alias-order-1',
  adapter_module: adapterPath, adapter_sha256: pin,
  anchored_append_timestamps: anchored2,
}, null, 2));
fs.writeFileSync(path.join(dir2, 'production-telemetry', 'alias-retirement.json'),
  fs.readFileSync(path.join(dir, 'production-telemetry', 'alias-retirement.json')));
// Positive control: cycle before day1, strictly increasing day anchors.
const dir3 = path.join(authDir, 'positive-proj');
fs.mkdirSync(path.join(dir3, 'production-telemetry'), { recursive: true });
const anchored3 = {};
const cycleTs3 = new Date(Date.UTC(year, month - 1, dayNum - 20, 8)).toISOString();
anchored3[cycleHead] = cycleTs3;
for (let i = 0; i < 14; i += 1) {
  const h = days[i].witness_head;
  const dayTs = new Date(Date.UTC(year, month - 1, dayNum - (14 - i), 12)).toISOString();
  anchored3[h] = dayTs;
}
const bind3 = path.join(authDir, 'binding-positive.json');
fs.writeFileSync(bind3, JSON.stringify({
  kind: 'trusted_installed_witness_adapter_binding', authority_id: 'alias-order-1',
  adapter_module: adapterPath, adapter_sha256: pin,
  anchored_append_timestamps: anchored3,
}, null, 2));
fs.writeFileSync(path.join(dir3, 'production-telemetry', 'alias-retirement.json'),
  fs.readFileSync(path.join(dir, 'production-telemetry', 'alias-retirement.json')));
process.stdout.write(JSON.stringify({
  auth: authPath, bindingAfter: bindingPath, bindingNonmono: bind2, bindingPositive: bind3,
  projAfter: dir, projNonmono: dir2, projPositive: dir3,
}));
NODE
)"
ORDER_AUTH="$(node -e 'const j=JSON.parse(process.argv[1]);process.stdout.write(j.auth)' "$ORDER_META")"
ORDER_BIND_AFTER="$(node -e 'const j=JSON.parse(process.argv[1]);process.stdout.write(j.bindingAfter)' "$ORDER_META")"
ORDER_PROJ_AFTER="$(node -e 'const j=JSON.parse(process.argv[1]);process.stdout.write(j.projAfter)' "$ORDER_META")"
ORDER_OUT_AFTER="$(
  AUTOPILOT_TRUSTED_INSTALLED_WITNESS_AUTHORITY="$ORDER_AUTH" \
  AUTOPILOT_TRUSTED_WITNESS_ADAPTER_BINDING="$ORDER_BIND_AFTER" \
  node "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js" \
    --project "$ORDER_PROJ_AFTER" --repo-root "$REPO_ROOT" 2>&1
)"
node - "$ORDER_OUT_AFTER" <<'NODE'
const report = JSON.parse(process.argv[2]);
const alias = report.alias_retirement;
if (!alias || alias.status !== 'HOLD') {
  console.error('cycle-after-window must HOLD; got', alias && alias.status);
  process.exit(1);
}
const reasons = (alias.blocking_reasons || []).join('\n');
if (!/cycle|precede|after-window|first required day/i.test(reasons)) {
  console.error('must cite cycle-after-window; got', reasons);
  process.exit(1);
}
console.log('alias_cycle_after_window_hold=ok');
NODE
assert_eq "0" "$?" "cycle append after window HOLDs"

ORDER_BIND_NONMONO="$(node -e 'const j=JSON.parse(process.argv[1]);process.stdout.write(j.bindingNonmono)' "$ORDER_META")"
ORDER_PROJ_NONMONO="$(node -e 'const j=JSON.parse(process.argv[1]);process.stdout.write(j.projNonmono)' "$ORDER_META")"
ORDER_OUT_NONMONO="$(
  AUTOPILOT_TRUSTED_INSTALLED_WITNESS_AUTHORITY="$ORDER_AUTH" \
  AUTOPILOT_TRUSTED_WITNESS_ADAPTER_BINDING="$ORDER_BIND_NONMONO" \
  node "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js" \
    --project "$ORDER_PROJ_NONMONO" --repo-root "$REPO_ROOT" 2>&1
)"
node - "$ORDER_OUT_NONMONO" <<'NODE'
const report = JSON.parse(process.argv[2]);
const alias = report.alias_retirement;
if (!alias || alias.status !== 'HOLD') {
  console.error('nonmonotonic day timestamps must HOLD; got', alias && alias.status);
  process.exit(1);
}
const reasons = (alias.blocking_reasons || []).join('\n');
if (!/only [0-9]+ complete|timestamp|14|host-clock|nonmono|order|increasing/i.test(reasons)) {
  console.error('must reject nonchronological day timestamps; got', reasons);
  process.exit(1);
}
console.log('alias_nonmonotonic_day_timestamps_hold=ok');
NODE
assert_eq "0" "$?" "nonchronological day timestamps HOLD"

ORDER_BIND_POS="$(node -e 'const j=JSON.parse(process.argv[1]);process.stdout.write(j.bindingPositive)' "$ORDER_META")"
ORDER_PROJ_POS="$(node -e 'const j=JSON.parse(process.argv[1]);process.stdout.write(j.projPositive)' "$ORDER_META")"
ORDER_OUT_POS="$(
  AUTOPILOT_TRUSTED_INSTALLED_WITNESS_AUTHORITY="$ORDER_AUTH" \
  AUTOPILOT_TRUSTED_WITNESS_ADAPTER_BINDING="$ORDER_BIND_POS" \
  node "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js" \
    --project "$ORDER_PROJ_POS" --repo-root "$REPO_ROOT" 2>&1
)"
node - "$ORDER_OUT_POS" <<'NODE'
const report = JSON.parse(process.argv[2]);
const alias = report.alias_retirement;
// Overall may still HOLD (e.g. migration on residual skills), but the day window
// must prove exactly 14 validated days and no incomplete-window/order blockers.
if (!alias || alias.trusted_authority_present !== true) {
  console.error('positive window control must authenticate authority; got', alias);
  process.exit(1);
}
const reasons = (alias.blocking_reasons || []).join('\n');
// Reject any incomplete-window phrasing: "only N complete" in any wording.
if (/only\s+\d+\s+complete/i.test(reasons)) {
  console.error('positive control must not report incomplete day count; got', reasons);
  process.exit(1);
}
if (/cycle-after-window|does not precede first required day|nonmono|out-of-order|strictly increasing/i.test(reasons)) {
  console.error('positive control must not report window/order blockers; got', reasons);
  process.exit(1);
}
// Exact validated-day count surface: scalar must be 14 and must not be blocked
// as mismatched against validated distinct day-record count.
if (alias.witnessed_zero_use_days !== 14) {
  console.error('positive control requires witnessed_zero_use_days === 14; got',
    alias.witnessed_zero_use_days);
  process.exit(1);
}
if (/scalar witnessed_zero_use_days=.*does not match/i.test(reasons)) {
  console.error('positive control must not report scalar/validated day mismatch; got', reasons);
  process.exit(1);
}
if (/full witnessed 14-day production evidence missing/i.test(reasons)) {
  console.error('positive control must not report missing 14-day evidence; got', reasons);
  process.exit(1);
}
console.log('alias_positive_window_order_control=ok');
NODE
assert_eq "0" "$?" "positive cycle-before-day1 strictly-increasing control"
rm -rf "$ORDER_DIR" "$ORDER_AUTH_DIR"



# Finding 3 — Migration OR semantics: mechanical-only and authority-only
# success shapes (overall disposition remains HOLD when other prerequisites
# are absent). Untrusted telemetry completion flags are never required.
# ---------------------------------------------------------------------------
# Mechanical-only: stubbed migrated skills so the scan completes; no authority
# migration receipt. Expect deterministic_caller_migration true via scan alone.
MECH_REPO="$(mktemp -d "${TMPDIR:-/tmp}/alias-mech-repo.XXXXXX")"
MECH_PROJ="$(mktemp -d "${TMPDIR:-/tmp}/alias-mech-proj.XXXXXX")"
mkdir -p "$MECH_PROJ/production-telemetry"
# Minimal checker + owner-kernel deps for --repo-root.
for rel in \
  scripts/check-owner-kernel-release-gates.js \
  src/engine/owner-kernel/canonical.js \
  src/engine/owner-kernel/witness.js \
  src/engine/owner-kernel/errors.js
do
  mkdir -p "$(dirname "$MECH_REPO/$rel")"
  cp "$REPO_ROOT/$rel" "$MECH_REPO/$rel"
done
for level in l3 l4 l5 l6; do
  mkdir -p "$MECH_REPO/skills/$level"
  printf '%s\n' "---" "name: $level" "---" "compat stub" >"$MECH_REPO/skills/$level/SKILL.md"
done
printf '%s\n' '{
  "compatibility_cycle_id": "mech-only",
  "shipped_compatibility_cycle": false,
  "witnessed_zero_use_days": 0,
  "translation_used_events": 0,
  "unresolved_translation_deltas": 0,
  "caller_migration_complete": false,
  "deterministic_caller_migration": false
}' >"$MECH_PROJ/production-telemetry/alias-retirement.json"
MECH_OUT="$(node "$MECH_REPO/scripts/check-owner-kernel-release-gates.js" \
  --project "$MECH_PROJ" \
  --repo-root "$MECH_REPO" 2>&1)"
node - "$MECH_OUT" <<'NODE'
const report = JSON.parse(process.argv[2]);
const alias = report.alias_retirement;
if (!alias || alias.status !== 'HOLD') {
  console.error('mechanical-only must preserve overall HOLD; got', alias && alias.status);
  process.exit(1);
}
if (alias.deterministic_caller_migration !== true) {
  console.error('mechanical-only success shape requires deterministic_caller_migration true; got',
    alias.deterministic_caller_migration);
  process.exit(1);
}
const reasons = (alias.blocking_reasons || []).join('\n');
if (/caller migration evidence missing or incomplete/i.test(reasons)) {
  console.error('mechanical-only must not emit migration-incomplete blocker; got:', reasons);
  process.exit(1);
}
if (!alias.mechanical_caller_migration_scan || alias.mechanical_caller_migration_scan.complete !== true) {
  console.error('mechanical scan must report complete');
  process.exit(1);
}
console.log('alias_mechanical_only_success_shape=ok');
NODE
assert_eq "0" "$?" "mechanical-only migration success shape with overall HOLD"
rm -rf "$MECH_REPO" "$MECH_PROJ"

# Authority-only: residual real-repo skills fail mechanical scan, but an
# independently provisioned pinned adapter binding authenticates a migration receipt.
AUTH_ONLY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/alias-auth-only.XXXXXX")"
AUTH_ONLY_AUTH="$(mktemp -d "${TMPDIR:-/tmp}/alias-auth-only-auth.XXXXXX")"
mkdir -p "$AUTH_ONLY_DIR/production-telemetry"
AUTH_ONLY_META="$(node - "$REPO_ROOT" "$AUTH_ONLY_DIR" "$AUTH_ONLY_AUTH" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = process.argv[2];
const dir = process.argv[3];
const authDir = process.argv[4];
const { sha256, canonicalJson } = require(path.join(root, 'src/engine/owner-kernel/canonical'));
const streamId = 'alias-auth-only-stream';
const runId = 'alias-auth-only-run';
function headOf(base) { return sha256(canonicalJson(base)); }
const cycleBody = { compatibility_cycle_id: 'alias-auth-only-cycle' };
const cycleEventHash = sha256(canonicalJson(cycleBody));
const cycleBase = {
  run_id: runId, stream_id: streamId, sequence: 1,
  event_hash: cycleEventHash, previous_witness_head: null,
};
const cycleHead = headOf(cycleBase);
const cycleReceipt = { ...cycleBase, witness_head: cycleHead };
const migrationBody = { complete: true, callers_migrated: ['l3', 'l4', 'l5', 'l6'] };
const migrationHash = sha256(canonicalJson(migrationBody));
const migBase = {
  run_id: runId, stream_id: streamId, sequence: 2,
  event_hash: migrationHash, previous_witness_head: cycleHead,
};
const migHead = headOf(migBase);
const migrationReceipt = { ...migBase, witness_head: migHead };
const journal = [cycleReceipt, migrationReceipt];
const adapterPath = path.join(authDir, 'external-witness-adapter.js');
fs.writeFileSync(adapterPath, `'use strict';
const crypto = require('crypto');
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
}
function createAuthority({ streamId, receipts, anchored_append_timestamps }) {
  const known = new Map();
  for (const entry of receipts || []) known.set(String(entry.witness_head).toLowerCase(), entry);
  const anchored = new Map(Object.entries(anchored_append_timestamps || {}).map(([k, v]) => [String(k).toLowerCase(), v]));
  return {
    streamId, trustTier: 'external',
    identity: 'external-adapter:' + streamId,
    attestation_hash: sha256('external-adapter:' + streamId),
    protocol_version: 1,
    getAppendTimestamp(r) { return anchored.get(String(r.witness_head).toLowerCase()) || null; },
    append() { throw new Error('unused'); },
    verify(receipt) {
      if (!receipt || receipt.stream_id !== streamId) return false;
      const head = String(receipt.witness_head).toLowerCase();
      if (!known.has(head)) return false;
      const expected = sha256(canonicalJson({
        run_id: receipt.run_id, stream_id: receipt.stream_id, sequence: receipt.sequence,
        event_hash: receipt.event_hash, previous_witness_head: receipt.previous_witness_head,
      }));
      return expected === receipt.witness_head;
    },
  };
}
module.exports = { createAuthority };
`);
const adapterPin = crypto.createHash('sha256').update(fs.readFileSync(adapterPath)).digest('hex');
const authPath = path.join(authDir, 'trusted-installed-witness-authority.json');
fs.writeFileSync(authPath, JSON.stringify({
  kind: 'trusted_installed_witness_authority',
  authority_id: 'alias-auth-only-1',
  stream_id: streamId,
  receipts: journal,
}, null, 2));
const bindingPath = path.join(authDir, 'trusted-witness-adapter-binding.json');
fs.writeFileSync(bindingPath, JSON.stringify({
  kind: 'trusted_installed_witness_adapter_binding',
  authority_id: 'alias-auth-only-1',
  adapter_module: adapterPath,
  adapter_sha256: adapterPin,
}, null, 2));
fs.writeFileSync(path.join(dir, 'production-telemetry', 'alias-retirement.json'), JSON.stringify({
  compatibility_cycle_id: 'alias-auth-only-cycle',
  shipped_compatibility_cycle: true,
  compatibility_cycle_receipt_body: cycleBody,
  compatibility_cycle_ship_receipt: cycleReceipt,
  witnessed_zero_use_days: 0,
  translation_used_events: 0,
  unresolved_translation_deltas: 0,
  deterministic_caller_migration: false,
  caller_migration_complete: false,
  caller_migration_scan_body: migrationBody,
  caller_migration_scan_hash: migrationHash,
  caller_migration_witness_receipt: migrationReceipt,
  witnessed_day_records: [],
}, null, 2));
process.stdout.write(JSON.stringify({ auth: authPath, binding: bindingPath }));
NODE
)"
AUTH_ONLY_PATH="$(node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(j.auth)' "$AUTH_ONLY_META")"
AUTH_ONLY_BINDING="$(node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(j.binding)' "$AUTH_ONLY_META")"
AUTH_ONLY_OUT="$(
  AUTOPILOT_TRUSTED_INSTALLED_WITNESS_AUTHORITY="$AUTH_ONLY_PATH" \
  AUTOPILOT_TRUSTED_WITNESS_ADAPTER_BINDING="$AUTH_ONLY_BINDING" \
  node "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js" \
    --project "$AUTH_ONLY_DIR" \
    --repo-root "$REPO_ROOT" 2>&1
)"
node - "$AUTH_ONLY_OUT" <<'NODE'
const report = JSON.parse(process.argv[2]);
const alias = report.alias_retirement;
if (!alias || alias.status !== 'HOLD') {
  console.error('authority-only must preserve overall HOLD; got', alias && alias.status);
  process.exit(1);
}
if (alias.trusted_authority_present !== true) {
  console.error('authority-only requires trusted_authority_present');
  process.exit(1);
}
if (alias.deterministic_caller_migration !== true) {
  console.error('authority-only success shape requires deterministic_caller_migration true; got',
    alias.deterministic_caller_migration);
  process.exit(1);
}
const reasons = (alias.blocking_reasons || []).join('\n');
if (/caller migration evidence missing or incomplete/i.test(reasons)) {
  console.error('authority-only must not emit migration-incomplete blocker; got:', reasons);
  process.exit(1);
}
if (alias.mechanical_caller_migration_scan && alias.mechanical_caller_migration_scan.complete === true) {
  console.error('authority-only fixture expected residual mechanical scan failure on real repo');
  process.exit(1);
}
console.log('alias_authority_only_success_shape=ok');
NODE
assert_eq "0" "$?" "authority-only migration success shape with overall HOLD"
rm -rf "$AUTH_ONLY_DIR" "$AUTH_ONLY_AUTH"

# Source asserts for containment / authority-issued append timestamps / OR contracts.
CHECKER_SRC="$(cat "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js")"
assert_contains "$CHECKER_SRC" 'realpathSync' \
  "authority path containment uses realpath"
assert_contains "$CHECKER_SRC" 'getAppendTimestamp' \
  "day receipts require adapter-owned getAppendTimestamp"
assert_contains "$CHECKER_SRC" 'AUTOPILOT_TRUSTED_WITNESS_ADAPTER_BINDING' \
  "adapter identity comes from deployment binding"
assert_contains "$CHECKER_SRC" 'sanitizeReceiptForTimestampLookup' \
  "timestamp lookup sanitizes receipts"
assert_contains "$CHECKER_SRC" 'migrationScan.complete === true' \
  "migration OR includes mechanical scan complete"
assert_contains "$CHECKER_SRC" 'migrationAuthorityAuthenticated === true' \
  "migration OR includes authority authentication"
assert_not_contains "$CHECKER_SRC" 'caller_migration_complete === true' \
  "untrusted telemetry completion flag is not required for migration"
if printf '%s' "$CHECKER_SRC" | grep -q 'allowTestWitness: true'; then
  echo "FAIL: allowTestWitness:true is forbidden for release evidence" >&2
  exit 1
fi

echo "PASS [owner-kernel-alias-retirement] alias retirement gate stays HOLD without deletion"
finalize_test
