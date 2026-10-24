'use strict';

// scripts/lib/bash-launch-rules.js — the ONE definition of three Bash-launch hazards that
// hooks/depth0-delegate-gate.js checks on every Bash call (all depths, BL-0019):
//   1. detach-no-wake (DENY)  — a trailing `&` or `setsid -f` (with or without nohup) starting a dispatch RAIL entrypoint
//      (one of the explicit RAIL_NAMES list below — observers such as dispatch-status.js and *.test.* files are
//      not rails, and never match the exact-name pattern) with nothing in the same command that wakes the session.
//      Only the COMMAND-POSITION word counts: `grep dispatch-review.sh x &` is not a launch.
//   2. pkill-self-match (DENY by default since BL-0148; knob off|warn|deny in the hook) — `pkill -f` / `pgrep -f` (also inside `$(…)`) whose pattern lacks the
//      `[x]` self-exclusion trick, so the pattern matches the Bash tool's own command line.
//   3. zsh-expansion (WARN, zsh only, never a deny) — a word starting with `=<char>` (zsh EQUALS
//      expansion) or an unquoted glob that matches nothing (zsh `nomatch` aborts the whole line).
//      Prefers silence: `**`, a partly-quoted word, a directory that cannot be read within the 50 ms budget,
//      or oversized input ⇒ no warning.
// Rules run on EXECUTABLE text (heredoc bodies / comments stripped by bash-wait-rules.js).
//
// scripts/lib/dispatch-detach.sh is NOT a launcher: it is a sourceable helper the read rails
// source to detach THEMSELVES (setsid supervisor + durable result file). Nothing to allow here.

const fs = require('fs');
const path = require('path');
const { executableText } = require('./bash-wait-rules.js');


// Rail entrypoints that LAUNCH a worker (an explicit list: dispatch-status.js / dispatch-contract.js /
// dispatch-tree.js are observers and validators, not launchers). Never a *.test.* file.
const RAIL_NAMES = 'hetero|review|author|author-kimi|consult|discuss|explore|foreman|batch|anthropic-review|local-openai|plan-review|experience-critic';
// Any path (or none) in front of a listed rail file name counts: `cd scripts && bash dispatch-review.sh &`.
const RAIL_PATH_RE = new RegExp(`(?:^|/)dispatch-(?:${RAIL_NAMES})\\.(?:sh|js)$`);
const WAKE_HEADS = new Set(['wait']);
const WAKE_SCRIPT_RE = /(?:^|\/)wait-dispatch-results(?:\.[a-z]+)?$/;
const PREFIX_CMDS = new Set(['time', 'exec', 'command', 'sudo', 'nice', 'nohup', 'setsid', 'env', 'bash', 'sh', 'zsh', 'dash', 'node', 'stdbuf', 'timeout',
  'ionice', 'flock', 'chrt', 'taskset', 'xargs', 'parallel']);
// Leading positional words a prefix command consumes before the real command: `flock FILE cmd`, `chrt PRIO cmd`,
// `taskset MASK cmd` (`taskset -c LIST cmd` has no mask word: handled where the flags are read).
const POSITIONAL = { flock: 1, chrt: 1, taskset: 1 };
// Flags of a prefix command that consume the NEXT word as their value.
const VALUE_FLAGS = {
  nice: new Set(['-n']), sudo: new Set(['-u', '-g', '-h', '-p', '-C']), env: new Set(['-u', '-C', '-S']), timeout: new Set(['-s', '-k']),
  ionice: new Set(['-c', '-n', '-p', '-P', '-u']), flock: new Set(['-w', '-E', '--timeout', '--conflict-exit-code']),
  taskset: new Set(['-c', '--cpu-list']), xargs: new Set(['-P', '-n', '-L', '-I', '-d', '-E', '-s', '-a', '-R', '-S']),
  // GNU parallel: `parallel [options] command {} ::: args` (options per its man page)
  parallel: new Set(['-j', '--jobs', '-n', '--max-args', '-N', '-S', '--sshlogin', '-a', '--arg-file', '-I', '-d', '--delimiter', '-L', '--max-lines',
    '--joblog', '--results', '--delay', '--timeout', '--retries', '--workdir', '--tagstring', '--colsep', '-C']),
};
// Shell keywords that precede a command: `for …; do CMD &`, `if …; then CMD`, `{ CMD; }`.
const KEYWORDS = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', '{', '!', '(']);

const CLOSERS = [
  { close: /^\}(?:\s|$)/, open: /^\{(?:\s|$)/ },
  { close: /^done(?:\s|$)/, open: /^(?:for|while|until|select)\s/ },
  { close: /^fi(?:\s|$)/, open: /^if\s/ },
  { close: /^esac(?:\s|$)/, open: /^case\s/ },
];

// Cost bounds: the closer pull-back below scans backwards (quadratic over `} & } & …`), and `$(…)` scans
// run per segment. Past SEG_MAX_TEXT the structural passes are skipped (plain `&`/list marking only);
// within it the pull-back looks at most CLOSER_SCAN_MAX segments back.
const SEG_MAX_TEXT = 16384;
const CLOSER_SCAN_MAX = 64;

// Split into segments with their terminator. Quote-aware; `&&`, `||`, `|`, `;`, newline end a
// segment; a single `&` (not `>&`, `&>`, `&&`) ends a segment AND marks it backgrounded.
function segments(text) {
  const out = [];
  let cur = '';
  let q = null;
  const s = String(text);
  // `listStart`: index of the first segment of the current `;`/newline-delimited list. A single `&`
  // backgrounds the WHOLE list (`a && b | c &`), so every segment since listStart is marked.
  let listStart = 0;
  const big = s.length > SEG_MAX_TEXT;
  let pipeNext = false; // the next segment is the right-hand side of a `|` / `|&`
  let subDepth = 0; // inside a `( … )` subshell: its background jobs are NOT waitable by the outer shell
  // `lvl`: which shell a segment runs in. A `wait` only sees jobs of its OWN shell level (the script itself, or one
  // `( … )` subshell of it); expandSegments prefixes the script id so `bash -c` / `$( )` bodies are levels of their own.
  const lvlStack = [0];
  let lvlN = 0;
  let inner = 0; // unquoted `(` that is not a subshell opener (`$(`, `f(`)
  let bt = false; // inside an unquoted backtick substitution
  const push = (bg, endsList = false) => {
    if (cur.trim()) { out.push({ text: cur.trim(), bg, sub: subDepth > 0, pipe: pipeNext, lvl: lvlStack[lvlStack.length - 1] }); pipeNext = false; }
    cur = '';
    if (bg) {
      for (let k = listStart; k < out.length; k += 1) out[k].bg = true;
      // `{ a; } &`, `for …; do …; done &`, `if …; then …; fi &` — a closer segment pulls back to its
      // matching opener (nesting counted), and everything in between is backgrounded too.
      const last = out[out.length - 1];
      const closer = !big && last && CLOSERS.find((c) => c.close.test(last.text));
      if (closer) {
        let depthN = 0;
        for (let k = out.length - 1; k >= 0 && k >= out.length - CLOSER_SCAN_MAX; k -= 1) {
          const t = out[k].text.replace(/^(?:do|then|else)\s+/, "");
          if (closer.close.test(t)) depthN += 1;
          else if (closer.open.test(t)) depthN -= 1;
          if (depthN === 0) { for (let j = k; j < out.length; j += 1) out[j].bg = true; break; }
        }
      }
    }
    if (endsList) listStart = out.length;
  };
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (q) {
      if (c === '\\' && q === '"' && i + 1 < s.length) { cur += c + s[i + 1]; i += 1; continue; }
      if (c === q) q = null;
      cur += c; continue;
    }
    if (c === '\\' && i + 1 < s.length) { cur += c + s[i + 1]; i += 1; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === '`') { bt = !bt; cur += c; continue; }
    if (c === '(' && cur.trim() === '') { subDepth += 1; lvlN += 1; lvlStack.push(lvlN); continue; } // leading subshell paren
    if (c === '(') { inner += 1; cur += c; continue; }
    if (c === ')') {
      if (inner > 0) inner -= 1;
      else if (subDepth > 0) { push(false); subDepth -= 1; lvlStack.pop(); continue; } // closes a subshell
      cur += c; continue;
    }
    // Inside an unquoted `$( … )` or backtick pair the separators belong to that substitution: keep it one segment (it is
    // re-parsed on its own by expandSegments), otherwise `echo $(rail &)` would be torn apart.
    if ((inner > 0 || bt) && (c === '\n' || c === ';' || c === '|' || c === '&')) { cur += c; continue; }
    if (c === '\n' || c === ';') { push(false, true); continue; }
    if (c === '|' && s[i - 1] === '>') { cur += c; continue; } // `>|` clobber redirect, not a pipe
    if (c === '|') {
      push(false);
      if (s[i + 1] === '|') { i += 1; continue; } // `||`
      if (s[i + 1] === '&') i += 1; // `|&` (pipe stderr too)
      if (out.length) out[out.length - 1].pipe = true; // a pipeline member: `wait | cat` waits for nothing
      pipeNext = true; continue;
    }
    if (c === '&') {
      if (s[i + 1] === '&') { push(false); i += 1; continue; }
      if (s[i - 1] === '>' || s[i + 1] === '>') { cur += c; continue; } // `2>&1`, `&>file`
      push(true, true); continue;
    }
    cur += c;
  }
  push(false, true);
  return out;
}

// Quoted spans become a same-length run of `x` (NOT blanks): a word like `"a"=b` stays one word and
// its quoted part can never look like `=`/glob syntax.
function maskQuotes(seg) {
  return seg.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, (m) => 'x'.repeat(m.length));
}

