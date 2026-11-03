#!/usr/bin/env node
'use strict';
/**
 * check-claude-spawn-sites.js - G37 spawn-site gate (plan 5.9, 8 P6, N8).
 *
 *   node scripts/check-claude-spawn-sites.js [--root DIR] [--registry FILE] [--json]
 *
 * Walks scripts/ src/ hooks/ bin/ evals/ tools/ skills/ (those that exist) under --root (default: this repo), finds every NON-comment line that can
 * start a `claude` process, and requires each hit FILE to be listed in scripts/lib/claude-spawn-sites.json
 * (default: <root>/scripts/lib/claude-spawn-sites.json) with a status:
 *   wired         the file reaches the account layer (claude-account.js / account-state.sh / account-rail.js /
 *                 eval-account.*); needs `covered_by` (test files that exist and name the file)
 *   out_of_scope  not an Anthropic-subscription model call; needs `reason`
 *   frozen_legacy a digest-frozen replay runner that is deliberately not wired; needs `reason` and `locked_by`
 *                 (an existing file that actually names it)
 * Findings (one stderr line each, exit 1):
 *   unregistered_claude_spawn   a spawn shape in a file with no registry entry
 *   wired_site_not_wired        a `wired` file with no account-layer call in it
 *   wired_site_not_covered      a `wired` file whose covered_by is missing, absent on disk, or does not name the file
 *   stale_entry                 an entry whose file no longer exists
 *   frozen_lock_missing         a frozen_legacy entry whose locked_by does not exist or does not name the file
 *   reviewed_non_spawn_spawns   a file recorded in reviewed_non_spawns that now has a spawn shape
 *   bad_entry                   a malformed entry (unknown status, missing reason, duplicate file, unknown key)
 * Exit 0 clean, 1 findings, 2 usage / unreadable registry. Node >= 20.10, built-ins only.
 *
 * Detection shapes (a file is a candidate when any code line matches; lines that begin with a comment marker
 * are skipped; a shape that only ever appears in a comment is not a spawn):
 *   S1  a command line: `claude [-p|--print|--bare|--version|plugin|exec|setup-token|auth|-c|--model] ...`
 *   S2  spawn / spawnSync / execFile(Sync) / execSync / exec with the literal 'claude' as the program
 *   S3  an array form `['claude', ...]` or `"claude",` used as argv0
 *   S4  a binary seam variable: QC_CLAUDE_BIN BENCH_CLAUDE_BIN CLAUDE_EVAL_BIN CC_BIN claudeBin CLAUDE_BIN REAL_CLAUDE
 *   S5  a PATH wrapper that execs `claude`: `exec claude` / `command -v claude`
 *   S6  `'claude', '-flag'` inside an argv list, or the resolved-binary names realClaude / whichClaude
 *   S8  a flag only the claude CLI has, quoted in code (an argv list built for it): --strict-mcp-config
 *       --dangerously-skip-permissions --setting-sources --no-session-persistence --disable-slash-commands
 *   S9  `const bin = 'claude'`, `x || 'claude'`, `${X:-claude}`, `BIN=claude`: the program name bound or defaulted for later use
 *   S10 npx / bunx / pnpm dlx / npm exec of @anthropic-ai/claude-code
 *   S7  a call into the account layer itself: a file that routes claude through it IS a spawn site, so it must be listed
 * The scan is over files, not ranges, so an edit that moves lines cannot make the registry stale.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const REGISTRY_REL = path.join('scripts', 'lib', 'claude-spawn-sites.json');
const SCAN_DIRS = ['scripts', 'src', 'hooks', 'bin', 'evals', 'tools', 'skills'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'results', 'results-archive']);
const CODE_EXT = /\.(js|cjs|mjs|ts|sh|bash|zsh|py)$/;
const STATUSES = new Set(['wired', 'out_of_scope', 'frozen_legacy']);
const ENTRY_KEYS = new Set(['file', 'status', 'group', 'reason', 'locked_by', 'lock_key', 'covered_by']);
const ACCOUNT_LAYER = /claude-account|account-state\.sh|account-rail|eval-account\.(js|sh)\b/;

const ACCOUNT_LAYER_G = /claude-account|account-state\.sh|account-rail|eval-account\.(js|sh)\b/;
const SHAPES = [
  ['S1', /(^|[\s`'"(;|&=])claude(-native)?\s+(-p\b|--print\b|--bare\b|--version\b|plugin\b|exec\b|setup-token\b|auth\b|-c\b|--model\b|--output-format\b|--dangerously)/],
  ['S2', /\b(spawn|spawnSync|execFile|execFileSync|execSync|exec)\(\s*[`'"]claude[`'"]/],
  ['S3', /(\[\s*[`'"]claude[`'"]\s*[,\]])|(^|[^\w.-])[`'"]claude[`'"]\s*,\s*\[/],
  ['S4', /\b(QC_CLAUDE_BIN|BENCH_CLAUDE_BIN|CLAUDE_EVAL_BIN|CC_BIN|claudeBin|CLAUDE_BIN|REAL_CLAUDE)\b/],
  ['S5', /(\bexec\s+claude\b)|(\bcommand\s+-v\s+claude\b)/],
  ['S6', /[`'"]claude[`'"]\s*,\s*[`'"]-|\b(realClaude|whichClaude)\b/],
  ['S7', ACCOUNT_LAYER_G],
  // S9: the program name bound to a variable / defaulted, then used as argv0 elsewhere
  ['S9', /((^|[\s;(,])(const|let|var)\s+\w+\s*=\s*[`'"]claude[`'"]\s*[;,)]?\s*$)|((\|\||\?\?)\s*[`'"]claude[`'"])|(\$\{\w+:?[-=]claude\})|(\b\w+=[`'"]?claude[`'"]?\s*$)/],
  // S10: a package runner that fetches and starts the claude CLI
  ['S10', /\b(npx|bunx|pnpm\s+dlx|pnpx|yarn\s+dlx|npm\s+exec)\b.*@anthropic-ai\/claude-code/],
  ['S8', /[`'"]--(strict-mcp-config|dangerously-skip-permissions|setting-sources|no-session-persistence|disable-slash-commands)[`'"]/],
];

/** Test files, fixtures and archived evidence are not spawn sites of this tree. */
function isExcludedPath(rel) {
  const p = rel.split(path.sep).join('/');
  if (/\.test\.[a-z]+$/.test(p)) return true;
  if (p.startsWith('hooks/tests/')) return true;
  if (/(^|\/)(fixtures?|packs|stubs|mutants)\//.test(p)) return true;
  return false;
}

function isCommentLine(line) {
  const t = line.trimStart();
  return t === '' || t.startsWith('#') || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--');
}

function walk(root, dir, out) {
  let ents;
  try { ents = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch (_) { return; }
  for (const e of ents) {
    if (SKIP_DIRS.has(e.name)) continue;
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(root, rel, out);
    else if (e.isFile() && CODE_EXT.test(e.name)) out.push(rel);
  }
}

/** -> Map(relFile -> [{line, shape}]) of candidate spawn files. */
function scan(root) {
  const files = [];
  for (const d of SCAN_DIRS) walk(root, d, files);
  const hits = new Map();
  for (const rel of files.sort()) {
    if (isExcludedPath(rel)) continue;
    let text;
    try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch (_) { continue; }
    const found = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (isCommentLine(lines[i])) continue;
      for (const [id, re] of SHAPES) {
        if (re.test(lines[i])) { found.push({ line: i + 1, shape: id }); break; }
      }
    }
    if (found.length) hits.set(rel.split(path.sep).join('/'), found);
  }
  return hits;
}


/** Test files that can run a wired caller with a hand-built environment (G37 I: the account layer resolves the home from passwd,
 *  so only AUTOPILOT_ACCOUNTS_DIR keeps such a run off the operator's real registry). */
function testFiles(root) {
  const out = [];
  const add = (dir, re) => { try { for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) if (e.isFile() && re.test(e.name)) out.push(path.join(dir, e.name)); } catch (_) { /* absent */ } };
  add(path.join('hooks', 'tests'), /\.(sh|js)$/);
  add('scripts', /\.test\.(js|sh)$/);
  const walkEvals = (dir) => {
    let ents; try { ents = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      if (SKIP_DIRS.has(e.name)) continue;
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walkEvals(rel); else if (/\.test\.(js|sh)$/.test(e.name)) out.push(rel);
    }
  };
  walkEvals('evals');
  return out;
}

