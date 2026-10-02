#!/usr/bin/env bash
# Identity-rule unit cases + KR5 inventories + G9 ceiling dirs.
# Hunt for stray empty /tmp/.git: searched hooks/tests, scripts, and src for
# mkdir/mkdtemp/fs.mkdirSync of a .git entry whose base may be os.tmpdir() or
# $TMPDIR. import-aa-capabilities.test.js mkdirSync is under a fixture worktree,
# not TMPDIR. not reproduced
#
# RED at 362d2a45: missing lib; G9 empty; inventory skipped; git-invoking without lib.sh: calendar-teeth-negative, check-hands-commit, mission-terminal-rollover, orchestration-eval, pin-evidence-anchors, probe-mutation, resolve-knowledge-routing, resolve-project-paths, session-mode, skill-onoff-markers, strike-writer-wiring
. "$(dirname "$0")/lib.sh"

IDENTITY_LIB="$REPO_ROOT/scripts/lib/test-identity.sh"

CONTROL_EMAILS=(
  '2537196+cookys@users.noreply.github.com'
  'cookys@stranity.com'
  'foo@example.community'
)

is_declared_control() {
  local email="$1" c
  for c in "${CONTROL_EMAILS[@]}"; do
    [ "$email" = "$c" ] && return 0
  done
  return 1
}

# --- 1. Rule cases ---
if [ -f "$IDENTITY_LIB" ]; then
  # shellcheck disable=SC1090
  . "$IDENTITY_LIB"
  MATCHES=(t@t a@example.com a@example.org a@example.net a@x.invalid a@x.test a@x.example a@x.local a@x.localhost '')
  for e in "${MATCHES[@]}"; do
    if is_test_identity_email "$e"; then
      assert_eq 0 0 "match $(printf '%q' "$e")"
    else
      fail "expected test identity: $(printf '%q' "$e")"
    fi
  done
  for e in "${CONTROL_EMAILS[@]}"; do
    if is_test_identity_email "$e"; then
      fail "control must not match: $e"
    else
      assert_eq 0 0 "control $e"
    fi
  done
else
  fail "scripts/lib/test-identity.sh missing"
fi

# --- 5. G9 ---
case ":${GIT_CEILING_DIRECTORIES:-}:" in
  *:/tmp:*) assert_eq 0 0 "GIT_CEILING contains /tmp" ;;
  *) fail "GIT_CEILING_DIRECTORIES missing /tmp: ${GIT_CEILING_DIRECTORIES:-}" ;;
esac
_td="${TMPDIR:-/tmp}"
case ":${GIT_CEILING_DIRECTORIES:-}:" in
  *:"$_td":*) assert_eq 0 0 "GIT_CEILING contains TMPDIR" ;;
  *) fail "GIT_CEILING_DIRECTORIES missing TMPDIR=$_td: ${GIT_CEILING_DIRECTORIES:-}" ;;
esac

# --- 2/3 Inventory one ---
SUITE_SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
extract_emails_node() {
  node - "$@" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const self = process.argv[3];
const extra = process.argv.slice(4);
const files = [];
function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.git') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (/\.(sh|js|cjs|mjs)$/.test(ent.name)) files.push(p);
  }
}
if (root === '--files') {
  files.push(...process.argv.slice(3));
} else {
  const testsDir = path.join(root, 'hooks', 'tests');
  for (const ent of fs.readdirSync(testsDir)) {
    if (ent.endsWith('.test.sh')) files.push(path.join(testsDir, ent));
  }
  walk(path.join(root, 'scripts'));
  files.push(...extra);
}
const identRe = [
  /\bconfig(?:\s+-C\s+\S+)?\s+user\.email(?:\s+|=)(?:"([^"]*)"|'([^']*)'|([^\s;|&]+))/g,
  /['"]?user\.email=([^\s"';|&,\]\)]*)/g,
  /\bGIT_AUTHOR_EMAIL=(?:"([^"]*)"|'([^']*)'|([^\s;|&]+))/g,
  /\bGIT_COMMITTER_EMAIL=(?:"([^"]*)"|'([^']*)'|([^\s;|&]+))/g,
  /(?:^|[^\w])EMAIL=(?:"([^"]*)"|'([^']*)'|([^\s;|&]+))/g,
  /['"]user\.email['"]\s*,\s*['"]([^'"]*)['"]/g,
];
const skipSelf = root !== '--files';
for (const file of files) {
  if (skipSelf && path.resolve(file) === path.resolve(self)) continue;
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
  const lines = text.split(/\n/);
  lines.forEach((line, i) => {
    for (const re of identRe) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) {
        const email = m[1] ?? m[2] ?? m[3] ?? '';
        if (email.startsWith('$') || email.startsWith('${')) continue;
        process.stdout.write(`${file}:${i + 1}:${email}\n`);
      }
    }
  });
}
NODE
}

if type is_test_identity_email >/dev/null 2>&1; then
  while IFS= read -r rec; do
    [ -z "$rec" ] && continue
    file="${rec%%:*}"
    rest="${rec#*:}"
    lineno="${rest%%:*}"
    email="${rest#*:}"
    if is_declared_control "$email"; then
      continue
    fi
    if is_test_identity_email "$email"; then
      continue
    fi
    fail "non-test identity ${file}:${lineno} ${email}"
  done < <(extract_emails_node "$REPO_ROOT" "$SUITE_SELF")
else
  fail "inventory one skipped: no is_test_identity_email"
fi

# Scanner self-test: quoted -c and JS argv '-c' + 'user.email=' (non-repo temp file)
SCAN_FIXTURE="$TEST_TMP/ident-scan-syntax.sh"
{
  printf '%s\n' 'git -c "user.email=quoted-scan@github.com"'
  printf '%s\n' "const args = ['-c', 'user.email=jsargv-scan@github.com'];"
  printf '%s\n' 'git -c user.email=bare-scan@github.com'
} > "$SCAN_FIXTURE"
SCAN_OUT="$(extract_emails_node --files "$SCAN_FIXTURE")"
assert_contains "$SCAN_OUT" "quoted-scan@github.com" "scanner extracts quoted -c user.email"
assert_contains "$SCAN_OUT" "jsargv-scan@github.com" "scanner extracts JS argv user.email="
assert_contains "$SCAN_OUT" "bare-scan@github.com" "scanner extracts bare -c user.email="

# --- 4. Inventory two: git-invoking tests source lib.sh ---
HOOKS_TESTS="$REPO_ROOT/hooks/tests"
for f in "$HOOKS_TESTS"/*.test.sh; do
  if grep -Eq '(^|[[:space:];|&])git[[:space:]]' "$f"; then
    if ! grep -Eq '(^|[[:space:]])(\.|source)[[:space:]]+.*lib\.sh' "$f"; then
      fail "git-invoking test missing lib.sh: $(basename "$f")"
    fi
  fi
done

finalize_test
