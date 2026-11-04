#!/usr/bin/env node
'use strict';
// compile-kit.js -- PROTOTYPE kit compiler. Validates a role kit and prints how it maps onto one runner.
// It never starts a binary and never writes anything (a dry-run mapping, no model call).
//   compile-kit.js --kit <dir> --runner claude|codex|agy [--config-dir <dir>] [--json]
//
// Kit layout (shared with the railkit lane):   <kit>/role.md  [<kit>/plugin/]  <kit>/tools
//   role.md   the role card, <= 2048 bytes, a regular file
//   tools     one line, comma-separated tool names; an empty line means "no tools"
//   plugin/   optional; .claude-plugin/plugin.json plus exactly one skills/<name>/SKILL.md, nothing else
// No symlinks anywhere in the kit.
//
// Runner mapping (what is verified is in project/plans/2026-11-05-rolekit-direction.md section 3.2):
//   claude  argv: -p --setting-sources project --strict-mcp-config --system-prompt <role.md> [--plugin-dir <plugin>] --tools <list>
//           env:  CLAUDE_CONFIG_DIR=<throwaway dir seeded with the credentials file only, by the rail, not here>
//           --tools narrows the tool surface (verified); --allowedTools is a permission rule, not used.
//   codex   env:  CODEX_HOME=<dir>; layout AGENTS.md <- role.md, skills/<name>/SKILL.md <- plugin skill.
//           NO tool allowlist exists on codex (only -s sandbox and -c); the tools file is NOT enforced -> warning.
//           Swapping CODEX_HOME swaps auth too: the rail must seed it. codex exec with a real model is UNVERIFIED.
//   agy     env:  HOME=<dir>; layout GEMINI.md <- role.md. NO allowlist; `agy -p` does not read skills (verified
//           negative), so the plugin skill is dropped and its method must be in the role card -> warning. UNVERIFIED end to end.
// Exit: 0 ok . 2 invalid kit or usage.
const fs = require('fs');
const path = require('path');

const MAX_ROLE_BYTES = 2048;
const MAX_PLUGIN_BYTES = 32 * 1024;
const TOOL_NAMES = new Set(['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'Agent', 'NotebookEdit']);

function walk(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const r = path.posix.join(rel, e.name);
    out.push({ rel: r, abs: path.join(dir, e.name), isDir: e.isDirectory(), isLink: e.isSymbolicLink() });
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), r));
  }
  return out;
}

function parseTools(text) {
  const line = text.replace(/\r?\n$/, '');
  if (line.includes('\n')) return { error: 'tools must be one line' };
  if (line.trim() === '') return { tools: [] };
  const names = line.split(',').map((s) => s.trim());
  const bad = names.filter((n) => !TOOL_NAMES.has(n));
  if (bad.length) return { error: `unknown tool name(s): ${bad.join(', ')}` };
  if (new Set(names).size !== names.length) return { error: 'duplicate tool name' };
  return { tools: names };
}

