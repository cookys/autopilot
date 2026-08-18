#!/usr/bin/env bash
# hooks/tests/profile-guided-dispositions.test.sh — red/green suite for the guided-baseline
# three-class disposition ontology (dev-flow-contract-card P4; G2-F1 fold).
#
# The check under test: build-profile-payload.js validateGuidedCompatibility — every P0
# baseline rule must be present in the (successor-universe) current multiset OR carry an
# explicit removed/rewritten disposition. Red cases mutate a SANDBOX copy's baseline side
# (snapshot + archived record hash), never the real archive.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TEST_TMP=$(mktemp -d -t "guided-dispositions-test-XXXXXX")
trap 'rm -rf "$TEST_TMP"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

SANDBOX="$TEST_TMP/repo"
mkdir -p "$SANDBOX/skills" "$SANDBOX/docs/projects/_archive"
cp -r "$REPO_ROOT/profiles" "$SANDBOX/profiles"
cp -r "$REPO_ROOT/skills/ceo-agent" "$SANDBOX/skills/ceo-agent"
cp -r "$REPO_ROOT/skills/dev-flow" "$SANDBOX/skills/dev-flow"
cp -r "$REPO_ROOT/docs/projects/_archive/2026-07-26-capability-adaptive-profiles" \
      "$SANDBOX/docs/projects/_archive/2026-07-26-capability-adaptive-profiles"

check() { # → echoes exit code; output to $TEST_TMP/check-out.txt
  set +e
  node "$REPO_ROOT/scripts/build-profile-payload.js" catalog --check --repo "$SANDBOX" \
    > "$TEST_TMP/check-out.txt" 2>&1
  echo $?
  set -e
}
expect_code() { # $1 want-exit-nonzero-with-token $2 label
  grep -q "$1" "$TEST_TMP/check-out.txt" || { cat "$TEST_TMP/check-out.txt" >&2; fail "$2: expected token $1"; }
}

echo "=== green: pristine sandbox passes ==="
rc=$(check); [ "$rc" -eq 0 ] || { cat "$TEST_TMP/check-out.txt" >&2; fail "pristine sandbox red (rc=$rc)"; }

# Helper: plant a synthetic rule into the baseline (snapshot + archived record hash),
# so the CURRENT tree is short exactly one known-hash rule.
FAKE_RULE="- synthetic baseline rule planted by profile-guided-dispositions.test.sh"
plant() {
  node -e '
    const fs=require("fs"),path=require("path"),crypto=require("crypto");
    const { sha256 }=require(process.argv[2]+"/scripts/measure-profile-context.js");
    const sandbox=process.argv[1];
    const rule=process.argv[3];
    const basePath=path.join(sandbox,"docs/projects/_archive/2026-07-26-capability-adaptive-profiles/p0-context-baseline.json");
    const base=JSON.parse(fs.readFileSync(basePath,"utf8"));
    const entry=base.source_surface.files.find(f=>f.path==="skills/dev-flow/SKILL.md");
    const snapPath=path.join(sandbox,"profiles/p0-sources",sha256("skills/dev-flow/SKILL.md")+".txt");
    const snap=fs.readFileSync(snapPath,"utf8")+rule+"\n";
    fs.writeFileSync(snapPath,snap);
    entry.sha256=sha256(snap);
    fs.writeFileSync(basePath,JSON.stringify(base,null,2)+"\n");
    console.log(sha256(rule.trim().replace(/\s+/g," ")));
  ' "$SANDBOX" "$REPO_ROOT" "$FAKE_RULE"
}
set_dispositions() { # $1 = JSON array for dispositions
  node -e '
    const fs=require("fs"),path=require("path"),crypto=require("crypto");
    const sandbox=process.argv[1];
    const f=path.join(sandbox,"profiles/guided-baseline-dispositions.json");
    const doc=JSON.parse(fs.readFileSync(f,"utf8"));
    doc.dispositions=JSON.parse(process.argv[2]);
    fs.writeFileSync(f,JSON.stringify(doc,null,2)+"\n");
    const sha=x=>crypto.createHash("sha256").update(fs.readFileSync(x)).digest("hex");
    const catPath=path.join(sandbox,"profiles/profile-catalog.json");
    const cat=JSON.parse(fs.readFileSync(catPath,"utf8"));
    cat.guided_dispositions_sha256=sha(f);
    fs.writeFileSync(catPath,JSON.stringify(cat,null,2)+"\n");
  ' "$SANDBOX" "$1"
}

