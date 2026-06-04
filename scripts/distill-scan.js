#!/usr/bin/env node
/*
 * distill-scan.js — deterministic conversation-history scanner (P1 value-gate, plan 2026-06-03-distill-skill §4.2)
 *
 * Reads ~/.claude/projects/<encoded-cwd>/*.jsonl, emits FREQUENCY ATOMS only. NO LLM.
 * Atoms: normalized bash-command shapes, command-sequence n-grams (ritual candidates),
 * slash-command frequency, tool frequency, bilingual user-friction-phrase hits.
 * Project attribution comes from the in-line `cwd` field (never the dir-name encoding — see
 * memory project_hook-transcript-pivot). Borrows JSONL-parsing conventions (line cap, per-line
 * try/catch) without reusing the single-event hook reader.
 *
 * INCREMENTAL CURSOR (--incremental / --new-only):
 *   Each jsonl is scanned WHOLE exactly once; its per-file atom contribution is cached in a state
 *   file keyed by {size, mtime}. Unchanged (completed) sessions are reused from cache — only NEW or
 *   GROWN sessions are re-read. Cumulative totals = merge of all per-file atoms, so the ≥N× value
 *   gate is IDENTICAL to a full scan. (We deliberately re-scan a changed file whole rather than
 *   reading only appended bytes: a raw byte-offset would split a session's command sequence across
 *   runs — losing boundary n-grams — and risk reading a half-written trailing JSONL line.)
 *   --new-only reports only candidates whose CUMULATIVE count rose THIS run ("what's new to distill").
 *
 * Usage: node distill-scan.js [--json] [--top N] [--real-only] [--incremental|--new-only] [--state PATH]
 *   default: human-readable report to stdout.  --json: emit the atom JSON.
 * Exit: 0 always (read-only, apart from the opt-in state file).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = process.env.DISTILL_SCAN_ROOT || path.join(os.homedir(), '.claude', 'projects');
// --real-only keeps only encoded-cwd dirs under the user's real home (skip /tmp eval dirs).
// Derived from os.homedir() so it works for any user (not a hardcoded username).
const HOME_TOKEN = os.homedir().replace(/[^a-zA-Z0-9]/g, '-');
const MAX_LINE_BYTES = 2 * 1024 * 1024;
const STATE_SCHEMA = 2;
const DEFAULT_STATE = path.join(os.homedir(), '.autopilot', 'distill', 'scan-state.json');
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write([
    'distill-scan.js — deterministic conversation-history scanner (skills/distill, P1).',
    'Reads ~/.claude/projects/*/*.jsonl → frequency atoms in two buckets (ritual + correction candidates). No LLM.',
    '',
    'Usage: node distill-scan.js [--json] [--real-only] [--top N] [--incremental|--new-only] [--state PATH]',
    '  --json         emit the atom JSON instead of the human report',
    '  --real-only    scan only /home/<user> projects (skip ephemeral /tmp eval dirs)',
    '  --top N        number of rows per section (default 25)',
    '  --incremental  reuse cached per-session atoms; only (re)scan new/changed jsonl. Persists state.',
    '  --new-only     like --incremental, but report ONLY candidates whose cumulative count rose this run',
    `  --state PATH   cursor state file (default ${DEFAULT_STATE})`,
    'Exit 0 always (read-only apart from the opt-in --state file).', '',
  ].join('\n') + '\n');
  process.exit(0);
}
const AS_JSON = args.includes('--json');
const REAL_ONLY = args.includes('--real-only');
const NEW_ONLY = args.includes('--new-only');
const INCREMENTAL = NEW_ONLY || args.includes('--incremental');
const STATE_PATH = (() => { const i = args.indexOf('--state'); return i >= 0 && args[i + 1] ? args[i + 1] : DEFAULT_STATE; })();
const TOP = (() => { const i = args.indexOf('--top'); return i >= 0 ? parseInt(args[i + 1], 10) || 25 : 25; })();

// --- normalize a bash command to a stable "shape" (command + subcommand, args/paths/hashes dropped) ---
const MULTIWORD = new Set(['git', 'npm', 'pnpm', 'yarn', 'cargo', 'go', 'docker', 'kubectl', 'gh',
  'node', 'python', 'python3', 'pip', 'pip3', 'bun', 'deno', 'make', 'brew', 'apt', 'systemctl']);
