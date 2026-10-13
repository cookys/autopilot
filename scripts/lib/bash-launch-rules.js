'use strict';

// scripts/lib/bash-launch-rules.js — the ONE definition of three Bash-launch hazards that
// hooks/depth0-delegate-gate.js checks on every Bash call (all depths, BL-0019):
//   1. detach-no-wake (DENY)  — nohup / setsid / trailing `&` starting a dispatch RAIL entrypoint
//      (scripts/dispatch-*.sh|js, never *.test.*) with nothing in the same command that wakes the session.
//      Only the COMMAND-POSITION word counts: `grep dispatch-review.sh x &` is not a launch.
//   2. pkill-self-match (WARN) — `pkill -f` / `pgrep -f` (also inside `$(…)`) whose pattern lacks the
//      `[x]` self-exclusion trick, so the pattern matches the Bash tool's own command line.
//   3. zsh-expansion (WARN, zsh only, never a deny) — a word starting with `=<char>` (zsh EQUALS
//      expansion) or an unquoted glob that matches nothing (zsh `nomatch` aborts the whole line).
//      Prefers silence: no fs.globSync, `**`, or a partly-quoted word ⇒ no warning.
// Rules run on EXECUTABLE text (heredoc bodies / comments stripped by bash-wait-rules.js).
//
// scripts/lib/dispatch-detach.sh is NOT a launcher: it is a sourceable helper the read rails
// source to detach THEMSELVES (setsid supervisor + durable result file). Nothing to allow here.

const fs = require('fs');
const { executableText } = require('./bash-wait-rules.js');