// Tokens of a segment: { raw, masked } pairs (masking preserves length, so offsets line up).
function tokens(segText) {
  const masked = maskQuotes(segText);
  const out = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(masked)) !== null) out.push({ raw: segText.slice(m.index, m.index + m[0].length), masked: m[0] });
  return out;
}

// Interpreter one-liners whose string argument is run by a shell (python / perl / ruby / node).
const INTERP_C_RE = /^(?:\S*\/)?(?:python[0-9.]*|perl|ruby|node)\s+(?:-[a-zA-Z]*\s+)*-[a-zA-Z]*[ce]\s+(?:'([^']*)'|"((?:\\.|[^"\\])*)")/;
const SHELL_CALL_RE = /(os\.(?:system|popen)|subprocess\.(?:run|call|Popen|check_call|check_output|getoutput)|child_process\.(?:exec|execSync|spawn)|\bsystem)\(\s*(?:'([^']*)'|"((?:\\.|[^"\\])*)")/g;
// List-form launches: python `subprocess.Popen(['rail', ...])`, node `spawn('rail', [args])` / `spawn('bash', ['rail', ...])`.
const LIST_CALL_RE = /(subprocess\.Popen|child_process\.(?:spawn|execFile)|\b(?:spawn|execFile))\(\s*(\[[^\]]*\]|'[^']*'|"[^"]*")(?:\s*,\s*(\[[^\]]*\]))?/g;
// Does the child launched by the call at `body[idx]` outlive the one-liner? One judgment for the list AND the
// string (`shell=True` / `{shell: true}`) forms (BL-0190). Python's Popen child outlives the interpreter unless
// THIS launch is waited on; a node child keeps the event loop alive (the call blocks) unless THIS launch is
// unref'd (`detached` alone is not enough). "This launch" = a `.wait()` / `.communicate()` / `.unref()` chained
// on the call, or one on the variable the call is assigned to (`p = Popen(...)` … `p.wait()`); a wait or unref on
// any other variable says nothing about this child. `with Popen(...) as p:` waits on exit.
const CHILD_ASSIGN_RE = /([\w$]+(?:\s*\.\s*[\w$]+)*)\s*=(?!=)\s*(?:[\w$]+(?:\(\s*['"][\w:./-]*['"]\s*\))?\s*\.\s*)*$/;
function callCloseIndex(body, open) { // index just past the `)` matching body[open] === '(' (quote-aware), or -1
  let depth = 0;
  for (let i = open; i < body.length; i++) {
    const c = body[i];
    if (c === '"' || c === "'") { // skip a quoted string
      for (i += 1; i < body.length && body[i] !== c; i++) if (body[i] === '\\') i += 1;
    } else if (c === '(') depth += 1;
    else if (c === ')' && (depth -= 1) === 0) return i + 1;
  }
  return -1;
}
function childOutlivesCall(call, body, idx) {
  const py = /Popen/.test(call);
  const verbs = py ? 'wait|communicate' : 'unref';
  const before = body.slice(0, idx);
  if (py && /\bwith\s+$/.test(before)) return false;
  const open = body.indexOf('(', idx);
  const close = open < 0 ? -1 : callCloseIndex(body, open);
  if (close >= 0 && new RegExp(`^\\s*\\.\\s*(?:${verbs})\\s*\\(`).test(body.slice(close))) return !py; // chained on the call
  const vm = CHILD_ASSIGN_RE.exec(before);
  // Only the text after THIS call counts, up to the next re-assignment of the same handle (BL-0192): a later
  // `p = Popen(B)` replaces the handle, so a `p.wait()` after it belongs to B, not to this launch.
  const name = vm ? vm[1].replace(/\s+/g, '').replace(/[$.]/g, '\\$&') : '';
  let after = close >= 0 ? body.slice(close) : '';
  const re = vm ? name.replace(/\\\./g, '\\s*\\.\\s*') : '';
  const rebind = vm ? new RegExp(`(?<![\\w$.])${re}\\s*=(?!=)`).exec(after) : null;
  if (rebind) after = after.slice(0, rebind.index);
  const waited = !!vm && new RegExp(`(?<![\\w$.])${re}\\s*\\.\\s*(?:${verbs})\\s*\\(`).test(after);
  return py ? !waited : waited;
}
const LIST_WORD_RE = /'([^']*)'|"([^"]*)"/g;
const listWords = (txt) => { const o = []; let m; LIST_WORD_RE.lastIndex = 0; while ((m = LIST_WORD_RE.exec(txt)) !== null) o.push(m[1] !== undefined ? m[1] : m[2]); return o; };
const SHELL_C_RE = /^(?:\S*\/)?(?:bash|sh|zsh|dash)\s+(?:-[a-zA-Z]*\s+)*-[a-zA-Z]*c\s+(?:'([^']*)'|"((?:\\.|[^"\\])*)")/;

// ---- `$(…)` / backtick scanner -------------------------------------------------------------------
// Paren-DEPTH scan (a regex cannot nest): quotes, backticks, `#` comments and heredoc bodies inside
// the substitution are skipped, so a `(` or `)` in a commit-message heredoc never ends the span.
function skipDq(s, i) { // i is just past an opening `"`; returns the index just past the closing one
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '"') return i + 1;
    if (c === '$' && s[i + 1] === '(') { const e = closeParen(s, i + 2); if (e < 0) return s.length; i = e + 1; continue; }
    i += 1;
  }
  return s.length;
}

