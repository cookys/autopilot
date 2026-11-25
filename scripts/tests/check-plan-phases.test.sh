#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LINT="$REPO_ROOT/scripts/check-plan-phases.js"
GRAD="$REPO_ROOT/scripts/check-plan-graduation.js"

TMPDIR_TEST="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_TEST"' EXIT
export HOME="$TMPDIR_TEST/home"
mkdir -p "$HOME"

PASS=0
FAIL=0

assert_ok() {
  local name="$1"
  local file="$2"
  if node "$LINT" "$file" >"$TMPDIR_TEST/out" 2>"$TMPDIR_TEST/err"; then
    PASS=$((PASS + 1))
  else
    echo "FAIL ($name): expected rc=0, got rc=$? stderr=$(cat "$TMPDIR_TEST/err")" >&2
    FAIL=$((FAIL + 1))
  fi
}

assert_fail() {
  local name="$1"
  local file="$2"
  if node "$LINT" "$file" >"$TMPDIR_TEST/out" 2>"$TMPDIR_TEST/err"; then
    echo "FAIL ($name): expected rc!=0, got rc=0" >&2
    FAIL=$((FAIL + 1))
  else
    if grep -q "phases:v1" "$TMPDIR_TEST/err"; then
      PASS=$((PASS + 1))
    else
      echo "FAIL ($name): stderr missing 'phases:v1': $(cat "$TMPDIR_TEST/err")" >&2
      FAIL=$((FAIL + 1))
    fi
  fi
}

# 1. Valid table
cat > "$TMPDIR_TEST/valid.md" <<'EOF'
# Plan
## 4. Phases
<!-- phases:v1 -->
| id | size | depends_on | acceptance_cmd | needs_look | title |
|----|------|------------|----------------|------------|-------|
| P1 | S    | -          | bash scripts/tests/a.test.sh | no | First phase |
| P2 | M    | P1         | bash scripts/tests/b.test.sh | yes | Second phase |
<!-- /phases -->
EOF
assert_ok "valid_table" "$TMPDIR_TEST/valid.md"

# 2. Missing column
cat > "$TMPDIR_TEST/missing_col.md" <<'EOF'
<!-- phases:v1 -->
| id | size | depends_on | acceptance_cmd | needs_look | title |
|----|------|------------|----------------|------------|-------|
| P1 | S    | -          | echo ok        | no |
<!-- /phases -->
EOF
assert_fail "missing_col" "$TMPDIR_TEST/missing_col.md"

# 3. Unknown dependency
cat > "$TMPDIR_TEST/unknown_dep.md" <<'EOF'
<!-- phases:v1 -->
| id | size | depends_on | acceptance_cmd | needs_look | title |
|----|------|------------|----------------|------------|-------|
| P1 | S    | P99        | echo ok        | no         | First |
<!-- /phases -->
EOF
assert_fail "unknown_dep" "$TMPDIR_TEST/unknown_dep.md"

# 4. Cycle
cat > "$TMPDIR_TEST/cycle.md" <<'EOF'
<!-- phases:v1 -->
| id | size | depends_on | acceptance_cmd | needs_look | title |
|----|------|------------|----------------|------------|-------|
| P1 | S    | P2         | echo ok        | no         | First |
| P2 | S    | P1         | echo ok        | no         | Second |
<!-- /phases -->
EOF
assert_fail "cycle" "$TMPDIR_TEST/cycle.md"

# 5. Forward reference
cat > "$TMPDIR_TEST/forward_ref.md" <<'EOF'
<!-- phases:v1 -->
| id | size | depends_on | acceptance_cmd | needs_look | title |
|----|------|------------|----------------|------------|-------|
| P1 | S    | P2         | echo ok        | no         | First |
| P2 | S    | -          | echo ok        | no         | Second |
<!-- /phases -->
EOF
assert_fail "forward_ref" "$TMPDIR_TEST/forward_ref.md"

# 6. Invalid size
cat > "$TMPDIR_TEST/bad_size.md" <<'EOF'
<!-- phases:v1 -->
| id | size | depends_on | acceptance_cmd | needs_look | title |
|----|------|------------|----------------|------------|-------|
| P1 | XXL  | -          | echo ok        | no         | First |
<!-- /phases -->
EOF
assert_fail "bad_size" "$TMPDIR_TEST/bad_size.md"

# 7. Invalid needs_look
cat > "$TMPDIR_TEST/bad_look.md" <<'EOF'
<!-- phases:v1 -->
| id | size | depends_on | acceptance_cmd | needs_look | title |
|----|------|------------|----------------|------------|-------|
| P1 | S    | -          | echo ok        | maybe      | First |
<!-- /phases -->
EOF
assert_fail "bad_look" "$TMPDIR_TEST/bad_look.md"

# 8. acceptance_cmd contains TBD
cat > "$TMPDIR_TEST/tbd_cmd.md" <<'EOF'
<!-- phases:v1 -->
| id | size | depends_on | acceptance_cmd | needs_look | title |
|----|------|------------|----------------|------------|-------|
| P1 | S    | -          | TBD            | no         | First |
<!-- /phases -->
EOF
assert_fail "tbd_cmd" "$TMPDIR_TEST/tbd_cmd.md"

# 9. Two tables
cat > "$TMPDIR_TEST/two_tables.md" <<'EOF'
<!-- phases:v1 -->
| id | size | depends_on | acceptance_cmd | needs_look | title |
|----|------|------------|----------------|------------|-------|
| P1 | S    | -          | echo ok        | no         | First |
<!-- /phases -->
<!-- phases:v1 -->
| id | size | depends_on | acceptance_cmd | needs_look | title |
|----|------|------------|----------------|------------|-------|
| P2 | S    | -          | echo ok        | no         | Second |
<!-- /phases -->
EOF
assert_fail "two_tables" "$TMPDIR_TEST/two_tables.md"

# 10. Legacy plan without phases:v1 is unaffected by --register-template
LEGACY_REPO="$TMPDIR_TEST/legacy_repo"
mkdir -p "$LEGACY_REPO/project/plans"
cat > "$LEGACY_REPO/project/plans/2026-11-25-legacy.md" <<'EOF'
# Legacy Plan
## 4. Phases
Free-text phases without phases:v1 marker.
EOF
if node "$GRAD" --register-template 2026-11-25-legacy --repo-root "$LEGACY_REPO" >"$TMPDIR_TEST/reg_out" 2>"$TMPDIR_TEST/reg_err"; then
  PASS=$((PASS + 1))
else
  echo "FAIL (legacy_register): expected rc=0, got rc=$? stderr=$(cat "$TMPDIR_TEST/reg_err")" >&2
  FAIL=$((FAIL + 1))
fi

# prose mention of the marker (inline code) must not count as a second table
{
  echo 'The table opens with `<!-- phases:v1 -->` and closes with `<!-- /phases -->`.'
  echo '<!-- phases:v1 -->'
  echo '| id | size | depends_on | acceptance_cmd | needs_look | title |'
  echo '|---|---|---|---|---|---|'
  echo '| P1 | S | - | true | no | a |'
  echo '<!-- /phases -->'
} > "$TMPDIR_TEST/prose_mention.md"
assert_ok "prose_mention" "$TMPDIR_TEST/prose_mention.md"

echo "check-plan-phases.test.sh: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
