#!/usr/bin/env bash
# Harness for scripts/pin-evidence-anchors.js — the commit-side evidence anchor.
#
# The failure this guards against is silent and unrecoverable: a mission receipt
# names a commit SHA, the only ref holding that commit is a dispatch branch, the
# branch is reaped, and `git gc` reclaims the object. The receipt still claims
# "verified"; the thing it verified is gone. This repo lost four commits that way
# before the anchor namespace existed.
#
# Proves: scan is genuinely read-only, an unreachable receipt-referenced commit is
# found, a reachable one is not (no ref churn), apply makes it reachable and is
# idempotent, every anchor ref name equals the object it points at, content digests
# that merely look like SHAs are not mistaken for commits, and a repo with no
# mission state is a clean no-op rather than an error.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/pin-evidence-anchors.js"
PASS=0; FAIL=0
TESTDIR="$(mktemp -d)"
trap 'rm -rf "$TESTDIR"' EXIT

ok()  { PASS=$((PASS+1)); printf 'PASS: %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FAIL: %s\n' "$1"; }

jfield() { node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));const p=process.argv[1].split(".");let v=d;for(const k of p)v=v[k];console.log(Array.isArray(v)?v.length:v)' "$1"; }

# ---- fixture: a repo with mission receipts naming both reachable and orphaned commits
REPO="$TESTDIR/repo"
git init -q "$REPO"
git -C "$REPO" config user.email t@t; git -C "$REPO" config user.name t
printf 'a\n' > "$REPO/f"; git -C "$REPO" add f; git -C "$REPO" commit -qm base
BASE="$(git -C "$REPO" rev-parse HEAD)"

# an orphan: committed on a side branch, then the branch is deleted
git -C "$REPO" checkout -q -b side
printf 'b\n' > "$REPO/f"; git -C "$REPO" commit -qam side
ORPHAN="$(git -C "$REPO" rev-parse HEAD)"
git -C "$REPO" checkout -q master 2>/dev/null || git -C "$REPO" checkout -q main
git -C "$REPO" branch -qD side

COMMON="$(git -C "$REPO" rev-parse --path-format=absolute --git-common-dir)"
mkdir -p "$COMMON/autopilot/mission/journals/x"
# a receipt referencing BOTH: the orphan (must be found) and the reachable base
# (must not be), plus a content digest that is 40 hex but not an object at all.
cat > "$COMMON/autopilot/mission/journals/x/r.applied.json" <<EOF
{
  "artifact_type": "campaign_terminal_receipt",
  "candidate_sha": "$ORPHAN",
  "base_sha": "$BASE",
  "some_content_digest": "0123456789abcdef0123456789abcdef01234567"
}
EOF

# ---- scan finds the orphan, ignores the reachable one and the fake digest
OUT="$(node "$SCRIPT" scan --repo-root "$REPO" --json)"
[ "$(printf '%s' "$OUT" | jfield unreachable)" = "1" ] \
  && ok "scan finds exactly the unreachable receipt-referenced commit" \
  || bad "scan unreachable count wrong: $OUT"
printf '%s' "$OUT" | grep -q "$ORPHAN" \
  && ok "scan names the orphan" || bad "scan did not name the orphan"
printf '%s' "$OUT" | grep -q "$BASE" \
  && bad "scan wrongly listed the reachable commit" || ok "reachable commit is not listed"
[ "$(printf '%s' "$OUT" | jfield candidates)" = "2" ] \
  && ok "the fake 40-hex digest is not counted as a commit" \
  || bad "candidate count wrong (fake digest miscounted?): $OUT"

# ---- scan must not write anything
REFS_BEFORE="$(git -C "$REPO" for-each-ref refs/autopilot | wc -l)"
node "$SCRIPT" scan --repo-root "$REPO" --json >/dev/null
REFS_AFTER="$(git -C "$REPO" for-each-ref refs/autopilot | wc -l)"
[ "$REFS_BEFORE" = "$REFS_AFTER" ] && [ "$REFS_BEFORE" = "0" ] \
  && ok "scan is read-only (created no refs)" \
  || bad "scan wrote refs: before=$REFS_BEFORE after=$REFS_AFTER"

# ---- apply pins it, and the orphan becomes reachable
node "$SCRIPT" apply --repo-root "$REPO" >/dev/null
git -C "$REPO" for-each-ref --contains "$ORPHAN" --format='%(refname)' | grep -q evidence-anchors \
  && ok "apply makes the orphan reachable" || bad "orphan still unreachable after apply"

# ---- ref name must equal the object it points at (self-verifying namespace)
MISMATCH="$(git -C "$REPO" for-each-ref refs/autopilot/evidence-anchors \
  --format='%(refname:strip=3) %(objectname)' | awk '$1 != $2' | wc -l)"
