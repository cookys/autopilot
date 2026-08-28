#!/usr/bin/env bash
# hooks/tests/qualification-asset-seals.test.sh
#
# D4 acceptance (plan: docs/plans/2026-08-28-consult-discuss-qualification.md,
# D4 "rubric freeze + pinned assets + anti-gaming") for
# scripts/lib/qualification-asset-seals.js — the load-bearing seal/pin check
# consult and discuss qualification MUST refuse to run without.
#
# Covers:
#   1. clean state: both roles verify green, five frozen identities returned.
#   2. tampered rubric bytes (seal left stale) -> refuses (throws), both roles.
#   3. tampered seal (rubric bytes intact) -> refuses (throws), both roles.
#   4. tampered corpus manifest bytes (seal stale) -> refuses.
#   5. a pinned-hash constant drifted from the real file (simulates an
#      un-re-pinned edit) -> refuses even when the rubric-freeze relationship
#      is internally consistent (both file and seal edited together).
#   6. unknown role -> throws, not a silent pass.
#
# All mutation happens on sandboxed COPIES in TEST_TMP; the repo's real evals/
# assets are never touched.
. "$(dirname "$0")/lib.sh"

LIB="$REPO_ROOT/scripts/lib/qualification-asset-seals.js"
assert_file_exists "$LIB" "qualification-asset-seals.js exists"

node --check "$LIB" >/dev/null 2>&1
assert_exit_code "$?" "0" "qualification-asset-seals.js: valid JS syntax"

# ── 1. clean state: both roles verify green with five identities ───────────
for ROLE in consult discuss; do
  OUT="$(node -e "
    const s = require('$LIB');
    const ids = s.frozenIdentities('$ROLE');
    console.log(JSON.stringify(ids));
  " 2>&1)"
  RC=$?
  assert_exit_code "$RC" "0" "$ROLE: verifyPinnedEvaluationAssets clean state exits 0"
  assert_contains "$OUT" '"role":"'"$ROLE"'"' "$ROLE: frozenIdentities reports its own role"
  assert_contains "$OUT" '"generator":"' "$ROLE: frozenIdentities carries generator identity"
  assert_contains "$OUT" '"grader":"' "$ROLE: frozenIdentities carries grader identity"
  assert_contains "$OUT" '"corpus":"' "$ROLE: frozenIdentities carries corpus identity"
  assert_contains "$OUT" '"rubric":"' "$ROLE: frozenIdentities carries rubric identity"
  assert_contains "$OUT" '"seal":"' "$ROLE: frozenIdentities carries seal identity"
done

# checkAssetSeals alias behaves identically to verifyPinnedEvaluationAssets.
ALIAS_OUT="$(node -e "
  const s = require('$LIB');
  console.log(JSON.stringify(s.checkAssetSeals('consult')));
" 2>&1)"
assert_exit_code "$?" "0" "checkAssetSeals('consult') clean state exits 0"

# Role-specific convenience wrappers.
node -e "require('$LIB').verifyPinnedConsultEvaluationAssets()" >/dev/null 2>&1
assert_exit_code "$?" "0" "verifyPinnedConsultEvaluationAssets() clean state exits 0"
node -e "require('$LIB').verifyPinnedDiscussEvaluationAssets()" >/dev/null 2>&1
assert_exit_code "$?" "0" "verifyPinnedDiscussEvaluationAssets() clean state exits 0"

# ── sandbox setup: a full repo-relative copy so path.join(__dirname,'..','..')
# resolution inside the lib still lands on evals/ + scripts/lib/ correctly ──
mk_sandbox() {
  local dir="$TEST_TMP/sandbox-$1"
  mkdir -p "$dir/scripts/lib" "$dir/evals"
  cp "$LIB" "$dir/scripts/lib/qualification-asset-seals.js"
  cp "$REPO_ROOT/evals/consult-eval-generator.js" "$dir/evals/"
  cp "$REPO_ROOT/evals/consult-eval-grader.js" "$dir/evals/"
  cp "$REPO_ROOT/evals/consult-capability-evidence-corpus.json" "$dir/evals/"
  cp "$REPO_ROOT/evals/consult-capability-evidence-corpus.seal.json" "$dir/evals/"
  cp "$REPO_ROOT/evals/consult-eval-rubric.md" "$dir/evals/"
  cp "$REPO_ROOT/evals/consult-eval-rubric.seal.json" "$dir/evals/"
  cp "$REPO_ROOT/evals/discuss-eval-generator.js" "$dir/evals/"
  cp "$REPO_ROOT/evals/discuss-eval-grader.js" "$dir/evals/"
  cp "$REPO_ROOT/evals/discuss-capability-evidence-corpus.json" "$dir/evals/"
  cp "$REPO_ROOT/evals/discuss-capability-evidence-corpus.seal.json" "$dir/evals/"
  cp "$REPO_ROOT/evals/discuss-eval-rubric.md" "$dir/evals/"
  cp "$REPO_ROOT/evals/discuss-eval-rubric.seal.json" "$dir/evals/"
  echo "$dir"
}