// Rail entrypoint path: .../scripts/dispatch-<x>.sh|js, not a *.test.* file.
const RAIL_PATH_RE = /(?:^|\/)scripts\/dispatch-[\w.-]*\.(?:sh|js)$/;
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
  const push = (bg, endsList = false) => {
    if (cur.trim()) out.push({ text: cur.trim(), bg });
    cur = '';
    if (bg) {
      for (let k = listStart; k < out.length; k += 1) out[k].bg = true;
      // `{ a; b; } &` — the `}` segment pulls back to its opening `{`.
      const last = out[out.length - 1];
      if (last && /^\}/.test(last.text)) {
        for (let k = out.length - 1; k >= 0; k -= 1) {
          if (/^\{(?:\s|$)/.test(out[k].text)) { for (let j = k; j < out.length; j += 1) out[j].bg = true; break; }
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
    if (c === '(' && cur.trim() === '') continue; // leading subshell paren
    if (c === '\n' || c === ';') { push(false, true); continue; }
    if (c === '|') { push(false); if (s[i + 1] === '|') i += 1; continue; }
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

// Flatten `bash -c '…'` bodies and `$(…)` / backtick bodies into extra segments (they are executed).
function expandSegments(text, depth = 0) {
  const all = [];
  for (const seg of segments(text)) {
    all.push(seg);
    if (depth >= 2) continue;
    const m = SHELL_C_RE.exec(seg.text);
    if (m) all.push(...expandSegments(m[1] !== undefined ? m[1] : m[2], depth + 1).map((x) => ({ ...x, bg: x.bg || seg.bg, sh: true })));
    const noSingle = seg.text.replace(/'[^']*'/g, (x) => ' '.repeat(x.length)); // '$(…)' is data
    const subRe = /\$\(([^()]*)\)|`([^`]*)`/g;
    let sm;
    while ((sm = subRe.exec(noSingle)) !== null) {
      // The body of `$(…)` / backticks is a fresh script: strip ITS heredoc bodies and comments too
      // (`git commit -m "$(cat <<'EOF' … EOF)"` — the outer lexer treats the heredoc as quoted data).
      // (noSingle only blanked quoted spans for matching; slice the ORIGINAL text so quotes survive.)
      const open = sm[1] !== undefined ? 2 : 1;
      const body = executableText(seg.text.slice(sm.index + open, sm.index + sm[0].length - 1));
      all.push(...expandSegments(body, depth + 1).map((x) => ({ ...x, bg: false, sh: x.sh || seg.sh })));
    }
  }
  return all;
}

const unq = (w) => w.replace(/^['"]|['"]$/g, '');

// Command position of a segment: strips VAR=val assignments and launcher/interpreter prefixes (with
// their flags). Returns { head, detach, rest }: head is the first real command word, detach is true when
// a nohup / setsid (not -w) prefix was stripped.
function commandPosition(segText) {
  const w = tokens(segText).map((t) => unq(t.raw));
  let detach = false;
  let i = 0;
  while (i < w.length) {
    const a = w[i];
    if (/^[A-Za-z_]\w*=/.test(a) || KEYWORDS.has(a)) { i += 1; continue; }
    const base = a.replace(/^.*\//, '');
    if (PREFIX_CMDS.has(base)) {
      if (base === 'nohup') detach = true;
      i += 1;
      let waitFlag = false;
      while (i < w.length && /^-/.test(w[i])) {
        if (VALUE_FLAGS[base] && VALUE_FLAGS[base].has(w[i])) i += 1;
        if (i >= w.length) break;
        if (base === 'setsid' && (w[i] === '-w' || w[i] === '--wait')) waitFlag = true;
        if (/^-[a-zA-Z]*c$/.test(w[i]) && ['bash', 'sh', 'zsh', 'dash'].includes(base)) return { head: null, detach, rest: [] };
        i += 1;
      }
      if (base === 'setsid' && !waitFlag) detach = true;
      if (base === 'timeout' && i < w.length && /^\d/.test(w[i])) i += 1; // the duration
      continue;
    }
    return { head: a.replace(/\)+$/, ''), detach, rest: w.slice(i + 1) };
  }
  return { head: null, detach, rest: [] };
}

const REL_RAIL_RE = /^\.\/dispatch-[\w.-]*\.(?:sh|js)$/;
function isRail(head, mentionsScripts) {
  if (!head || TEST_FILE_RE.test(head)) return false;
  return RAIL_PATH_RE.test(head) || (mentionsScripts && REL_RAIL_RE.test(head));
}

// Rule 1. Returns { rule, why } or null.
function detectDetachNoWake(cmd) {
  const text = executableText(typeof cmd === 'string' ? cmd : '');
  const segs = expandSegments(text);
  const pos = segs.map((s) => ({ seg: s, ...commandPosition(s.text) }));
  // Wake-up only counts when `wait` / the waiter script is itself a command word.
  if (pos.some((p) => p.head && (WAKE_HEADS.has(p.head) || WAKE_SCRIPT_RE.test(p.head)))) return null;
  const mentionsScripts = pos.some((p) => p.head === 'cd' && /(?:^|\/)scripts\/?$/.test(unq(p.rest[0] || '')));
  for (const p of pos) {
    if (!p.head || !(p.detach || p.seg.bg)) continue;
    if (isRail(p.head, mentionsScripts)) {
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
    const mq = /\b(?:pkill|pgrep)\b(?:\s+-[^\s'"]*(?:\s+\d+)?)*\s+('([^']*)'|"([^"]*)"|(\S+))/.exec(seg.text);
    if (!mq) continue;
    const pattern = mq[2] !== undefined ? mq[2] : (mq[3] !== undefined ? mq[3] : mq[4]);
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

// Rule 3 (zsh only). Returns { rule, why, token } or null.
function detectZshExpansion(cmd, cwd) {
  let text = executableText(typeof cmd === 'string' ? cmd : '');
  text = text.replace(/\[\[[\s\S]*?\]\]/g, ' ').replace(/\$?\(\([\s\S]*?\)\)/g, ' ');
  const allSegs = expandSegments(text);
  // A `cd`/`pushd` anywhere means globs are relative to a directory we do not know.
  const hasCd = allSegs.some((sg) => { const h = commandPosition(sg.text).head; return h === 'cd' || h === 'pushd'; });
  for (const seg of allSegs) {
    if (seg.sh) continue; // `bash -c '…'` bodies run in bash, not zsh
    for (const { raw, masked } of tokens(seg.text)) {
      if (/^=./.test(masked)) { // `=y` is command-path lookup; a lone `=` / `==` is fine in `[`/`test`
        return {
          rule: 'zsh-expansion', token: raw,
          why: `zsh expands a word starting with "=" (${raw}) as a command-path lookup and aborts the line `
            + `("${raw.replace(/^=+/, '')} not found") — quote it ('${raw}') or use bash -c`,
        };
      }
      // Drop parameter forms (`$?`, `$*`, `${x:-*}`) and command substitutions before looking for globs.
      const bare = masked.replace(/\$\{[^}]*\}|\$\([^)]*\)?|\$[?*@#!$-]|`[^`]*`?/g, '');
      if (!/[*?]|\[[^\]]+\]/.test(bare)) continue;
      // Stay silent when we cannot judge: backslash/quote/brace in the word, `**`, or no globSync.
      if (/[\\'"{$]/.test(raw) || raw.includes('**') || bare !== masked) continue;
      if (hasCd || /^~/.test(raw)) continue; // cannot resolve / too broad: stay silent
      if (raw.split('/').filter((part) => /[*?[]/.test(part)).length > 3) continue; // bound worst-case cost
      if (typeof fs.globSync !== 'function' || !cwd) continue;
      try {
        if (fs.globSync(raw, { cwd }).length > 0) continue;
      } catch { continue; }
      return {
        rule: 'zsh-expansion', token: raw,
        why: `unquoted glob ${raw} matches nothing: zsh aborts the WHOLE line with "no matches found" `
          + '(bash passes it through literally) — quote it, or setopt nonomatch',
      };
    }
  }
  return null;
}

module.exports = { detectDetachNoWake, detectPkillSelfMatch, detectZshExpansion, segments, expandSegments };
