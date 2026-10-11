'use strict';

// scripts/lib/bash-wait-rules.js — the ONE definition of "this Bash command is a foreground
// wait". hooks/foreman-guard.js (depth-1, denies) and hooks/depth0-delegate-gate.js (depth-0,
// advises only) both load their sleep / while-wait rules and the executable-text lexer from
// here, so the two hooks can never disagree about what a wait loop looks like.
//
// Rules run on EXECUTABLE text only: heredoc bodies and `#` comments are stripped first;
// quoted strings stay because `bash -c '…'` / `sh -c "…"` execute them. The sleep rule needs a
// digit after `sleep` so it stays off prose like `-m "sleep well"`.

// Strip the parts of a Bash command that are DATA, not executed commands: heredoc BODIES
// (`<<TAG … TAG`, quoted or unquoted tag, optional `-`) and `#` comments to end of line.
// Quote-aware: a `#` or `<<` inside single/double quotes is literal, and the executable text
// before AND after a heredoc introducer on its own line (`cat <<EOF; sleep 10`) is kept.
function executableText(cmd) {
  const out = [];
  const lines = String(cmd).split('\n');
  let heredocTag = null;
  for (const line of lines) {
    if (heredocTag !== null) {
      if (line.replace(/^\t+/, '') === heredocTag) heredocTag = null;
      continue; // heredoc body: data
    }
    let keep = '';
    let q = null; // active quote char
    // `#` opens a comment only at the START of a word (`echo foo\ #bar` keeps `#bar`).
    let wordStart = true;
    let i = 0;
    while (i < line.length) {
      const c = line[i];
      if (q) {
        if (c === '\\' && q === '"' && i + 1 < line.length) { keep += c + line[i + 1]; i += 2; continue; }
        if (c === q) q = null;
        keep += c; i += 1; continue;
      }
      if (c === '\\' && i + 1 < line.length) { keep += c + line[i + 1]; i += 2; wordStart = false; continue; }
      if (c === "'" || c === '"') { q = c; keep += c; i += 1; wordStart = false; continue; }
      if (c === '#' && wordStart) break; // comment to EOL
      if (c === '<' && line[i + 1] === '<' && line[i + 2] !== '<') {
        const m = /^<<-?\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_][\w]*))/.exec(line.slice(i));
        if (m) { heredocTag = m[1] || m[2] || m[3]; i += m[0].length; wordStart = true; continue; } // drop the introducer only
      }
      wordStart = /[\s;&|(]/.test(c);
      keep += c; i += 1;
    }
    out.push(keep);
  }
  return `${out.join('\n')}\n`;
}

function isAffirmative(v) {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') return ['true', '1', 'yes', 'on'].includes(v.trim().toLowerCase());
  return false;
}

// `sleep` as a command word: start of text or after a separator/quote, optional absolute path.
const SLEEP_HEAD = String.raw`(?:^|[;&|(${'`'}\s'"])(?:\/[\w./-]*\/)?sleep\s+`;
const SLEEP_RE = new RegExp(`${SLEEP_HEAD}\\d`);
const WHILE_WAIT_RE = new RegExp(String.raw`\b(?:while|until)\b[\s\S]*?\bdo\b[\s\S]*?(?:${SLEEP_HEAD}\d|(?:^|[;\s])(?:true|:)(?:\s*;|\s*$|\s+done\b))`);
// `tail -f` / `-F` / `--follow` (also bundled like `-fn 5`): blocks until killed.
const TAIL_FOLLOW_RE = /(?:^|[;&|(`\s'"])(?:\/[\w./-]*\/)?tail\s+(?:[^|;&\n]*\s)?(?:-[A-Za-z0-9]*[fF][A-Za-z0-9]*|--follow\b)/;

// Seconds of every `sleep <n>[smhd]` in the text (only the first operand of each sleep).
function sleepSeconds(text) {
  const re = new RegExp(`${SLEEP_HEAD}(\\d+(?:\\.\\d+)?)([smhd]?)`, 'g');
  const mult = { '': 1, s: 1, m: 60, h: 3600, d: 86400 };
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) out.push(Number(m[1]) * mult[m[2]]);
  return out;
}

// Depth-0 advisory classifier: the id of the first foreground-wait shape found, or null.
// A background call is the sanctioned wait and never matches.
function detectForegroundWait(cmd, runInBackground, minSleepSeconds = 20) {
  if (isAffirmative(runInBackground)) return null;
  const text = executableText(typeof cmd === 'string' ? cmd : '');
  if (WHILE_WAIT_RE.test(text)) return 'while-wait';
  if (TAIL_FOLLOW_RE.test(text)) return 'tail-follow';
  if (sleepSeconds(text).some((s) => s >= minSleepSeconds)) return 'sleep';
  return null;
}

module.exports = {
  executableText, isAffirmative, SLEEP_RE, WHILE_WAIT_RE, TAIL_FOLLOW_RE, sleepSeconds, detectForegroundWait,
};
