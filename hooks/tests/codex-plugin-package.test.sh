#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

PLUGIN_DIR="$REPO_ROOT/platforms/codex/plugin"
MARKETPLACE_ROOT="$REPO_ROOT/platforms/codex"
MARKETPLACE="$MARKETPLACE_ROOT/.agents/plugins/marketplace.json"

assert_file_exists "$PLUGIN_DIR/.codex-plugin/plugin.json" "Codex plugin manifest exists"
assert_file_exists "$MARKETPLACE" "Codex local marketplace exists"
assert_file_exists "$PLUGIN_DIR/skills" "Codex plugin generated skills copy exists"

DIFF_OUT="$(node - "$REPO_ROOT/skills" "$PLUGIN_DIR/skills" <<'NODE'
const fs = require('fs');
const path = require('path');

const [sourceRoot, copyRoot] = process.argv.slice(2);
const failures = [];

function listFiles(root, dir = '') {
  const absolute = path.join(root, dir);
  const entries = fs.readdirSync(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.join(dir, entry.name);
    const full = path.join(root, relative);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      files.push(...listFiles(root, relative));
    } else if (stat.isFile()) {
      files.push(relative);
    }
  }
  return files.sort();
}

const sourceFiles = listFiles(sourceRoot);
const copyFiles = listFiles(copyRoot);
const sourceSet = new Set(sourceFiles);
const copySet = new Set(copyFiles);

for (const file of sourceFiles) {
  if (!copySet.has(file)) failures.push(`missing ${file}`);
}
for (const file of copyFiles) {
  if (!sourceSet.has(file)) failures.push(`extra ${file}`);
}
for (const file of sourceFiles) {
  if (!copySet.has(file)) continue;
  const source = fs.readFileSync(path.join(sourceRoot, file));
  const copy = fs.readFileSync(path.join(copyRoot, file));
  if (!source.equals(copy)) failures.push(`content ${file}`);
}

if (failures.length > 0) {
  console.log(failures.join('\n'));
  process.exit(1);
}
console.log('skills_copy_in_sync');
NODE
)"
EXIT=$?
assert_eq "$EXIT" "0" "Codex plugin generated skills copy drift check exits 0"
assert_eq "$DIFF_OUT" "skills_copy_in_sync" "Codex plugin generated skills copy has no file drift"

SUPPORT_DIFF_OUT="$(node - "$REPO_ROOT" "$PLUGIN_DIR" <<'NODE'
const fs = require('fs');
const path = require('path');

const [root, pluginDir] = process.argv.slice(2);
const failures = [];

function listFiles(rootDir, dir = '') {
  const absolute = path.join(rootDir, dir);
  const entries = fs.readdirSync(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.join(dir, entry.name);
    const full = path.join(rootDir, relative);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      files.push(...listFiles(rootDir, relative));
    } else if (stat.isFile()) {
      files.push(relative);
    }
  }
  return files.sort();
}

function compareTree(rel) {
  const sourceRoot = path.join(root, rel);
  const copyRoot = path.join(pluginDir, rel);
  const sourceFiles = listFiles(sourceRoot);
  const copyFiles = listFiles(copyRoot);
  const sourceSet = new Set(sourceFiles);
  const copySet = new Set(copyFiles);

  // Mirror sync-codex-plugin-skills.sh SCRIPT_EXCLUDES: the Codex payload
  // deliberately omits the OpenCode installer scripts.
  const scriptExcludes = new Set(['install-opencode.sh', 'sync-opencode-plugin.sh']);
  const excluded = (file) => rel === 'scripts' && scriptExcludes.has(file);

  for (const file of sourceFiles) {
    if (excluded(file)) continue;
    if (!copySet.has(file)) failures.push(`missing ${rel}/${file}`);
  }
  for (const file of copyFiles) {
    if (!sourceSet.has(file)) failures.push(`extra ${rel}/${file}`);
  }
  for (const file of sourceFiles) {
    if (excluded(file) || !copySet.has(file)) continue;
    const source = fs.readFileSync(path.join(sourceRoot, file));
    const copy = fs.readFileSync(path.join(copyRoot, file));
    if (!source.equals(copy)) failures.push(`content ${rel}/${file}`);
  }
}

