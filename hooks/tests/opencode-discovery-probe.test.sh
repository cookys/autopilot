#!/usr/bin/env bash
# opencode-discovery-probe.test.sh — negative controls for preflight-portability checks 16-18
# (OpenCode plugin version / skill discovery / agent body) and for the probe they share
# (scripts/lib/opencode-discovery-probe.js). Every gate here is shown RED against a deliberately
# broken fixture repo before it is trusted green: a check that cannot fail proves nothing.
. "$(dirname "$0")/lib.sh"

if ! command -v opencode >/dev/null 2>&1; then
  echo "SKIP [$TEST_NAME] opencode not found"
  exit 0
fi

PROBE="$REPO_ROOT/scripts/lib/opencode-discovery-probe.js"
PREFLIGHT="$REPO_ROOT/scripts/preflight-portability.sh"

# A fixture repo = the consumer layer only (what the probe copies), freely breakable.
new_fixture() { # <name> -> prints dir
  local d="$TEST_TMP/fixture-$1"
  mkdir -p "$d/.opencode"
  cp -R "$REPO_ROOT/.claude-plugin" "$d/.claude-plugin"
  ( cd "$REPO_ROOT/.opencode" && for f in *; do case "$f" in node_modules|package.json|package-lock.json) ;; *) cp -R "$f" "$d/.opencode/$f" ;; esac; done )
  ln -s "$REPO_ROOT/.agents" "$d/.agents"
  echo "$d"
}

probe_json() { # <bin> <fixture> <name>
  node "$PROBE" --bin "$1" --repo "$2" --root "$TEST_TMP/root-$3" 2>&1
}

preflight_oc() { # <fixture> [bin] -> the OpenCode lines of preflight (stdout+stderr)
  PREFLIGHT_OPENCODE_REPO="$1" OPENCODE_BIN="${2:-opencode}" bash "$PREFLIGHT" --opencode-only </dev/null 2>&1 | grep -E 'OpenCode|opencode' || true
}

# ── green control: the real repo passes all three ──
OUT="$(PREFLIGHT_OPENCODE_REPO="$REPO_ROOT" bash "$PREFLIGHT" --opencode-only </dev/null 2>&1 | grep -E '^  [✓✗] OpenCode' || true)"
assert_contains "$OUT" '✓ OpenCode plugin getPluginVersion returns real version' "green: plugin version check passes on the real repo"
assert_contains "$OUT" '✓ OpenCode agent body resolves without frontmatter leak' "green: agent body check passes on the real repo"
assert_not_contains "$OUT" '✗' "green: no OpenCode check fails on the real repo"

ADAPTOR="$(probe_json opencode "$REPO_ROOT" adaptor | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0)).adaptor)')"

# ── red 1: agent body whose YAML frontmatter leaked into the prompt ──
F="$(new_fixture leak)"
printf -- '---\nname: reviewer\ndescription: leaked\n---\n# Reviewer\n' > "$F/.opencode/agent-bodies/reviewer.body.md"
J="$(probe_json opencode "$F" leak)"
assert_contains "$J" '"agent_frontmatter_leak":true' "red 1: probe reports the frontmatter leak"
OUT="$(preflight_oc "$F")"
assert_contains "$OUT" '✗ OpenCode agent body resolves without frontmatter leak' "red 1: agent-body check goes red on a leaking body"

# ── red 2: plugin that reports a fake version ──
F="$(new_fixture fakever)"
sed -i 's/getPluginVersion())/"9.9.9")/' "$F/.opencode/plugin-package/server.ts"
grep -q '"9.9.9"' "$F/.opencode/plugin-package/server.ts" || { echo "FIXTURE: fake-version sed did not apply"; exit 1; }
J="$(probe_json opencode "$F" fakever)"
assert_contains "$J" '"plugin_loaded_version":"9.9.9"' "red 2: probe reads the version the plugin printed"
OUT="$(preflight_oc "$F")"
assert_contains "$OUT" '✗ OpenCode plugin getPluginVersion returns real version' "red 2: plugin-version check goes red on a fake version"

# ── red 3: plugin entry in the pre-2.x shape (a file path; 2.x wants a directory) never loads ──
F="$(new_fixture filepath)"
sed -i 's#"./plugin-package"#"./plugin-package/server.ts"#' "$F/.opencode/opencode.json"
J="$(probe_json opencode "$F" filepath)"
OUT="$(preflight_oc "$F")"
case "$ADAPTOR" in
  v2)
    assert_contains "$J" '"plugin_loaded_version":null' "red 3: file-path plugin entry never loads on 2.x"
    assert_contains "$OUT" '✗ OpenCode plugin getPluginVersion returns real version' "red 3: plugin-version check goes red when the plugin never loads" ;;
  *) echo "NOTE [$TEST_NAME] installed opencode is not 2.x: red 3 (2.x file-path rejection) not applicable" ;;
esac

# ── red 4: skills not discoverable (empty .agents/skills) ──
F="$(new_fixture noskill)"
rm "$F/.agents"; mkdir -p "$F/.agents/skills/unrelated"
printf -- '---\nname: unrelated\ndescription: not dev-flow\n---\nbody\n' > "$F/.agents/skills/unrelated/SKILL.md"
J="$(probe_json opencode "$F" noskill)"
assert_contains "$J" '"skill_found":false' "red 4: probe does not find dev-flow in a fixture without it"
OUT="$(preflight_oc "$F")"
case "$ADAPTOR" in
  v2) assert_contains "$OUT" '✗ OpenCode discovers autopilot skills' "red 4: skill-discovery check is a hard failure on 2.x" ;;
  *) assert_contains "$OUT" 'ADVISORY' "red 4: skill-discovery shortfall is advisory on 1.x" ;;
esac

# ── red 5: unknown major fails closed (probe exit 3, preflight check red), nothing guessed ──
BIN="$TEST_TMP/fake-opencode"
printf '#!/bin/sh\necho "opencode 3.1.0"\n' > "$BIN"; chmod +x "$BIN"
J="$(probe_json "$BIN" "$REPO_ROOT" unknownmajor)"; RC=$?
node "$PROBE" --bin "$BIN" --repo "$REPO_ROOT" --root "$TEST_TMP/root-unknownmajor2" >/dev/null 2>&1; RC=$?
assert_eq "$RC" "3" "red 5: unknown opencode major exits 3 (fail closed)"
assert_contains "$J" 'refusing to guess' "red 5: unknown major names the refusal"
OUT="$(preflight_oc "$REPO_ROOT" "$BIN")"
assert_contains "$OUT" '✗ OpenCode plugin getPluginVersion returns real version' "red 5: preflight check goes red on an unknown major"

# ── isolation: the probe's opencode wrote its state inside the sandbox root ──
assert_file_exists "$TEST_TMP/root-adaptor/xdg-data/opencode" "isolation: opencode data dir lives under the probe root (XDG_DATA_HOME redirected)"
assert_file_exists "$TEST_TMP/root-adaptor/home" "isolation: HOME is the probe root's home"

finalize_test