function normCmd(cmd) {
  if (!cmd || typeof cmd !== 'string') return null;
  let seg = cmd.split(/\||;|&&|\|\||\n|>/)[0].trim();       // first segment before pipe/redirect/chain
  if (!seg) return null;
  const toks = seg.split(/\s+/).filter(Boolean);
  if (!toks.length) return null;
  let head = toks[0];
  if (head.startsWith('(') || head === 'sudo' || /^[A-Z_]+=/.test(head)) {  // strip wrappers/env-prefix
    head = toks[1] || head;
  }
  // collapse a path-y command to its basename
  if (head.includes('/')) head = path.basename(head);
  let shape = head;
  if (MULTIWORD.has(head)) {
    const sub = (toks[1] || '').replace(/[^a-zA-Z0-9_-].*$/, '');
    if (sub && /^[a-zA-Z]/.test(sub)) shape = head + ' ' + sub;
  }
  return shape.length > 40 ? shape.slice(0, 40) : shape;
}

// --- bilingual friction-phrase proxy (lexical, documented as a proxy not a detector) ---
const FRICTION = [
  /\bagain\b/i, /\bi told you\b/i, /\bas i said\b/i, /\bstop\b.*\bdoing\b/i, /\bwhy did you\b/i,
  /\bnot what i\b/i, /\bdon'?t .*again\b/i, /\byou (still|keep)\b/i,
  '不要', '不是說過', '重來', '我說過', '每次', '不對', '錯了', '還是', '又'
];
function frictionHits(text) {
  let n = 0;
  for (const p of FRICTION) {
    if (typeof p === 'string') { if (text.includes(p)) n++; } else if (p.test(text)) n++;
  }
  return n;
}
function userText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(c => (c && c.text) || '').join(' ');
  return '';
}
// reject harness-injected / system text masquerading as a user record — keep only genuinely typed prompts
const INJECTED = [
  /^\s*</,                              // <task-notification>, <command-name>, <local-command-…>
  /^\s*Base directory for this skill:/, /^\s*Caveat:/, /^\s*"""/, /^\s*⎿/,
  /PostToolUse:|hook error|Plugin directory does not exist/,
  /tool-use-id|output-file|<task-id>/,
  /^\s*\[Request interrupted/, /system-reminder/,
];
function isGenuineUserText(t) {
  if (!t || t.length < 4) return false;
  for (const p of INJECTED) if (p.test(t)) return false;
  return true;
}

// pure navigation/inspection — NOT procedural; excluded from ritual n-grams so signal isn't drowned
const NOISE = new Set(['cd', 'ls', 'cat', 'grep', 'echo', 'find', 'tail', 'head', 'wc', 'pwd', 'which',
  'sort', 'uniq', 'sed', 'awk', '.', '#', 'for', 'if', 'while', 'true', 'sleep', 'printf', 'tr', 'cut',
  'xargs', 'less', 'more', 'type', 'stat', 'file', 'du', 'df', 'env', 'set', 'read', 'test', 'jq']);
const isNoise = (shape) => NOISE.has((shape || '').split(' ')[0]);

const inc = (m, k, by = 1) => { if (k) m.set(k, (m.get(k) || 0) + by); };

// --- scan ONE jsonl into its own per-file atom contribution (no shared mutable state) ---
// Returning a self-contained contribution is what makes the incremental cache correct: a file's
// atoms depend only on that file, so an unchanged file's contribution can be reused verbatim.
function scanFile(fp) {
  let raw;
  try { raw = fs.readFileSync(fp, 'utf8'); } catch { return null; }
  const cmd = new Map(), bi = new Map(), tri = new Map(), slash = new Map(), tool = new Map();
  const samples = []; const seen = new Set();
  let cwd = null, friction = 0, parseErr = 0, lines = 0;
  const seq = [];
  for (const line0 of raw.split(/\r?\n/)) {
    if (!line0) continue;
    if (Buffer.byteLength(line0) > MAX_LINE_BYTES) continue;
    lines++;
    let rec; try { rec = JSON.parse(line0); } catch { parseErr++; continue; }
    if (!rec || typeof rec !== 'object') continue;
    if (rec.cwd && !cwd) cwd = rec.cwd;
    const t = rec.type;
    if (t === 'user') {
      const txt = userText(rec.message && rec.message.content);
      if (isGenuineUserText(txt)) {
        const f = frictionHits(txt); friction += f;
        if (f > 0) {
          const clean = txt.replace(/\s+/g, ' ').trim().slice(0, 160);
          if (!seen.has(clean)) { seen.add(clean); samples.push(clean); }
        }
        const m = txt.trim().match(/^\/([a-z][a-z0-9-]{1,30})/i);
        if (m) inc(slash, '/' + m[1].toLowerCase());
      }
    } else if (t === 'assistant' && rec.message && Array.isArray(rec.message.content)) {
      for (const c of rec.message.content) {
        if (!c || c.type !== 'tool_use') continue;
        inc(tool, c.name);
        if (c.name === 'Bash' && c.input) {
          const shape = normCmd(c.input.command);
          if (shape) { inc(cmd, shape); seq.push(shape); }
        }
      }
    }
  }
  // command-sequence n-grams: drop navigation/inspection noise, then collapse immediate repeats
  const s = seq.filter((v) => !isNoise(v)).filter((v, i, a) => v !== a[i - 1]);
  for (let i = 0; i + 1 < s.length; i++) inc(bi, s[i] + ' → ' + s[i + 1]);
  for (let i = 0; i + 2 < s.length; i++) inc(tri, s[i] + ' → ' + s[i + 1] + ' → ' + s[i + 2]);
  return {
    cmd: [...cmd], bi: [...bi], tri: [...tri], slash: [...slash], tool: [...tool],
    samples, cwd: cwd || '(unknown)', friction, cmds: seq.length, lines, parseErr,
  };
}

// --- merge a set of per-file contributions into cumulative atom maps ---
function mergeContribs(contribs) {
  const cmdFreq = new Map(), toolFreq = new Map(), slashFreq = new Map();
  const bigram = new Map(), trigram = new Map();
  const proj = new Map();
  const frictionSamples = [], frictionSeen = new Set();
  let files = 0, lines = 0, parseErr = 0, frictionTotal = 0, sessions = 0;
  for (const c of contribs) {
    if (!c) continue;
    files++; sessions++; lines += c.lines || 0; parseErr += c.parseErr || 0; frictionTotal += c.friction || 0;
    for (const [k, v] of c.cmd) inc(cmdFreq, k, v);
    for (const [k, v] of c.tool) inc(toolFreq, k, v);
    for (const [k, v] of c.slash) inc(slashFreq, k, v);
    for (const [k, v] of c.bi) inc(bigram, k, v);
    for (const [k, v] of c.tri) inc(trigram, k, v);
    for (const sm of c.samples) { if (!frictionSeen.has(sm)) { frictionSeen.add(sm); frictionSamples.push(sm); } }
    const p = proj.get(c.cwd) || { sessions: 0, cmds: 0, friction: 0 };
    p.sessions += 1; p.cmds += c.cmds || 0; p.friction += c.friction || 0; proj.set(c.cwd, p);
  }
  return { cmdFreq, toolFreq, slashFreq, bigram, trigram, proj, frictionSamples,
    scanned: { files, lines, parseErrors: parseErr, sessions }, frictionTotal };
}

// --- collect jsonl paths (apply --real-only filter at the directory level, as before) ---
function collectFiles(dir, out) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) collectFiles(fp, out);
    else if (e.name.endsWith('.jsonl')) {
      if (REAL_ONLY && !path.basename(dir).startsWith(HOME_TOKEN)) continue;
      out.push(fp);
    }
  }
}

// --- incremental state I/O ---
function loadState() {
  try {
    const st = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    if (!st || st.schemaVersion !== STATE_SCHEMA || !st.files) return { schemaVersion: STATE_SCHEMA, files: {} };
    return st;
  } catch { return { schemaVersion: STATE_SCHEMA, files: {} }; }
}
function saveState(st) {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(st) + '\n');
  } catch (e) { process.stderr.write(`distill-scan: could not persist state (${e.message})\n`); }
}

// ============================ main ============================
const paths = [];
collectFiles(ROOT, paths);

const prevState = INCREMENTAL ? loadState() : { schemaVersion: STATE_SCHEMA, files: {} };
const newState = { schemaVersion: STATE_SCHEMA, lastRun: new Date().toISOString(), files: {} };
const contribs = [];          // current cumulative inputs
const prevContribs = [];      // last-run cumulative inputs (for --new-only delta)
let rescanned = 0, reused = 0;

for (const fp of paths) {
  let stat; try { stat = fs.statSync(fp); } catch { continue; }
  const sig = { size: stat.size, mtime: stat.mtimeMs };
  const cached = INCREMENTAL ? prevState.files[fp] : null;
  let contrib;
  if (cached && cached.size === sig.size && cached.mtime === sig.mtime && cached.atoms) {
    contrib = cached.atoms; reused++;
  } else {
    contrib = scanFile(fp); rescanned++;
  }
  if (!contrib) continue;
  contribs.push(contrib);
  newState.files[fp] = { size: sig.size, mtime: sig.mtime, atoms: contrib };
  if (NEW_ONLY && cached && cached.atoms) prevContribs.push(cached.atoms);
}

if (INCREMENTAL) saveState(newState);

const merged = mergeContribs(contribs);

// derive the report rows from cumulative maps (identical thresholds to a full scan)
const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const minCount = (arr, min) => arr.filter(([, c]) => c >= min);

let atoms = {
  scanned: merged.scanned,
  friction_total: merged.frictionTotal,
  top_commands: top([...merged.cmdFreq].reduce((m, [k, v]) => (isNoise(k) ? m : m.set(k, v)), new Map()), TOP),
  friction_samples: merged.frictionSamples,
  top_bigrams: minCount(top(merged.bigram, TOP * 2), 3).slice(0, TOP),
  top_trigrams: minCount(top(merged.trigram, TOP * 2), 3).slice(0, TOP),
  top_slash: top(merged.slashFreq, 15),
  top_tools: top(merged.toolFreq, 12),
  projects: top(new Map([...merged.proj].map(([k, v]) => [k, v.sessions])), 15),
};

// --- --new-only: keep only candidates whose cumulative count ROSE since last run ---
let newSummary = null;
if (NEW_ONLY) {
  const prev = mergeContribs(prevContribs);
  const rose = (curMap, prevMap) => (rows) => rows.filter(([k, c]) => c > (prevMap.get(k) || 0));
  const prevSamples = new Set(prev.frictionSamples);
  atoms = {
    ...atoms,
    top_commands: rose(merged.cmdFreq, prev.cmdFreq)(atoms.top_commands),
    top_bigrams: rose(merged.bigram, prev.bigram)(atoms.top_bigrams),
    top_trigrams: rose(merged.trigram, prev.trigram)(atoms.top_trigrams),
    top_slash: rose(merged.slashFreq, prev.slashFreq)(atoms.top_slash),
    friction_samples: atoms.friction_samples.filter((s) => !prevSamples.has(s)),
  };
  newSummary = { rescanned, reused, lastRun: prevState.lastRun || null };
}

if (AS_JSON) {
  if (INCREMENTAL) atoms.cursor = { rescanned, reused, state: STATE_PATH, ...(newSummary || {}) };
  process.stdout.write(JSON.stringify(atoms, null, 2) + '\n');
  process.exit(0);
}

const fmt = (rows) => rows.map(([k, c]) => `  ${String(c).padStart(4)}  ${k}`).join('\n');
const head = NEW_ONLY ? 'distill-scan (NEW since last run)' : 'distill-scan';
console.log(`# ${head} — ${merged.scanned.files} sessions, ${merged.scanned.lines} lines, ${merged.scanned.parseErrors} parse-errors, ${merged.frictionTotal} friction hits`);
if (INCREMENTAL) console.log(`# cursor: ${rescanned} (re)scanned, ${reused} reused from cache${prevState.lastRun ? ` · last run ${prevState.lastRun}` : ''}`);
console.log('');
console.log(`## Recurring command sequences (ritual candidates — trigrams, ≥3×)\n${fmt(atoms.top_trigrams) || '  (none ≥3×)'}\n`);
console.log(`## Command-pair transitions (bigrams, ≥3×)\n${fmt(atoms.top_bigrams) || '  (none)'}\n`);
console.log(`## Top PROCEDURAL command shapes (navigation/inspection noise removed)\n${fmt(atoms.top_commands) || '  (none)'}\n`);
console.log(`## Friction-phrase contexts (recurring-correction candidates — sample)\n${atoms.friction_samples.slice(0, 30).map(s => '  • ' + s).join('\n') || '  (none)'}\n`);
console.log(`## Slash-command usage\n${fmt(atoms.top_slash) || '  (none)'}\n`);
if (!NEW_ONLY) {
  console.log(`## Tool usage\n${fmt(atoms.top_tools)}\n`);
  console.log(`## Projects by session count\n${fmt(atoms.projects)}`);
}