function compareFile(rel) {
  const sourcePath = path.join(root, rel);
  const copyPath = path.join(pluginDir, rel);
  if (!fs.existsSync(copyPath)) {
    failures.push(`missing ${rel}`);
    return;
  }
  const source = fs.readFileSync(sourcePath);
  const copy = fs.readFileSync(copyPath);
  if (!source.equals(copy)) failures.push(`content ${rel}`);
}

for (const rel of ['bin', 'src', 'profiles', 'hooks/_shared', 'references', 'scripts', 'project-config-template']) {
  compareTree(rel);
}
for (const rel of [
  'hooks/hooks.json',
  'docs/plans/2026-06-04-distill-consolidate.md',
  'docs/plans/2026-06-22-ceo-fleet-autonomy.md',
  'docs/plans/2026-06-26-trust-tiered-review-policy.md',
  'docs/projects/2026-07-26-capability-adaptive-profiles/p0-context-baseline.json',
  'docs/projects/_archive/2026-06-26-test-integrity-l1/design-spec.md',
]) {
  compareFile(rel);
}

if (failures.length > 0) {
  console.log(failures.join('\n'));
  process.exit(1);
}
console.log('support_payload_in_sync');
NODE
)"
EXIT=$?
assert_eq "$EXIT" "0" "Codex plugin support payload drift check exits 0"
assert_eq "$SUPPORT_DIFF_OUT" "support_payload_in_sync" "Codex plugin support payload has no file drift"

OUT="$(bash "$REPO_ROOT/scripts/sync-codex-plugin-skills.sh" --check 2>&1)"; EXIT=$?
assert_eq "$EXIT" "0" "sync-codex-plugin-skills --check exits 0 on clean payload"
assert_contains "$OUT" "Codex plugin payload in sync" "sync-codex-plugin-skills --check reports clean payload"

PROFILE_CATALOG_OUT="$(node "$PLUGIN_DIR/scripts/build-profile-payload.js" catalog \
  --check --repo "$PLUGIN_DIR" 2>&1)"; EXIT=$?
assert_eq "$EXIT" "0" "Codex package validates its profile catalog from its own root"
assert_contains "$PROFILE_CATALOG_OUT" '"canonical_rules": 751' \
  "Codex package includes the immutable baseline needed by profile validation"

STANDALONE_PLUGIN="$TEST_TMP/standalone-codex-plugin"
cp -R "$PLUGIN_DIR" "$STANDALONE_PLUGIN"
STANDALONE_CATALOG_OUT="$(GIT_CEILING_DIRECTORIES="$TEST_TMP" \
  node "$STANDALONE_PLUGIN/scripts/build-profile-payload.js" catalog \
  --check --repo "$STANDALONE_PLUGIN" 2>&1)"; EXIT=$?
assert_eq "$EXIT" "0" "standalone Codex package validates without parent Git discovery"
assert_contains "$STANDALONE_CATALOG_OUT" '"canonical_rules": 751' \
  "standalone catalog uses packaged immutable baseline snapshots"
STANDALONE_BUILD_OUT="$(GIT_CEILING_DIRECTORIES="$TEST_TMP" \
  node "$STANDALONE_PLUGIN/scripts/build-profile-payload.js" build \
  --profile guided --out "$TEST_TMP/standalone-guided-bundle" \
  --repo "$STANDALONE_PLUGIN" 2>&1)"; EXIT=$?
assert_eq "$EXIT" "0" "standalone Codex package builds a guided payload"
assert_contains "$STANDALONE_BUILD_OUT" '"effective_profile": "guided"' \
  "standalone payload build resolves the packaged hook manifest"