echo "=== red: baseline rule missing, no disposition ==="
HASH=$(plant)
rc=$(check); [ "$rc" -ne 0 ] || fail "missing rule with no disposition passed"
expect_code "PROFILE_GUIDED_COMPATIBILITY_DRIFT" "no-disposition case"

echo "=== green: removed disposition discharges loudly ==="
set_dispositions "[{\"content_hash\":\"$HASH\",\"disposition\":\"removed\",\"rationale\":\"test: true deletion with recorded rationale\"}]"
rc=$(check); [ "$rc" -eq 0 ] || { cat "$TEST_TMP/check-out.txt" >&2; fail "removed disposition did not discharge"; }

echo "=== red: rewritten disposition naming an absent successor ==="
set_dispositions "[{\"content_hash\":\"$HASH\",\"disposition\":\"rewritten\",\"successor_hashes\":[\"$(printf 'a%.0s' $(seq 64))\"],\"rationale\":\"test: successor does not exist\"}]"
rc=$(check); [ "$rc" -ne 0 ] || fail "absent successor passed"
expect_code "PROFILE_GUIDED_DISPOSITION_SUCCESSOR_MISSING" "absent-successor case"

echo "=== green: rewritten disposition naming a PRESENT successor ==="
PRESENT_HASH=$(node -e '
  const path=require("path");
  const { sha256, extractRuleCandidates, canonicalizeProjectedSkillSource }=require(process.argv[2]+"/scripts/measure-profile-context.js");
  const fs=require("fs");
  const src=canonicalizeProjectedSkillSource(fs.readFileSync(path.join(process.argv[1],"skills/dev-flow/SKILL.md"),"utf8"),process.argv[1],"skills/dev-flow/SKILL.md");
  console.log(extractRuleCandidates(src)[0].content_hash);
' "$SANDBOX" "$REPO_ROOT")
set_dispositions "[{\"content_hash\":\"$HASH\",\"disposition\":\"rewritten\",\"successor_hashes\":[\"$PRESENT_HASH\"],\"rationale\":\"test: reworded into an existing rule\"}]"
rc=$(check); [ "$rc" -eq 0 ] || { cat "$TEST_TMP/check-out.txt" >&2; fail "present successor rejected"; }

echo "=== red: dead disposition (rule still present in current tree) ==="
set_dispositions "[{\"content_hash\":\"$PRESENT_HASH\",\"disposition\":\"removed\",\"rationale\":\"test: stale entry\"},{\"content_hash\":\"$HASH\",\"disposition\":\"removed\",\"rationale\":\"test: keeps the planted shortfall discharged\"}]"
rc=$(check); [ "$rc" -ne 0 ] || fail "dead disposition passed"
expect_code "PROFILE_GUIDED_DISPOSITION_DEAD" "dead-disposition case"

echo "=== red: disposition for a hash not in the baseline at all ==="
set_dispositions "[{\"content_hash\":\"$(printf 'b%.0s' $(seq 64))\",\"disposition\":\"removed\",\"rationale\":\"test: alien hash\"},{\"content_hash\":\"$HASH\",\"disposition\":\"removed\",\"rationale\":\"test: keeps the planted shortfall discharged\"}]"
rc=$(check); [ "$rc" -ne 0 ] || fail "alien-hash disposition passed"
expect_code "PROFILE_GUIDED_DISPOSITION_DEAD" "alien-hash case"

echo "=== red: catalog does not bind the dispositions file (tamper without catalog update) ==="
set_dispositions "[{\"content_hash\":\"$HASH\",\"disposition\":\"removed\",\"rationale\":\"test: valid state\"}]"
node -e '
  const fs=require("fs"),path=require("path");
  const f=path.join(process.argv[1],"profiles/guided-baseline-dispositions.json");
  const doc=JSON.parse(fs.readFileSync(f,"utf8"));
  doc.note=(doc.note||"")+" tampered";
  fs.writeFileSync(f,JSON.stringify(doc,null,2)+"\n");
' "$SANDBOX"
rc=$(check); [ "$rc" -ne 0 ] || fail "dispositions tamper without catalog update passed"

echo "PASS: guided-baseline dispositions red/green suite"
