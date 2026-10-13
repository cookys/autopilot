'use strict';

// scripts/lib/bash-launch-rules.js — the ONE definition of three Bash-launch hazards that
// hooks/depth0-delegate-gate.js checks on every Bash call (all depths, BL-0019):
//   1. detach-no-wake (DENY)  — a trailing `&` or `setsid -f` (with or without nohup) starting a dispatch RAIL entrypoint
//      (one of the explicit RAIL_NAMES list below — observers such as dispatch-status.js and *.test.* files are
//      not rails) with nothing in the same command that wakes the session.
//      Only the COMMAND-POSITION word counts: `grep dispatch-review.sh x &` is not a launch.
//   2. pkill-self-match (WARN) — `pkill -f` / `pgrep -f` (also inside `$(…)`) whose pattern lacks the
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
const RAIL_PATH_RE = new RegExp(`(?:^|/)scripts/dispatch-(?:${RAIL_NAMES})\\.(?:sh|js)$`);
const TEST_FILE_RE = /\.test\.(?:sh|js)$/;
const WAKE_HEADS = new Set(['wait']);
const WAKE_SCRIPT_RE = /(?:^|\/)wait-dispatch-results(?:\.[a-z]+)?$/;
const PREFIX_CMDS = new Set(['time', 'exec', 'command', 'sudo', 'nice', 'nohup', 'setsid', 'env', 'bash', 'sh', 'zsh', 'dash', 'node', 'stdbuf', 'timeout']);
// Flags of a prefix command that consume the NEXT word as their value.
const VALUE_FLAGS = {
  nice: new Set(['-n']), sudo: new Set(['-u', '-g', '-h', '-p', '-C']), env: new Set(['-u', '-C', '-S']), timeout: new Set(['-s', '-k']),
};
// Shell keywords that precede a command: `for …; do CMD &`, `if …; then CMD`, `{ CMD; }`.
const KEYWORDS = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', '{', '!', '(']);

const CLOSERS = [
  { close: /^\}(?:\s|$)/, open: /^\{(?:\s|$)/ },
  { close: /^done(?:\s|$)/, open: /^(?:for|while|until|select)\s/ },
  { close: /^fi(?:\s|$)/, open: /^if\s/ },
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
  let subDepth = 0; // inside a `( … )` subshell: its background jobs are NOT waitable by the outer shell
  let inner = 0; // unquoted `(` that is not a subshell opener (`$(`, `f(`)
  let bt = false; // inside an unquoted backtick substitution
  const push = (bg, endsList = false) => {
    if (cur.trim()) out.push({ text: cur.trim(), bg, sub: subDepth > 0 });
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
    if (c === '(' && cur.trim() === '') { subDepth += 1; continue; } // leading subshell paren
    if (c === '(') { inner += 1; cur += c; continue; }
    if (c === ')') {
      if (inner > 0) inner -= 1;
      else if (subDepth > 0) { push(false); subDepth -= 1; continue; } // closes a subshell
      cur += c; continue;
    }
    // Inside an unquoted `$( … )` or backtick pair the separators belong to that substitution: keep it one segment (it is
    // re-parsed on its own by expandSegments), otherwise `echo $(rail &)` would be torn apart.
    if ((inner > 0 || bt) && (c === '\n' || c === ';' || c === '|' || c === '&')) { cur += c; continue; }
    if (c === '\n' || c === ';') { push(false, true); continue; }
    if (c === '|') { push(false); if (s[i + 1] === '|' || s[i + 1] === '&') i += 1; continue; } // `||`, and `|&` (pipe stderr too)
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

function closeParen(s, i) { // i is just past `$(`; returns the index of the matching `)` or -1
  let depth = 1;
  const pending = [];
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') { i += 2; continue; }
    if (c === "'") { const j = s.indexOf("'", i + 1); i = j < 0 ? s.length : j + 1; continue; }
    if (c === '"') { i = skipDq(s, i + 1); continue; }
    if (c === '`') { const j = s.indexOf('`', i + 1); i = j < 0 ? s.length : j + 1; continue; }
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
      let j = i + 1;
      while (j < text.length && text[j] !== '`') j += text[j] === '\\' ? 2 : 1;
      out.push(text.slice(i + 1, Math.min(j, text.length)));
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
function expandSegments(text, depth = 0) {
  const all = [];
  for (const seg of segments(text)) {
    all.push(seg);
    if (depth >= 2) continue;
    const m = SHELL_C_RE.exec(seg.text);
    if (m) all.push(...expandSegments(m[1] !== undefined ? m[1] : m[2], depth + 1).map((x) => ({ ...x, bg: x.bg || seg.bg, sh: true, sub: true })));
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
  let i = 0;
  while (i < w.length) {
    const a = w[i];
    if (/^[A-Za-z_]\w*=/.test(a) || KEYWORDS.has(a)) { i += 1; continue; }
    const base = a.replace(/^.*\//, '');
    if (PREFIX_CMDS.has(base)) {
      i += 1;
      while (i < w.length && /^-/.test(w[i])) {
        if (VALUE_FLAGS[base] && VALUE_FLAGS[base].has(w[i])) i += 1;
        if (i >= w.length) break;
        if (base === 'setsid' && (w[i] === '-f' || w[i] === '--fork')) detach = true;
        if (/^-[a-zA-Z]*c$/.test(w[i]) && ['bash', 'sh', 'zsh', 'dash'].includes(base)) return { head: null, detach, rest: [] };
        i += 1;
      }
      if (base === 'timeout' && i < w.length && /^\d/.test(w[i])) i += 1; // the duration
      continue;
    }
    return { head: a.replace(/\)+$/, ''), detach, rest: w.slice(i + 1) };
  }
  return { head: null, detach, rest: [] };
}

const REL_RAIL_RE = new RegExp(`^\\./dispatch-(?:${RAIL_NAMES})\\.(?:sh|js)$`);
function isRail(head, mentionsScripts) {
  if (!head || TEST_FILE_RE.test(head)) return false;
  return RAIL_PATH_RE.test(head) || (mentionsScripts && REL_RAIL_RE.test(head));
}

// Rule 1. Returns { rule, why } or null.
function detectDetachNoWake(cmd) {
  const text = executableText(typeof cmd === 'string' ? cmd : '');
  const segs = expandSegments(text);
  const pos = segs.map((s) => ({ seg: s, ...commandPosition(s.text) }));
  // Wake-up only counts when the waiter script is itself a command word, or — for a plain trailing `&`
  // directly in the SAME shell level — a later `wait` in that same level. A `wait` cannot see a job that
  // was `setsid -f` forked, that lives in a `( … )` subshell, or that runs inside `$(…)` / `bash -c`.
  const waiter = pos.some((p) => p.head && WAKE_SCRIPT_RE.test(p.head));
  if (waiter) return null;
  const mentionsScripts = pos.some((p) => p.head === 'cd' && /(?:^|\/)scripts\/?$/.test(unq(p.rest[0] || '')));
  for (let idx = 0; idx < pos.length; idx += 1) {
    const p = pos[idx];
    if (!p.head || !(p.detach || p.seg.bg)) continue;
    if (!isRail(p.head, mentionsScripts)) continue;
    const shape = p.detach ? 'setsid-f' : 'amp';
    if (shape === 'amp' && !p.seg.sub
      && pos.slice(idx + 1).some((q) => q.head === 'wait' && !q.seg.sub && !q.seg.bg)) continue;
    const rm = /dispatch-([a-z-]+)\.(?:sh|js)$/.exec(p.head);
    return {
      rule: 'detach-no-wake',
      shape,
      rail: rm ? rm[1] : null,
      why: 'a dispatch rail entrypoint is launched in the background (trailing & / setsid -f) with nothing '
        + 'that can wake the session when it finishes',
      advice: launchAdvice(shape, rm ? rm[1] : null),
    };
  }
  return null;
}

// Rails that honour `--ledger/--run-id[/--stage]` and land `<ledger>.results/<run>.<stage>.exit`
// (dispatch-detach.sh via review/author/foreman, in-process in hetero). The other rails never write it.
const LEDGER_RAILS = { review: 'stage', author: 'stage', hetero: 'stage', foreman: 'fixed' };

// Only options that literally work for this (shape, rail) pair — see the recipe tests.
function launchAdvice(shape, rail) {
  const parts = ["Short job (any rail): run it in the foreground with the Bash tool's run_in_background: true "
    + '(no nohup / setsid / &) — one completion notification.'];
  if (shape === 'amp') {
    parts.push('Or keep the `&` and put `wait` after it in the same command (the call blocks until the rail exits, '
      + 'bounded by the Bash tool timeout).');
  } else {
    parts.push('A bare `wait` does not wait for a `setsid -f` job.');
  }
  const kind = LEDGER_RAILS[rail];
  if (kind === 'stage') {
    parts.push('Long job: pass `--ledger <path> --run-id <id> --stage <name>` (all three — without them no .exit file '
      + 'is written) and in the SAME command run `node scripts/wait-dispatch-results.js --ledger <path> --expect '
      + '<id>.<name>` — run that whole command with `run_in_background: true` (the waiter waits up to 3600 s by '
      + "default, past the Bash tool's 600 s foreground limit).");
  } else if (kind === 'fixed') {
    parts.push('Long job: pass `--ledger <path> --run-id <id>` (the stage is fixed) and in the SAME command run '
      + '`node scripts/wait-dispatch-results.js --ledger <path> --expect <id>.foreman` — run that whole command '
      + "with `run_in_background: true` (the waiter waits up to 3600 s by default, past the Bash tool's 600 s "
      + 'foreground limit).');
  } else {
    parts.push(`dispatch-${rail || '…'} never writes the .exit file wait-dispatch-results.js waits for, so only the `
      + 'option(s) above work for it.');
  }
  return parts.join(' ');
}

const PGREP_VALUE_FLAGS = new Set(['u', 'U', 'g', 'G', 'P', 's', 't', 'F']);
const PGREP_LONG_VALUE = new Set(['--euid', '--uid', '--group', '--pgroup', '--parent', '--session', '--terminal', '--pidfile', '--signal']);

// Rule 2. Returns { rule, why, pattern } or null.
function detectPkillSelfMatch(cmd) {
  const text = executableText(typeof cmd === 'string' ? cmd : '');
  for (const seg of expandSegments(text)) {
    const { head, rest } = commandPosition(seg.text);
    if (!head) continue;
    const name = head.replace(/^.*\//, '');
    if (name !== 'pkill' && name !== 'pgrep') continue;
    let full = false;
    for (const a of rest) {
      if (a === '--full' || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a)) full = true;
    }
    if (!full) continue;
    // The pattern is the first non-option word after the command; recover quoted multi-word patterns.
    // Walk the words after the command: options that take a value (`-u me`, `-P 1`, `--uid me`) skip that
    // value, so `me` is never mistaken for the pattern.
    const toks = tokens(seg.text).map((t) => t.raw);
    const hi = toks.findIndex((t) => t.replace(/^.*\//, '') === name);
    let word;
    for (let i = hi + 1; i < toks.length; i++) {
      const t = toks[i];
      if (/^--[a-z-]+$/.test(t)) { if (PGREP_LONG_VALUE.has(t)) i += 1; continue; }
      if (/^-[a-zA-Z0-9]+$/.test(t)) { if (PGREP_VALUE_FLAGS.has(t[t.length - 1]) && !/^-[0-9]/.test(t)) i += 1; continue; }
      if (t.startsWith('-')) continue;
      word = t; break;
    }
    if (word === undefined) continue;
    const pattern = word.replace(/^(['"])([\s\S]*)\1$/, '$2');
    if (/\[[^\]\s]\]/.test(pattern) || /\$/.test(pattern)) continue; // `[f]oo` self-exclusion; `$PAT` unknowable
    return {
      rule: 'pkill-self-match',
      pattern,
      why: `${name} -f pattern "${pattern}" also matches this Bash call's own command line — write it as `
        + "'[f]oo' (bracket one character) or kill by PID",
    };
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

module.exports = { globHasMatch, launchAdvice, findSubstitutions, detectDetachNoWake, detectPkillSelfMatch, detectZshExpansion, segments, expandSegments };