# The codex-payload change-scope triggers moved from a bespoke CODEX_PAYLOAD_TRIGGER_RE
# in .githooks/pre-commit into the sync-codex-plugin-skills row of scripts/sync-manifest.json
# (consumed by scripts/sync-all.sh, which pre-commit delegates to). The invariant is
# unchanged: every doc the generator copies must be covered by that ritual's triggers, so
# editing one still fires the mirror check. Assert it at the new location.
MANIFEST_TRIGGER_OUT="$(node - "$REPO_ROOT/scripts/sync-manifest.json" <<'NODE'
const fs = require('fs');
const [manifestPath] = process.argv.slice(2);
const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const row = (m.rituals || []).find((r) => r.id === 'sync-codex-plugin-skills');
if (!row) { console.log('missing sync-codex-plugin-skills ritual'); process.exit(1); }
const triggers = row.trigger || [];
// same match semantics as scripts/sync-all.sh: entry ending '/' = dir prefix,
// entry starting '*' = suffix, else exact path.
const covers = (f) => triggers.some((e) =>
  e.endsWith('/') ? f.startsWith(e) : e.startsWith('*') ? f.endsWith(e.slice(1)) : f === e);
const docFiles = [
  'docs/plans/2026-06-04-distill-consolidate.md',
  'docs/plans/2026-06-22-ceo-fleet-autonomy.md',
  'docs/plans/2026-06-26-trust-tiered-review-policy.md',
  'docs/projects/2026-07-26-capability-adaptive-profiles/p0-context-baseline.json',
  'docs/projects/_archive/2026-06-26-test-integrity-l1/design-spec.md',
];
const misses = docFiles.filter((rel) => !covers(rel));
if (misses.length > 0) { console.log(misses.join('\n')); process.exit(1); }
console.log('manifest_codex_doc_triggers_in_sync');
NODE
)"
EXIT=$?
assert_eq "$EXIT" "0" "Codex payload docs trigger manifest mirror check"
assert_eq "$MANIFEST_TRIGGER_OUT" "manifest_codex_doc_triggers_in_sync" "Codex payload doc triggers cover generator docs (sync-manifest.json)"

SYNC_SANDBOX="$TEST_TMP/codex-sync-sandbox"
mkdir -p "$SYNC_SANDBOX/scripts" "$SYNC_SANDBOX/platforms/codex/plugin"
cp "$REPO_ROOT/scripts/sync-codex-plugin-skills.sh" "$SYNC_SANDBOX/scripts/sync-codex-plugin-skills.sh"
for rel in skills bin src profiles hooks/_shared references scripts project-config-template schemas; do
  mkdir -p "$SYNC_SANDBOX/$rel" "$SYNC_SANDBOX/platforms/codex/plugin/$rel"
  printf 'payload %s\n' "$rel" > "$SYNC_SANDBOX/$rel/payload.txt"
  cp "$SYNC_SANDBOX/$rel/payload.txt" "$SYNC_SANDBOX/platforms/codex/plugin/$rel/payload.txt"
done
mkdir -p "$SYNC_SANDBOX/skills/example" "$SYNC_SANDBOX/platforms/codex/plugin/skills/example"
printf -- '---\nname: example\ndescription: sandbox skill\n---\n# Example\n' > "$SYNC_SANDBOX/skills/example/SKILL.md"
cp "$SYNC_SANDBOX/skills/example/SKILL.md" "$SYNC_SANDBOX/platforms/codex/plugin/skills/example/SKILL.md"
cp "$SYNC_SANDBOX/scripts/sync-codex-plugin-skills.sh" "$SYNC_SANDBOX/platforms/codex/plugin/scripts/sync-codex-plugin-skills.sh"
for rel in \
  docs/plans/2026-06-04-distill-consolidate.md \
  docs/plans/2026-06-22-ceo-fleet-autonomy.md \
  docs/plans/2026-06-26-trust-tiered-review-policy.md \
  docs/projects/2026-07-26-capability-adaptive-profiles/p0-context-baseline.json \
  docs/projects/_archive/2026-06-26-test-integrity-l1/design-spec.md
