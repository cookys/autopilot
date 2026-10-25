'use strict';
// fbatch/shell-parse.js — the one shell tokenizer behind every Bash-string decision in fbatch/cell.js.
// parseShell(src) -> flat list of simple commands { words: [...], redirs: [{op, target}] }, in execution order:
// quotes are removed (whitespace inside quotes stays in the word), backslash escapes are honoured, heredoc bodies are
// skipped, `;` `&` `&&` `|` `||` `|&` newline `(` `)` end a command, $(...) `...` <(...) >(...) are parsed
// recursively and their commands come first, and `bash|sh|zsh|dash|ksh -c '<code>'` is parsed recursively (up to
// MAX_DEPTH levels). Redirections (`>`, `>>`, `>|`, `&>`, `&>>`, `N>`, `<`, `<<<`, ...) are separated from words with
// their target already unquoted, so `echo x > "FINDINGS report.txt"` has the target `FINDINGS report.txt`.
// describe(cmd) -> { kind: 'read'|'inline'|'run', program, command } for one simple command: wrappers (env, time,
// timeout, nice, nohup, xargs, sudo ...) are stripped; `program` is the basename of the program or, for an
// interpreter (node, bash, python ...), of the script it runs; `command` is the normalised text lib.js matches.
// Known limits (README): variable expansion ($X, ${X}), eval, programs that write files themselves, shell nesting
// deeper than MAX_DEPTH, here-string content, aliases and functions.
const MAX_DEPTH = 3;
const READERS = new Set(['cat', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'less', 'more', 'ls', 'wc', 'stat', 'file', 'diff', 'cmp', 'echo', 'printf', 'test', '[', '[[', 'find', 'tree', 'sed', 'awk', 'jq', 'which', 'type', 'realpath', 'basename', 'dirname', 'pwd', 'date', 'true', 'false', 'read', 'sort', 'uniq', 'cut', 'tr', 'tee', 'cd']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const INTERP = new Set(['node', 'nodejs', 'python', 'python3', 'ruby', 'perl', 'bash', 'sh', 'zsh', 'dash', 'ksh', 'deno', 'bun']);
const KEYWORDS = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', 'time', '{', '}', 'done', 'fi', 'esac']);
const WRAPPERS = new Set(['env', 'nice', 'nohup', 'command', 'exec', 'sudo', 'timeout', 'xargs', 'stdbuf', 'setsid', 'builtin', 'ionice']);
const WRITE_OPS = new Set(['>', '>>', '>|', '&>', '&>>']);

const base = (p) => String(p).replace(/\/+$/, '').split('/').pop();

function matchParen(src, open) { // src[open] === '('; returns index of the matching ')' (or src.length)
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') { i++; continue; }
    if (ch === "'") { const e = src.indexOf("'", i + 1); i = e < 0 ? src.length : e; continue; }
    if (ch === '"') { for (i++; i < src.length && src[i] !== '"'; i++) if (src[i] === '\\') i++; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) return i; }
  }
  return src.length;
}