[ "$MISMATCH" = "0" ] && ok "every anchor ref name equals its OID" \
  || bad "$MISMATCH anchor(s) have a name/OID mismatch"

# ---- idempotent
OUT2="$(node "$SCRIPT" apply --repo-root "$REPO")"
[ "$(printf '%s' "$OUT2" | jfield pinned)" = "0" ] \
  && ok "second apply pins nothing (idempotent)" || bad "not idempotent: $OUT2"

# ---- a repo with no mission state is a no-op, not an error
BARE="$TESTDIR/plain"
git init -q "$BARE"
if node "$SCRIPT" scan --repo-root "$BARE" --json >/dev/null 2>&1; then
  ok "repo without mission state exits 0"
else
  bad "repo without mission state should be a clean no-op"
fi

# ---- a non-repo fails loudly rather than silently reporting nothing
if node "$SCRIPT" scan --repo-root "$TESTDIR/nope" --json >/dev/null 2>&1; then
  bad "missing repo should fail closed"
else
  ok "missing repo fails closed"
fi

# ---- THE pre-delete case: a receipt SHA reachable ONLY through the branch being
# reaped. Without --exclude-ref it looks reachable and is skipped, then orphaned
# by the very deletion that follows. This is the failure the reaper integration
# exists to prevent, so it is tested at the seam the reaper actually uses.
REPO2="$TESTDIR/predelete"
git init -q "$REPO2"
git -C "$REPO2" config user.email t@t; git -C "$REPO2" config user.name t
printf 'a\n' > "$REPO2/f"; git -C "$REPO2" add f; git -C "$REPO2" commit -qm base
git -C "$REPO2" checkout -q -b doomed
printf 'b\n' > "$REPO2/f"; git -C "$REPO2" commit -qam doomed
HELD="$(git -C "$REPO2" rev-parse HEAD)"
DEFAULT2="$(git -C "$REPO2" symbolic-ref --short HEAD 2>/dev/null || echo master)"
git -C "$REPO2" checkout -q "$(git -C "$REPO2" rev-parse --abbrev-ref HEAD)" 2>/dev/null
git -C "$REPO2" checkout -q master 2>/dev/null || git -C "$REPO2" checkout -q main
COMMON2="$(git -C "$REPO2" rev-parse --path-format=absolute --git-common-dir)"
mkdir -p "$COMMON2/autopilot/mission"
printf '{"candidate_sha":"%s"}\n' "$HELD" > "$COMMON2/autopilot/mission/r.json"

OUT3="$(node "$SCRIPT" scan --repo-root "$REPO2" --json)"
[ "$(printf '%s' "$OUT3" | jfield unreachable)" = "0" ] \
  && ok "without --exclude-ref the branch-held commit looks reachable (baseline)" \
  || bad "baseline wrong: $OUT3"

OUT4="$(node "$SCRIPT" scan --repo-root "$REPO2" --exclude-ref refs/heads/doomed --json)"
[ "$(printf '%s' "$OUT4" | jfield unreachable)" = "1" ] \
  && ok "--exclude-ref exposes the commit the pending deletion would orphan" \
  || bad "pre-delete case NOT detected — the reaper integration would be a no-op: $OUT4"

node "$SCRIPT" apply --repo-root "$REPO2" --exclude-ref refs/heads/doomed >/dev/null
git -C "$REPO2" branch -qD doomed
git -C "$REPO2" for-each-ref --contains "$HELD" --format='%(refname)' | grep -q evidence-anchors \
  && ok "commit survives the deletion it was anchored against" \
  || bad "commit orphaned despite anchoring — the exact regression under test"

# ---- a name/OID mismatched anchor must not mask an unprotected commit
REPO3="$TESTDIR/mismatch"
git init -q "$REPO3"
git -C "$REPO3" config user.email t@t; git -C "$REPO3" config user.name t
printf 'a\n' > "$REPO3/f"; git -C "$REPO3" add f; git -C "$REPO3" commit -qm base
git -C "$REPO3" checkout -q -b tmp
printf 'b\n' > "$REPO3/f"; git -C "$REPO3" commit -qam orphan
ORPH3="$(git -C "$REPO3" rev-parse HEAD)"
BASE3="$(git -C "$REPO3" rev-parse HEAD~1)"
git -C "$REPO3" checkout -q master 2>/dev/null || git -C "$REPO3" checkout -q main
git -C "$REPO3" branch -qD tmp
COMMON3="$(git -C "$REPO3" rev-parse --path-format=absolute --git-common-dir)"
mkdir -p "$COMMON3/autopilot"
printf '{"tip":"%s"}\n' "$ORPH3" > "$COMMON3/autopilot/r.json"
# a ref NAMED for the orphan but POINTING at base — the lie the contract forbids
git -C "$REPO3" update-ref "refs/autopilot/evidence-anchors/$ORPH3" "$BASE3"