do
  mkdir -p "$SYNC_SANDBOX/$(dirname "$rel")" "$SYNC_SANDBOX/platforms/codex/plugin/$(dirname "$rel")"
  printf 'doc %s\n' "$rel" > "$SYNC_SANDBOX/$rel"
  cp "$SYNC_SANDBOX/$rel" "$SYNC_SANDBOX/platforms/codex/plugin/$rel"
done
printf '{"hooks":{}}\n' > "$SYNC_SANDBOX/hooks/hooks.json"
cp "$SYNC_SANDBOX/hooks/hooks.json" \
  "$SYNC_SANDBOX/platforms/codex/plugin/hooks/hooks.json"

OUT="$(bash "$SYNC_SANDBOX/scripts/sync-codex-plugin-skills.sh" --check 2>&1)"; EXIT=$?
assert_eq "$EXIT" "0" "sync-codex-plugin-skills --check exits 0 in sandbox"
assert_contains "$OUT" "Codex plugin payload in sync" "sync-codex-plugin-skills --check sandbox clean report"

printf 'drift\n' >> "$SYNC_SANDBOX/skills/example/SKILL.md"
OUT="$(bash "$SYNC_SANDBOX/scripts/sync-codex-plugin-skills.sh" --check 2>&1)"; EXIT=$?
assert_eq "$EXIT" "1" "sync-codex-plugin-skills --check exits 1 on source drift"
assert_contains "$OUT" "skills/example/SKILL.md" "sync-codex-plugin-skills --check names drifted path"

LINK_CHECK_OUT="$(node - "$PLUGIN_DIR/skills" <<'NODE'
const fs = require('fs');
const path = require('path');

const [root] = process.argv.slice(2);
const fileExt = /\.[A-Za-z0-9]{1,8}$/;
const ghRel = /(^|\/)(commit|commits|issues|pull|releases|blob|tree|compare|wiki)(\/|$)/;
const failures = [];

function listMarkdown(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMarkdown(full));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(full);
    }
  }
  return files;
}

for (const file of listMarkdown(root)) {
  const text = fs.readFileSync(file, 'utf8');
  const base = path.dirname(file);
  const regex = /\]\(([^)]+)\)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const link = match[1];
    if (link.startsWith('http://') || link.startsWith('https://') || link.startsWith('#') || link.startsWith('mailto:')) continue;
    if (/[<>{}|]/.test(link)) continue;
    const linkPath = link.split('#')[0];
    if (!linkPath || ghRel.test(linkPath)) continue;
    if (!(linkPath.endsWith('/') || fileExt.test(linkPath))) continue;
    const target = path.normalize(path.join(base, linkPath));
    if (!fs.existsSync(target)) {
      failures.push(`${path.relative(root, file)}: ${link}`);
    }
  }
}

if (failures.length > 0) {
  console.log(failures.join('\n'));
  process.exit(1);
}
console.log('package_skill_links_resolve');
NODE
)"
EXIT=$?
assert_eq "$EXIT" "0" "Codex plugin package skill-link check exits 0"
assert_eq "$LINK_CHECK_OUT" "package_skill_links_resolve" "Codex plugin package skill links resolve inside payload"

OUT="$(node "$PLUGIN_DIR/bin/autopilot.js" --help 2>&1)"; EXIT=$?
assert_eq "$EXIT" "0" "Codex plugin packaged engine CLI help exits 0"
assert_contains "$OUT" "engine implement-review" "Codex plugin packaged engine CLI can load support modules"

OUT="$(node - "$REPO_ROOT" "$PLUGIN_DIR" "$MARKETPLACE" "$MARKETPLACE_ROOT" <<'NODE'
const fs = require('fs');
const path = require('path');

const [root, pluginDir, marketplacePath, marketplaceRoot] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, '.codex-plugin', 'plugin.json'), 'utf8'));
const marketplace = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'));
const canonical = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));

function print(key, value) {
  console.log(`${key}=${value}`);
}

