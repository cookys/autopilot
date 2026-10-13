'use strict';

// scripts/lib/bash-launch-rules.js — the ONE definition of three Bash-launch hazards that
// hooks/depth0-delegate-gate.js checks on every Bash call (all depths, BL-0019):
//   1. detach-no-wake (DENY)  — nohup / setsid / trailing `&` starting a dispatch RAIL entrypoint
//      (scripts/dispatch-*.sh|js) with nothing in the same command that wakes the session.
//   2. pkill-self-match (WARN) — `pkill -f` / `pgrep -f` whose pattern lacks the `[x]` self-exclusion
//      trick, so the pattern matches the Bash tool's own command line.
//   3. zsh-expansion (WARN, zsh only, never a deny) — a word starting with `=` (zsh EQUALS expansion)
//      or an unquoted glob that matches nothing (zsh `nomatch` aborts the whole line).
// Rules run on EXECUTABLE text (heredoc bodies / comments stripped by bash-wait-rules.js).

const fs = require('fs');
const { executableText } = require('./bash-wait-rules.js');

// Rail entrypoint: a path word whose basename is dispatch-<x>.sh|js (scripts/ or scripts/lib/).
const RAIL_RE = /(?:^|[\s/=])dispatch-[\w.-]*\.(?:sh|js)(?=$|[\s;&|)])/;
// Anything in the same command that supplies a wake-up: the sanctioned waiter script, or `wait`.
const WAKE_RE = /(?:wait-dispatch-results|(?:^|[;&|(\s])wait(?:\s|$|;)|\bMonitor\b)/;

// Split into segments with their terminator. Quote-aware; `&&`, `||`, `|`, `;`, newline end a
// segment; a single `&` (not `>&`, `&>`, `&&`) ends a segment AND marks it backgrounded.
function segments(text) {
  const out = [];
  let cur = '';
  let q = null;
  const s = String(text);
  const push = (bg) => { if (cur.trim()) out.push({ text: cur.trim(), bg }); cur = ''; };
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (q) {
      if (c === '\\' && q === '"' && i + 1 < s.length) { cur += c + s[i + 1]; i += 1; continue; }
      if (c === q) q = null;
      cur += c; continue;
    }
    if (c === '\\' && i + 1 < s.length) { cur += c + s[i + 1]; i += 1; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === '\n' || c === ';') { push(false); continue; }
    if (c === '|') { push(false); if (s[i + 1] === '|') i += 1; continue; }
    if (c === '&') {
      if (s[i + 1] === '&') { push(false); i += 1; continue; }
      if (s[i - 1] === '>' || s[i + 1] === '>') { cur += c; continue; } // `2>&1`, `&>file`
      push(true); continue;
    }
    cur += c;
  }
  push(false);
  return out;
}

// Replace quoted spans with blanks (keeps word boundaries) so a quoted mention is not a command.
function maskQuotes(seg) {
  return seg.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, (m) => ' '.repeat(m.length));
}

const SHELL_C_RE = /^(?:\S*\/)?(?:bash|sh|zsh|dash)\s+(?:-[a-zA-Z]*\s+)*-[a-zA-Z]*c\s+(?:'([^']*)'|"((?:\\.|[^"\\])*)")/;

// Flatten `bash -c '…'` bodies into extra segments (they are executed).
function expandSegments(text, depth = 0) {
  const all = [];
  for (const seg of segments(text)) {
    all.push(seg);
    const m = depth < 2 ? SHELL_C_RE.exec(seg.text) : null;
    if (m) all.push(...expandSegments(m[1] !== undefined ? m[1] : m[2], depth + 1).map((x) => ({ ...x, bg: x.bg || seg.bg })));
  }
  return all;
}

// Words of a masked segment, skipping leading VAR=val assignments and `time`/`exec`/`env`.
function words(masked) {
  const w = masked.split(/\s+/).filter(Boolean);
  while (w.length && (/^[A-Za-z_]\w*=/.test(w[0]) || ['time', 'exec', 'command', 'sudo', 'nice'].includes(w[0]))) w.shift();
  return w;
}

