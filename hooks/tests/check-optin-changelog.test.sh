#!/usr/bin/env bash
# check-optin-changelog.js test suite — 15 deterministic groups.

. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/check-optin-changelog.js"
BASE_MANIFEST_COMMIT_PRE=b469dc768ce3b765e088e0e9f7ae1f309847f4c8

FIX="$TEST_TMP/cases"
mkdir -p "$FIX"

# helper
assert_exit_in_0_or_1() {
  local actual="$1"
  local msg="$2"
  if [ "$actual" = "0" ] || [ "$actual" = "1" ]; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "$msg (exit was $actual)"
  fi
}

# 1) unchanged ⇒ exit 0
cat > "$FIX/base.json" <<'EOF'
{
  "opt_in": ["accumulator", "batch-format"]
}
EOF
cat > "$FIX/current.json" <<'EOF'
{
  "opt_in": ["accumulator", "batch-format"]
}
EOF
cat > "$FIX/changelog.md" <<'EOF'
## v2.26.3
- nothing changed for this test
EOF
OUT=$(node "$SCRIPT" --manifest "$FIX/current.json" --baseline-manifest "$FIX/base.json" --changelog "$FIX/changelog.md" --version 2.26.3 2>&1)
EC=$?
assert_eq "$EC" "0" "unchanged exit 0"

# 2) added + named with opt-in ⇒ exit 0
cat > "$FIX/base.json" <<'EOF'
{
  "opt_in": ["accumulator", "batch-format"]
}
EOF
cat > "$FIX/current.json" <<'EOF'
{
  "opt_in": ["accumulator", "batch-format", "session-summary"]
}
EOF
cat > "$FIX/changelog.md" <<'EOF'
## v2.26.3
- opt-in updates this release include session-summary for review workflows.
EOF
OUT=$(node "$SCRIPT" --manifest "$FIX/current.json" --baseline-manifest "$FIX/base.json" --changelog "$FIX/changelog.md" --version 2.26.3 2>&1)
EC=$?
assert_eq "$EC" "0" "added + co-located token exit 0"

# 3) added + stem named but opt-in missing ⇒ exit 1
cat > "$FIX/changelog.md" <<'EOF'
## v2.26.3
- session-summary was added for review workflows.
EOF
OUT=$(node "$SCRIPT" --manifest "$FIX/current.json" --baseline-manifest "$FIX/base.json" --changelog "$FIX/changelog.md" --version 2.26.3 2>&1)
EC=$?
assert_eq "$EC" "1" "added + missing opt-in token exit 1"
assert_contains "$OUT" "missing literal \"opt-in\" mention in v2.26.3 entry" "added + missing opt-in token says missing literal"

# 4) added + stem not named ⇒ exit 1
cat > "$FIX/changelog.md" <<'EOF'
## v2.26.3
- opt-in changes landed for this version.
EOF
OUT=$(node "$SCRIPT" --manifest "$FIX/current.json" --baseline-manifest "$FIX/base.json" --changelog "$FIX/changelog.md" --version 2.26.3 2>&1)
EC=$?
assert_eq "$EC" "1" "added + stem missing exit 1"
assert_contains "$OUT" "opt-in hook \"session-summary\" (added) not named alongside \"opt-in\" in the v2.26.3 CHANGELOG entry" "added stem missing names the stem"

# 5) removed + named / removed + not named
cat > "$FIX/base.json" <<'EOF'
{
  "opt_in": ["accumulator", "session-summary"]
}
EOF
cat > "$FIX/current.json" <<'EOF'
{
  "opt_in": ["accumulator"]
}
EOF
cat > "$FIX/changelog.md" <<'EOF'
## v2.26.3
- opt-in changes remove session-summary from startup paths.
EOF
OUT=$(node "$SCRIPT" --manifest "$FIX/current.json" --baseline-manifest "$FIX/base.json" --changelog "$FIX/changelog.md" --version 2.26.3 2>&1)
EC=$?
assert_eq "$EC" "0" "removed + co-located token exit 0"

