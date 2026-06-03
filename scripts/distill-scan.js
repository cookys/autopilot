#!/usr/bin/env node
/*
 * distill-scan.js — deterministic full-history scanner (P1 value-gate, plan 2026-06-03-distill-skill §4.2)
 *
 * Reads ~/.claude/projects/<encoded-cwd>/*.jsonl, emits FREQUENCY ATOMS only. NO LLM.
 * Atoms: normalized bash-command shapes, command-sequence n-grams (ritual candidates),
 * slash-command frequency, tool frequency, bilingual user-friction-phrase hits.
 * Project attribution comes from the in-line `cwd` field (never the dir-name encoding — see
 * memory project_hook-transcript-pivot). Borrows JSONL-parsing conventions (line cap, per-line
 * try/catch) without reusing the single-event hook reader.
 *
 * Usage: node distill-scan.js [--json] [--top N] [--real-only]
 *   default: human-readable report to stdout.  --json: emit the atom JSON.
 * Exit: 0 always (read-only). PROVISIONAL: not wired into CLAUDE.md inventory until P1 passes.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(os.homedir(), '.claude', 'projects');
const MAX_LINE_BYTES = 2 * 1024 * 1024;
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write([
    'distill-scan.js — deterministic conversation-history scanner (skills/distill, P1).',
    'Reads ~/.claude/projects/*/*.jsonl → frequency atoms in two buckets (ritual + correction candidates). No LLM.',
    '',
    'Usage: node distill-scan.js [--json] [--real-only] [--top N] [--help]',
    '  --json       emit the atom JSON instead of the human report',
    '  --real-only  scan only /home/<user> projects (skip ephemeral /tmp eval dirs)',
    '  --top N      number of rows per section (default 25)',
    'Exit 0 always (read-only).', '',
  ].join('\n') + '\n');
  process.exit(0);
}
const AS_JSON = args.includes('--json');
const REAL_ONLY = args.includes('--real-only');
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

// --- accumulators ---
// pure navigation/inspection — NOT procedural; excluded from ritual n-grams so signal isn't drowned
const NOISE = new Set(['cd', 'ls', 'cat', 'grep', 'echo', 'find', 'tail', 'head', 'wc', 'pwd', 'which',
  'sort', 'uniq', 'sed', 'awk', '.', '#', 'for', 'if', 'while', 'true', 'sleep', 'printf', 'tr', 'cut',
  'xargs', 'less', 'more', 'type', 'stat', 'file', 'du', 'df', 'env', 'set', 'read', 'test', 'jq']);
const isNoise = (shape) => NOISE.has((shape || '').split(' ')[0]);

const cmdFreq = new Map(), toolFreq = new Map(), slashFreq = new Map();
const bigram = new Map(), trigram = new Map();
const proj = new Map();   // cwd -> {sessions, cmds, friction}
const frictionSamples = [], frictionSeen = new Set();
let files = 0, lines = 0, parseErr = 0, frictionTotal = 0, sessions = 0;

const inc = (m, k, by = 1) => { if (k) m.set(k, (m.get(k) || 0) + by); };

function scanFile(fp) {
  let raw;
  try { raw = fs.readFileSync(fp, 'utf8'); } catch { return; }
  files++; sessions++;
  const seq = [];                       // ordered command shapes within this session
  let cwd = null;
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
        const f = frictionHits(txt); frictionTotal += f;
        if (f > 0) {
          const clean = txt.replace(/\s+/g, ' ').trim().slice(0, 160);
          if (!frictionSeen.has(clean)) { frictionSeen.add(clean); frictionSamples.push(clean); }
        }
        const m = txt.trim().match(/^\/([a-z][a-z0-9-]{1,30})/i);
        if (m) inc(slashFreq, '/' + m[1].toLowerCase());
        if (cwd) { const p = proj.get(cwd) || { sessions: 0, cmds: 0, friction: 0 }; p.friction += f; proj.set(cwd, p); }
      }
    } else if (t === 'assistant' && rec.message && Array.isArray(rec.message.content)) {
      for (const c of rec.message.content) {
        if (!c || c.type !== 'tool_use') continue;
        inc(toolFreq, c.name);
        if (c.name === 'Bash' && c.input) {
          const shape = normCmd(c.input.command);
          if (shape) { inc(cmdFreq, shape); seq.push(shape); }
        }
      }
    }
  }
  // per-project rollup
  const key = cwd || '(unknown)';
  const p = proj.get(key) || { sessions: 0, cmds: 0, friction: 0 };
  p.sessions += 1; p.cmds += seq.length; proj.set(key, p);
  // command-sequence n-grams: drop navigation/inspection noise, then collapse immediate repeats
  const s = seq.filter((v) => !isNoise(v)).filter((v, i, a) => v !== a[i - 1]);
  for (let i = 0; i + 1 < s.length; i++) inc(bigram, s[i] + ' → ' + s[i + 1]);
  for (let i = 0; i + 2 < s.length; i++) inc(trigram, s[i] + ' → ' + s[i + 1] + ' → ' + s[i + 2]);
}

function walk(dir) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) walk(fp);
    else if (e.name.endsWith('.jsonl')) {
      if (REAL_ONLY && !/-home-cookys/.test(path.basename(dir))) continue;
      scanFile(fp);
    }
  }
}

const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const minCount = (arr, min) => arr.filter(([, c]) => c >= min);

walk(ROOT);

const atoms = {
  scanned: { files, lines, parseErrors: parseErr, sessions },
  friction_total: frictionTotal,
  top_commands: top([...cmdFreq].reduce((m, [k, v]) => (isNoise(k) ? m : m.set(k, v)), new Map()), TOP),
  friction_samples: frictionSamples,
  top_bigrams: minCount(top(bigram, TOP * 2), 3).slice(0, TOP),
  top_trigrams: minCount(top(trigram, TOP * 2), 3).slice(0, TOP),
  top_slash: top(slashFreq, 15),
  top_tools: top(toolFreq, 12),
  projects: top(new Map([...proj].map(([k, v]) => [k, v.sessions])), 15),
};

if (AS_JSON) { process.stdout.write(JSON.stringify(atoms, null, 2) + '\n'); process.exit(0); }

const fmt = (rows) => rows.map(([k, c]) => `  ${String(c).padStart(4)}  ${k}`).join('\n');
console.log(`# distill-scan — ${files} files, ${lines} lines, ${parseErr} parse-errors, ${frictionTotal} friction hits\n`);
console.log(`## Recurring command sequences (ritual candidates — trigrams, ≥3×)\n${fmt(atoms.top_trigrams) || '  (none ≥3×)'}\n`);
console.log(`## Command-pair transitions (bigrams, ≥3×)\n${fmt(atoms.top_bigrams)}\n`);
console.log(`## Top PROCEDURAL command shapes (navigation/inspection noise removed)\n${fmt(atoms.top_commands)}\n`);
console.log(`## Friction-phrase contexts (recurring-correction candidates — sample)\n${atoms.friction_samples.slice(0, 30).map(s => '  • ' + s).join('\n') || '  (none)'}\n`);
console.log(`## Slash-command usage\n${fmt(atoms.top_slash)}\n`);
console.log(`## Tool usage\n${fmt(atoms.top_tools)}\n`);
console.log(`## Projects by session count\n${fmt(atoms.projects)}`);