# Sanity: an untouched sandbox copy still verifies clean (proves the fixture
# harness itself is not what makes the negatives below fail).
SANDBOX_CLEAN="$(mk_sandbox clean)"
node -e "require('$SANDBOX_CLEAN/scripts/lib/qualification-asset-seals.js').frozenIdentities('consult')" >/dev/null 2>&1
assert_exit_code "$?" "0" "sandbox harness sanity: untouched copy verifies clean (consult)"
node -e "require('$SANDBOX_CLEAN/scripts/lib/qualification-asset-seals.js').frozenIdentities('discuss')" >/dev/null 2>&1
assert_exit_code "$?" "0" "sandbox harness sanity: untouched copy verifies clean (discuss)"

# ── 2. tampered rubric bytes, seal left stale -> refuses (both roles) ──────
for ROLE in consult discuss; do
  SB="$(mk_sandbox "rubric-tamper-$ROLE")"
  printf '\n<!-- tampered -->\n' >> "$SB/evals/${ROLE}-eval-rubric.md"
  ERR="$(node -e "require('$SB/scripts/lib/qualification-asset-seals.js').frozenIdentities('$ROLE')" 2>&1 1>/dev/null)"
  RC=$?
  assert_exit_code "$RC" "1" "$ROLE: tampered rubric bytes (seal stale) -> throws, non-zero exit"
  assert_contains "$ERR" "pinned hash" "$ROLE: tampered rubric bytes -> pinned-hash drift error, not a silent pass"
done

# ── 3. tampered seal (rubric bytes intact) -> refuses (both roles) ─────────
for ROLE in consult discuss; do
  SB="$(mk_sandbox "seal-tamper-$ROLE")"
  # Corrupt the seal's pinned digest so it no longer matches the (untouched)
  # rubric bytes, while keeping the JSON shape valid.
  node -e "
    const fs = require('fs');
    const p = '$SB/evals/${ROLE}-eval-rubric.seal.json';
    const seal = JSON.parse(fs.readFileSync(p, 'utf8'));
    seal.spec_sha256 = '0'.repeat(64);
    fs.writeFileSync(p, JSON.stringify(seal, null, 2));
  "
  ERR="$(node -e "require('$SB/scripts/lib/qualification-asset-seals.js').frozenIdentities('$ROLE')" 2>&1 1>/dev/null)"
  RC=$?
  assert_exit_code "$RC" "1" "$ROLE: tampered seal (rubric bytes intact) -> throws, non-zero exit"
  assert_contains "$ERR" "pinned hash" "$ROLE: tampered seal -> pinned-hash drift error, not a silent pass"
done

# ── 3b. seal's spec_sha256 pointed at the WRONG (but plausible) digest, with
# both the rubric bytes AND the seal file's own bytes re-pinned to match each
# other post-tamper — isolates the seal-RELATIONSHIP check (assertSealFrozen)
# from the static pinned-hash check (assertPinned), so this negative fails
# even if a future edit removed the static pins and kept only the relationship
# check, or vice versa. ─────────────────────────────────────────────────────
SB3B="$(mk_sandbox "seal-relationship-tamper")"
node -e "
  const fs = require('fs');
  const crypto = require('crypto');
  const libPath = '$SB3B/scripts/lib/qualification-asset-seals.js';
  const sealPath = '$SB3B/evals/consult-eval-rubric.seal.json';
  // Point the seal at a plausible-looking but wrong digest (not all-zeros,
  // not the real rubric digest), then re-derive that seal FILE's own hash
  // and patch the library's static EXPECTED_CONSULT_SEAL_HASH pin to match
  // it — so only the rubric<->seal RELATIONSHIP check can still catch this.
  const seal = JSON.parse(fs.readFileSync(sealPath, 'utf8'));
  seal.spec_sha256 = crypto.createHash('sha256').update('wrong-but-well-formed').digest('hex');
  fs.writeFileSync(sealPath, JSON.stringify(seal, null, 2));
  const newSealFileHash = crypto.createHash('sha256').update(fs.readFileSync(sealPath)).digest('hex');
  let lib = fs.readFileSync(libPath, 'utf8');
  lib = lib.replace(
    /const EXPECTED_CONSULT_SEAL_HASH = '[0-9a-f]{64}'/,
    \"const EXPECTED_CONSULT_SEAL_HASH = '\" + newSealFileHash + \"'\"
  );
  fs.writeFileSync(libPath, lib);
