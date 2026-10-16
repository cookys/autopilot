#!/usr/bin/env bash
# check-settings-changelog.js — Settings changes gate (fixtures; negative controls red before green).
. "$(dirname "$0")/lib.sh"
S="$REPO_ROOT/scripts/check-settings-changelog.js"
D="$TEST_TMP/c"; mkdir -p "$D"
keys() { # name aud default
  printf '{"entries":[%s]}' "$1" > "$2"
}
E_A='{"name":"a.one","audience":"user","default":1}'
E_B='{"name":"b.two","audience":"user","default":2}'
E_B2='{"name":"b.two","audience":"user","default":3}'
E_NEW='{"name":"c.new","audience":"user","default":true}'
E_I='{"name":"i.int","audience":"internal","default":1}'
E_I2='{"name":"i.int","audience":"internal","default":9}'
keys "$E_A,$E_B,$E_I" "$D/base.json"
cl_with() { printf '# Changelog\n\n## Unreleased\n\n### Settings changes\n\n%s\n\n## v1.0.0\n\nold\n' "$1" > "$D/cl.md"; }
printf '# Changelog\n\n## Unreleased\n\n### Added\n\n- x\n' > "$D/cl-none.md"
run() { node "$S" --baseline-keys "$D/base.json" --keys "$D/cur.json" --changelog "$1" --section "${2:-Unreleased}" >/dev/null 2>&1; echo $?; }

keys "$E_A,$E_B,$E_NEW,$E_I" "$D/cur.json"
assert_eq "1" "$(run "$D/cl-none.md")" "added user key, no subsection => red"
cl_with "- other thing"; assert_eq "1" "$(run "$D/cl.md")" "added user key, not named => red"
cl_with "- \`c.new\` is new"; assert_eq "0" "$(run "$D/cl.md")" "added user key, named => green"
keys "$E_A,$E_B2,$E_I" "$D/cur.json"
cl_with "- unrelated"; assert_eq "1" "$(run "$D/cl.md")" "default changed, not named => red"
cl_with "- b.two default 2 -> 3"; assert_eq "0" "$(run "$D/cl.md")" "default changed, named => green"
keys "$E_A,$E_I" "$D/cur.json"
cl_with "- unrelated"; assert_eq "1" "$(run "$D/cl.md")" "removed user key, not named => red"
cl_with "- b.two removed"; assert_eq "0" "$(run "$D/cl.md")" "removed user key, named => green"
keys "$E_A,$E_B,$E_I2" "$D/cur.json"
assert_eq "0" "$(run "$D/cl-none.md")" "internal-only change => not required"
keys "$E_A,$E_B,$E_I" "$D/cur.json"
assert_eq "0" "$(run "$D/cl-none.md")" "no change => not required"
# bootstrap (no baseline at ref)
bs() { node "$S" --base-ref "$(git -C "$REPO_ROOT" rev-list --max-parents=0 HEAD | head -1)" --keys "$D/cur.json" --changelog "$1" --section Unreleased >/dev/null 2>&1; echo $?; }
assert_eq "1" "$(bs "$D/cl-none.md")" "bootstrap, no subsection => red"
cl_with "- see x"; assert_eq "1" "$(bs "$D/cl.md")" "bootstrap, no settings-reference link => red"
cl_with "- see docs/settings-reference.md"; assert_eq "0" "$(bs "$D/cl.md")" "bootstrap, linked => green"
finalize_test
