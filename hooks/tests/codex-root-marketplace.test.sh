#!/usr/bin/env bash
# `codex plugin marketplace add <repo root>` must install the Codex package (platforms/codex/plugin),
# not the repo root: the root hooks/hooks.json carries the Claude-only top-level `modules` key and
# Codex (0.163) rejects it on every exec: "unknown field `modules`, expected `description` or `hooks`".
# RED at 3cb8d9cba: .agents/plugins/marketplace.json absent at the repo root, so Codex fell back to
# .claude-plugin/marketplace.json (source "./") and installed hooks/hooks.json with `modules`
# (reproduced with real codex-cli 0.163.0: every `codex exec` emitted the "failed to parse plugin hooks config" item).
. "$(dirname "$0")/lib.sh"

MKT="$REPO_ROOT/.agents/plugins/marketplace.json"
assert_file_exists "$MKT" "repo-root Codex marketplace exists"

OUT="$(node - "$REPO_ROOT" "$MKT" <<'NODE'
const fs = require('fs');
const path = require('path');
const [root, mktPath] = process.argv.slice(2);
const ALLOWED = new Set(['description', 'hooks']); // Codex hooks.json top-level schema (0.163 error text)
const print = (k, v) => console.log(`${k}=${v}`);
// Returns the list of top-level keys Codex would reject.
const badKeys = (file) => Object.keys(JSON.parse(fs.readFileSync(file, 'utf8'))).filter((k) => !ALLOWED.has(k));

let pluginDir = null;
try {
  const mkt = JSON.parse(fs.readFileSync(mktPath, 'utf8'));
  const entry = mkt.plugins.find((p) => p && p.name === 'autopilot');
  print('entry', Boolean(entry));
  pluginDir = fs.realpathSync(path.join(root, entry.source.path));
  print('points_to_codex_package', pluginDir === fs.realpathSync(path.join(root, 'platforms/codex/plugin')));
} catch (e) { print('entry', 'error:' + e.message); }
if (pluginDir) {
  print('codex_hooks_bad_keys', JSON.stringify(badKeys(path.join(pluginDir, 'hooks/hooks.json'))));
}
// Negative control: the checker must flag the Claude-only root hooks.json.
print('control_root_hooks_bad_keys', JSON.stringify(badKeys(path.join(root, 'hooks/hooks.json'))));
// Claude Code still needs `modules` in the root file.
print('root_hooks_keeps_modules', Object.prototype.hasOwnProperty.call(JSON.parse(fs.readFileSync(path.join(root, 'hooks/hooks.json'), 'utf8')), 'modules'));
NODE
)"

assert_contains "$OUT" "entry=true" "root marketplace lists autopilot"
assert_contains "$OUT" "points_to_codex_package=true" "root marketplace source is platforms/codex/plugin"
assert_contains "$OUT" "codex_hooks_bad_keys=[]" "Codex package hooks.json has only keys Codex accepts"
assert_contains "$OUT" 'control_root_hooks_bad_keys=["modules"]' "negative control: checker flags the Claude-only root hooks.json"
assert_contains "$OUT" "root_hooks_keeps_modules=true" "Claude Code root hooks.json keeps modules"

finalize_test