"
ERR3B="$(node -e "require('$SB3B/scripts/lib/qualification-asset-seals.js').frozenIdentities('consult')" 2>&1 1>/dev/null)"
RC3B=$?
assert_exit_code "$RC3B" "1" "seal relationship tamper (static pins re-matched) -> still refuses"
assert_contains "$ERR3B" "DRIFT" "seal relationship tamper -> caught by relationship check specifically (DRIFT), proving it is not dead code"

# ── 4. tampered corpus manifest bytes, seal left stale -> refuses ──────────
for ROLE in consult discuss; do
  SB="$(mk_sandbox "corpus-tamper-$ROLE")"
  node -e "
    const fs = require('fs');
    const p = '$SB/evals/${ROLE}-capability-evidence-corpus.json';
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.__tamper_marker = true;
    fs.writeFileSync(p, JSON.stringify(j, null, 2));
  "
  ERR="$(node -e "require('$SB/scripts/lib/qualification-asset-seals.js').frozenIdentities('$ROLE')" 2>&1 1>/dev/null)"
  RC=$?
  assert_exit_code "$RC" "1" "$ROLE: tampered corpus manifest (seal stale) -> throws, non-zero exit"
  assert_contains "$ERR" "corpus" "$ROLE: tampered corpus manifest -> error names the corpus asset"
done

# ── 5. rubric + its seal edited TOGETHER (relationship still consistent),
# but the pinned hash constants baked into the library were not re-derived
# -> still refuses. This is the check that a coordinated tamper (or a real
# edit that forgot to re-pin the library) cannot slip through just because
# rubric-freeze.js's own two-file relationship check would pass. ─────────
SB5="$(mk_sandbox "coordinated-tamper")"
node -e "
  const fs = require('fs');
  const crypto = require('crypto');
  const rubricPath = '$SB5/evals/consult-eval-rubric.md';
  const sealPath = '$SB5/evals/consult-eval-rubric.seal.json';
  fs.appendFileSync(rubricPath, '\n<!-- coordinated tamper -->\n');
  const digest = crypto.createHash('sha256').update(fs.readFileSync(rubricPath)).digest('hex');
  const seal = JSON.parse(fs.readFileSync(sealPath, 'utf8'));
  seal.spec_sha256 = digest;
  fs.writeFileSync(sealPath, JSON.stringify(seal, null, 2));
"
# Confirm the relationship IS internally consistent post-tamper (rubric-freeze
# check alone would pass) — this is what makes the negative meaningful.
node "$REPO_ROOT/scripts/rubric-freeze.js" check "$SB5/evals/consult-eval-rubric.md" "$SB5/evals/consult-eval-rubric.seal.json" >/dev/null 2>&1
assert_exit_code "$?" "0" "coordinated-tamper sanity: rubric-freeze.js check alone sees FROZEN (relationship consistent)"
ERR5="$(node -e "require('$SB5/scripts/lib/qualification-asset-seals.js').frozenIdentities('consult')" 2>&1 1>/dev/null)"
RC5=$?
assert_exit_code "$RC5" "1" "coordinated rubric+seal tamper still refuses (pinned constant catches it)"
assert_contains "$ERR5" "pinned hash" "coordinated tamper -> pinned-hash drift error, not a silent pass"

# ── 6. unknown role -> throws, not a silent pass ────────────────────────────
ERR6="$(node -e "require('$LIB').checkAssetSeals('bogus-role')" 2>&1 1>/dev/null)"
RC6=$?
assert_exit_code "$RC6" "1" "unknown role -> throws"
assert_contains "$ERR6" "unknown role" "unknown role -> named error, not a silent pass or crash-elsewhere"

finalize_test
