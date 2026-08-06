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

printf '\n%s: %d passed, %d failed\n' "$(basename "$0")" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