/** Index of the `}` closing the `{` at text[open], or -1. */
function closeBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/** -> [{file, line, why}] test statements that run a wired caller in an environment that drops AUTOPILOT_ACCOUNTS_DIR. */
function scanTestEnv(root, callerNames) {
  const found = [];
  for (const rel of testFiles(root)) {
    if (path.basename(rel) === 'check-claude-spawn-sites.test.js') continue; // its fixtures are strings that look like the cases it checks
    let text;
    try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch (_) { continue; }
    if (!callerNames.some((c) => text.includes(c))) continue;
    if (/\.sh$/.test(rel)) {
      // variables that hold the path of a wired caller
      const vars = new Set();
      for (const m of text.matchAll(/^\s*(?:export\s+)?([A-Za-z_]\w*)=["']?[^\n]*?([\w.-]+\.(?:sh|js))["']?\s*$/gm)) if (callerNames.includes(m[2])) vars.add(m[1]);
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (isCommentLine(lines[i])) continue;
        let stmt = lines[i];
        let j = i;
        while (/\\\s*$/.test(stmt) && j + 1 < lines.length) stmt += '\n' + lines[++j];
        if (!/\benv\s+-i\b/.test(stmt)) continue;
        const runsCaller = callerNames.some((c) => stmt.includes(c)) || [...vars].some((v) => new RegExp(`\\$\\{?${v}\\b`).test(stmt));
        if (runsCaller && !/AUTOPILOT_ACCOUNTS_DIR/.test(stmt)) found.push({ file: rel, line: i + 1, why: '`env -i` runs a wired caller without AUTOPILOT_ACCOUNTS_DIR' });
      }
    } else {
      // a hand-built env object (it names PATH or HOME and does not spread the parent env) in a file that drives a wired caller
      for (const m of text.matchAll(/\benv\s*:\s*\{/g)) {
        const open = m.index + m[0].length - 1;
        const end = closeBrace(text, open);
        if (end < 0) continue;
        const body = text.slice(open, end + 1);
        if (!/\b(PATH|HOME)\s*:/.test(body)) continue;
        if (/\.\.\.\s*process\.env|Object\.assign\(\s*\{\s*\}\s*,\s*process\.env/.test(body)) continue;
        if (/AUTOPILOT_ACCOUNTS_DIR/.test(body)) continue;
        found.push({ file: rel, line: text.slice(0, m.index).split('\n').length, why: 'a hand-built env object in a file that drives a wired caller has no AUTOPILOT_ACCOUNTS_DIR' });
      }
    }
  }
  return found;
}

function loadRegistry(file) {
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { error: `cannot read registry ${file}: ${e.message}` }; }
  if (!j || j.schema_version !== 1 || !Array.isArray(j.sites)) return { error: `registry ${file}: need {schema_version:1, sites:[...]}` };
  return { sites: j.sites, reviewed: j.reviewed_non_spawns || [] };
}

function fileNamesTarget(root, holderRel, needle) {
  // does the file `holderRel` (a covering test, or a lock file) contain `needle` (default use: the target's basename)?
  try {
    return fs.readFileSync(path.join(root, holderRel), 'utf8').includes(needle);
  } catch (_) { return false; }
}

function check(root, registryFile) {
  const findings = [];
  const add = (code, file, msg) => findings.push({ code, file, msg });
  const reg = loadRegistry(registryFile);
  if (reg.error) return { error: reg.error, findings };
  // The Codex plugin payload (marked by .codex-plugin/) ships this script and the registry with a subset of evals/: most
  // entries would read as stale and the payload is not where spawn sites are added. Say so and pass; the development tree
  // has no .codex-plugin/ at its root.
  if (fs.existsSync(path.join(root, '.codex-plugin'))) {
    return { findings, hits: new Map(), sites: reg.sites, skipped: true };
  }
  const byFile = new Map();
  for (const s of reg.sites) {
    if (!s || typeof s !== 'object' || typeof s.file !== 'string') { add('bad_entry', String(s && s.file), 'entry without a file'); continue; }
    for (const k of Object.keys(s)) if (!ENTRY_KEYS.has(k)) add('bad_entry', s.file, `unknown key ${k}`);
    if (byFile.has(s.file)) { add('bad_entry', s.file, 'duplicate entry'); continue; }
    byFile.set(s.file, s);
    if (!STATUSES.has(s.status)) { add('bad_entry', s.file, `unknown status ${JSON.stringify(s.status)}`); continue; }
    if ((s.status === 'out_of_scope' || s.status === 'frozen_legacy') && !(typeof s.reason === 'string' && s.reason.trim().length >= 20)) {
      add('bad_entry', s.file, `${s.status} needs a reason of at least 20 characters`);
    }
    if (!fs.existsSync(path.join(root, s.file))) { add('stale_entry', s.file, 'file does not exist'); continue; }
    if (s.status === 'frozen_legacy') {
      const lb = s.locked_by;
      const key = typeof s.lock_key === 'string' && s.lock_key ? s.lock_key : path.basename(s.file);
      const lockOk = typeof lb === 'string' && fs.existsSync(path.join(root, lb)) && fileNamesTarget(root, lb, key);
      if (!lockOk) add('frozen_lock_missing', s.file, `locked_by ${JSON.stringify(lb)} is missing or does not name this file`);
    }
    if (s.status === 'wired') {
      let text = '';
      try { text = fs.readFileSync(path.join(root, s.file), 'utf8'); } catch (_) { /* reported as stale above */ }
      const code = text.split('\n').filter((l) => !isCommentLine(l)).join('\n');
      if (!ACCOUNT_LAYER.test(code)) add('wired_site_not_wired', s.file, 'no call to claude-account.js / account-state.sh / account-rail.js / eval-account.* in the file');
      const cov = Array.isArray(s.covered_by) ? s.covered_by : [];
      const covOk = cov.length > 0 && cov.every((c) => typeof c === 'string' && fs.existsSync(path.join(root, c)));
      const named = covOk && cov.some((c) => fileNamesTarget(root, c, path.basename(s.file)));
      if (!named) add('wired_site_not_covered', s.file, 'covered_by is empty, names a missing file, or no covering test names this file');
    }
  }
  const hits = scan(root);
  // Files that were looked at and are NOT spawn sites (they only mention claude in text, or reach it through a registered rail).
  // Recorded so the inventory decision is auditable; if such a file ever grows a spawn shape it is reported, not trusted.
  const reviewed = Array.isArray(reg.reviewed) ? reg.reviewed : [];
  for (const r of reviewed) {
    if (!r || typeof r.file !== 'string' || typeof r.reason !== 'string' || r.reason.trim().length < 20) { add('bad_entry', String(r && r.file), 'reviewed_non_spawn needs file and a reason of at least 20 characters'); continue; }
    if (byFile.has(r.file)) add('bad_entry', r.file, 'listed both as a site and as a reviewed non-spawn');
    if (!fs.existsSync(path.join(root, r.file))) { add('stale_entry', r.file, 'reviewed non-spawn does not exist'); continue; }
    if (hits.has(r.file)) add('reviewed_non_spawn_spawns', r.file, `line ${hits.get(r.file)[0].line} now has a spawn shape; register it as a site`);
  }
  for (const [file, found] of hits) {
    if (reviewed.some((r) => r && r.file === file)) continue;
    if (!byFile.has(file)) {
      const f = found[0];
      add('unregistered_claude_spawn', file, `line ${f.line} (${f.shape}) can start claude and the file is not in claude-spawn-sites.json`);
    }
  }
  // I: a test that hand-builds its environment must still pin the account registry dir
  const callerNames = [...new Set(reg.sites.filter((x) => x && x.status === 'wired' && typeof x.file === 'string').map((x) => path.basename(x.file)))];
  for (const f of scanTestEnv(root, callerNames)) add('test_env_loses_accounts_dir', f.file, `line ${f.line}: ${f.why}`);
  // e45b846c: cc-v2.js is the d0gate v2 library; the campaign runner that refuses an active registry is its only requirer
  const ccv2 = [];
  for (const d of SCAN_DIRS) {
    const fl = []; walk(root, d, fl);
    for (const rel of fl) {
      if (rel.split(path.sep).join('/') === 'evals/skill-onoff/d0gate-v2/cc-v2.js' || isExcludedPath(rel)) continue;
      let t; try { t = fs.readFileSync(path.join(root, rel), 'utf8'); } catch (_) { continue; }
      if (t.split('\n').some((l) => !isCommentLine(l) && /require\(\s*['"`][^'"`]*\bcc-v2(\.js)?['"`]\s*\)/.test(l))) ccv2.push(rel.split(path.sep).join('/'));
    }
  }
  if (fs.existsSync(path.join(root, 'evals', 'skill-onoff', 'd0gate-v2', 'cc-v2.js'))) {
    for (const r of ccv2) if (r !== 'evals/skill-onoff/run-d0gate-v2-campaign.js') add('cc_v2_extra_requirer', r, 'requires cc-v2.js; the only allowed requirer is evals/skill-onoff/run-d0gate-v2-campaign.js (it refuses an active registry)');
  }
  return { findings, hits, sites: reg.sites };
}

function main(argv) {
  let root = DEFAULT_ROOT;
  let registry = null;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') root = path.resolve(argv[++i] || '');
    else if (a === '--registry') registry = path.resolve(argv[++i] || '');
    else if (a === '--json') json = true;
    else if (a === '--help' || a === '-h') {
      process.stdout.write('usage: check-claude-spawn-sites.js [--root DIR] [--registry FILE] [--json]\n');
      return 0;
    } else { process.stderr.write(`check-claude-spawn-sites: unknown argument ${a}\n`); return 2; }
  }
  const res = check(root, registry || path.join(root, REGISTRY_REL));
  if (res.error) { process.stderr.write(`check-claude-spawn-sites: ${res.error}\n`); return 2; }
  const counts = {};
  for (const s of res.sites) counts[s.status] = (counts[s.status] || 0) + 1;
  if (res.skipped) {
    process.stdout.write('claude spawn sites: skipped (the root is a shipped Codex plugin payload, not the development tree)\n');
    return 0;
  }
  if (json) {
    process.stdout.write(`${JSON.stringify({ ok: res.findings.length === 0, sites: res.sites.length, by_status: counts, findings: res.findings })}\n`);
  } else {
    for (const f of res.findings) process.stderr.write(`${f.code}: ${f.file}: ${f.msg}\n`);
    process.stdout.write(`claude spawn sites: ${res.sites.length} registered (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}), ${res.findings.length} finding(s)\n`);
  }
  return res.findings.length === 0 ? 0 : 1;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { check, scan, main, SHAPES, isCommentLine };
