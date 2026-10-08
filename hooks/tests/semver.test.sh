#!/usr/bin/env bash
# semver.test.sh — shared fixture matrix (fixtures/semver/matrix.json) exercised
# against every consumer of scripts/lib/semver.js: the lib itself, sync-version.js,
# preflight-release.sh, check-optin-changelog.js, hooks/session-start.js and
# scripts/preflight-portability.sh (check_intent_capture_with_env).
# Everything runs in temp sandboxes; the real plugin.json is never touched.

. "$(dirname "$0")/lib.sh"

MATRIX="$HOOKS_DIR/tests/fixtures/semver/matrix.json"
[ -f "$MATRIX" ] || MATRIX="$REPO_ROOT/hooks/tests/fixtures/semver/matrix.json"
SEMVER="$REPO_ROOT/scripts/lib/semver.js"

# mx <js-expr over m> → newline-separated values
mx() { node -e "const m=require(process.argv[1]); const r=($1); console.log([].concat(r).join('\n'))" "$MATRIX"; }

# ── 1. lib: ordering, equality, rejection, badge ───────────────────────────────
mapfile -t ASC < <(mx 'm.ascending')
for ((i = 0; i < ${#ASC[@]} - 1; i++)); do
  a="${ASC[$i]}"; b="${ASC[$((i + 1))]}"
  out=$(node "$SEMVER" compare "$a" "$b" 2>/dev/null)
  assert_eq "$out" '{"cmp":-1}' "lib: $a < $b"
  out=$(node "$SEMVER" compare "$b" "$a" 2>/dev/null)
  assert_eq "$out" '{"cmp":1}' "lib: $b > $a"
done
# transitivity spot-check: first < last
out=$(node "$SEMVER" compare "${ASC[0]}" "${ASC[${#ASC[@]}-1]}" 2>/dev/null)
assert_eq "$out" '{"cmp":-1}' "lib: first < last"

while IFS=' ' read -r a b; do
  out=$(node "$SEMVER" compare "$a" "$b" 2>/dev/null)
  assert_eq "$out" '{"cmp":0}' "lib: $a == $b"
done < <(mx 'm.equal.map(p=>p.join(" "))')

mapfile -t BAD < <(mx 'm.malformed')
for v in "${BAD[@]}"; do
  node "$SEMVER" valid "$v" >/dev/null 2>&1
  assert_exit_code "$?" 1 "lib: rejects malformed '$v'"
  node "$SEMVER" compare "$v" "1.0.0" >/dev/null 2>&1
  assert_exit_code "$?" 2 "lib: compare refuses malformed '$v'"
done
for v in "${ASC[@]}"; do
  node "$SEMVER" valid "$v" >/dev/null 2>&1
  assert_exit_code "$?" 0 "lib: accepts '$v'"
done

while IFS=' ' read -r v want; do
  out=$(node "$SEMVER" badge "$v" 2>/dev/null)
  assert_eq "$out" "{\"badge\":\"$want\"}" "lib: badge escape $v"
done < <(mx 'Object.entries(m.badge).map(e=>e.join(" "))')

# ── 2. sync-version.js: validateArgs + badges (README + zh-TW) ─────────────────
SANDBOX="$TEST_TMP/sv"
SCRIPT=$(setup_sync_version_sandbox "$SANDBOX")
cp "$REPO_ROOT/README.zh-TW.md" "$SANDBOX/README.zh-TW.md"
SKILLS=$(grep -oE '[0-9]+ lifecycle skills' "$SANDBOX/.claude-plugin/plugin.json" | head -1 | grep -oE '^[0-9]+')
HFRAG=$(grep -oE '[0-9]+ hooks \([0-9]+ default-on, [0-9]+ opt-in(, [0-9]+ disabled)?\)' "$SANDBOX/.claude-plugin/plugin.json" | head -1)
HOOKS=$(printf '%s' "$HFRAG" | grep -oE '^[0-9]+')
OPTIN=$(printf '%s' "$HFRAG" | grep -oE '[0-9]+ opt-in' | grep -oE '^[0-9]+')
DISABLED=$(printf '%s' "$HFRAG" | grep -oE '[0-9]+ disabled' | grep -oE '^[0-9]+'); DISABLED=${DISABLED:-0}
SVARGS=(--hook-count "$HOOKS" --skill-count "$SKILLS" --opt-in-count "$OPTIN" --disabled-count "$DISABLED")

for v in "${BAD[@]}"; do
  node "$SCRIPT" --version "$v" "${SVARGS[@]}" --dry-run >/dev/null 2>&1
  assert_neq "$?" "0" "sync-version: rejects malformed '$v'"
done

for v in "3.0.0-alpha.1" "3.0.0-rc.12" "3.0.0" "2.36.116"; do
  node "$SCRIPT" --version "$v" "${SVARGS[@]}" >/dev/null 2>&1
  assert_exit_code "$?" 0 "sync-version: bump to $v"
  node "$SCRIPT" --check >/dev/null 2>&1
  assert_exit_code "$?" 0 "sync-version: --check clean at $v"
  esc=$(node "$SEMVER" badge "$v" | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).badge)')
  for readme in README.md README.zh-TW.md; do
    grep -q "badge/version-${esc}-" "$SANDBOX/$readme"
    assert_exit_code "$?" 0 "sync-version: $readme badge carries $esc"
    grep -q "alt=\"v${v}\"" "$SANDBOX/$readme"
    assert_exit_code "$?" 0 "sync-version: $readme alt carries v$v"
  done
  got=$(node "$SEMVER" from-json "$SANDBOX/.claude-plugin/plugin.json")
  assert_eq "$got" "{\"version\":\"$v\"}" "sync-version: canonical reads back $v"
done

# ── 3. preflight-release.sh: changelog heading follows the canonical version ───
mk_pf() { # mk_pf <dir> <canonical-version>
  local d="$1" v="$2"
  mkdir -p "$d/scripts/lib" "$d/.claude-plugin" "$d/docs/projects"
  cp "$REPO_ROOT/scripts/preflight-release.sh" "$d/scripts/"
  cp "$SEMVER" "$d/scripts/lib/"
  printf '{ "name": "autopilot", "version": "%s" }\n' "$v" > "$d/.claude-plugin/plugin.json"
}
pf_result() { # pf_result <dir> <check-title-prefix> → ✓ or ✗ line following the title
  (cd "$1" && AUTOPILOT_SKIP_SLASH_PROBE=1 bash scripts/preflight-release.sh 2>&1) | grep -A2 -F "$2" | sed -n 2,3p
}

PF="$TEST_TMP/pf-alpha"
mk_pf "$PF" "3.0.0-alpha.1"
printf '## v3.0.0-alpha.1 — first alpha\n' > "$PF/CHANGELOG.md"
printf '| x | v3.0.0-alpha.1 | y |\n' > "$PF/docs/projects/INDEX.md"
assert_contains "$(pf_result "$PF" "[1] canonical version parseable")" "✓" "preflight: 3.0.0-alpha.1 parses as canonical"
assert_contains "$(pf_result "$PF" "[2] CHANGELOG.md has a '## v3.0.0-alpha.1' entry")" "✓" "preflight: alpha.1 demands and finds '## v3.0.0-alpha.1'"
assert_contains "$(pf_result "$PF" "[4] docs/projects/INDEX.md references v3.0.0-alpha.1")" "✓" "preflight: INDEX row v3.0.0-alpha.1 found"

# A heading for the bare release does not satisfy the pre-release canonical.
printf '## v3.0.0 — final\n' > "$PF/CHANGELOG.md"
assert_contains "$(pf_result "$PF" "[2] CHANGELOG.md has a '## v3.0.0-alpha.1' entry")" "✗" "preflight: '## v3.0.0' does not satisfy 3.0.0-alpha.1"
printf '## v3.0.0-alpha.10 — later alpha\n' > "$PF/CHANGELOG.md"
assert_contains "$(pf_result "$PF" "[2] CHANGELOG.md has a '## v3.0.0-alpha.1' entry")" "✗" "preflight: alpha.10 heading does not satisfy alpha.1"

# Final canonical is not satisfied by its own pre-release heading.
PF2="$TEST_TMP/pf-final"
mk_pf "$PF2" "3.0.0"
printf '## v3.0.0-alpha.1 — first alpha\n' > "$PF2/CHANGELOG.md"
printf '| x | v3.0.0-alpha.1 | y |\n' > "$PF2/docs/projects/INDEX.md"
assert_contains "$(pf_result "$PF2" "[2] CHANGELOG.md has a '## v3.0.0' entry")" "✗" "preflight: alpha heading does not satisfy final 3.0.0"
assert_contains "$(pf_result "$PF2" "[4] docs/projects/INDEX.md references v3.0.0")" "✗" "preflight: alpha INDEX row does not satisfy final 3.0.0"
printf '## v3.0.0 — final\n## v3.0.0-alpha.1 — first alpha\n' > "$PF2/CHANGELOG.md"
assert_contains "$(pf_result "$PF2" "[2] CHANGELOG.md has a '## v3.0.0' entry")" "✓" "preflight: final heading satisfies 3.0.0"
# A final heading/INDEX row that also mentions a pre-release on the same line still counts.
printf '## v3.0.0 — folds v3.0.0-alpha.2\n' > "$PF2/CHANGELOG.md"
printf '| x | v3.0.0 | folds v3.0.0-alpha.2 |\n' > "$PF2/docs/projects/INDEX.md"
assert_contains "$(pf_result "$PF2" "[2] CHANGELOG.md has a '## v3.0.0' entry")" "✓" "preflight: final heading mixed with a pre-release mention passes"
assert_contains "$(pf_result "$PF2" "[4] docs/projects/INDEX.md references v3.0.0")" "✓" "preflight: final INDEX row mixed with a pre-release mention passes"
# Only pre-release headings present while canonical is final ⇒ fail (also with trailing text and a longer version).
printf '## v3.0.0-alpha.1\n## v3.0.0.1 — x\n## v3.0.01 — y\n' > "$PF2/CHANGELOG.md"
assert_contains "$(pf_result "$PF2" "[2] CHANGELOG.md has a '## v3.0.0' entry")" "✗" "preflight: only '## v3.0.0-alpha.1' (and longer versions) does not satisfy final 3.0.0"

# Plain N.N.N behaviour unchanged (historical '-followup' suffix still counts).
PF3="$TEST_TMP/pf-plain"
mk_pf "$PF3" "2.7.2"
printf '## v2.7.2 — x\n' > "$PF3/CHANGELOG.md"
printf '| x | v2.7.2-followup | y |\n' > "$PF3/docs/projects/INDEX.md"
assert_contains "$(pf_result "$PF3" "[2] CHANGELOG.md has a '## v2.7.2' entry")" "✓" "preflight: plain N.N.N heading"
assert_contains "$(pf_result "$PF3" "[4] docs/projects/INDEX.md references v2.7.2")" "✓" "preflight: plain N.N.N INDEX row (suffix tolerated as before)"

# Malformed canonical → check 1 fails.
for v in "1.2" "1.2.3-gamma.1" "01.2.3"; do
  PFB="$TEST_TMP/pf-bad-$v"
  mk_pf "$PFB" "$v"
  : > "$PFB/CHANGELOG.md"
  assert_contains "$(pf_result "$PFB" "[1] canonical version parseable")" "✗" "preflight: malformed canonical '$v' fails check 1"
done

# ── 4. check-optin-changelog.js: version validation + pre-release section ──────
OC="$TEST_TMP/oc"
mkdir -p "$OC"
printf '{ "opt_in": ["accumulator"] }\n' > "$OC/m.json"
printf '## v3.0.0-alpha.1\n- nothing\n' > "$OC/cl.md"
node "$REPO_ROOT/scripts/check-optin-changelog.js" --manifest "$OC/m.json" --baseline-manifest "$OC/m.json" --changelog "$OC/cl.md" --version 3.0.0-alpha.1 >/dev/null 2>&1
assert_exit_code "$?" 0 "check-optin-changelog: accepts --version 3.0.0-alpha.1"
printf '{ "opt_in": ["accumulator", "newhook"] }\n' > "$OC/m2.json"
out=$(node "$REPO_ROOT/scripts/check-optin-changelog.js" --manifest "$OC/m2.json" --baseline-manifest "$OC/m.json" --changelog "$OC/cl.md" --version 3.0.0-alpha.1 2>&1)
assert_contains "$out" "in v3.0.0-alpha.1 entry" "check-optin-changelog: alpha section is located and checked for opt-in mention"
for v in "${BAD[@]}"; do
  [ -n "$v" ] || continue
  node "$REPO_ROOT/scripts/check-optin-changelog.js" --manifest "$OC/m.json" --baseline-manifest "$OC/m.json" --changelog "$OC/cl.md" --version "$v" >/dev/null 2>&1
  assert_neq "$?" "0" "check-optin-changelog: rejects malformed '$v'"
done

# ── 5. hooks/session-start.js: update notice ordering over pre-releases ────────
SS_ROOT="$TEST_TMP/ss-root"
WORKSPACE="$TEST_TMP/ss-ws"
mkdir -p "$SS_ROOT/.claude-plugin" "$WORKSPACE" "$HOOK_HOME/.autopilot"
PAYLOAD="{\"source\":\"startup\",\"reason\":\"clear\",\"cwd\":\"$WORKSPACE\"}"
printf '%s\n' \
  '## v1.0.0 — final release' \
  '## v1.0.0-rc.1 — release candidate' \
  '## v1.0.0-beta.1 — beta' \
  '## v1.0.0-alpha.1 — alpha' > "$SS_ROOT/CHANGELOG.md"
run_ss() { # run_ss <current> <last-seen|""> → context text in $SS_OUT
  printf '{"name":"autopilot","version":"%s"}' "$1" > "$SS_ROOT/.claude-plugin/plugin.json"
  if [ -n "$2" ]; then printf '%s' "$2" > "$HOOK_HOME/.autopilot/last-seen-version"; else rm -f "$HOOK_HOME/.autopilot/last-seen-version"; fi
  SS_OUT=$(HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" CLAUDE_PLUGIN_ROOT="$SS_ROOT" node "$HOOKS_DIR/session-start.js" <<< "$PAYLOAD" 2>&1)
  SS_SEEN=$(cat "$HOOK_HOME/.autopilot/last-seen-version" 2>/dev/null)
}
run_ss "1.0.0-rc.1" "1.0.0-alpha.1"
assert_contains "$SS_OUT" "v1.0.0-alpha.1 → v1.0.0-rc.1" "session-start: alpha.1 → rc.1 notice header"
assert_contains "$SS_OUT" "v1.0.0-rc.1: release candidate" "session-start: rc.1 headline included"
assert_contains "$SS_OUT" "v1.0.0-beta.1: beta" "session-start: beta.1 headline included"
assert_not_contains "$SS_OUT" "v1.0.0-alpha.1: alpha" "session-start: last-seen alpha.1 headline excluded"
assert_not_contains "$SS_OUT" "final release" "session-start: future final headline excluded"
assert_eq "$SS_SEEN" "1.0.0-rc.1" "session-start: watermark advanced to pre-release"
run_ss "1.0.0" "1.0.0-rc.1"
assert_contains "$SS_OUT" "v1.0.0-rc.1 → v1.0.0" "session-start: rc.1 → final is an upgrade"
assert_contains "$SS_OUT" "v1.0.0: final release" "session-start: final headline included"
run_ss "1.0.0-beta.1" "1.0.0"
assert_not_contains "$SS_OUT" "[Autopilot updated:" "session-start: final → beta is a downgrade, silent"
assert_eq "$SS_SEEN" "1.0.0" "session-start: watermark not lowered on downgrade"
for v in "${BAD[@]}"; do
  [ -n "$v" ] || continue
  run_ss "$v" "1.0.0-alpha.1"
  assert_not_contains "$SS_OUT" "[Autopilot updated:" "session-start: malformed canonical '$v' yields no notice"
done

# ── 6. preflight-portability.sh: canonical-version check uses the shared grammar ──
# The check function is extracted and run against a sandbox REPO whose plugin.json carries
# each matrix version, so the real script's other checks (and ~/.autopilot) are never touched.
PP="$TEST_TMP/pp"
mkdir -p "$PP/scripts/lib" "$PP/.claude-plugin"
cp "$SEMVER" "$PP/scripts/lib/"
PP_FN=$(sed -n '/^check_intent_capture_with_env()/,/^}/p' "$REPO_ROOT/scripts/preflight-portability.sh")
assert_neq "$PP_FN" "" "preflight-portability: check_intent_capture_with_env extracted"
pp_check() { # pp_check <version> → exit status of the real check function
  printf '{"name":"autopilot","version":"%s"}\n' "$1" > "$PP/.claude-plugin/plugin.json"
  ( REPO="$PP"; eval "$PP_FN"; check_intent_capture_with_env ) >/dev/null 2>&1
}
for v in "${ASC[@]}"; do
  pp_check "$v"
  assert_exit_code "$?" 0 "preflight-portability: accepts canonical '$v'"
done
for v in "${BAD[@]}"; do
  [ -n "$v" ] || continue
  pp_check "$v"
  assert_neq "$?" "0" "preflight-portability: rejects malformed canonical '$v'"
done

finalize_test
