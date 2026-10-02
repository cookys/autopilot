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
  /['"]?user\.email=(?:"([^"]*)"|'([^']*)'|([^\s"';|&,\]\)]*))/g,
  /\bGIT_AUTHOR_EMAIL=(?:"([^"]*)"|'([^']*)'|([^\s;|&]+))/g,
  /\bGIT_COMMITTER_EMAIL=(?:"([^"]*)"|'([^']*)'|([^\s;|&]+))/g,
  /(?:^|[^\w])EMAIL=(?:"([^"]*)"|'([^']*)'|([^\s;|&]+))/g,
  /['"]user\.email['"]\s*,\s*['"]([^'"]*)['"]/g,
];
const catchAllRe = /[A-Za-z0-9.%+\-_]+@[A-Za-z0-9.\-]+/g;
const gitInvokingRe = /(^|[\s;|&])git[\s]/;
const skipSelf = root !== '--files';
for (const file of files) {
  if (skipSelf && path.resolve(file) === path.resolve(self)) continue;
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
  const gitInvoking = gitInvokingRe.test(text);
  const hooksTest = /(?:^|\/)hooks\/tests\/[^/]+\.test\.sh$/.test(file.replace(/\\/g, '/'));
  const applyCatchAll = gitInvoking && (root === '--files' || hooksTest);
  const lines = text.split(/\n/);
  lines.forEach((line, i) => {
    const seen = new Set();
    for (const re of identRe) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) {
        const email = m[1] ?? m[2] ?? m[3] ?? '';
        if (email.startsWith('$') || email.startsWith('${')) continue;
        seen.add(email);
        process.stdout.write(`${file}:${i + 1}:${email}\n`);
      }
    }
    const trimmed = line.replace(/^[ \t]+/, '');
    if (trimmed.startsWith('#')) return;
    if (!applyCatchAll) return;
    catchAllRe.lastIndex = 0;
    let cm;
    while ((cm = catchAllRe.exec(line))) {
      const email = cm[0];
      if (email.includes('$')) continue;
      const idx = cm.index;
      if (idx > 0 && line[idx - 1] === '@') continue;
      const domain = email.slice(email.indexOf('@') + 1);
      if (!/[A-Za-z]/.test(domain)) continue;
      if (domain.endsWith('.')) continue;
      if (domain.startsWith('pytest.')) continue;
      if (seen.has(email)) continue;
      process.stdout.write(`${file}:${i + 1}:${email}\n`);
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
  printf '%s\n' 'git -c user.email="dq-scan@github.com" commit'
  printf '%s\n' "git -c user.email='sq-scan@github.com' commit"
  printf '%s\n' 'git commit --author "Scan User <catchall-scan@github.com>"'
} > "$SCAN_FIXTURE"
SCAN_OUT="$(extract_emails_node --files "$SCAN_FIXTURE")"
assert_contains "$SCAN_OUT" "quoted-scan@github.com" "scanner extracts quoted -c user.email"
assert_contains "$SCAN_OUT" "jsargv-scan@github.com" "scanner extracts JS argv user.email="
assert_contains "$SCAN_OUT" "bare-scan@github.com" "scanner extracts bare -c user.email="
assert_contains "$SCAN_OUT" "dq-scan@github.com" "scanner extracts double-quoted -c user.email="
assert_contains "$SCAN_OUT" "sq-scan@github.com" "scanner extracts single-quoted -c user.email="
assert_contains "$SCAN_OUT" "catchall-scan@github.com" "catch-all flags --author outside listed syntaxes"

# --- 4. Inventory two: git-invoking tests source lib.sh ---
HOOKS_TESTS="$REPO_ROOT/hooks/tests"
for f in "$HOOKS_TESTS"/*.test.sh; do
  if grep -Eq '(^|[[:space:];|&])git[[:space:]]' "$f"; then
    if ! grep -Eq '(^|[[:space:]])(\.|source)[[:space:]]+.*lib\.sh' "$f"; then
      fail "git-invoking test missing lib.sh: $(basename "$f")"
    fi
  fi
done

# --- P3: identity gate hooks ---
# RED at 183c6e9e: unmodified .githooks allow test-identity commit/merge (exit 0);
# no pre-merge-commit; pre-push identity not judged (file transport 128 here).
# Failures: author/committer/merge RED expected 1 got 0; env/overlay/outside-TMPDIR
# NC expected 1 got 0.

P3_OWNER_EMAIL='cookys@stranity.com'
P3_TEST_EMAIL='p3-author@example.invalid'
P3_TEST_COMMITTER='p3-committer@example.invalid'

p3_seed_hooks() {
  local dest="$1"
  mkdir -p "$dest/.githooks/lib" "$dest/scripts/lib" "$dest/references"
  cp -a "$REPO_ROOT/.githooks/." "$dest/.githooks/"
  chmod +x "$dest/.githooks/pre-commit" "$dest/.githooks/pre-push" 2>/dev/null || true
  [ -f "$dest/.githooks/pre-merge-commit" ] && chmod +x "$dest/.githooks/pre-merge-commit"
  cp "$REPO_ROOT/scripts/lib/test-identity.sh" "$dest/scripts/lib/test-identity.sh"
  cp "$REPO_ROOT/references/blind-dispatch.md" "$dest/references/blind-dispatch.md"
  printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$dest/scripts/sync-all.sh"
  chmod +x "$dest/scripts/sync-all.sh"
}

p3_init_repo() {
  local dest="$1"
  mkdir -p "$dest"
  p3_seed_hooks "$dest"
  git -C "$dest" init -q
  git -C "$dest" config core.hooksPath .githooks
  mkdir -p "$dest/.claude"
  printf -- '- mode: off\n' > "$dest/.claude/qc-gate-config.md"
  git -C "$dest" config user.name 'P3 Owner'
  git -C "$dest" config user.email "$P3_OWNER_EMAIL"
  git -C "$dest" config protocol.file.allow always
}

p3_run_pre_push() {
  local dest="$1"
  local remote="$2"
  local local_sha="$3"
  local remote_sha="$4"
  local local_ref="${5:-refs/heads/main}"
  local remote_ref="${6:-refs/heads/main}"
  echo "$local_ref $local_sha $remote_ref $remote_sha" | ( cd "$dest" && bash .githooks/pre-push "$remote" )
}

ZERO_SHA='0000000000000000000000000000000000000000'

p3_try_commit() {
  local dest="$1"
  shift
  ( cd "$dest" && git add -A && git commit -q "$@" )
}

# RED: test-identity author refused
P3A="$TEST_TMP/p3-author"
p3_init_repo "$P3A"
printf 'a\n' > "$P3A/f.txt"
OUT="$(GIT_AUTHOR_EMAIL="$P3_TEST_EMAIL" GIT_AUTHOR_NAME=t \
  GIT_COMMITTER_EMAIL="$P3_OWNER_EMAIL" GIT_COMMITTER_NAME=o \
  p3_try_commit "$P3A" -m author-bad 2>&1)"; EX=$?
assert_eq "$EX" "1" "P3 RED: test-identity author commit refused"
assert_contains "$OUT" "author" "P3 RED: names author"

# RED: test-identity committer only refused
P3C="$TEST_TMP/p3-committer"
p3_init_repo "$P3C"
printf 'c\n' > "$P3C/f.txt"
OUT="$(GIT_AUTHOR_EMAIL="$P3_OWNER_EMAIL" GIT_AUTHOR_NAME=o \
  GIT_COMMITTER_EMAIL="$P3_TEST_COMMITTER" GIT_COMMITTER_NAME=t \
  p3_try_commit "$P3C" -m committer-bad 2>&1)"; EX=$?
assert_eq "$EX" "1" "P3 RED: test-identity committer-only refused"
assert_contains "$OUT" "committer" "P3 RED: names committer"

# NC: owner identity passes
P3O="$TEST_TMP/p3-owner"
p3_init_repo "$P3O"
printf 'o\n' > "$P3O/f.txt"
OUT="$(p3_try_commit "$P3O" -m owner-ok 2>&1)"; EX=$?
assert_eq "$EX" "0" "P3 NC: owner identity commit passes"

# RED: merge commit with test-identity committer refused by pre-merge-commit
P3M="$TEST_TMP/p3-merge"
p3_init_repo "$P3M"
printf 'base\n' > "$P3M/m.txt"
p3_try_commit "$P3M" -m base
git -C "$P3M" checkout -q -b side
printf 'side\n' > "$P3M/side.txt"
p3_try_commit "$P3M" -m side
git -C "$P3M" checkout -q -
printf 'mainline\n' >> "$P3M/m.txt"
p3_try_commit "$P3M" -m mainline
OUT="$(cd "$P3M" && GIT_COMMITTER_EMAIL="$P3_TEST_COMMITTER" GIT_COMMITTER_NAME=t \
  GIT_AUTHOR_EMAIL="$P3_OWNER_EMAIL" GIT_AUTHOR_NAME=o \
  git merge --no-ff --no-edit side 2>&1)"; EX=$?
assert_eq "$EX" "1" "P3 RED: test-identity merge commit refused"
assert_contains "$OUT" "committer" "P3 RED: merge names committer"

# G8 bypass requires the fixture common dir under ${TMPDIR:-/tmp} (after lib.sh
# that is HOOK_TMPDIR, so TEST_TMP itself is the parent, not a child).
_p3_host_tmp="${TMPDIR:-/tmp}"
_p3_real_host="$(cd "$_p3_host_tmp" && pwd -P)"
_p3_real_test="$(cd "$TEST_TMP" && pwd -P)"
_p3_fx="$TEST_TMP"
case "$_p3_real_test" in
  "$_p3_real_host"|"$_p3_real_host"/*) ;;
  *)
    _p3_fx="$(mktemp -d "${TMPDIR:-/tmp}/autopilot-p3-XXXXXX")"
    ;;
esac
p3_cleanup_extras() {
  [ "$BASHPID" = "${__TEST_TOP_BASHPID:-}" ] || return 0
  [ -n "${P3X_ROOT:-}" ] && rm -rf "$P3X_ROOT"
  if [ -n "${_p3_fx:-}" ] && [ "$_p3_fx" != "$TEST_TMP" ]; then
    rm -rf "$_p3_fx"
  fi
}
trap 'p3_cleanup_extras; cleanup_test_tmp' EXIT

# NC: gate-off under TMPDIR allows test identity
P3B="$_p3_fx/p3-bypass"
p3_init_repo "$P3B"
git -C "$P3B" config autopilot.testIdentityGate off
printf 'b\n' > "$P3B/f.txt"
OUT="$(GIT_AUTHOR_EMAIL="$P3_TEST_EMAIL" GIT_AUTHOR_NAME=t \
  GIT_COMMITTER_EMAIL="$P3_TEST_EMAIL" GIT_COMMITTER_NAME=t \
  p3_try_commit "$P3B" -m bypass-ok 2>&1)"; EX=$?
assert_eq "$EX" "0" "P3 NC: autopilot.testIdentityGate=off under TMPDIR allows"

# NC: AUTOPILOT_ALLOW_TEST_IDENT=1 does not bypass
P3E="$TEST_TMP/p3-env"
p3_init_repo "$P3E"
printf 'e\n' > "$P3E/f.txt"
OUT="$(AUTOPILOT_ALLOW_TEST_IDENT=1 GIT_AUTHOR_EMAIL="$P3_TEST_EMAIL" GIT_AUTHOR_NAME=t \
  GIT_COMMITTER_EMAIL="$P3_OWNER_EMAIL" GIT_COMMITTER_NAME=o \
  p3_try_commit "$P3E" -m env-no 2>&1)"; EX=$?
assert_eq "$EX" "1" "P3 NC: AUTOPILOT_ALLOW_TEST_IDENT=1 does not bypass"

# NC: GIT_CONFIG_COUNT overlay does not bypass
P3L="$TEST_TMP/p3-leak"
p3_init_repo "$P3L"
printf 'l\n' > "$P3L/f.txt"
OUT="$(GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=autopilot.testIdentityGate GIT_CONFIG_VALUE_0=off \
  GIT_AUTHOR_EMAIL="$P3_TEST_EMAIL" GIT_AUTHOR_NAME=t \
  GIT_COMMITTER_EMAIL="$P3_OWNER_EMAIL" GIT_COMMITTER_NAME=o \
  p3_try_commit "$P3L" -m leak-no 2>&1)"; EX=$?
assert_eq "$EX" "1" "P3 NC: GIT_CONFIG_COUNT overlay does not bypass"

# NC: key off outside TMPDIR does not bypass
P3X_ROOT="$TEST_TMP/p3-outside"
rm -rf "$P3X_ROOT"
mkdir -p "$P3X_ROOT"
P3X="$P3X_ROOT/repo"
p3_init_repo "$P3X"
git -C "$P3X" config autopilot.testIdentityGate off
printf 'x\n' > "$P3X/f.txt"
OUT="$(TMPDIR="$TEST_TMP/other-tmp" mkdir -p "$TEST_TMP/other-tmp"
  TMPDIR="$TEST_TMP/other-tmp" GIT_AUTHOR_EMAIL="$P3_TEST_EMAIL" GIT_AUTHOR_NAME=t \
  GIT_COMMITTER_EMAIL="$P3_OWNER_EMAIL" GIT_COMMITTER_NAME=o \
  p3_try_commit "$P3X" -m outside-no 2>&1)"; EX=$?
rm -rf "$P3X_ROOT"
assert_eq "$EX" "1" "P3 NC: gate-off outside TMPDIR does not bypass"

# RED: push of range containing test-identity commit refused
P3P="$TEST_TMP/p3-push"
p3_init_repo "$P3P"
printf 'p0\n' > "$P3P/f.txt"
p3_try_commit "$P3P" -m p0
BASEP="$(git -C "$P3P" rev-parse HEAD)"
printf 'pbad\n' > "$P3P/f.txt"
GIT_AUTHOR_EMAIL="$P3_TEST_EMAIL" GIT_AUTHOR_NAME=t \
  GIT_COMMITTER_EMAIL="$P3_OWNER_EMAIL" GIT_COMMITTER_NAME=o \
  p3_try_commit "$P3P" --no-verify -m pbad
TIPP="$(git -C "$P3P" rev-parse HEAD)"
OUT="$(p3_run_pre_push "$P3P" origin "$TIPP" "$BASEP" 2>&1)"; EX=$?
assert_eq "$EX" "1" "P3 RED: push of test-identity range refused"
assert_contains "$OUT" "author" "P3 RED: push names author"

# NC: test-identity already on target remote, new owner commit pushes
P3R="$_p3_fx/p3-remote-ok"
p3_init_repo "$P3R"
git -C "$P3R" config autopilot.testIdentityGate off
printf 'r0\n' > "$P3R/f.txt"
GIT_AUTHOR_EMAIL="$P3_TEST_EMAIL" GIT_AUTHOR_NAME=t \
  GIT_COMMITTER_EMAIL="$P3_TEST_EMAIL" GIT_COMMITTER_NAME=t \
  p3_try_commit "$P3R" -m rbad
BADR="$(git -C "$P3R" rev-parse HEAD)"
git -C "$P3R" update-ref refs/remotes/origin/main "$BADR"
git -C "$P3R" config --unset autopilot.testIdentityGate || true
printf 'r1\n' > "$P3R/f.txt"
p3_try_commit "$P3R" -m rowner
TIPR="$(git -C "$P3R" rev-parse HEAD)"
OUT="$(p3_run_pre_push "$P3R" origin "$TIPR" "$BADR" 2>&1)"; EX=$?
assert_eq "$EX" "0" "P3 NC: test-identity already on target remote, owner tip pushes"

# NC: new ref whose bad commit exists only on unrelated remote is refused
P3U="$_p3_fx/p3-unrelated"
p3_init_repo "$P3U"
git -C "$P3U" config autopilot.testIdentityGate off
printf 'u0\n' > "$P3U/f.txt"
p3_try_commit "$P3U" -m u0
printf 'ubad\n' > "$P3U/f.txt"
GIT_AUTHOR_EMAIL="$P3_TEST_EMAIL" GIT_AUTHOR_NAME=t \
  GIT_COMMITTER_EMAIL="$P3_OWNER_EMAIL" GIT_COMMITTER_NAME=o \
  p3_try_commit "$P3U" -m ubad
TIPU="$(git -C "$P3U" rev-parse HEAD)"
git -C "$P3U" update-ref refs/remotes/other/main "$TIPU"
git -C "$P3U" config --unset autopilot.testIdentityGate || true
OUT="$(p3_run_pre_push "$P3U" origin "$TIPU" "$ZERO_SHA" 2>&1)"; EX=$?
assert_eq "$EX" "1" "P3 NC: new ref with bad commit only on unrelated remote refused"

# --- P3 landing round 1: remote-scoped pre-push commit set ---
# RED at e0cf0511: (a) existing branch merging on-remote test-identity base
# expected '0', got '1' (two-dot remote_sha..local_sha swept the base in);
# (c) unknown old tip: expected '1', got '0'; (c2) never-fetched remote:
# expected '1', got '0' and 'git fetch' not found in output (silent pass).
p3_bad_commit() {
  local dest="$1" msg="$2"
  printf '%s\n' "$msg" >> "$dest/f.txt"
  ( cd "$dest" && git add -A && GIT_AUTHOR_EMAIL="$P3_TEST_EMAIL" GIT_AUTHOR_NAME=t \
    GIT_COMMITTER_EMAIL="$P3_OWNER_EMAIL" GIT_COMMITTER_NAME=o git commit -q --no-verify -m "$msg" )
}
P3M="$TEST_TMP/p3-merge-base"
p3_init_repo "$P3M"
printf 'm0\n' > "$P3M/f.txt"
p3_try_commit "$P3M" -m m0
C0M="$(git -C "$P3M" rev-parse HEAD)"
git -C "$P3M" checkout -q -b feature
git -C "$P3M" checkout -q -b main2 "$C0M"
p3_bad_commit "$P3M" mbad
BADM="$(git -C "$P3M" rev-parse HEAD)"
git -C "$P3M" update-ref refs/remotes/origin/main "$BADM"
git -C "$P3M" update-ref refs/remotes/origin/feature "$C0M"
git -C "$P3M" checkout -q feature
( cd "$P3M" && git merge -q --no-ff --no-verify -m 'merge base' main2 >/dev/null 2>&1 )
TIPM="$(git -C "$P3M" rev-parse HEAD)"
OUT="$(p3_run_pre_push "$P3M" origin "$TIPM" "$C0M" refs/heads/feature refs/heads/feature 2>&1)"; EX=$?
assert_eq "$EX" "0" "P3 landing(a): existing branch merging on-remote test-identity base passes"
# (b) a new test-identity commit on top is refused
p3_bad_commit "$P3M" mtop
TOPM="$(git -C "$P3M" rev-parse HEAD)"
OUT="$(p3_run_pre_push "$P3M" origin "$TOPM" "$C0M" refs/heads/feature refs/heads/feature 2>&1)"; EX=$?
assert_eq "$EX" "1" "P3 landing(b): new test-identity commit on top refused"
# (c) old tip absent locally: remote has refs -> new bad commit still judged
UNKNOWN_SHA='1111111111111111111111111111111111111111'
OUT="$(p3_run_pre_push "$P3M" origin "$TOPM" "$UNKNOWN_SHA" refs/heads/feature refs/heads/feature 2>&1)"; EX=$?
assert_eq "$EX" "1" "P3 landing(c): unknown old tip does not silently pass a bad commit"
# (c2) remote never fetched (no refs, tip unknown): fail closed with fetch hint
OUT="$(p3_run_pre_push "$P3M" ghost "$TIPM" "$UNKNOWN_SHA" refs/heads/feature refs/heads/feature 2>&1)"; EX=$?
assert_eq "$EX" "1" "P3 landing(c2): never-fetched remote refused"
assert_contains "$OUT" "git fetch" "P3 landing(c2): tells operator to fetch"
# (d) two-remote: bad commit only on other remote, existing origin ref -> refused
P3T="$TEST_TMP/p3-two-remote"
p3_init_repo "$P3T"
printf 't0\n' > "$P3T/f.txt"
p3_try_commit "$P3T" -m t0
C0T="$(git -C "$P3T" rev-parse HEAD)"
p3_bad_commit "$P3T" tbad
TIPT="$(git -C "$P3T" rev-parse HEAD)"
git -C "$P3T" update-ref refs/remotes/other/main "$TIPT"
git -C "$P3T" update-ref refs/remotes/origin/main "$C0T"
OUT="$(p3_run_pre_push "$P3T" origin "$TIPT" "$C0T" 2>&1)"; EX=$?
assert_eq "$EX" "1" "P3 landing(d): bad commit only on unrelated remote refused (existing ref)"

finalize_test