// Frontmatter of a skill: "---", single-line `key: value` pairs, "---". A value must be a double-quoted JSON string, a
// single-quoted string, or a plain scalar with no ": " or " #" inside and no leading indicator character (strict YAML;
// the 2026-11 planner/verifier skills failed here). name and description are required.
function frontmatterError(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return 'no frontmatter block';
  const seen = {};
  let inBlock = false;
  for (const [i, line] of m[1].split('\n').entries()) {
    if (inBlock && /^\s+\S/.test(line)) continue; // continuation of a | or > block scalar
    inBlock = false;
    const kv = /^([A-Za-z][A-Za-z0-9_-]*):(?: (.*))?$/.exec(line);
    if (!kv) return `frontmatter line ${i + 1} is not "key: value": ${line.slice(0, 50)}`;
    const v = kv[2] === undefined ? '' : kv[2];
    seen[kv[1]] = v;
    if (/^[|>][+-]?$/.test(v)) { inBlock = true; continue; }
    if (v.startsWith('"')) { try { JSON.parse(v); } catch (e) { return `frontmatter ${kv[1]}: bad double-quoted string`; } }
    else if (v.startsWith("'")) { if (!/^'(?:[^']|'')*'$/.test(v)) return `frontmatter ${kv[1]}: bad single-quoted string`; }
    else if (v !== '' && (/: |\s#/.test(v) || /^[&*!|>%@`{[\],?-]/.test(v) || /:$/.test(v))) return `frontmatter ${kv[1]}: plain scalar needs quotes (": " or an indicator character): ${v.slice(0, 50)}`;
  }
  for (const k of ['name', 'description']) if (!seen[k]) return `frontmatter lacks ${k}`;
  return null;
}

function validateKit(kitDir) {
  const errors = [];
  const kit = path.resolve(kitDir);
  if (!fs.existsSync(kit) || !fs.statSync(kit).isDirectory()) return { errors: [`kit dir not found: ${kitDir}`] };
  const all = walk(kit);
  for (const f of all) if (f.isLink) errors.push(`symlink in kit: ${f.rel}`);
  const rolePath = path.join(kit, 'role.md');
  const toolsPath = path.join(kit, 'tools');
  let roleText = null; let tools = null; let plugin = null;
  if (!fs.existsSync(rolePath) || fs.lstatSync(rolePath).isSymbolicLink() || !fs.statSync(rolePath).isFile()) errors.push('role.md missing or not a regular file');
  else {
    roleText = fs.readFileSync(rolePath, 'utf8');
    if (Buffer.byteLength(roleText) > MAX_ROLE_BYTES) errors.push(`role.md is ${Buffer.byteLength(roleText)} bytes (max ${MAX_ROLE_BYTES})`);
    if (roleText.trim() === '') errors.push('role.md is empty');
  }
  if (!fs.existsSync(toolsPath) || !fs.statSync(toolsPath).isFile()) errors.push('tools missing');
  else { const t = parseTools(fs.readFileSync(toolsPath, 'utf8')); if (t.error) errors.push(`tools: ${t.error}`); else tools = t.tools; }
  const top = fs.readdirSync(kit).filter((n) => !['role.md', 'tools', 'plugin', 'sources.json'].includes(n));
  if (top.length) errors.push(`unexpected entries at kit top level: ${top.join(', ')}`);
  const pluginDir = path.join(kit, 'plugin');
  if (fs.existsSync(pluginDir)) {
    const files = all.filter((f) => f.rel.startsWith('plugin/') && !f.isDir);
    const manifest = path.join(pluginDir, '.claude-plugin', 'plugin.json');
    const skills = files.filter((f) => /^plugin\/skills\/[^/]+\/SKILL\.md$/.test(f.rel));
    if (!fs.existsSync(manifest)) errors.push('plugin/.claude-plugin/plugin.json missing');
    else { try { const m = JSON.parse(fs.readFileSync(manifest, 'utf8')); if (!m || typeof m.name !== 'string' || m.name === '') errors.push('plugin.json has no name'); } catch (e) { errors.push(`plugin.json is not JSON: ${e.message}`); } }
    if (skills.length !== 1) errors.push(`plugin must hold exactly one skill, found ${skills.length}`);
    const stray = files.filter((f) => f.rel !== 'plugin/.claude-plugin/plugin.json' && !skills.includes(f));
    if (stray.length) errors.push(`stray files in plugin/: ${stray.map((f) => f.rel).join(', ')}`);
    const bytes = files.reduce((n, f) => n + fs.statSync(f.abs).size, 0);
    if (bytes > MAX_PLUGIN_BYTES) errors.push(`plugin is ${bytes} bytes (max ${MAX_PLUGIN_BYTES})`);
    if (skills.length === 1) { const fe = frontmatterError(fs.readFileSync(skills[0].abs, 'utf8')); if (fe) errors.push(`${skills[0].rel}: ${fe}`); }
    if (skills.length === 1) plugin = { dir: pluginDir, skillRel: skills[0].rel.replace(/^plugin\//, ''), skillName: skills[0].rel.split('/')[2], skillAbs: skills[0].abs };
  }
  return { errors, kit, roleText, tools, plugin };
}

function compile(kitDir, runner, opts = {}) {
  const v = validateKit(kitDir);
  if (v.errors.length) return { ok: false, errors: v.errors };
  const warnings = [];
  const out = { ok: true, runner, kit: v.kit, argv: [], env: {}, files: [], warnings, verified: {} };
  if (runner === 'claude') {
    out.argv = ['-p', '--setting-sources', 'project', '--strict-mcp-config', '--system-prompt', v.roleText];
    if (v.plugin) out.argv.push('--plugin-dir', v.plugin.dir);
    out.argv.push('--tools', v.tools.join(','));
    out.env.CLAUDE_CONFIG_DIR = opts.configDir || '<throwaway dir seeded with the credentials file only>';
    out.verified = { tools_flag: 'verified (S5)', system_prompt: 'verified (S5)', model_follows_card: 'UNVERIFIED' };
  } else if (runner === 'codex') {
    out.argv = ['exec'];
    out.env.CODEX_HOME = opts.configDir || '<throwaway CODEX_HOME; the rail must seed auth>';
    out.files.push({ from: path.join(v.kit, 'role.md'), to: 'AGENTS.md' });
    if (v.plugin) out.files.push({ from: v.plugin.skillAbs, to: `skills/${v.plugin.skillName}/SKILL.md` });
    warnings.push(`codex has no tool allowlist: the tools file (${v.tools.join(',') || 'none'}) is NOT enforced; use -s sandbox and a worktree`);
    warnings.push('swapping CODEX_HOME swaps auth with it; the rail must seed the credentials');
    out.verified = { prompt_input_loads_agents_and_skills: 'verified (codex debug prompt-input)', exec_with_real_model: 'UNVERIFIED (blocked on G37)' };
  } else if (runner === 'agy') {
    out.argv = ['-p'];
    out.env.HOME = opts.configDir || '<throwaway HOME>';
    out.files.push({ from: path.join(v.kit, 'role.md'), to: 'GEMINI.md' });
    warnings.push('agy has no tool allowlist: the tools file is NOT enforced; isolation is the worktree');
    if (v.plugin) warnings.push('agy -p does not read skills: the plugin skill is dropped; its method must be in role.md');
    out.verified = { gemini_md_via_home: 'UNVERIFIED on agy 1.5.0', skills: 'verified negative' };
  } else {
    return { ok: false, errors: [`unknown runner: ${runner}`] };
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const kit = opt('--kit'); const runner = opt('--runner');
  if (!kit || !runner) { console.error('usage: compile-kit.js --kit <dir> --runner claude|codex|agy [--config-dir <dir>] [--json]'); process.exit(2); }
  const r = compile(kit, runner, { configDir: opt('--config-dir') });
  if (!r.ok) { console.error(`compile-kit: invalid\n${r.errors.map((e) => `  - ${e}`).join('\n')}`); process.exit(2); }
  if (argv.includes('--json')) { process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); return; }
  const show = (a) => a.map((x, i) => (a[i - 1] === '--system-prompt' ? `<role.md ${Buffer.byteLength(x)} bytes>` : /[\s"']/.test(x) || x === '' ? JSON.stringify(x) : x)).join(' ');
  process.stdout.write(`runner: ${r.runner}\nargv:   ${show(r.argv)}\n`);
  for (const [k, val] of Object.entries(r.env)) process.stdout.write(`env:    ${k}=${val}\n`);
  for (const f of r.files) process.stdout.write(`file:   ${f.from} -> <home>/${f.to}\n`);
  for (const w of r.warnings) process.stdout.write(`WARN:   ${w}\n`);
  for (const [k, val] of Object.entries(r.verified)) process.stdout.write(`status: ${k}: ${val}\n`);
}
if (require.main === module) main();
module.exports = { frontmatterError, validateKit, compile, parseTools, MAX_ROLE_BYTES };