OUT5="$(node "$SCRIPT" scan --repo-root "$REPO3" --json)"
printf '%s' "$OUT5" | grep -q "$ORPH3" \
  && ok "mismatched anchor does not mask the unprotected commit" \
  || bad "mismatched anchor wrongly counted as protection: $OUT5"

node "$SCRIPT" apply --repo-root "$REPO3" >/dev/null
MM="$(git -C "$REPO3" for-each-ref refs/autopilot/evidence-anchors \
  --format='%(refname:strip=3) %(objectname)' | awk '$1 != $2' | wc -l)"
[ "$MM" = "0" ] && ok "apply repairs the mismatch (namespace cannot lie)" \
  || bad "mismatch survived apply"

# ---- an unreadable receipt subtree must fail closed, never scan partially
if command -v chmod >/dev/null && [ "$(id -u)" != "0" ]; then
  REPO4="$TESTDIR/unreadable"
  git init -q "$REPO4"
  git -C "$REPO4" config user.email t@t; git -C "$REPO4" config user.name t
  printf 'a\n' > "$REPO4/f"; git -C "$REPO4" add f; git -C "$REPO4" commit -qm base
  COMMON4="$(git -C "$REPO4" rev-parse --path-format=absolute --git-common-dir)"
  mkdir -p "$COMMON4/autopilot/locked"
  printf '{}\n' > "$COMMON4/autopilot/locked/r.json"
  chmod 000 "$COMMON4/autopilot/locked"
  if node "$SCRIPT" scan --repo-root "$REPO4" --json >/dev/null 2>&1; then
    bad "unreadable receipt subtree silently produced a partial scan"
  else
    ok "unreadable receipt subtree fails closed"
  fi
  chmod 755 "$COMMON4/autopilot/locked"
else
  ok "unreadable-subtree case skipped (running as root)"
fi

# ---- a mismatched anchor pointing at a DESCENDANT of the SHA it is named for.
# That ref really does make the named SHA reachable, so counting it while
# computing reachability marks the SHA safe, skips anchoring it, and then apply
# deletes that very ref — orphaning it. Reachability must exclude anchors that are
# about to be removed.
REPO5="$TESTDIR/mismatch-descendant"
git init -q "$REPO5"
git -C "$REPO5" config user.email t@t; git -C "$REPO5" config user.name t
printf 'a\n' > "$REPO5/f"; git -C "$REPO5" add f; git -C "$REPO5" commit -qm base
git -C "$REPO5" checkout -q -b side
printf 'b\n' > "$REPO5/f"; git -C "$REPO5" commit -qam A
SHA_A="$(git -C "$REPO5" rev-parse HEAD)"
printf 'c\n' > "$REPO5/f"; git -C "$REPO5" commit -qam B
SHA_B="$(git -C "$REPO5" rev-parse HEAD)"
git -C "$REPO5" checkout -q master 2>/dev/null || git -C "$REPO5" checkout -q main
git -C "$REPO5" branch -qD side
COMMON5="$(git -C "$REPO5" rev-parse --path-format=absolute --git-common-dir)"
mkdir -p "$COMMON5/autopilot"
printf '{"candidate_sha":"%s"}\n' "$SHA_A" > "$COMMON5/autopilot/r.json"
# named for A, pointing at its descendant B — so A IS reachable through this ref
git -C "$REPO5" update-ref "refs/autopilot/evidence-anchors/$SHA_A" "$SHA_B"

OUT6="$(node "$SCRIPT" scan --repo-root "$REPO5" --json)"
printf '%s' "$OUT6" | grep -q "$SHA_A" \
  && ok "SHA kept alive only by a doomed mismatched anchor is reported" \
  || bad "mismatched-anchor reachability masked the SHA: $OUT6"

node "$SCRIPT" apply --repo-root "$REPO5" >/dev/null
git -C "$REPO5" for-each-ref --contains "$SHA_A" --format='%(refname)' | grep -q evidence-anchors \
  && ok "it survives apply removing the mismatched ref" \
  || bad "orphaned by the repair that was supposed to protect it"
MM5="$(git -C "$REPO5" for-each-ref refs/autopilot/evidence-anchors \
  --format='%(refname:strip=3) %(objectname)' | awk '$1 != $2' | wc -l)"
[ "$MM5" = "0" ] && ok "no mismatched anchor left behind" || bad "mismatch survived"

printf '\n%s: %d passed, %d failed\n' "$(basename "$0")" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
