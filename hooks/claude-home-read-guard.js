#!/usr/bin/env node
'use strict';

// PreToolUse Claude default-config boundary. Card exceptions (never enabled by default):
// d-522f32f4 / d-7436a800: read this seat's own project's session files; writes only in its memory/.
// d-d031e0de: AUTOPILOT_CLAUDE_HOME_EXCEPTION=usage permits own-home projects/**/*.jsonl reads only.
// d-4b987a63: AUTOPILOT_CLAUDE_HOME_EXCEPTION=updater permits own-home plugins/** and settings.json.
const fs = require('node:fs');
const path = require('node:path');

const READ_COMMANDS = new Set('cat head tail less more grep egrep rg ugrep ag find fd jq sed awk ls stat tree du tar zip xxd od strings diff python python3 node ruby perl sqlite3 base64 file wc'.split(' '));
const WRITE_COMMANDS = new Set('cp mv rsync'.split(' '));

function unquote(s) { return String(s).replace(/^(['"])(.*)\1$/, '$2'); }
function splitCommands(src) {
  const out = []; let cur = ''; let quote = ''; let escaped = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (escaped) { cur += c; escaped = false; continue; }
    if (c === '\\' && quote !== "'") { cur += c; escaped = true; continue; }
    if (quote) { cur += c; if (c === quote) quote = ''; continue; }
    if (c === "'" || c === '"') { quote = c; cur += c; continue; }
    if (c === ';' || c === '\n' || c === '|' || c === '&') {
      if (cur.trim()) out.push(cur.trim()); cur = '';
      if ((c === '|' || c === '&') && src[i + 1] === c) i++;
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function words(src) {
  const out = []; let cur = ''; let q = ''; let escaped = false;
  for (const c of src) {
    if (escaped) { cur += c; escaped = false; continue; }
    if (c === '\\' && q !== "'") { escaped = true; continue; }
    if (q) { if (c === q) q = ''; else cur += c; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (/\s/.test(c)) { if (cur) out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}
function realOrLexical(p) {
  const abs = path.resolve(p);
  let probe = abs; const tail = [];
  while (!fs.existsSync(probe)) { const parent = path.dirname(probe); if (parent === probe) break; tail.unshift(path.basename(probe)); probe = parent; }
  try { return path.join(fs.realpathSync(probe), ...tail); } catch { return path.normalize(abs); }
}
function expand(raw, cwd) {
  let p = unquote(raw);
  const home = process.env.HOME || require('node:os').homedir();
  p = p.replace(/\$\{HOME\}|\$HOME/g, home);
  if (p === '~' || p.startsWith('~/')) p = home + p.slice(1);
  else if (/^~[^/]+/.test(p)) { const user = p.slice(1).split('/')[0]; if (user === 'root') p = '/root' + p.slice(user.length + 1); else p = `/home/${user}` + p.slice(user.length + 1); }
  return realOrLexical(path.isAbsolute(p) ? p : path.resolve(cwd, p));
}
function protectedHomes() {
  const roots = (process.env.AUTOPILOT_CLAUDE_HOME_ROOTS || '/home:/root').split(path.delimiter).filter(Boolean);
  const homes = new Set([path.resolve(process.env.HOME || require('node:os').homedir())]);
  for (const raw of roots) {
    const root = path.resolve(raw);
    if (root === '/root') homes.add('/root');
    else {
      homes.add(root);
      try { for (const e of fs.readdirSync(root, { withFileTypes: true })) if (e.isDirectory()) homes.add(path.join(root, e.name)); } catch { /* names are still covered by lexical /home/<user> matching */ }
    }
  }
  return [...homes].map(realOrLexical);
}
function configRoot(p, homes) { return homes.find((h) => p === path.join(h, '.claude') || p.startsWith(path.join(h, '.claude') + path.sep)); }
function isOwnProject(p, ownRoot) { return p === ownRoot || p.startsWith(ownRoot + path.sep); }
function exceptionAllows(p, ownRoot, isWrite, envMode) {
  const home = realOrLexical(process.env.HOME || require('node:os').homedir());
  const own = path.join(home, '.claude', 'projects', path.basename(ownRoot));
  if (isOwnProject(p, realOrLexical(own))) {
    const rel = path.relative(realOrLexical(own), p);
    if (isWrite) return rel === 'memory' || rel.startsWith(`memory${path.sep}`);
    return true;
  }
  if (envMode === 'usage' && !isWrite) {
    const projects = realOrLexical(path.join(home, '.claude', 'projects'));
    return p.startsWith(projects + path.sep) && p.endsWith('.jsonl');
  }
  if (envMode === 'updater') {
    const plugins = realOrLexical(path.join(home, '.claude', 'plugins'));
    return p === realOrLexical(path.join(home, '.claude', 'settings.json')) || p.startsWith(plugins + path.sep);
  }
  return false;
}
function cardUsageAllowed() {
  const os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const dir = path.join(process.env.XDG_RUNTIME_DIR || os.tmpdir(), 'autopilot', 'card-exceptions');
  let names;
  try { names = fs.readdirSync(dir); } catch { return false; }
  for (const name of names) {
    if (!/^d-[0-9a-f]{8}\.json$/.test(name)) continue;
    try {
      const file = path.join(dir, name);
      const grant = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (grant.card !== name.slice(0, -5) || typeof grant.answer !== 'string' || !grant.answer ||
          !/^[0-9a-f]{64}$/.test(grant.content_sha256) || grant.mode !== 'usage' || typeof grant.verified_at !== 'string') continue;
      const verified = Date.parse(grant.verified_at);
      if (!Number.isFinite(verified)) continue;
      const age = Date.now() - verified;
      if (age >= 0 && age <= 600000) return true;
      const result = spawnSync(process.env.AUTOPILOT_FLEET_BIN || 'fleet',
        ['decision', 'verify', grant.card, grant.answer, '--content-sha256', grant.content_sha256], { timeout: 3000 });
      if (result.status !== 0) continue;
      grant.verified_at = new Date().toISOString();
      fs.writeFileSync(file, JSON.stringify(grant), { mode: 0o600 });
      return true;
    } catch { /* Invalid or inaccessible grants never authorize. */ }
  }
  return false;
}
function projectRoot(payload) {
  const project = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
  const hash = path.resolve(project).replace(/[^a-zA-Z0-9]/g, '-');
  return path.join(realOrLexical(process.env.HOME || require('node:os').homedir()), '.claude', 'projects', hash);
}
// d-522f32f4 covers the seat's own sessions even when the tool ran from another cwd
// (e.g. a jq against the transcript while cd'd elsewhere): the session's project is
// CLAUDE_PROJECT_DIR, or any ancestor of the cwd, not just the cwd itself.
function ownProjectRoots(payload) {
  const home = realOrLexical(process.env.HOME || require('node:os').homedir());
  const dirs = [];
  if (process.env.CLAUDE_PROJECT_DIR) dirs.push(path.resolve(process.env.CLAUDE_PROJECT_DIR));
  let cur = path.resolve(payload.cwd || process.cwd());
  const stop = path.resolve(home);
  for (;;) {
    dirs.push(cur);
    const parent = path.dirname(cur);
    if (parent === cur || parent === stop) break;
    cur = parent;
  }
  return dirs.map((d) => path.join(home, '.claude', 'projects', d.replace(/[^a-zA-Z0-9]/g, '-')));
}
function targetDecision(raw, payload, { write = false } = {}) {
  if (typeof raw !== 'string' || !raw) return null;
  const p = expand(raw, payload.cwd || process.cwd()); const homes = protectedHomes(); const root = configRoot(p, homes);
  if (!root) return null;
  const mode = process.env.AUTOPILOT_CLAUDE_HOME_EXCEPTION;
  for (const own of ownProjectRoots(payload)) {
    if (exceptionAllows(p, own, write, mode)) return null;
    if (!write && mode !== 'usage' && exceptionAllows(p, own, false, 'usage') && cardUsageAllowed()) return null;
  }
  return p;
}
function globCanReachClaude(pattern) { return /(?:^|\/)(?:\.claude|\*\*|\*)/.test(pattern || ''); }
function shortFlag(arg, flag) { return /^-[A-Za-z]+$/.test(arg) && arg.slice(1).includes(flag); }
const OPERAND_OPTIONS = {
  grep: { value: { e: 'pattern', regexp: 'pattern', f: 'pattern-path', file: 'pattern-path', g: 'glob', glob: 'glob', include: 'glob', exclude: 'glob', 'exclude-dir': 'glob', m: 'value', A: 'value', B: 'value', C: 'value', 'max-count': 'value', 'after-context': 'value', 'before-context': 'value', context: 'value' } },
  egrep: { value: { e: 'pattern', regexp: 'pattern', f: 'pattern-path', file: 'pattern-path', g: 'glob', glob: 'glob', include: 'glob', exclude: 'glob', 'exclude-dir': 'glob', m: 'value', A: 'value', B: 'value', C: 'value', 'max-count': 'value', 'after-context': 'value', 'before-context': 'value', context: 'value' } },
  rg: { value: { e: 'pattern', regexp: 'pattern', f: 'pattern-path', file: 'pattern-path', g: 'glob', glob: 'glob', include: 'glob', exclude: 'glob', 'max-count': 'value', 'after-context': 'value', 'before-context': 'value', context: 'value', maxdepth: 'value', threads: 'value', type: 'value', t: 'value', T: 'value', A: 'value', B: 'value', C: 'value', m: 'value', j: 'value', M: 'value', 'type-add': 'value', 'type-not': 'value' } },
  ugrep: { value: { e: 'pattern', regexp: 'pattern', f: 'pattern-path', file: 'pattern-path', g: 'glob', glob: 'glob', include: 'glob', exclude: 'glob', 'exclude-dir': 'glob', m: 'value', A: 'value', B: 'value', C: 'value', 'max-count': 'value', 'after-context': 'value', 'before-context': 'value', context: 'value' } },
  ag: { value: { e: 'pattern', regexp: 'pattern', f: 'pattern-path', file: 'pattern-path', g: 'glob', glob: 'glob', include: 'glob', exclude: 'glob', 'max-count': 'value', after: 'value', before: 'value', context: 'value', depth: 'value' } },
  sed: { value: { e: 'script', f: 'pattern-path', expression: 'script', file: 'pattern-path' } },
  awk: { value: { e: 'script', f: 'pattern-path', F: 'value', v: 'value', 'field-separator': 'value', assign: 'value' } },
  jq: { value: { f: 'pattern-path', 'from-file': 'pattern-path', arg: 'two-values', argjson: 'two-values', rawfile: 'name-path', slurpfile: 'name-path', argfile: 'path', 'run-tests': 'path' } },
};
function classifyOperands(program, args) {
  const table = OPERAND_OPTIONS[program]; const paths = []; const patterns = [];
  const takesValue = (kind) => kind === 'pattern' || kind === 'script' || kind === 'pattern-path' || kind === 'path' || kind === 'glob' || kind === 'value' || kind === 'two-values' || kind === 'name-path';
  const patternKind = (kind) => kind === 'pattern' || kind === 'script' || kind === 'pattern-path';
  const scanOptions = (onOption) => {
    let endOptions = false;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!endOptions && arg === '--') { endOptions = true; continue; }
      if (!endOptions && table && arg.startsWith('--')) {
        const eq = arg.indexOf('='); const name = arg.slice(2, eq < 0 ? undefined : eq); const kind = table.value[name];
        if (kind) {
          onOption(kind);
          if (eq < 0 && takesValue(kind) && i + 1 < args.length) {
            i++;
            if ((kind === 'two-values' || kind === 'name-path') && i + 1 < args.length) i++;
          }
          continue;
        }
      }
      if (!endOptions && table && /^-[^-]/.test(arg)) {
        for (let n = 1; n < arg.length; n++) {
          const kind = table.value[arg[n]]; if (!kind || !takesValue(kind)) continue;
          onOption(kind);
          if (!arg.slice(n + 1) && i + 1 < args.length) {
            i++;
            if ((kind === 'two-values' || kind === 'name-path') && i + 1 < args.length) i++;
          }
          break;
        }
        continue;
      }
    }
  };
  let patternGivingOption = false;
  scanOptions((kind) => { if (patternKind(kind)) patternGivingOption = true; });
  const noPattern = program === 'rg' && args.some((arg, index) => arg === '--files' || arg === '--type-list' || arg.startsWith('--files='));
  const hasPatternOption = patternGivingOption || noPattern;
  let firstNonOption = true; let endOptions = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!endOptions && arg === '--') { endOptions = true; continue; }
    if (!endOptions && table && arg.startsWith('--')) {
      const eq = arg.indexOf('='); const name = arg.slice(2, eq < 0 ? undefined : eq); const kind = table.value[name];
      if (kind) {
        if (eq >= 0) {
          const value = arg.slice(eq + 1);
          if (kind === 'path' || kind === 'pattern-path') paths.push(value);
          else if (kind === 'pattern' || kind === 'script') patterns.push(value);
          else if (kind === 'name-path') { if (i + 1 < args.length) paths.push(args[++i]); }
        } else if (takesValue(kind) && i + 1 < args.length) {
          if (kind === 'path' || kind === 'pattern-path') paths.push(args[++i]);
          else if (kind === 'pattern' || kind === 'script') patterns.push(args[++i]);
          else if (kind === 'name-path') { i++; if (i + 1 < args.length) paths.push(args[++i]); }
          else if (kind === 'two-values') i += Math.min(2, args.length - i - 1);
          else i++;
        }
        continue;
      }
    }
    if (!endOptions && table && /^-[^-]/.test(arg)) {
      let consumed = false;
      for (let n = 1; n < arg.length; n++) {
        const kind = table.value[arg[n]]; if (!kind || !takesValue(kind)) continue;
        const attached = arg.slice(n + 1);
        if (attached) {
          if (kind === 'path' || kind === 'pattern-path') paths.push(attached);
          else if (kind === 'pattern' || kind === 'script') patterns.push(attached);
          else if (kind === 'name-path' && i + 1 < args.length) paths.push(args[++i]);
        } else if (i + 1 < args.length) {
          if (kind === 'path' || kind === 'pattern-path') paths.push(args[++i]);
          else if (kind === 'pattern' || kind === 'script') patterns.push(args[++i]);
          else if (kind === 'name-path') { i++; if (i + 1 < args.length) paths.push(args[++i]); }
          else if (kind === 'two-values') i += Math.min(2, args.length - i - 1);
          else i++;
        }
        consumed = true; break;
      }
      if (consumed) continue;
      if (arg !== '-') continue;
    }
    if (!endOptions && arg.startsWith('-') && arg !== '-') continue;
    if (firstNonOption) {
      firstNonOption = false;
      if (!hasPatternOption && !noPattern && ['jq', 'sed', 'awk', 'grep','egrep','rg','ugrep','ag'].includes(program)) { patterns.push(arg); continue; }
    }
    paths.push(arg);
  }
  return { paths, patterns };
}
function ancestorOfHome(p, homes) {
  const ancestors = new Set(['/', '/home', '/root']);
  for (const h of homes) { let cur = h; while (true) { ancestors.add(cur); const up = path.dirname(cur); if (up === cur) break; cur = up; } }
  return ancestors.has(p);
}
function unwrapCommand(ws, depth = 0) {
  let i = 0;
  while (i < ws.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(ws[i])) i++;
  let cmd = path.basename(ws[i] || '');
  while (['env','timeout','nice','nohup','command','xargs','sudo'].includes(cmd)) {
    const wrapper = cmd; i++;
    if (wrapper === 'env') {
      while (i < ws.length && ws[i].startsWith('-')) { const opt = ws[i++]; if (opt === '-u' || opt === '--unset' || opt === '-C' || opt === '--chdir') i++; }
      while (i < ws.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(ws[i])) i++;
    } else if (wrapper === 'timeout') {
      while (i < ws.length && ws[i].startsWith('-')) { const opt = ws[i++]; if (['-k','--kill-after','-s','--signal','--foreground'].includes(opt) && ws[i]) i++; }
      if (ws[i]) i++;
    } else if (wrapper === 'nice') {
      if (ws[i] === '-n' || ws[i] === '--adjustment') i += 2;
      else if (ws[i]?.startsWith('-')) i++;
    } else if (wrapper === 'xargs') {
      while (i < ws.length && ws[i].startsWith('-')) { const opt = ws[i++]; if (['-a','-E','-I','-L','-n','-P','-s','-d'].includes(opt) && ws[i]) i++; }
    } else if (wrapper === 'sudo') {
      while (i < ws.length && ws[i].startsWith('-')) { const opt = ws[i++]; if ((opt === '-u' || opt === '--user') && ws[i]) i++; }
    }
    while (i < ws.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(ws[i])) i++;
    cmd = path.basename(ws[i] || '');
  }
  return { cmd, args: ws.slice(i + 1), raw: ws[i], depth, commandIndex: i };
}
function bashDecision(command, payload, depth = 0) {
  const homes = protectedHomes(); let cwd = payload.cwd || process.cwd(); let entered = null;
  for (const segment of splitCommands(command)) {
    let ws = words(segment); if (!ws.length) continue;
    const parsed = unwrapCommand(ws, depth); let cmd = parsed.cmd;
    if (!cmd) continue;
    ws = ws.slice(parsed.commandIndex);
    if (cmd === 'cd' && ws[1]) { const p = expand(ws[1], cwd); if (configRoot(p, homes)) entered = p; else cwd = p; continue; }
    if (entered) return entered;
    if (depth < 3 && ['bash','sh','zsh'].includes(cmd)) {
      const cIndex = ws.findIndex((w) => w === '--command' || (/^-[A-Za-z]+$/.test(w) && w.slice(1).includes('c')));
      if (cIndex >= 0 && ws[cIndex + 1]) { const nested = bashDecision(ws[cIndex + 1], { ...payload, cwd }, depth + 1); if (nested) return nested; }
      continue;
    }
    for (let i = 0; i < ws.length; i++) {
      const token = ws[i];
      if (['<', '>', '>>', '2>', '<<<'].includes(token) && ws[i + 1]) {
        const target = targetDecision(ws[i + 1], { ...payload, cwd }, { write: token !== '<' && token !== '<<<' });
        if (target) return target;
      } else if (/^(?:\d*>>?|\d*<).+/.test(token)) {
        const m = token.match(/^(?:\d*>>?|\d*<)(.+)$/);
        if (m) { const target = targetDecision(m[1], { ...payload, cwd }, { write: token.includes('>') }); if (target) return target; }
      }
    }
    const read = READ_COMMANDS.has(cmd); const write = WRITE_COMMANDS.has(cmd);
    if (read || write) {
      const operands = classifyOperands(cmd, ws.slice(1));
      for (const arg of operands.paths) {
        if (/^(?:\d*[<>])/.test(arg)) continue;
        if (arg === '<' || arg === '>' || arg === '>>' || arg === '2>' || arg === '<<<') continue;
        const target = targetDecision(arg, { ...payload, cwd }, { write }); if (target) return target;
      }
    }
    const recursive = (['grep','egrep'].includes(cmd) && ws.some((x) => shortFlag(x, 'r') || shortFlag(x, 'R') || ['--recursive','--dereference-recursive'].includes(x)))
      || ['rg','ugrep','ag','fd','find','du','tree'].includes(cmd)
      || (cmd === 'ls' && ws.some((x) => shortFlag(x, 'R') || x === '--recursive'));
    if (recursive) {
      const excluded = ws.some((x) => x === '--exclude-dir=.claude' || (x === '-g' && ws[ws.indexOf(x) + 1] === '!.claude'))
        || /-not\s+-path\s+['"]?\*\/\.claude\*/.test(segment) || /(?:^|\s)-prune\b/.test(segment) && /\.claude/.test(segment);
      if (!excluded) for (const arg of classifyOperands(cmd, ws.slice(1)).paths) {
        if (arg.startsWith('-')) continue;
        const p = expand(arg, cwd); if (ancestorOfHome(p, homes)) return p;
      }
    }
  }
  return null;
}
function deny(p) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason:
    `這個操作會讀到真正的 Claude 預設設定目錄（${p}）。依紅線要操作員本人的卡才能讀；自己這席的 session 檔案（~/.claude/projects/<本專案>/）不受限。 [claude-home-read-guard]`
    + require('./lib/gate-hint.js').gateHint('只讀自己專案的 session 檔（~/.claude/projects/<本專案>/）；要看別席設定就開 fleet task 請操作員處理', 'hooks/README.md') } };
}
function handle(payload) {
  if (payload?.hook_event_name !== 'PreToolUse') return null;
  const name = payload.tool_name; const input = payload.tool_input || {}; let hit = null;
  if (name === 'Bash') hit = bashDecision(input.command || '', payload);
  else if (name === 'Read') hit = targetDecision(input.file_path, payload);
  else if (['Edit','Write','MultiEdit','NotebookEdit'].includes(name)) hit = targetDecision(input.file_path || input.notebook_path, payload, { write: true });
  else if (name === 'Grep' || name === 'Glob') {
    const root = expand(input.path || payload.cwd || '.', payload.cwd || process.cwd());
    hit = targetDecision(root, payload);
    if (!hit && name === 'Glob' && globCanReachClaude(input.pattern) && ancestorOfHome(root, protectedHomes())) hit = root;
    if (!hit && name === 'Grep' && ancestorOfHome(root, protectedHomes())) hit = root;
  }
  return hit ? deny(hit) : null;
}
if (require.main === module) {
  try { const result = handle(JSON.parse(fs.readFileSync(0, 'utf8'))); if (result) process.stdout.write(JSON.stringify(result)); }
  catch (e) { process.stderr.write(`claude-home-read-guard: internal error; allowing (${e.message})\n`); }
}
module.exports = { handle, expand, protectedHomes, targetDecision, bashDecision };