// Rule 1. Returns { rule, why } or null.
function detectDetachNoWake(cmd) {
  const text = executableText(typeof cmd === 'string' ? cmd : '');
  if (WAKE_RE.test(maskQuotes(text))) return null;
  for (const seg of expandSegments(text)) {
    const masked = maskQuotes(seg.text);
    const w = words(masked);
    if (!w.length) continue;
    // `sh -c '…'` wrappers are expanded separately; skip the wrapper line itself for the rail test.
    if (SHELL_C_RE.test(seg.text) && !seg.bg) continue;
    const head = w[0].replace(/^.*\//, '');
    let launcher = seg.bg;
    if (head === 'nohup') launcher = true;
    if (head === 'setsid' && !w.slice(1).some((a) => a === '-w' || a === '--wait')) launcher = true;
    if (!launcher) continue;
    const rest = w.join(' ');
    if (RAIL_RE.test(` ${rest}`)) {
      return {
        rule: 'detach-no-wake',
        why: 'a dispatch rail entrypoint is launched detached (nohup / setsid / trailing &) with no wake-up '
          + 'mechanism — the session will never be told when it finishes',
      };
    }
  }
  return null;
}

// Rule 2. Returns { rule, why, pattern } or null.
function detectPkillSelfMatch(cmd) {
  const text = executableText(typeof cmd === 'string' ? cmd : '');
  for (const seg of expandSegments(text)) {
    const w = words(maskQuotes(seg.text));
    const raw = words(seg.text);
    if (!w.length) continue;
    const head = w[0].replace(/^.*\//, '');
    if (head !== 'pkill' && head !== 'pgrep') continue;
    let full = false;
    let pat = null;
    for (let i = 1; i < raw.length; i += 1) {
      const a = raw[i];
      if (a === '--full' || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a)) full = true;
      else if (/^-/.test(a)) {
        if (/^-[uUgGnoPstT]$/.test(a)) i += 1; // option that takes a value
      } else { pat = a; break; }
    }
    if (!full || pat === null) continue;
    // Quoted patterns can contain spaces; recover the full quoted token from the raw segment.
    const mq = /(?:^|\s)(?:pkill|pgrep)\b[^|]*?\s('([^']*)'|"([^"]*)")/.exec(seg.text);
    const pattern = mq ? (mq[2] !== undefined ? mq[2] : mq[3]) : pat.replace(/^['"]|['"]$/g, '');
    if (/\[[^\]\s]\]/.test(pattern)) continue; // `[f]oo`: the self-exclusion trick
    return {
      rule: 'pkill-self-match',
      pattern,
      why: `${head} -f pattern "${pattern}" also matches this Bash call's own command line — write it as `
        + "'[f]oo' (bracket one character) or kill by PID",
    };
  }
  return null;
}

// Rule 3 (zsh only). Returns { rule, why, token } or null.
function detectZshExpansion(cmd, cwd) {
  let text = executableText(typeof cmd === 'string' ? cmd : '');
  text = text.replace(/\[\[[\s\S]*?\]\]/g, ' ').replace(/\$?\(\([\s\S]*?\)\)/g, ' ');
  for (const seg of expandSegments(text)) {
    const w = words(maskQuotes(seg.text));
    if (!w.length) continue;
    const head = w[0];
    for (let i = 0; i < w.length; i += 1) {
      const t = w[i];
      if (/^=/.test(t)) {
        return {
          rule: 'zsh-expansion', token: t,
          why: `zsh expands a word starting with "=" (${t}) as a command-path lookup and aborts the line `
            + `("${t.replace(/^=+/, '') || '='} not found") — quote it ('${t}') or use bash -c`,
        };
      }
      if (i === 0 && /^[A-Za-z_]\w*=/.test(head)) continue;
      // Drop parameter forms (`$?`, `$*`, `${x:-*}`) and command substitutions before looking for globs.
      const bare = t.replace(/\$\{[^}]*\}|\$\([^)]*\)?|\$[?*@#!$-]|`[^`]*`?/g, '');
      if (/[*?]|\[[^\]]+\]/.test(bare)) {
        if (cwd && typeof fs.globSync === 'function') {
          try { if (fs.globSync(t, { cwd }).length > 0) continue; } catch { /* unknown: warn */ }
        }
        return {
          rule: 'zsh-expansion', token: t,
          why: `unquoted glob ${t}: zsh aborts the WHOLE line with "no matches found" when it matches nothing `
            + '(bash passes it through literally) — quote it, or setopt nonomatch',
        };
      }
    }
  }
  return null;
}

module.exports = { detectDetachNoWake, detectPkillSelfMatch, detectZshExpansion, segments, expandSegments };