// Index of the backtick that closes a backtick substitution whose body starts at i (just past the opening one), or -1.
// A backslash escapes the next character, so an escaped \` inside the body is a nested substitution, not the end. Linear.
function findBacktickClose(text, i) {
  for (let j = i; j < text.length;) {
    if (text[j] === '`') return j;
    j += text[j] === '\\' ? 2 : 1;
  }
  return -1;
}
// Body of a backtick substitution as the shell sees it: `\`` `\$` `\\` lose their backslash (so a nested \`…\` becomes a real one).
const unescapeBacktickBody = (b) => b.replace(/\\([`$\\])/g, '$1');

function closeParen(s, i) { // i is just past `$(`; returns the index of the matching `)` or -1
  let depth = 1;
  const pending = [];
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') { i += 2; continue; }
    if (c === "'") { const j = s.indexOf("'", i + 1); i = j < 0 ? s.length : j + 1; continue; }
    if (c === '"') { i = skipDq(s, i + 1); continue; }
    if (c === '`') { const j = findBacktickClose(s, i + 1); i = j < 0 ? s.length : j + 1; continue; }
    if (c === '#' && (i === 0 || /[\s;&|(]/.test(s[i - 1]))) { const j = s.indexOf('\n', i); i = j < 0 ? s.length : j; continue; }
    if (c === '<' && s[i + 1] === '<' && s[i + 2] !== '<' && s[i + 2] !== '(') {
      const hm = /^<<(-?)[ \t]*(?:'([^']*)'|"([^"]*)"|\\?([A-Za-z_]\w*))/.exec(s.slice(i, i + 200));
      if (hm) { pending.push({ tag: hm[2] !== undefined ? hm[2] : (hm[3] !== undefined ? hm[3] : hm[4]), dash: hm[1] === '-' }); i += hm[0].length; continue; }
      i += 2; continue;
    }
    if (c === '\n' && pending.length) {
      i += 1;
      for (const h of pending) {
        while (i < s.length) {
          let e = s.indexOf('\n', i);
          if (e < 0) e = s.length;
          const line = s.slice(i, e);
          i = Math.min(e + 1, s.length);
          if ((h.dash ? line.replace(/^\t+/, '') : line) === h.tag) break;
        }
      }
      pending.length = 0;
      continue;
    }
    if (c === '(') depth += 1;
    else if (c === ')') { depth -= 1; if (depth === 0) return i; }
    i += 1;
  }
  return -1;
}

// Bodies of every executed `$(…)` and `` `…` `` in a segment's text (single-quoted spans are data;
// inside double quotes only `'` is literal). Nested substitutions come back through the recursion.
function findSubstitutions(text) {
  const out = [];
  let inD = false;
  for (let i = 0; i < text.length;) {
    const c = text[i];
    if (c === '\\') { i += 2; continue; }
    if (!inD && c === "'") { const j = text.indexOf("'", i + 1); i = j < 0 ? text.length : j + 1; continue; }
    if (c === '"') { inD = !inD; i += 1; continue; }
    if (c === '`') {
      let j = findBacktickClose(text, i + 1);
      if (j < 0) j = text.length;
      out.push(unescapeBacktickBody(text.slice(i + 1, j)));
      i = j + 1; continue;
    }
    if (c === '$' && text[i + 1] === '(' && text[i + 2] !== '(') {
      const e = closeParen(text, i + 2);
      out.push(text.slice(i + 2, e < 0 ? text.length : e));
      i = e < 0 ? text.length : e + 1; continue;
    }
    i += 1;
  }
  return out;
}

// Flatten `bash -c '…'` bodies and `$(…)` / backtick bodies into extra segments (they are executed).
// One-entry cache: rules 1 and 2 expand the very same executable text in the same hook call (read-only).
let lastExpanded = { text: null, out: null };
let scriptSeq = 0; // one id per parsed script text, so segments of different scripts never share a wait level
const MAX_EXPAND_DEPTH = 5; // `$($($(rail &)))` is 3 deep; deeper nesting is not worth the cost, and stays silent
function expandSegments(text, depth = 0) {
  if (depth === 0 && lastExpanded.text === text) return lastExpanded.out;
  const out = expandSegmentsUncached(text, depth);
  if (depth === 0) lastExpanded = { text, out };
  return out;
}
function expandSegmentsUncached(text, depth) {
  const all = [];
  const sid = (scriptSeq += 1);
  for (const seg of segments(text)) {
    seg.lvl = `${sid}:${seg.lvl}`;
    all.push(seg);
    if (depth >= MAX_EXPAND_DEPTH) continue;
    const m = SHELL_C_RE.exec(seg.text);
    if (m) all.push(...expandSegments(m[1] !== undefined ? m[1] : m[2], depth + 1).map((x) => ({ ...x, bg: x.bg || seg.bg, sh: true, sub: true })));
    // `python3 -c "import os; os.system('rail &')"`: the string handed to a shell-running call is a script too.
    const im = INTERP_C_RE.exec(seg.text);
    if (im && seg.text.length <= SEG_MAX_TEXT) {
      const body = im[1] !== undefined ? im[1] : im[2];
      SHELL_CALL_RE.lastIndex = 0;
      let cm;
      while ((cm = SHELL_CALL_RE.exec(body)) !== null) {
        const script = cm[2] !== undefined ? cm[2] : cm[3];
        // Popen / spawn return at once, so the child outlives the call even with no `&` in the string —
        // unless the body waits for it (python) or never unref's it (node): same rule as the list form.
        const asyncCall = /Popen|spawn/.test(cm[1]) && childOutlivesCall(cm[1], body, cm.index);
        all.push(...expandSegments(script, depth + 1).map((x) => ({ ...x, bg: x.bg || seg.bg || asyncCall, sh: true, sub: true })));
      }
    }
    if (im && seg.text.length <= SEG_MAX_TEXT) {
      const body = (im[1] !== undefined ? im[1] : im[2]).replace(/\\(["'])/g, '$1');
      LIST_CALL_RE.lastIndex = 0;
      let lm;
      while ((lm = LIST_CALL_RE.exec(body)) !== null) {
        if (!childOutlivesCall(lm[1], body, lm.index)) continue;
        // A lone quoted string (`shell=True` / `{shell: true}`) is a whole script, not one command word.
        if (lm[3] === undefined && lm[2][0] !== '[') {
          all.push(...expandSegments(lm[2].slice(1, -1), depth + 1).map((x) => ({ ...x, bg: true, sh: true, sub: true })));
          continue;
        }
        const words = lm[3] !== undefined ? [...listWords(lm[2]), ...listWords(lm[3])] : listWords(lm[2]);
        if (!words.length) continue;
        all.push(...expandSegments(words.map((w) => (/^[\w./:=@%+,-]+$/.test(w) ? w : `'${w.replace(/'/g, '')}'`)).join(' '), depth + 1)
          .map((x) => ({ ...x, bg: true, sh: true, sub: true })));
      }
    }
    for (const sub of (seg.text.length > SEG_MAX_TEXT ? [] : findSubstitutions(seg.text))) {
      // The body of `$(…)` / backticks is a fresh script: strip ITS heredoc bodies and comments too
      // (`git commit -m "$(cat <<'EOF' … EOF)"` — the outer lexer treats the heredoc as quoted data).
      all.push(...expandSegments(executableText(sub), depth + 1).map((x) => ({ ...x, sh: x.sh || seg.sh, sub: true })));
    }
  }
  return all;
}

const unq = (w) => w.replace(/^['"]|['"]$/g, '');

// Command position of a segment: strips VAR=val assignments and launcher/interpreter prefixes (with
// their flags). Returns { head, detach, rest }: head is the first real command word, detach is true when
// `setsid -f` / `--fork` (a real background fork) was stripped. A bare `nohup X` or `setsid X` runs in the
// FOREGROUND (the tool call waits for it) and is not a detach; only a trailing `&` or `setsid -f` is.
function commandPosition(segText) {
  const w = tokens(segText).map((t) => unq(t.raw));
  let detach = false;
  let armStart = false;
  let bg = false; // `coproc`: always asynchronous, but a plain background job (`wait` does see it)
  let i = 0;
  while (i < w.length) {
    const a = w[i];
    if (/^[A-Za-z_]\w*=/.test(a) || KEYWORDS.has(a)) { i += 1; continue; }
    if (a === 'coproc') {
      bg = true; i += 1;
      if (/^[A-Za-z_]\w*$/.test(w[i] || '') && w[i + 1] === '{') i += 1; // `coproc NAME { … }`
      continue;
    }
    // `case $x in a) CMD` and later arms `b) CMD`: skip the `case … in` head and the arm label.
    if (a === 'case') {
      const k = w.indexOf('in', i + 1);
      if (k < 0) return { head: null, detach, bg, rest: [] };
      i = k + 1; armStart = true; continue;
    }
    // A label right after `case … in` is always a label (even `dispatch-review.sh)`); at the start of a later
    // arm's segment it is one unless it is a bare rail path.
    if (/^\(?[^()]*\)$/.test(a) && (armStart || (i === 0 && !isRail(a.replace(/\)+$/, ''))))) { i += 1; armStart = false; continue; }
    armStart = false;
    const base = a.replace(/^.*\//, '');
    if (PREFIX_CMDS.has(base)) {
      i += 1;
      let positional = POSITIONAL[base] || 0;
      while (i < w.length && /^-/.test(w[i])) {
        if (base === 'taskset' && (w[i] === '-c' || w[i] === '--cpu-list')) positional = 0;
        if (VALUE_FLAGS[base] && VALUE_FLAGS[base].has(w[i])) i += 1;
        if (i >= w.length) break;
        if (base === 'setsid' && (w[i] === '-f' || w[i] === '--fork')) detach = true;
        if (/^-[a-zA-Z]*c$/.test(w[i]) && ['bash', 'sh', 'zsh', 'dash'].includes(base)) return { head: null, detach, bg, rest: [] };
        i += 1;
      }
      i = Math.min(w.length, i + positional);
      if (base === 'timeout' && i < w.length && /^\d/.test(w[i])) i += 1; // the duration
      continue;
    }
    return { head: a.replace(/\)+$/, ''), detach, bg, rest: w.slice(i + 1) };
  }
  return { head: null, detach, bg, rest: [] };
}

function isRail(head) {
  // `dispatch-<rail>.test.sh` never matches: the pattern needs the exact `<name>.sh|js` tail.
  return !!head && RAIL_PATH_RE.test(head);
}

// Only a bare `wait` or `wait $!` / `wait "$!"` is guaranteed to wait for the rail just launched
// (`wait 999` waits for pid 999; redirections do not change that).
function waitsForAll(rest, pidVar = null) {
  const args = [];
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (/^(?:\d*(?:>\||[<>]{1,2}&?)|&>>?)$/.test(a)) { i += 1; continue; } // bare operator (`>|` too): skip its target word too
    if (/^(?:\d*[<>]|&>)/.test(a)) continue; // operator with the target attached
    args.push(a);
  }
  if (args.length === 0) return true;
  if (args.some((a) => a.startsWith('-'))) return false; // `wait -n` returns after ONE job
  // `wait $P1 $P2` waits for every listed job, so it is enough that one of them is THIS launch's pid:
  // `$!` itself, or `pid=$!` taken right after this launch.
  const mine = pidVar ? new RegExp(`^"?\\$(?:${pidVar}|\\{${pidVar}\\})"?$`) : null;
  return args.some((a) => /^"?\$!"?$/.test(a) || (mine && mine.test(a)));
}

// `pid=$!` straight after the launch at pos[idx] (same shell level, no other background launch in between).
function bangVarAfter(pos, idx) {
  const lvl = pos[idx].seg.lvl;
  for (let k = idx + 1; k < pos.length; k += 1) {
    const q = pos[k];
    if (q.seg.lvl !== lvl) continue;
    const m = /^([A-Za-z_]\w*)=("?)\$!\2$/.exec(q.seg.text);
    if (m) return { name: m[1], at: k };
    if (q.seg.bg || q.detach || q.bg) return null; // `$!` would name a later job
  }
  return null;
}

// Functions whose body runs a rail: name -> rail path. `f(){ rail x; }; f &` backgrounds the rail through f.
const FUNC_DEF_RE = /^(?:function\s+([A-Za-z_][\w.:-]*)(?:\s*\(\s*\))?|([A-Za-z_][\w.:-]*)\s*\(\s*\))\s*\{\s*(.*)$/;
const PAREN_FUNC_DEF_RE = /^(?:function\s+([A-Za-z_][\w.:-]*)(?:\s*\(\s*\))?|([A-Za-z_][\w.:-]*)\s*\(\s*\))\s*\(([\s\S]*)$/;
function functionRails(pos) {
  const map = new Map();
  let open = null;
  for (const p of pos) {
    const t = p.seg.text;
    const m = FUNC_DEF_RE.exec(t);
    if (!open) {
      // `f() ( rail x )`: the body is a subshell; the whole body sits in this one segment text.
      const pm = PAREN_FUNC_DEF_RE.exec(t);
      if (pm) {
        const railIn = pm[3].replace(/\)\s*$/, '').split(/[;\n&|]+/).map((x) => commandPosition(x).head).find((h) => isRail(h));
        if (railIn) map.set(pm[1] || pm[2], railIn);
        continue;
      }
      if (!m) continue;
      open = { name: m[1] || m[2], depth: 1, rail: null };
      const h = commandPosition(m[3]).head;
      if (isRail(h)) open.rail = h;
      continue;
    }
    if (m || /^\{(?:\s|$)/.test(t)) open.depth += 1;
    if (!open.rail && isRail(p.head)) open.rail = p.head;
    if (/^\}(?:\s|$)/.test(t)) {
      open.depth -= 1;
      if (open.depth === 0) { if (open.rail) map.set(open.name, open.rail); open = null; }
    }
  }
  return map;
}

// Does this detached rail launch carry every ledger arg its kind needs (stage rails: --ledger/--run-id/--stage,
// fixed rails: --ledger/--run-id, each followed by a real value word)? Only then does the rail write the .exit file.
// DISPATCH_DETACH=0 (detach switched off) keeps the rail inline: no .exit file, so it does not qualify.
function writesExitFile(p) {
  const m = /dispatch-([a-z-]+)\.(?:sh|js)$/.exec(p.head);
  const kind = m ? LEDGER_RAILS[m[1]] : undefined;
  if (!kind) return false;
  if (/(?:^|\s)DISPATCH_DETACH=["']?(?:0|false|no|off)["']?(?:\s|$)/i.test(p.seg.text)) return false;
  // foreman --resume re-enters a run inline (dispatch-foreman.sh detaches only when RESUME is 0): no .exit file.
  if (kind === 'fixed' && p.rest.includes('--resume')) return false;
  const have = (flag) => p.rest.some((w, i) => w === flag && i + 1 < p.rest.length
    && p.rest[i + 1] !== '' && !p.rest[i + 1].startsWith('-') && !/^\d*[<>&|]/.test(p.rest[i + 1]));
  return have('--ledger') && have('--run-id') && (kind === 'fixed' || have('--stage'));
}

// Rule 1. Returns { rule, why } or null.
function detectDetachNoWake(cmd) {
  const text = executableText(typeof cmd === 'string' ? cmd : '');
  const segs = expandSegments(text);
  const pos = segs.map((s) => ({ seg: s, ...commandPosition(s.text) }));
  const funcRail = functionRails(pos);
  // Wake-up only counts when the waiter script is itself a command word that runs AFTER the launch and in the
  // foreground (a waiter before the launch, or itself backgrounded, waits for nothing), or — for a plain trailing
  // `&` — a later `wait` in the SAME shell level (the script itself, one `( … )` subshell, or one `bash -c` / `$( )`
  // body: `bash -c 'rail & wait'` is fine). A `wait` cannot see a job that was `setsid -f` forked or that lives in
  // another shell level.
  for (let idx = 0; idx < pos.length; idx += 1) {
    const p = pos[idx];
    if (!p.head || !(p.detach || p.bg || p.seg.bg)) continue;
    const railHead = isRail(p.head) ? p.head : (funcRail.get(p.head) || null);
    if (!railHead) continue;
    if (pos.some((q, k) => k > idx && q.head && WAKE_SCRIPT_RE.test(q.head) && !q.seg.bg)) continue;
    // A `setsid -f` rail launched with EVERY ledger arg its kind needs lands `<ledger>.results/<id>.<stage>.exit`;
    // the NEXT call (an until-loop / Monitor on that file) is the wake-up, so this call needs no waiter.
    if (p.detach && railHead === p.head && writesExitFile(p)) continue;
    const shape = p.detach ? 'setsid-f' : 'amp';
    const bv = shape === 'amp' ? bangVarAfter(pos, idx) : null;
    if (shape === 'amp'
      && pos.some((q, k) => k > idx && q.head === 'wait' && q.seg.lvl === p.seg.lvl && !q.seg.bg && !q.seg.pipe
        && waitsForAll(q.rest, bv && k > bv.at ? bv.name : null))) continue;
    const rm = /dispatch-([a-z-]+)\.(?:sh|js)$/.exec(railHead);
    return {
      rule: 'detach-no-wake',
      shape,
      rail: rm ? rm[1] : null,
      why: 'a dispatch rail entrypoint is launched in the background (trailing & / setsid -f) with nothing '
        + 'that can wake the session when it finishes',
      advice: launchAdvice(shape, rm ? rm[1] : null, !!p.seg.sub),
    };
  }
  return null;
}

// Rails that honour `--ledger/--run-id[/--stage]` and land `<ledger>.results/<run>.<stage>.exit`
// (dispatch-detach.sh via review/author/foreman, in-process in hetero). The other rails never write it.
const LEDGER_RAILS = { review: 'stage', author: 'stage', hetero: 'stage', foreman: 'fixed' };

// Second long-job recipe (the harness memory guard often kills run_in_background jobs): detach the rail with every
// ledger arg, then watch the .exit file from a separate call. The sleep runs in the shell, so it costs no tokens.
const exitWatch = (key) => 'Or, when the harness may kill long background jobs: launch `setsid -f <rail> … ` with all its '
  + 'ledger args as its OWN call (allowed: the .exit file is the wake-up source), then in a SECOND call use '
  + `run_in_background: true with \`timeout <seconds> bash -c 'until [ -f <ledger>.results/${key}.exit ]; do sleep 30; done'\` `
  + '(a depth-0 session may use the Monitor tool on that file instead; a subagent cannot, so it uses the until loop) — '
  + 'one completion notification, no tokens spent while waiting. ALWAYS set the timeout: any failed pre-check, a killed '
  + 'supervisor, foreman --resume and an exit 2 after the hetero detach write no .exit file, so an unbounded loop hangs '
  + 'forever. Use a fresh run-id per launch (or `rm -f` the .exit first) so a stale file cannot end the wait early; the '
  + 'stage name must not contain `.`. Do NOT grep a log '
  + 'for a string such as `rc=` as the completion signal: test output can print the same string and be mistaken for '
  + 'completion. Do not poll with short-interval ScheduleWakeup.';

// Only options that literally work for this (shape, rail) pair — see the recipe tests.
function launchAdvice(shape, rail, nested = false) {
  const parts = ["Short job (any rail): run it in the foreground with the Bash tool's run_in_background: true "
    + '(no nohup / setsid / &) — one completion notification.'];
  if (shape === 'amp' && nested) {
    parts.push('Or move the launch out of the `( )` / `$( )` / `bash -c` to the outermost shell, keep its `&` and put '
      + '`wait` after it (a `wait` outside cannot see a job started inside).');
  } else if (shape === 'amp') {
    parts.push('Or keep the `&` and put `wait` after it in the same command (the call blocks until the rail exits, '
      + 'bounded by the Bash tool timeout).');
  } else {
    parts.push('A bare `wait` does not wait for a `setsid -f` job.');
  }
  const kind = LEDGER_RAILS[rail];
  if (kind === 'stage') {
    parts.push('Long job: pass `--ledger <path> --run-id <id> --stage <name>` (all three — without them no .exit file '
      + 'is written) and chain the waiter with `&&` in the SAME command: `setsid -f <rail> … && node '
      + 'scripts/wait-dispatch-results.js --ledger <path> --expect <id>.<name> --timeout <seconds>` (bad rail args '
      + 'exit before any .exit file exists, so set --timeout to the longest wait you accept) — run that whole '
      + "command with `run_in_background: true` (it can outlast the Bash tool's 600 s foreground limit). "
      + exitWatch('<id>.<name>'));
  } else if (kind === 'fixed') {
    parts.push('Long job: pass `--ledger <path> --run-id <id>` (the stage is fixed) and chain the waiter with `&&` in '
      + 'the SAME command: `setsid -f <rail> … && node scripts/wait-dispatch-results.js --ledger <path> --expect '
      + '<id>.foreman --timeout <seconds>` (bad rail args exit before any .exit file exists, so set --timeout to '
      + 'the longest wait you accept) — run that whole command with `run_in_background: true` (it can outlast '
      + "the Bash tool's 600 s foreground limit). "
      + exitWatch('<id>.foreman'));
  } else {
    parts.push(`dispatch-${rail || '…'} never writes the .exit file wait-dispatch-results.js waits for, so only the `
      + 'option(s) above work for it.');
  }
  return parts.join(' ');
}

const PGREP_VALUE_FLAGS = new Set(['u', 'U', 'g', 'G', 'P', 's', 't', 'F', 'd', 'r', 'O']);
const PGREP_LONG_VALUE = new Set(['--euid', '--uid', '--group', '--pgroup', '--parent', '--session', '--terminal', '--pidfile', '--signal',
  '--delimiter', '--runstates', '--older', '--ns', '--nslist', '--env']);
const POSIX_CLASS = { alpha: 'a-zA-Z', digit: '0-9', alnum: 'a-zA-Z0-9', upper: 'A-Z', lower: 'a-z', space: '\\s', blank: ' \\t' };
// APPROXIMATION of what the Bash tool's own shell shows in /proc/<pid>/cmdline. Observed real shape:
// `/usr/bin/zsh -c source …snapshot… && eval '<call>' < /dev/null && pwd -P >| …` — the shell path varies by host and the call
// sits inside single quotes (each `'` becomes `'"'"'`). The load-bearing premise is only that the call text appears verbatim
// in the cmdline; the prefix just keeps `^`-anchored patterns from matching the call's first word.
const SELF_CMDLINE_PREFIX = "/usr/bin/zsh -c source /tmp/shell-snapshot.sh && eval '";
const PATTERN_MAX_LEN = 300; // longer patterns are not judged (null)
// Nested quantifiers / quantified alternation can backtrack exponentially in a JS RegExp: never run those.
// Scan the pattern: a `)` followed by `* + {` whose matching group (by depth, skipping `\x` escapes and `[...]` classes)
// holds a quantifier or `|` is catastrophic-prone, however many parens wrap it.
function scanRegex(pat, onOpen, onClose) {
  for (let i = 0; i < pat.length; i += 1) {
    const c = pat[i];
    if (c === '\\') { i += 1; continue; }
    if (c === '[') { // character class: `]` right after `[` / `[^` is literal
      let j = i + 1;
      if (pat[j] === '^') j += 1;
      if (pat[j] === ']') j += 1;
      while (j < pat.length && pat[j] !== ']') j += pat[j] === '\\' ? 2 : 1;
      i = j; continue;
    }
    if (c === '(') onOpen(i);
    else if (c === ')') onClose(i);
  }
}
function hasQuantOrAlt(s) {
  let found = false;
  let depthFree = s.replace(/\\./g, '').replace(/\[(?:\^?\]|\^)?[^\]]*\]/g, '');
  if (/[*+{|]/.test(depthFree)) found = true;
  return found;
}
function redosShaped(pat) {
  const stack = [];
  let bad = false;
  scanRegex(pat, (i) => stack.push(i), (i) => {
    const start = stack.pop();
    if (start === undefined || bad) return;
    if (/[*+{]/.test(pat[i + 1] || '') && hasQuantOrAlt(pat.slice(start + 1, i))) bad = true;
  });
  return bad;
}

// Shell word -> the string the command receives (quotes removed, `\x` unescaped). Variables stay as `$name`.
function dequote(w) {
  let out = '';
  for (let i = 0; i < w.length; i += 1) {
    const c = w[i];
    if (c === "'") { const j = w.indexOf("'", i + 1); const e = j < 0 ? w.length : j; out += w.slice(i + 1, e); i = e; continue; }
    if (c === '"') {
      i += 1;
      for (; i < w.length && w[i] !== '"'; i += 1) {
        if (w[i] === '\\' && /["\\$`]/.test(w[i + 1] || '')) i += 1;
        out += w[i];
      }
      continue;
    }
    if (c === '\\' && i + 1 < w.length) { i += 1; out += w[i]; continue; }
    out += c;
  }
  return out;
}

// Plain `NAME=literal` assignment segments of this call (no `$`, backtick or glob in the value).
function literalAssignments(segs) {
  const vars = new Map();
  for (const sg of segs) {
    const m = /^(?:export\s+)?([A-Za-z_]\w*)=(\S*)$/.exec(sg.text);
    if (!m) continue;
    const v = dequote(m[2]);
    if (!/[$`]/.test(v)) vars.set(m[1], v);
  }
  return vars;
}

const SHELL_RE = '(?:\\S*\\/)?(?:bash|sh|zsh|dash)';
const SAME_FILE = (a, b) => a.replace(/^\.\//, '') === b.replace(/^\.\//, '');

// Does some segment of the call execute `file` (`./f`, `bash f`, `source f`, `. f`)?
function executesFile(segs, file) {
  return segs.some((sg) => {
    const w = tokens(sg.text).map((t) => dequote(t.raw));
    const k = w.findIndex((x) => !/^[A-Za-z_]\w*=/.test(x));
    if (k < 0) return false;
    if (SAME_FILE(w[k], file)) return true;
    const h = w[k].replace(/^.*\//, '');
    if (['bash', 'sh', 'zsh', 'dash'].includes(h) || w[k] === 'source' || w[k] === '.') {
      return w.slice(k + 1).some((x) => !x.startsWith('-') && SAME_FILE(x, file));
    }
    return false;
  });
}

// Heredoc bodies the call RUNS: fed straight to a shell (`bash <<EOF`, `cat <<EOF | bash`), or written to a file
// (`cat > f <<EOF`) that another segment then executes. A heredoc that is only data (never run) is not returned.
function runHeredocBodies(raw, segs) {
  const out = [];
  const lines = String(raw).split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const m = /<<(-?)[ \t]*(?:'([^']+)'|"([^"]+)"|\\?([A-Za-z_]\w*))/.exec(lines[i]);
    if (!m || lines[i][m.index + 2] === '<') continue;
    const tag = m[2] || m[3] || m[4];
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j += 1) { if ((m[1] ? lines[j].replace(/^\t+/, '') : lines[j]) === tag) break; body.push(lines[j]); }
    const intro = lines[i];
    let runs = new RegExp(`^\\s*(?:(?:sudo|env|time|exec|nohup|setsid)\\s+)*${SHELL_RE}\\b(?![^<]*\\s-c\\b)[^<|;&]*<<`).test(intro)
      || new RegExp(`\\|\\s*(?:(?:sudo|env|exec)\\s+)*${SHELL_RE}\\b`).test(intro.slice(m.index));
    if (!runs) {
      const fm = /(?:>>?|\btee(?:\s+-a)?)\s*(?:"([^"]+)"|'([^']+)'|([^\s<>|;&]+))/.exec(intro);
      const file = fm && (fm[1] || fm[2] || fm[3]);
      runs = !!file && executesFile(segs, file);
    }
    if (runs) out.push(body.join('\n'));
    i = j;
  }
  return out;
}

// Would `pgrep -f <pattern>` match this very call's shell? Test the pattern (ERE ~ JS RegExp) against the text the
// shell's cmdline carries. null = cannot tell (unresolved variable, unparsable regex): the caller falls back.
function patternMatchesSelf(pattern, raw, vars, flags) {
  let pat = pattern;
  if (/\$[A-Za-z_{]/.test(pat)) {
    pat = pat.replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g, (all, a, b) => (vars.has(a || b) ? vars.get(a || b) : all));
    if (/\$[A-Za-z_{(]/.test(pat)) return null; // an unknown variable / substitution: unknowable
  }
  if (/\$\(|`/.test(pat)) return null;
  if (pat.length > PATTERN_MAX_LEN || redosShaped(pat)) return null; // unjudgeable: ReDoS guard
  pat = pat.replace(/\[:([a-z]+):\]/g, (all, n) => POSIX_CLASS[n] || all);
  if (flags.exact) pat = `^(?:${pat})$`;
  try { return new RegExp(pat, flags.icase ? 'i' : '').test(SELF_CMDLINE_PREFIX + raw.replace(/'/g, `'"'"'`)); } catch { return null; }
}

// Rule 2. Returns { rule, why, pattern } or null.
// A pattern is a self-match when it really matches the call's own command line (so `[fF]oo`, `^x`, `x\.py` are
// fine and `P=foo; pgrep -f "$P"` is not); the shapes scanned include heredoc scripts the call runs, `eval` /
// `watch` bodies, `\pkill` and `xargs pkill`.
function detectPkillSelfMatch(cmd) {
  const raw = typeof cmd === 'string' ? cmd : '';
  const top = expandSegments(executableText(raw));
  const vars = literalAssignments(top);
  const scripts = [top];
  for (const body of runHeredocBodies(raw, top)) scripts.push(expandSegments(executableText(body)));
  for (let si = 0; si < scripts.length && si < 8; si += 1) {
    for (const seg of scripts[si]) {
      const { head, rest } = commandPosition(seg.text);
      if (!head) continue;
      const name = dequote(head).replace(/^.*\//, '');
      if (name === 'eval' || name === 'watch') {
        // the words after `eval` / `watch [-n N …]` are a script
        let k = 0;
        if (name === 'watch') while (k < rest.length && /^-/.test(rest[k])) k += (rest[k] === '-n' || rest[k] === '--interval') ? 2 : 1;
        const bodyText = dequote(rest.slice(k).join(' '));
        if (bodyText) scripts.push(expandSegments(executableText(bodyText)));
        continue;
      }
      if (name !== 'pkill' && name !== 'pgrep') continue;
      const flags = { icase: false, exact: false };
      let full = false;
      for (const a of rest) {
        if (a === '--full') full = true;
        else if (a === '--ignore-case') flags.icase = true;
        else if (a === '--exact') flags.exact = true;
        else if (/^-[a-zA-Z]+$/.test(a) && !/^-[A-Z]{2,}$/.test(a)) {
          if (a.includes('f')) full = true;
          if (a.includes('i')) flags.icase = true;
          if (a.includes('x')) flags.exact = true;
        }
      }
      if (!full) continue;
      // The pattern is the first non-option word after the command; recover quoted multi-word patterns.
      // Options that take a value (`-u me`, `-P 1`, `-d ,`, `--uid me`) skip that value, so it is never the pattern.
      const toks = tokens(seg.text).map((t) => t.raw);
      const hi = toks.findIndex((t) => dequote(t).replace(/^.*\//, '') === name);
      let word;
      for (let i = hi + 1; i < toks.length; i++) {
        const t = toks[i];
        if (/^--[a-z-]+$/.test(t)) { if (PGREP_LONG_VALUE.has(t)) i += 1; continue; }
        if (/^-[a-zA-Z0-9]+$/.test(t)) {
          const signal = /^-[A-Z]{2,}[0-9]*$/.test(t) || /^-[0-9]/.test(t); // `-HUP`, `-9`: a signal, takes no value
          if (!signal && PGREP_VALUE_FLAGS.has(t[t.length - 1])) i += 1;
          continue;
        }
        if (t.startsWith('-')) continue;
        word = t; break;
      }
      if (word === undefined) continue;
      const pattern = dequote(word);
      const hit = patternMatchesSelf(pattern, raw, vars, flags);
      if (hit === false) continue;
      // Unjudgeable (unknown $VAR, unparsable regex): keep the old stance — a `[x]` bracket or a `$` means "assume fine".
      if (hit === null && (/\[[^\]\s]\]/.test(pattern) || /\$/.test(pattern))) continue;
      return {
        rule: 'pkill-self-match',
        pattern,
        why: `${name} -f pattern "${pattern}" also matches this Bash call's own command line (the shell running it), `
          + 'so it can match and kill its own shell. Instead: read the PID from a pidfile (`kill "$(cat x.pid)"`), '
          + 'use the PID directly, or assemble the pattern in a variable from pieces so the whole literal never appears '
          + 'in the same command (`a=fo; b=o; pgrep -f "$a$b"`; an unresolvable `$VAR` pattern is not flagged), or bracket one '
          + "character (`'[f]oo'`)",
      };
    }
  }
  return null;
}

const GLOB_MAX_CHECKS = 3;
const GLOB_BUDGET_MS = 50; // HARD total: directory reads below poll the clock and give up (silently) past it
const ZSH_MAX_TEXT = 8192; // longer executable text: the zsh regexes can go quadratic — skip rule 3 entirely
const ZSH_MAX_TOKEN = 512;

// Does a single-level glob (`dir/*.ext`, `*.x`) match any entry? true / false, or null = cannot tell in
// time (deadline hit, extended-glob syntax, unreadable dir). Streams the directory with opendirSync and
// stops at the first match or the deadline — never a full listing of a huge directory.
function globHasMatch(raw, cwd, deadline) {
  const parts = raw.split('/');
  const gi = parts.findIndex((x) => /[*?[]/.test(x));
  if (gi !== parts.length - 1) return null; // a non-glob suffix after the glob part: not judged
  const g = parts[gi];
  if (/[(|<>~^#]/.test(g)) return null;
  let re = '';
  for (let i = 0; i < g.length; i += 1) {
    const c = g[i];
    if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const e = g.indexOf(']', i + 2);
      if (e < 0) { re += '\\['; continue; }
      let cls = g.slice(i + 1, e);
      if (cls[0] === '!') cls = `^${cls.slice(1)}`;
      re += `[${cls.replace(/\\/g, '\\\\')}]`;
      i = e;
    } else re += c.replace(/[.+^${}()|\\\]]/g, '\\$&');
  }
  let rx;
  try { rx = new RegExp(`^${re}$`); } catch { return null; }
  const dirPath = path.resolve(cwd, parts.slice(0, gi).join('/') || (raw.startsWith('/') ? '/' : '.'));
  const dotOk = g.startsWith('.');
  let d;
  try { d = fs.opendirSync(dirPath); } catch (e) { return e && e.code === 'ENOENT' ? false : null; }
  try {
    for (let n = 0; ; n += 1) {
      if ((n & 63) === 0 && Date.now() > deadline) return null;
      const ent = d.readSync();
      if (!ent) return false;
      if (!dotOk && ent.name.startsWith('.')) continue;
      if (rx.test(ent.name)) return true;
    }
  } catch { return null; } finally { try { d.closeSync(); } catch { /* closed */ } }
}

// Rule 3 (zsh only). Returns { rule, why, token } or null.
function detectZshExpansion(cmd, cwd) {
  let text = executableText(typeof cmd === 'string' ? cmd : '');
  if (text.length > ZSH_MAX_TEXT) return null; // before any regex: crafted `[a[a[a…` would be quadratic
  text = text.replace(/\[\[[\s\S]*?\]\]/g, ' ').replace(/\$?\(\([\s\S]*?\)\)/g, ' ');
  const allSegs = expandSegments(text);
  const t0 = Date.now();
  let globChecks = 0;
  // A `cd`/`pushd` anywhere means globs are relative to a directory we do not know.
  const hasCd = allSegs.some((sg) => { const h = commandPosition(sg.text).head; return h === 'cd' || h === 'pushd'; });
  for (const seg of allSegs) {
    if (seg.sh) continue; // `bash -c '…'` bodies run in bash, not zsh
    for (const { raw, masked } of tokens(seg.text)) {
      // zsh `=word` is command-path lookup and aborts the line (`=x` and `==` both report "= not found"
      // / "x not found"); only a lone `=` (e.g. `[ a = b ]`) is harmless.
      if (/^=./.test(masked)) {
        return {
          rule: 'zsh-expansion', token: raw,
          why: `zsh expands a word starting with "=" (${raw}) as a command-path lookup and aborts the line `
            + `("${raw.replace(/^=+/, '')} not found") — quote it ('${raw}') or use bash -c`,
        };
      }
      // Drop parameter forms (`$?`, `$*`, `${x:-*}`) and command substitutions before looking for globs.
      const bare = masked.replace(/\$\{[^}]*\}|\$\([^)]*\)?|\$[?*@#!$-]|`[^`]*`?/g, '');
      if (!/[*?]|\[[^\]]+\]/.test(bare)) continue;
      if (/\)$/.test(masked)) continue; // `case x in *)` branch label, not a word to expand
      if (/^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(masked)) continue; // `x=*.zzq` assignment is not globbed
      // Stay silent when we cannot judge: backslash/quote/brace in the word, `**`, or the lookup runs out of time.
      if (/[\\'"{$]/.test(raw) || raw.includes('**') || bare !== masked) continue;
      if (hasCd || /^~/.test(raw)) continue; // cannot resolve / too broad: stay silent
      // Cost bounds (worst case was 5 s for `/*/*/*/*/*/*/*`): only single-level globs are resolved, at most
      // GLOB_MAX_CHECKS per command and GLOB_BUDGET_MS in total; past that we stay silent.
      if (raw.split('/').filter((part) => /[*?[]/.test(part)).length > 1) continue;
      if (!cwd || raw.length > ZSH_MAX_TOKEN) continue;
      if (globChecks >= GLOB_MAX_CHECKS || Date.now() - t0 > GLOB_BUDGET_MS) continue;
      globChecks += 1;
      if (globHasMatch(raw, cwd, t0 + GLOB_BUDGET_MS) !== false) continue; // matched, or could not tell
      return {
        rule: 'zsh-expansion', token: raw,
        why: `unquoted glob ${raw} matches nothing: zsh aborts the WHOLE line with "no matches found" `
          + '(bash passes it through literally) — quote it, or setopt nonomatch',
      };
    }
  }
  return null;
}

// Rule 4 (BL-0300). Returns { rule, why } or null.
// Prefixes: reserved words (`!`, `if`, `time [-p] [--]`) are followed by an alias-expanded command word, so they are skipped;
// commands/builtins (`command`, `builtin`, `exec`, `env`, `nice`, `sudo`, `nohup`, `xargs`) take `ls` as an argument, never expanded, so they pass.
// An interactive shell may alias/wrap `ls` (eza, a function); the Bash tool sources that setup, and the
// wrapper hangs the call. Alias expansion happens on the first word of a command only, so a hit is a segment
// whose first real word (after VAR=val, `time`, and flow keywords) is literally the unquoted word `ls`.
// `command ls`, `\\ls`, `/bin/ls`, `'ls'` and `env ls` are not that word and pass. Heredoc bodies and
// quoted text never reach here (executableText); `bash -c` bodies are non-interactive and skipped.
// Rewrite `<(` / `>(` (process substitution) to `$(` outside quotes only: single quotes, double quotes and a
// backslash keep them literal. A `$(` inside double quotes runs, so its body is rewritten recursively. Linear.
function rewriteProcSubst(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '\\') { out += text.slice(i, i + 2); i += 2; continue; }
    if (c === "'") { const j = text.indexOf("'", i + 1); const e = j < 0 ? n : j + 1; out += text.slice(i, e); i = e; continue; }
    if (c === '"') {
      let j = i + 1;
      out += '"';
      while (j < n && text[j] !== '"') {
        if (text[j] === '\\') { out += text.slice(j, j + 2); j += 2; continue; }
        if (text[j] === '$' && text[j + 1] === '(') {
          const e = closeParen(text, j + 2);
          if (e < 0) { out += text.slice(j); j = n; break; }
          out += `$(${rewriteProcSubst(text.slice(j + 2, e))})`;
          j = e + 1;
          continue;
        }
        if (text[j] === '`') { // a backtick substitution runs too: rewrite its body like a `$(` body
          const e = findBacktickClose(text, j + 1);
          if (e < 0) { out += text.slice(j); j = n; break; }
          out += `\`${rewriteProcSubst(text.slice(j + 1, e))}\``;
          j = e + 1;
          continue;
        }
        out += text[j]; j += 1;
      }
      if (j < n) { out += '"'; j += 1; }
      i = j; continue;
    }
    if ((c === '<' || c === '>') && text[i + 1] === '(') { out += ' $('; i += 2; continue; }
    out += c; i += 1;
  }
  return out;
}

// Arithmetic contexts `(( … ))`, `$(( … ))`, `for (( … ))`: the words inside are variables, not commands. Blank the whole
// construct but keep the `$(…)` / backtick substitutions inside it, which do run. `( (ls) )` (space between) stays a subshell. Linear.
function stripArithmetic(text) {
  if (text.indexOf('((') < 0) return text;
  let out = '';
  let last = 0;
  const n = text.length;
  for (let i = text.indexOf('(('); i >= 0 && i < n; i = text.indexOf('((', i + 1)) {
    if (i < last) continue;
    const from = text[i - 1] === '$' ? i - 1 : i;
    out += `${text.slice(last, from)} `;
    let d = 2;
    let j = i + 2;
    while (j < n && d > 0) {
      const ch = text[j];
      if (ch === '\\') { j += 2; continue; }
      if (ch === "'") { const e = text.indexOf("'", j + 1); j = e < 0 ? n : e + 1; continue; }
      if (ch === '$' && text[j + 1] === '(') {
        const e = closeParen(text, j + 2);
        if (e < 0) { j = n; break; }
        out += ` ${text.slice(j, e + 1)} `;
        j = e + 1;
        continue;
      }
      if (ch === '`') {
        const e = findBacktickClose(text, j + 1);
        if (e < 0) { j = n; break; }
        out += ` ${text.slice(j, e + 1)} `;
        j = e + 1;
        continue;
      }
      if (ch === '(') d += 1;
      else if (ch === ')') d -= 1;
      j += 1;
    }
    out += ' 0 ';
    last = Math.min(j, n);
  }
  return out + text.slice(last);
}

// Body of an array assignment, starting just past `=(`: returns { kept, end } where `end` is just past the closing `)`
// and `kept` is the command substitutions (`$(…)`, `<(…)`, `>(…)`, backticks) that really run, including those inside
// double quotes. Parenthesis depth counts only unquoted, unescaped `(` and `)`: a backslash escapes the next char,
// single quotes are literal data, double quotes are data except for `$(…)` and backticks. One linear pass.
function scanArrayBody(text, start) {
  let kept = '';
  let d = 1;
  let j = start;
  const n = text.length;
  let inDq = false;
  const keepSub = (from, to) => { kept += ` ${text.slice(from, to)} `; };
  while (j < n && d > 0) {
    const ch = text[j];
    if (ch === '\\') { j += 2; continue; }
    if (!inDq && ch === "'") { const e = text.indexOf("'", j + 1); j = e < 0 ? n : e + 1; continue; }
    if (ch === '"') { inDq = !inDq; j += 1; continue; }
    if ((ch === '$' || (!inDq && (ch === '<' || ch === '>'))) && text[j + 1] === '(') {
      const e = closeParen(text, j + 2);
      if (e < 0) return { kept, end: n };
      keepSub(j, e + 1);
      j = e + 1;
      continue;
    }
    if (ch === '`') {
      const e = findBacktickClose(text, j + 1);
      if (e < 0) return { kept, end: n };
      keepSub(j, e + 1);
      j = e + 1;
      continue;
    }
    if (!inDq) {
      if (ch === '(') d += 1;
      else if (ch === ')') d -= 1;
    }
    j += 1;
  }
  return { kept, end: Math.min(j, n) };
}

// Array assignment bodies (`a=( ls -la )`, spanning lines) hold words, not commands: blank them out, but keep the
// command substitutions inside (`a=( $(ls) )`, backticks, `<(…)` already rewritten to `$(`).
// One linear pass, no regex backtracking and no fixed look-back: a small state machine recognises the target
// `NAME`, `NAME+`, `NAME[subscript]` (any length) at a word start, and enters the body only on `=(`.
const ARR_BOUNDARY = /[\s;&|(){}]/;
function stripArrayAssigns(text) {
  if (text.indexOf('=(') < 0) return text;
  let out = '';
  let last = 0;
  let st = 0; // 0 word start · 1 identifier · 2 inside [subscript] · 3 after ] · 4 after + · 5 not an array target (skip word)
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (st === 2) {
      if (c === '[') depth += 1;
      else if (c === ']') { depth -= 1; if (depth === 0) st = 3; }
      continue;
    }
    if (ARR_BOUNDARY.test(c)) { st = 0; continue; }
    if (st === 0) { st = /[A-Za-z_]/.test(c) ? 1 : 5; continue; }
    if (st === 5) continue;
    if (st === 1 && /\w/.test(c)) continue;
    if (c === '[' && st === 1) { st = 2; depth = 1; continue; }
    if (c === '+' && (st === 1 || st === 3)) { st = 4; continue; }
    if (c !== '=' || text[i + 1] !== '(') { st = 5; continue; }
    // array assignment: `=(` ends the target
    out += `${text.slice(last, i)}= `;
    const body = scanArrayBody(text, i + 2);
    out += body.kept;
    const j = body.end;
    last = j;
    i = j - 1;
    st = 0;
  }
  return out + text.slice(last);
}
const REDIR_RE = /^(?:\d+|&)?(?:>>|>\||>&|&>|>|<&|<)(.*)$/;

function detectBareLs(cmd) {
  try { return detectBareLsUnguarded(cmd); } catch { return null; } // pathological nesting overflows the stack: fail open
}
function detectBareLsUnguarded(cmd) {
  const exec = executableText(typeof cmd === 'string' ? cmd : '');
  if (!exec.includes('ls')) return null; // cheap exit first: this hook runs on every Bash call
  // `<(…)` / `>(…)` process substitution runs its body as a command list, exactly like `$(…)`.
  const text = stripArrayAssigns(stripArithmetic(rewriteProcSubst(exec)));
  if (!/\bls\b/.test(text)) return null;
  for (const seg of expandSegments(text)) {
    if (seg.sh) continue;
    let afterTime = false; // `time` is a reserved word: its options (`-p`, `--`) are skipped with it, the command after still gets alias expansion
    const toks = tokens(seg.text).map((t) => t.raw);
    for (let i = 0; i < toks.length; i += 1) {
      const raw = toks[i];
      if (afterTime && (raw === '-p' || raw === '--')) continue;
      if (raw === 'time') { afterTime = true; continue; }
      if (/^[A-Za-z_]\w*(?:\[[^\]]*\])?\+?=/.test(raw) || KEYWORDS.has(raw)) continue;
      // `coproc [NAME {] cmd`: coproc is a reserved word, the command after it is alias-expanded.
      if (raw === 'coproc') { if (/^[A-Za-z_]\w*$/.test(toks[i + 1] || '') && toks[i + 2] === '{') i += 1; continue; }
      // A leading redirection (`> f ls`, `2>/dev/null ls`, `<f ls`) does not end command position; a bare operator takes the next word as its target.
      const rd = REDIR_RE.exec(raw);
      if (rd) { if (rd[1] === '') i += 1; continue; }
      // `case x in a|b) ls`: skip the head and each arm label, the word after the label is a command.
      if (raw === 'case') { const k = toks.indexOf('in', i + 1); if (k < 0) break; i = k; continue; }
      if (/^\(?[^()\s]*\)$/.test(raw)) continue;
      // `ls () { … }` defines a function named ls; it is not a call.
      if (raw === 'ls' && /^\(/.test(toks[i + 1] || '')) break;
      if (raw === 'ls') {
        return {
          rule: 'bare-ls',
          why: 'a bare `ls` in the Bash tool runs this machine\'s interactive alias/function (eza or similar) and can hang the whole call. '
            + 'Use `command ls` or `/bin/ls`, or the Glob / Read tools',
        };
      }
      break;
    }
  }
  return null;
}

module.exports = { detectBareLs, globHasMatch, launchAdvice, findSubstitutions, detectDetachNoWake, detectPkillSelfMatch, patternMatchesSelf, detectZshExpansion, segments, expandSegments };