function parseShell(src, depth = 0) {
  const cmds = [];
  let words = [];
  let redirs = [];
  let cur = null;
  let pending = null; // redirect operator waiting for its target word
  const pend = []; // heredoc delimiters waiting for the next newline
  const nested = (code) => { if (depth < MAX_DEPTH) for (const c of parseShell(code, depth + 1)) cmds.push(c); };
  const pushWord = () => {
    if (cur === null) return;
    if (pending) { redirs.push({ op: pending, target: cur }); pending = null; } else words.push(cur);
    cur = null;
  };
  const endCmd = () => {
    pushWord(); pending = null;
    if (words.length || redirs.length) cmds.push({ words, redirs });
    words = []; redirs = [];
  };
  const append = (s) => { cur = (cur === null ? '' : cur) + s; };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\r') { pushWord(); continue; }
    if (ch === '\n') {
      endCmd();
      let at = i + 1;
      while (pend.length) {
        const d = pend.shift();
        for (;;) {
          if (at >= src.length) break;
          let e = src.indexOf('\n', at);
          if (e < 0) e = src.length;
          const line = src.slice(at, e);
          at = e + 1;
          if (line.trim() === d) break;
        }
      }
      i = at - 1;
      continue;
    }
    if (ch === '\\') { if (src[i + 1] === '\n') { i++; continue; } append(src[i + 1] || ''); i++; continue; }
    if (ch === "'") { const e = src.indexOf("'", i + 1); append(src.slice(i + 1, e < 0 ? src.length : e)); i = e < 0 ? src.length : e; continue; }
    if (ch === '"') {
      let j = i + 1; let s = '';
      for (; j < src.length && src[j] !== '"'; j++) {
        if (src[j] === '\\' && '$`"\\\n'.includes(src[j + 1] || 'x')) { if (src[j + 1] !== '\n') s += src[j + 1]; j++; continue; }
        if (src[j] === '$' && src[j + 1] === '(') { const e = matchParen(src, j + 1); nested(src.slice(j + 2, e)); j = e; continue; }
        if (src[j] === '`') { const e = src.indexOf('`', j + 1); nested(src.slice(j + 1, e < 0 ? src.length : e)); j = e < 0 ? src.length : e; continue; }
        s += src[j];
      }
      append(s); i = j; continue;
    }
    if (ch === '$' && src[i + 1] === '(') { const e = matchParen(src, i + 1); nested(src.slice(i + 2, e)); append(''); i = e; continue; }
    if (ch === '`') { const e = src.indexOf('`', i + 1); nested(src.slice(i + 1, e < 0 ? src.length : e)); append(''); i = e < 0 ? src.length : e; continue; }
    if ((ch === '<' || ch === '>') && src[i + 1] === '(') { const e = matchParen(src, i + 1); nested(src.slice(i + 2, e)); append(''); i = e; continue; }
    if (ch === ';' || ch === '(' || ch === ')') { endCmd(); continue; }
    if (ch === '|') { endCmd(); if (src[i + 1] === '|' || src[i + 1] === '&') i++; continue; }
    if (ch === '&' && src[i + 1] !== '>') { endCmd(); if (src[i + 1] === '&') i++; continue; }
    if (ch === '<' || ch === '>' || ch === '&') {
      if (cur !== null && /^\d+$/.test(cur) && ch !== '&') cur = null; else pushWord(); // fd prefix of N> / N<
      let op = ch;
      if (ch === '&') { op = '&>'; i++; }
      if (src[i + 1] === ch && ch !== '&') { op += ch; i++; if (ch === '<' && src[i + 1] === '<') { op += '<'; i++; } }
      if (op === '&>' && src[i + 1] === '>') { op = '&>>'; i++; }
      if (ch === '>' && op === '>' && src[i + 1] === '|') { op = '>|'; i++; }
      if ((op === '>' || op === '<') && src[i + 1] === '&') { op += '&'; i++; }
      if (op === '<<' || op === '<<-') {
        let j = i + 1;
        if (src[j] === '-') { j++; }
        while (src[j] === ' ' || src[j] === '\t') j++;
        let delim = '';
        if (src[j] === "'" || src[j] === '"') { const e = src.indexOf(src[j], j + 1); delim = src.slice(j + 1, e < 0 ? src.length : e); j = e < 0 ? src.length : e + 1; }
        else { let k = j; while (k < src.length && /[\w-]/.test(src[k])) k++; delim = src.slice(j, k); j = k; }
        if (delim) pend.push(delim);
        i = j - 1;
        continue;
      }
      pending = op;
      continue;
    }
    append(ch);
  }
  endCmd();
  // shell -c '<code>' : the code is executed, so parse it as commands too
  const out = [];
  for (const c of cmds) {
    out.push(c);
    if (depth >= MAX_DEPTH) continue;
    const eff = unwrap(c.words);
    if (eff.length && SHELLS.has(base(eff[0]))) {
      for (let k = 1; k < eff.length; k++) {
        if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(eff[k]) && eff[k + 1] !== undefined) { for (const n of parseShell(eff[k + 1], depth + 1)) out.push(n); break; }
        if (!eff[k].startsWith('-')) break;
      }
    }
  }
  return out;
}

// Strip leading assignments, control keywords and wrapper commands (with their own options).
function unwrap(words) {
  let w = words.slice();
  for (let guard = 0; guard < 20; guard++) {
    while (w.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]) || KEYWORDS.has(w[0]))) w.shift();
    if (!w.length) return w;
    const name = base(w[0]);
    if (!WRAPPERS.has(name)) return w;
    w.shift();
    const withArg = { xargs: new Set(['-I', '-n', '-P', '-d', '-L', '-s', '-E', '-a', '-J']), env: new Set(['-u', '-C', '-S']), nice: new Set(['-n']), sudo: new Set(['-u', '-g', '-C']), ionice: new Set(['-c', '-n']), stdbuf: new Set([]), timeout: new Set(['-s', '-k']) }[name] || new Set();
    while (w.length && (w[0].startsWith('-') || (name === 'env' && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0])))) {
      const o = w.shift();
      if (withArg.has(o) && w.length) w.shift();
    }
    if (name === 'timeout' && w.length) w.shift(); // the duration
  }
  return w;
}

// -> { kind, program, command, words } for one simple command (assignments / wrappers already stripped).
function describe(cmd) {
  const w = unwrap(cmd.words);
  if (!w.length) return { kind: 'empty', program: '', command: ':empty', words: [] };
  const name = base(w[0]);
  if (READERS.has(name)) return { kind: 'read', program: name, command: `:read ${name}`, words: w };
  if (INTERP.has(name)) {
    const isInline = (a) => (SHELLS.has(name) ? /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a) : ['-e', '-c', '-p', '-pe', '-ne', '--eval', '--print'].includes(a));
    const inline = w.findIndex((a, k) => k > 0 && isInline(a));
    if (inline > 0) return { kind: 'inline', program: name, command: `:inline ${name}`, words: w };
    const si = w.findIndex((a, i) => i > 0 && !a.startsWith('-'));
    if (si < 0) return { kind: 'run', program: name, command: name, words: w };
    return { kind: 'run', program: base(w[si]), command: `${name} ${w.slice(si).join(' ')}`, words: w };
  }
  if (name === 'git') {
    const sub = w.slice(1).find((a) => !a.startsWith('-')) || '';
    return { kind: 'run', program: 'git', command: sub === 'merge' ? w.join(' ') : `git ${sub}`.trim(), words: w };
  }
  return { kind: 'run', program: name, command: w.join(' '), words: w };
}

module.exports = { parseShell, unwrap, describe, WRITE_OPS, base, MAX_DEPTH };
