#!/usr/bin/env bash
# P1 live reverse probe: verify check-plan-phases.js accepts a valid phases:v1 table
# and rejects a single-parameter violation (forward reference).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LINT="$REPO_ROOT/scripts/check-plan-phases.js"

TMPDIR_PROBE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_PROBE"' EXIT
export HOME="$TMPDIR_PROBE/home"
mkdir -p "$HOME"

cat > "$TMPDIR_PROBE/valid.md" <<'EOF'
# Plan
## 4. Phases
<!-- phases:v1 -->
| id | size | depends_on | acceptance_cmd | needs_look | title |
|----|------|------------|----------------|------------|-------|
| P1 | S    | -          | echo ok 1      | no         | First phase |
| P2 | M    | P1         | echo ok 2      | yes        | Second phase |
<!-- /phases -->
EOF

node "$LINT" "$TMPDIR_PROBE/valid.md" >/dev/null

cat > "$TMPDIR_PROBE/bad.md" <<'EOF'
# Plan
## 4. Phases
<!-- phases:v1 -->
| id | size | depends_on | acceptance_cmd | needs_look | title |
|----|------|------------|----------------|------------|-------|
| P1 | S    | P2         | echo ok 1      | no         | First phase |
| P2 | M    | -          | echo ok 2      | yes        | Second phase |
<!-- /phases -->
EOF

set +e
err="$(node "$LINT" "$TMPDIR_PROBE/bad.md" 2>&1 >/dev/null)"
rc=$?
set -e

if [ "$rc" -eq 0 ]; then
  echo "FAIL (p1): expected non-zero exit on forward reference" >&2
  exit 1
fi
if ! printf '%s' "$err" | grep -q "phases:v1"; then
  echo "FAIL (p1): expected 'phases:v1' in stderr, got: $err" >&2
  exit 1
fi

echo "PASS (p1)"