cat > "$FIX/changelog.md" <<'EOF'
## v2.26.3
- opt-in changes are described in this section.
- This note does not mention the exact hook name.
EOF
OUT=$(node "$SCRIPT" --manifest "$FIX/current.json" --baseline-manifest "$FIX/base.json" --changelog "$FIX/changelog.md" --version 2.26.3 2>&1)
EC=$?
assert_eq "$EC" "1" "removed + stem missing exit 1"
assert_contains "$OUT" "opt-in hook \"session-summary\" (removed) not named alongside \"opt-in\" in the v2.26.3 CHANGELOG entry" "removed stem missing names the stem"

# 6) no baseline fail-closed policy + allow-no-baseline + bootstrap exception
cat > "$FIX/base.json" <<'EOF'
{
  "opt_in": ["accumulator"]
}
EOF
cat > "$FIX/current.json" <<'EOF'
{
  "opt_in": ["accumulator", "session-summary"]
}
EOF
cat > "$FIX/changelog.md" <<'EOF'
## v9.9.9
- opt-in placeholder
EOF
OUT=$(node "$SCRIPT" --manifest "$FIX/current.json" --changelog "$FIX/changelog.md" --version 9.9.9 --base-ref definitely-not-a-ref 2>&1)
EC=$?
assert_eq "$EC" "1" "no-baseline default is fail-closed"

OUT=$(node "$SCRIPT" --manifest "$FIX/current.json" --changelog "$FIX/changelog.md" --version 9.9.9 --base-ref definitely-not-a-ref --allow-no-baseline 2>&1)
EC=$?
assert_eq "$EC" "0" "no-baseline with allow-no-baseline is PASS"

OUT=$(node "$SCRIPT" --manifest "$FIX/current.json" --changelog "$FIX/changelog.md" --version 2.26.2 --base-ref "$BASE_MANIFEST_COMMIT_PRE" 2>&1)
EC=$?
assert_eq "$EC" "0" "bootstrap pre-manifest base-ref with --version 2.26.2 stays inert"

# 7) boundary collision uses hook-name boundaries
cat > "$FIX/base.json" <<'EOF'
{
  "opt_in": ["accumulator"]
}
EOF
cat > "$FIX/current.json" <<'EOF'
{
  "opt_in": ["accumulator", "config-protection"]
}
EOF
cat > "$FIX/changelog.md" <<'EOF'
## v2.26.3
- opt-in changes mention config-protection-extra only.
EOF
OUT=$(node "$SCRIPT" --manifest "$FIX/current.json" --baseline-manifest "$FIX/base.json" --changelog "$FIX/changelog.md" --version 2.26.3 2>&1)
EC=$?
assert_eq "$EC" "1" "boundary collision on config-protection"
assert_contains "$OUT" "opt-in hook \"config-protection\" (added) not named alongside \"opt-in\" in the v2.26.3 CHANGELOG entry" "boundary collision is named"

# 8) co-location requirement (different paragraphs)
cat > "$FIX/changelog.md" <<'EOF'
## v2.26.3
Rollback:
- config-protection was kept in a fallback path.

General note:
- opt-in updates continue as normal.
EOF
OUT=$(node "$SCRIPT" --manifest "$FIX/current.json" --baseline-manifest "$FIX/base.json" --changelog "$FIX/changelog.md" --version 2.26.3 2>&1)
EC=$?
assert_eq "$EC" "1" "co-location split paragraph fail"
assert_contains "$OUT" "opt-in hook \"config-protection\" (added) not named alongside \"opt-in\" in the v2.26.3 CHANGELOG entry" "co-location fail names missing"

cat > "$FIX/changelog.md" <<'EOF'
## v2.26.3
- opt-in update includes config-protection with the safe defaults.

Rollback:
- config-protection remains removed from the fallback branch.
EOF
OUT=$(node "$SCRIPT" --manifest "$FIX/current.json" --baseline-manifest "$FIX/base.json" --changelog "$FIX/changelog.md" --version 2.26.3 2>&1)
EC=$?
assert_eq "$EC" "0" "co-location within same paragraph passes"

# 9) version-boundary regex escapes and does not bleed into v2.26.30
cat > "$FIX/base.json" <<'EOF'
{
  "opt_in": []
}
EOF
cat > "$FIX/current.json" <<'EOF'
{
  "opt_in": ["session-summary"]
}
EOF
cat > "$FIX/changelog.md" <<'EOF'
## v2.26.30
- opt-in change: config-protection-extra.