print('manifest_name', manifest.name);
print('manifest_version_matches', manifest.version === canonical.version);
print('manifest_description_mentions_support', /support CLI\/scripts/.test(manifest.description));
print('manifest_description_skills_only_package', /package is skills-only/.test(manifest.description));
print('manifest_long_description_mentions_payload', /package payload bundles support CLI/.test(manifest.interface && manifest.interface.longDescription || ''));
print('skills_path', manifest.skills);
print('has_hooks_field', Object.prototype.hasOwnProperty.call(manifest, 'hooks'));
print('has_apps_field', Object.prototype.hasOwnProperty.call(manifest, 'apps'));
print('has_mcp_field', Object.prototype.hasOwnProperty.call(manifest, 'mcpServers'));
print('interface_category', manifest.interface && manifest.interface.category);
print('default_prompt_count', Array.isArray(manifest.interface.defaultPrompt) ? manifest.interface.defaultPrompt.length : 'bad');

const skillsPath = path.join(pluginDir, 'skills');
print('skills_is_symlink', fs.lstatSync(skillsPath).isSymbolicLink());
print('skills_is_directory', fs.statSync(skillsPath).isDirectory());
print('skill_dev_flow_exists', fs.existsSync(path.join(pluginDir, 'skills', 'dev-flow', 'SKILL.md')));
print('skill_harness_maintenance_exists', fs.existsSync(path.join(pluginDir, 'skills', 'harness-maintenance', 'SKILL.md')));
print('support_reference_exists', fs.existsSync(path.join(pluginDir, 'references', 'model-routing.md')));
print('support_script_exists', fs.existsSync(path.join(pluginDir, 'scripts', 'dispatch-review.sh')));
print('support_template_exists', fs.existsSync(path.join(pluginDir, 'project-config-template', 'review-loop-config.md')));
print('support_doc_exists', fs.existsSync(path.join(pluginDir, 'docs', 'plans', '2026-06-26-trust-tiered-review-policy.md')));

const pluginReal = fs.realpathSync(pluginDir);

