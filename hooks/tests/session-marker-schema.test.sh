#!/usr/bin/env bash
# hooks/tests/session-marker-schema.test.sh — schemas/session-marker.schema.json vs its fixtures (P2a).
# Every valid-*.json must be accepted and every invalid-*.json rejected; a missing fixture dir or a missing
# valid-/invalid- side fails (no skip). Moved out of scripts/check-contract-schema.js, which must also run
# inside the generated Codex package where these fixtures are not shipped.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FX="${SESSION_MARKER_FIXTURE_DIR:-$REPO_ROOT/hooks/tests/fixtures/session-marker}"
SCHEMA="$REPO_ROOT/schemas/session-marker.schema.json"
PASS=0; FAILS=0
ok() { PASS=$((PASS+1)); echo "ok: $*"; }
bad() { FAILS=$((FAILS+1)); echo "FAIL: $*" >&2; }

if [ ! -d "$FX" ]; then bad "fixture dir missing: $FX"; fi
shopt -s nullglob
VALID=("$FX"/valid-*.json); INVALID=("$FX"/invalid-*.json)
[ "${#VALID[@]}" -ge 1 ] && ok "at least one valid-*.json fixture (${#VALID[@]})" || bad "no valid-*.json fixture in $FX"
[ "${#INVALID[@]}" -ge 1 ] && ok "at least one invalid-*.json fixture (${#INVALID[@]})" || bad "no invalid-*.json fixture in $FX"

verdict() { SCHEMA="$SCHEMA" F="$1" node -e '
const { validateJsonSchema } = require(process.argv[1]);
const fs = require("fs");
const r = validateJsonSchema(JSON.parse(fs.readFileSync(process.env.SCHEMA, "utf8")), JSON.parse(fs.readFileSync(process.env.F, "utf8")));
process.stdout.write(r.valid ? "accepted" : "rejected");' "$REPO_ROOT/scripts/validate-json-schema.js" 2>&1 || true; }

for f in "${VALID[@]}"; do
  v=$(verdict "$f"); [ "$v" = accepted ] && ok "$(basename "$f") accepted" || bad "$(basename "$f") should be accepted, got [$v]"
done
for f in "${INVALID[@]}"; do
  v=$(verdict "$f"); [ "$v" = rejected ] && ok "$(basename "$f") rejected" || bad "$(basename "$f") should be rejected, got [$v]"
done

echo "Summary: $PASS passed, $FAILS failed"
[ "$FAILS" -eq 0 ]