## v2.26.3
- opt-in now names session-summary.
EOF
OUT=$(node "$SCRIPT" --manifest "$FIX/current.json" --baseline-manifest "$FIX/base.json" --changelog "$FIX/changelog.md" --version 2.26.3 2>&1)
EC=$?
assert_eq "$EC" "0" "version boundary chooses 2.26.3 section only"

# 10) --baseline-manifest nonexistent path => exit 2
OUT=$(node "$SCRIPT" --manifest "$FIX/current.json" --baseline-manifest "$FIX/does-not-exist.json" --changelog "$FIX/changelog.md" --version 2.26.3 2>&1)
EC=$?
assert_eq "$EC" "2" "missing baseline-manifest file is usage error"

# 11) missing changelog section => exit 1
cat > "$FIX/changelog.md" <<'EOF'
## v2.26.2
- opt-in now adds session-summary.
EOF
OUT=$(node "$SCRIPT" --manifest "$FIX/current.json" --baseline-manifest "$FIX/base.json" --changelog "$FIX/changelog.md" --version 2.26.3 2>&1)
EC=$?
assert_eq "$EC" "1" "missing changelog section is violation"
assert_contains "$OUT" "no CHANGELOG section for v2.26.3 to verify the opt-in change" "missing section message"

# 12) malformed current manifest
cat > "$FIX/current.json" <<'EOF'
{ opt_in: [
EOF
OUT=$(node "$SCRIPT" --manifest "$FIX/current.json" --baseline-manifest "$FIX/base.json" --changelog "$FIX/changelog.md" --version 2.26.3 2>&1)
EC=$?
assert_eq "$EC" "1" "malformed current manifest is violation"

# 13) usage and bad version
node "$SCRIPT" --help >/dev/null 2>&1
assert_eq "$?" "0" "--help exits 0"
OUT=$(node "$SCRIPT" --version foo --manifest "$FIX/current.json" 2>&1)
assert_eq "$?" "2" "bad --version exits 2"

# 14) real-repo smoke (defaults) — must execute the real-repo path coherently:
# a recognizable gate message AND a non-usage/non-crash exit (catches an exit-2 /
# empty-output / stack-trace regression that a bare "0 or 1" would wave through).
OUT=$(node "$SCRIPT" 2>&1)
EC=$?
assert_exit_in_0_or_1 "$EC" "real-repo smoke exits 0 or 1 (not usage/crash)"
if printf '%s' "$OUT" | grep -qiE 'gate inert|opt-in set unchanged|CHANGELOG names the opt-in change|not named alongside|not yet committed to first-parent|no CHANGELOG section'; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "real-repo smoke produced a recognizable gate message (got: $OUT)"
fi

# 15) ambiguous version history naming
AMBI="$FIX/ambig-repo"
mkdir -p "$AMBI/.claude-plugin" "$AMBI/hooks" "$AMBI/scripts"
cp "$SCRIPT" "$AMBI/scripts/check-optin-changelog.js"

(cd "$AMBI" && git -c user.email=t@t -c user.name=t init -q && \
  cat > .claude-plugin/plugin.json <<'EOF'
{
  "name": "ambig",
  "version": "1.0.0"
}
EOF
  cat > hooks/opt-in-manifest.json <<'EOF'
{
  "opt_in": ["alpha"]
}
EOF
  cat > CHANGELOG.md <<'EOF'
## v1.0.0
- opt-in now includes alpha.
EOF
  git add .claude-plugin/plugin.json hooks/opt-in-manifest.json CHANGELOG.md
  git commit -q -m "v1.0.0"

  cat > .claude-plugin/plugin.json <<'EOF'
{
  "name": "ambig",
  "version": "1.0.1"
}
EOF
  cat > hooks/opt-in-manifest.json <<'EOF'
{
  "opt_in": ["alpha", "beta"]
}
EOF
  cat > CHANGELOG.md <<'EOF'
## v1.0.1
- placeholder

## v1.0.0
- opt-in now includes alpha.
EOF
  git add .claude-plugin/plugin.json hooks/opt-in-manifest.json CHANGELOG.md
  git commit -q -m "v1.0.1"

  cat > .claude-plugin/plugin.json <<'EOF'
{
  "name": "ambig",
  "version": "1.0.0"
}
EOF
  cat > hooks/opt-in-manifest.json <<'EOF'
{
  "opt_in": ["alpha", "beta", "gamma"]
}
EOF
  cat > CHANGELOG.md <<'EOF'
## v1.0.0
- opt-in now includes gamma.
EOF
  git add .claude-plugin/plugin.json hooks/opt-in-manifest.json CHANGELOG.md
  git commit -q -m "v1.0.0 again"
)

OUT=$(node "$AMBI/scripts/check-optin-changelog.js" --version 1.0.0 --manifest "$AMBI/hooks/opt-in-manifest.json" --changelog "$AMBI/CHANGELOG.md" 2>&1)
EC=$?
assert_eq "$EC" "1" "ambiguous history exits 1"
assert_contains "$OUT" "ambiguous version history for v1.0.0; pass --base-ref <commit> to pin the previous-release baseline" "ambiguous history message names remedy"

# 16) co-location is per list-item: a stem in a DIFFERENT bullet than `opt-in` ⇒ not credited (impl-review 🟠)
cat > "$FIX/base.json" <<'EOF'
{ "opt_in": ["alpha", "beta"] }
EOF
cat > "$FIX/current.json" <<'EOF'
{ "opt_in": ["alpha", "beta", "config-protection"] }
EOF
cat > "$FIX/cl-adjacent.md" <<'EOF'
## v2.26.3
- This is an opt-in membership change.
- config-protection got wired but this bullet omits the word.
EOF
OUT=$(node "$SCRIPT" --manifest "$FIX/current.json" --baseline-manifest "$FIX/base.json" --changelog "$FIX/cl-adjacent.md" --version 2.26.3 2>&1)
assert_eq "$?" "1" "adjacent-bullet stem not credited by neighbouring opt-in bullet"
cat > "$FIX/cl-sameitem.md" <<'EOF'
## v2.26.3
- This opt-in change wires config-protection.
- an unrelated bullet.
EOF
OUT=$(node "$SCRIPT" --manifest "$FIX/current.json" --baseline-manifest "$FIX/base.json" --changelog "$FIX/cl-sameitem.md" --version 2.26.3 2>&1)
assert_eq "$?" "0" "stem named in the same bullet as opt-in passes"

# 17) prerelease heading must NOT satisfy the real version section (impl-review 🟠)
cat > "$FIX/cl-prerelease.md" <<'EOF'
## v2.26.3-alpha — pre
opt-in adds config-protection.

## v2.26.3 — real
plain, names nothing.
EOF
OUT=$(node "$SCRIPT" --manifest "$FIX/current.json" --baseline-manifest "$FIX/base.json" --changelog "$FIX/cl-prerelease.md" --version 2.26.3 2>&1)
assert_eq "$?" "1" "prerelease v2.26.3-alpha section does not bleed into v2.26.3"

# 18) fenced code block / HTML comment headings+mentions are ignored (impl-review 🟠)
cat > "$FIX/cl-fenced.md" <<'EOF'
## v2.26.3 — real
plain, names nothing.

```
## v2.26.3 — fenced example
opt-in adds config-protection
```
EOF
OUT=$(node "$SCRIPT" --manifest "$FIX/current.json" --baseline-manifest "$FIX/base.json" --changelog "$FIX/cl-fenced.md" --version 2.26.3 2>&1)
assert_eq "$?" "1" "fenced code block mention does not credit the stem"

# 18b) multi-line HTML comment mention is ignored (impl-review 🟠)
cat > "$FIX/cl-comment.md" <<'EOF'
## v2.26.3 — real
plain, names nothing.

<!--
opt-in adds config-protection
-->
EOF
OUT=$(node "$SCRIPT" --manifest "$FIX/current.json" --baseline-manifest "$FIX/base.json" --changelog "$FIX/cl-comment.md" --version 2.26.3 2>&1)
assert_eq "$?" "1" "HTML comment mention does not credit the stem"

# 18c) a longer (4-backtick) fence containing a ``` example is fully masked (CommonMark fence length)
cat > "$FIX/cl-longfence.md" <<'EOF'
## v2.26.3 — real
plain, names nothing.

````
```md
opt-in adds config-protection
```
````
EOF
OUT=$(node "$SCRIPT" --manifest "$FIX/current.json" --baseline-manifest "$FIX/base.json" --changelog "$FIX/cl-longfence.md" --version 2.26.3 2>&1)
assert_eq "$?" "1" "4-backtick fence with inner triple-fence does not leak the mention"

# 18d) an inline HTML comment on a REAL next-version heading must still terminate the section
cat > "$FIX/cl-inline-comment-heading.md" <<'EOF'
## v2.26.3 — real
plain, names nothing.

## v2.26.2 <!-- older release marker -->
- opt-in adds config-protection.
EOF
OUT=$(node "$SCRIPT" --manifest "$FIX/current.json" --baseline-manifest "$FIX/base.json" --changelog "$FIX/cl-inline-comment-heading.md" --version 2.26.3 2>&1)
assert_eq "$?" "1" "inline-comment heading still terminates so older section does not bleed in"

# 18e) a multi-line comment whose close shares a line with a real H2 must still terminate (impl-review R3 🟠)
cat > "$FIX/cl-comment-close-heading.md" <<'EOF'
## v2.26.3 — real
plain, names nothing.
<!-- older marker
--> ## v2.26.2
- opt-in adds config-protection.
EOF
OUT=$(node "$SCRIPT" --manifest "$FIX/current.json" --baseline-manifest "$FIX/base.json" --changelog "$FIX/cl-comment-close-heading.md" --version 2.26.3 2>&1)
assert_eq "$?" "1" "comment-close + trailing H2 terminates; older section does not bleed in"

# 18f) a fence opener whose info string contains <!-- is a fence, not a comment; real prose
# AFTER the fence closes is still read (no false-fail) (impl-review R3 🟡)
cat > "$FIX/cl-fence-infostring-comment.md" <<'EOF'
## v2.26.3 — real
```js <!-- not a comment
inside the fence, ignored
```
This opt-in change adds config-protection in real prose.
EOF
OUT=$(node "$SCRIPT" --manifest "$FIX/current.json" --baseline-manifest "$FIX/base.json" --changelog "$FIX/cl-fence-infostring-comment.md" --version 2.26.3 2>&1)
assert_eq "$?" "0" "fence info-string <!-- does not swallow real prose after the fence"

# 19) current version NOT yet committed to first-parent history ⇒ fail-closed, not inert (impl-review 🔴)
NYC="$FIX/not-yet-committed"
mkdir -p "$NYC/.claude-plugin" "$NYC/hooks" "$NYC/scripts"
cp "$SCRIPT" "$NYC/scripts/check-optin-changelog.js"
(cd "$NYC" && git -c user.email=t@t -c user.name=t init -q && \
  printf '{ "name": "x", "version": "9.9.8" }\n' > .claude-plugin/plugin.json && \
  printf '{ "opt_in": ["alpha"] }\n' > hooks/opt-in-manifest.json && \
  printf '## v9.9.8\n- opt-in initial alpha.\n' > CHANGELOG.md && \
  git add -A && git -c user.email=t@t -c user.name=t commit -q -m v9.9.8 && \
  printf '{ "name": "x", "version": "9.9.9" }\n' > .claude-plugin/plugin.json && \
  printf '{ "opt_in": ["alpha", "beta"] }\n' > hooks/opt-in-manifest.json && \
  printf '## v9.9.9\n- opt-in tweak, the added stem is not named here.\n\n## v9.9.8\n- opt-in initial alpha.\n' > CHANGELOG.md)
OUT=$(node "$NYC/scripts/check-optin-changelog.js" 2>&1)
assert_eq "$?" "1" "uncommitted current version is fail-closed (not inert HEAD-baseline)"
assert_contains "$OUT" "not yet committed to first-parent history" "uncommitted version message guides remedy"
# committing the bump ⇒ boundary^ baseline ⇒ added beta still unnamed ⇒ violation
(cd "$NYC" && git add -A && git -c user.email=t@t -c user.name=t commit -q -m v9.9.9)
OUT=$(node "$NYC/scripts/check-optin-changelog.js" 2>&1)
assert_eq "$?" "1" "committed bump with unnamed added stem is a violation"
# naming beta alongside opt-in ⇒ pass
(cd "$NYC" && printf '## v9.9.9\n- opt-in change adds beta.\n\n## v9.9.8\n- opt-in initial alpha.\n' > CHANGELOG.md && \
  git add -A && git -c user.email=t@t -c user.name=t commit -q -m fix)
OUT=$(node "$NYC/scripts/check-optin-changelog.js" 2>&1)
assert_eq "$?" "0" "committed bump with the added stem named passes"

finalize_test