print('marketplace_name', marketplace.name);
print('marketplace_plugins', Array.isArray(marketplace.plugins) ? marketplace.plugins.length : 'bad');
const entry = marketplace.plugins.find((plugin) => plugin && plugin.name === 'autopilot');
print('marketplace_entry_exists', Boolean(entry));
print('marketplace_path', entry && entry.source && entry.source.path);
print('marketplace_version_matches', entry && entry.version === canonical.version);
if (entry && entry.source && entry.source.path) {
  const resolvedMarketplacePath = fs.realpathSync(path.join(marketplaceRoot, entry.source.path));
  print('marketplace_path_points_to_plugin', resolvedMarketplacePath === pluginReal);
}
print('marketplace_installation', entry && entry.policy && entry.policy.installation);
print('marketplace_authentication', entry && entry.policy && entry.policy.authentication);
print('marketplace_category', entry && entry.category);
NODE
)"
EXIT=$?
assert_eq "$EXIT" "0" "Codex plugin JSON inspection exits 0"
assert_contains "$OUT" "manifest_name=autopilot" "Codex plugin manifest uses autopilot name"
assert_contains "$OUT" "manifest_version_matches=true" "Codex plugin version follows canonical manifest"
assert_contains "$OUT" "manifest_description_mentions_support=true" "Codex plugin manifest describes bundled support payload"
assert_contains "$OUT" "manifest_description_skills_only_package=false" "Codex plugin manifest does not call the whole package skills-only"
assert_contains "$OUT" "manifest_long_description_mentions_payload=true" "Codex plugin long description explains support payload"
assert_contains "$OUT" "skills_path=./skills/" "Codex plugin skills path is relative"
assert_contains "$OUT" "has_hooks_field=false" "Codex plugin does not declare hooks"
assert_contains "$OUT" "has_apps_field=false" "Codex plugin does not declare apps"
assert_contains "$OUT" "has_mcp_field=false" "Codex plugin does not declare MCP servers"
assert_contains "$OUT" "interface_category=Developer Tools" "Codex plugin interface category is present"
assert_contains "$OUT" "default_prompt_count=3" "Codex plugin keeps default prompts bounded"
assert_contains "$OUT" "skills_is_symlink=false" "Codex plugin skills payload is a real directory"
assert_contains "$OUT" "skills_is_directory=true" "Codex plugin skills payload is a directory"
assert_contains "$OUT" "skill_dev_flow_exists=true" "Codex plugin exposes dev-flow skill"
assert_contains "$OUT" "skill_harness_maintenance_exists=true" "Codex plugin exposes harness-maintenance skill"
assert_contains "$OUT" "support_reference_exists=true" "Codex plugin packages linked references"
assert_contains "$OUT" "support_script_exists=true" "Codex plugin packages linked scripts"
assert_contains "$OUT" "support_template_exists=true" "Codex plugin packages linked project config templates"
assert_contains "$OUT" "support_doc_exists=true" "Codex plugin packages linked docs"
assert_contains "$OUT" "marketplace_name=autopilot-local" "Codex marketplace has stable local name"
assert_contains "$OUT" "marketplace_plugins=1" "Codex marketplace contains one plugin"
assert_contains "$OUT" "marketplace_entry_exists=true" "Codex marketplace contains autopilot entry"
assert_contains "$OUT" "marketplace_path=./plugin" "Codex marketplace points directly to plugin root"
assert_contains "$OUT" "marketplace_version_matches=true" "Codex marketplace version follows canonical manifest"
assert_contains "$OUT" "marketplace_path_points_to_plugin=true" "Codex marketplace path resolves to plugin root"
assert_contains "$OUT" "marketplace_installation=AVAILABLE" "Codex marketplace install policy is explicit"
assert_contains "$OUT" "marketplace_authentication=ON_INSTALL" "Codex marketplace auth policy is explicit"
assert_contains "$OUT" "marketplace_category=Developer Tools" "Codex marketplace category is explicit"

if command -v codex >/dev/null 2>&1; then
  CODEX_HOME_DIR="$TEST_TMP/codex-home"
  mkdir -p "$CODEX_HOME_DIR/.codex"
  ADD_STDERR="$TEST_TMP/codex-marketplace-add.stderr"
  ADD_OUT="$(HOME="$CODEX_HOME_DIR" CODEX_HOME="$CODEX_HOME_DIR/.codex" codex plugin marketplace add "$MARKETPLACE_ROOT" --json 2>"$ADD_STDERR")"
  EXIT=$?
  assert_eq "$EXIT" "0" "Codex CLI can add the local marketplace in a sandboxed home"
  assert_contains "$ADD_OUT" "autopilot-local" "Codex marketplace add output includes local marketplace"

  LIST_STDERR="$TEST_TMP/codex-list-before-install.stderr"
  LIST_OUT="$(HOME="$CODEX_HOME_DIR" CODEX_HOME="$CODEX_HOME_DIR/.codex" codex plugin list --marketplace autopilot-local --available --json 2>"$LIST_STDERR")"
  EXIT=$?
  assert_eq "$EXIT" "0" "Codex CLI can list the local marketplace in a sandboxed home"
  assert_contains "$LIST_OUT" "\"pluginId\": \"autopilot@autopilot-local\"" "Codex CLI discovers autopilot plugin"
  assert_contains "$LIST_OUT" "\"installed\": false" "Codex CLI reports autopilot before install"

  ADD_PLUGIN_STDERR="$TEST_TMP/codex-plugin-add.stderr"
  ADD_PLUGIN_OUT="$(HOME="$CODEX_HOME_DIR" CODEX_HOME="$CODEX_HOME_DIR/.codex" codex plugin add autopilot@autopilot-local --json 2>"$ADD_PLUGIN_STDERR")"
  EXIT=$?
  assert_eq "$EXIT" "0" "Codex CLI can install the local autopilot plugin in a sandboxed home"
  assert_contains "$ADD_PLUGIN_OUT" "\"pluginId\": \"autopilot@autopilot-local\"" "Codex plugin add reports installed autopilot"

  INSTALLED_CACHE_OUT="$(ADD_PLUGIN_JSON="$ADD_PLUGIN_OUT" node - <<'NODE'
const fs = require('fs');
const payload = JSON.parse(process.env.ADD_PLUGIN_JSON);
const installedPath = payload.installedPath;
console.log(`installed_path=${installedPath || 'missing'}`);
console.log(`installed_dev_flow=${Boolean(installedPath) && fs.existsSync(`${installedPath}/skills/dev-flow/SKILL.md`)}`);
console.log(`installed_harness_maintenance=${Boolean(installedPath) && fs.existsSync(`${installedPath}/skills/harness-maintenance/SKILL.md`)}`);
console.log(`installed_reference=${Boolean(installedPath) && fs.existsSync(`${installedPath}/references/model-routing.md`)}`);
console.log(`installed_script=${Boolean(installedPath) && fs.existsSync(`${installedPath}/scripts/dispatch-review.sh`)}`);
console.log(`installed_template=${Boolean(installedPath) && fs.existsSync(`${installedPath}/project-config-template/review-loop-config.md`)}`);
console.log(`installed_doc=${Boolean(installedPath) && fs.existsSync(`${installedPath}/docs/plans/2026-06-26-trust-tiered-review-policy.md`)}`);
NODE
)"
  assert_contains "$INSTALLED_CACHE_OUT" "installed_dev_flow=true" "Installed Codex plugin cache contains dev-flow skill"
  assert_contains "$INSTALLED_CACHE_OUT" "installed_harness_maintenance=true" "Installed Codex plugin cache contains harness-maintenance skill"
  assert_contains "$INSTALLED_CACHE_OUT" "installed_reference=true" "Installed Codex plugin cache contains linked references"
  assert_contains "$INSTALLED_CACHE_OUT" "installed_script=true" "Installed Codex plugin cache contains linked scripts"
  assert_contains "$INSTALLED_CACHE_OUT" "installed_template=true" "Installed Codex plugin cache contains linked templates"
  assert_contains "$INSTALLED_CACHE_OUT" "installed_doc=true" "Installed Codex plugin cache contains linked docs"

  INSTALLED_STDERR="$TEST_TMP/codex-installed.stderr"
  INSTALLED_OUT="$(HOME="$CODEX_HOME_DIR" CODEX_HOME="$CODEX_HOME_DIR/.codex" codex plugin list --json 2>"$INSTALLED_STDERR")"
  EXIT=$?
  assert_eq "$EXIT" "0" "Codex CLI can list installed plugins in a sandboxed home"
  assert_contains "$INSTALLED_OUT" "\"pluginId\": \"autopilot@autopilot-local\"" "Codex CLI lists installed autopilot"
  assert_contains "$INSTALLED_OUT" "\"installed\": true" "Codex CLI reports autopilot installed"

  NON_REPO_CWD="$TEST_TMP/non-repo"
  mkdir -p "$NON_REPO_CWD"
  PROMPT_STDERR="$TEST_TMP/codex-prompt-input.stderr"
  PROMPT_OUT="$(cd "$NON_REPO_CWD" && HOME="$CODEX_HOME_DIR" CODEX_HOME="$CODEX_HOME_DIR/.codex" codex debug prompt-input "autopilot skill visibility smoke" 2>"$PROMPT_STDERR")"
  EXIT=$?
  assert_eq "$EXIT" "0" "Codex prompt-input debug works from a non-repo cwd"
  assert_contains "$PROMPT_OUT" "autopilot:dev-flow" "Installed Codex plugin exposes dev-flow to model-visible prompt input"
  assert_contains "$PROMPT_OUT" "autopilot:harness-maintenance" "Installed Codex plugin exposes harness-maintenance to model-visible prompt input"
fi

finalize_test
