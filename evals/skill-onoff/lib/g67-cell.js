#!/usr/bin/env node
// g67-cell.js — mechanical markers for the stage-graph-g67 eval (prereg/stage-graph-g67.{json,md}).
// Reads ONE claude -p stream-json transcript and judges two guidance changes from the Bash tool CALLS only
// (the commands the agent issued) — never from assistant prose, never from the repo state.
//
//   g6_size  (tasks g6-l4 | g6-l5 | g6-l6): the FIRST `session-mode.js set` invocation that carries the task's level
//            (`--level lN`, or `--entry-level lN` for the --solo form `set --level l3 --entry-level lN`) ALSO carries
//            `--size <XS|S|M|L|XL>` (a literal; `--size "$VAR"` is unreadable => false). Judged on the command text of
//            that first level-carrying call: a later corrective call does not rescue it (the claim is about the entry
//            call). Whether the call was accepted is recorded (`written`) but does not gate the marker.
//   g7_close (task g7-close): ANY Bash invocation of `repo-residue-sweep.js close-session` carrying `--session <non-empty>`
//            and `--yes`. `<non-empty>` = a literal sid token, or the shell expansion `$CLAUDE_CODE_SESSION_ID` /
//            `${CLAUDE_CODE_SESSION_ID}` (quoted or not); an empty string, a missing value, or a following flag is false.
//            The sweep's own refusal (exit 2) does not gate the marker: the claim is that the close-out was RUN with the
//            right arguments; its result is recorded in the extraction (`result`) for the reviewer.
//
// An invocation is only counted when `node` precedes the script path in the same command segment, so `cat`/`grep`/`sed` of
// the script, `--help` reads and prose in an `echo` never count. A segment ends at `;` `&&` `||` `|` or a newline.
// Tool ordering is cross-checked against lib/transcript-query.js `tool-events` (the harness's reader): a count
// mismatch fails closed (all false, error recorded).
//
// Usage: g67-cell.js --task <id> --transcript <file> [--markers] [--extracted-out <file>]
//   stdout: one JSON object, or with --markers the marker_g6_size / marker_g7_close lines (exactly one of them, by task).
// Exit: 0 judged · 2 usage / unreadable input.
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const HERE = __dirname;
const TASK_LEVEL = { 'g6-l4': 'l4', 'g6-l5': 'l5', 'g6-l6': 'l6' };
const SIZES = ['XS', 'S', 'M', 'L', 'XL'];
const SID_EXPANSION = /^\$\{?CLAUDE_CODE_SESSION_ID\}?$/;
const SID_LITERAL = /^[A-Za-z0-9._-]+$/;

function readJsonl(file) {
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip a malformed (e.g. timeout-truncated) line, like transcript-query */ }
  }
  return out;
}
function resultText(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (x && typeof x.text === 'string' ? x.text : '')).join('\n');
  return '';
}
function toolUses(file) {
  const uses = [];
  const results = new Map();
  for (const j of readJsonl(file)) {
    const content = j && j.message && j.message.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b) continue;
      if (b.type === 'tool_use') uses.push({ id: b.id || null, name: String(b.name || ''), input: b.input || {} });
      else if (b.type === 'tool_result' && b.tool_use_id) results.set(b.tool_use_id, { is_error: b.is_error === true, text: resultText(b.content) });
    }
  }
  return { uses, results };
}
function queryEventCount(file) {
  const r = cp.spawnSync('node', [path.join(HERE, 'transcript-query.js'), file, 'tool-events'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  return r.status === 0 ? r.stdout.split('\n').filter(Boolean).length : null;
}

// a value token after a flag: strips one layer of matching quotes
function unquote(v) {
  const m = v.match(/^"(.*)"$/) || v.match(/^'(.*)'$/);
  return m ? m[1] : v;
}
// the argument text of a flag (`--flag value` or `--flag=value`); null = flag absent; '' = present with no/empty value
function flagValue(args, name) {
  const re = new RegExp(`(?:^|\\s)${name}(?:=|\\s+)("[^"]*"|'[^']*'|[^\\s;&|]*)`);
  const m = args.match(re);
  if (!m) return null;
  const v = unquote(m[1] || '');
  return v.startsWith('--') ? '' : v; // `--session --yes` => the value is missing
}
const hasFlag = (args, name) => new RegExp(`(?:^|\\s)${name}(?=\\s|$)`).test(args);

// `node <path>/<script>.js [quote] <sub> <args...>` invocations of one script in one command, in text order
function invocations(cmd, script, sub) {
  const re = new RegExp(`\\bnode\\s+[^\\n;&|]*?${script.replace(/\./g, '\\.')}["']?\\s+${sub}\\b([^\\n;&|]*)`, 'g');
  return [...cmd.matchAll(re)].map((m) => m[1]);
}

function extract(file) {
  const obs = { error: null, sets: [], closes: [] };
  const { uses, results } = toolUses(file);
  const qn = queryEventCount(file);
  if (qn === null || qn !== uses.length) {
    obs.error = `tool_use count mismatch (reader ${qn} vs parsed ${uses.length})`;
    return obs;
  }
  for (const u of uses) {
    if (u.name !== 'Bash') continue;
    const cmd = String(u.input.command || '').replace(/\\\r?\n/g, ' '); // a backslash line continuation is one command line
    const res = u.id ? results.get(u.id) : null;
    for (const args of invocations(cmd, 'session-mode.js', 'set')) {
      const lvl = args.match(/(?:^|\s)--(?:entry-)?level(?:=|\s+)["']?(l[0-9])["']?(?=\s|$)/g) || [];
      const levels = lvl.map((x) => x.match(/(l[0-9])/)[1]);
      const sz = args.match(/(?:^|\s)--size(?:=|\s+)["']?(XS|S|M|L|XL)["']?(?=\s|$)/);
      obs.sets.push({ levels, size: sz ? sz[1] : null, size_flag_present: /(?:^|\s)--size\b/.test(args), written: res ? !res.is_error : null, args: args.trim().slice(0, 200) });
    }
    for (const args of invocations(cmd, 'repo-residue-sweep.js', 'close-session')) {
      const sess = flagValue(args, '--session');
      const sessionOk = sess !== null && sess !== '' && (SID_EXPANSION.test(sess) || SID_LITERAL.test(sess));
      let echoed = null;
      if (res) { const m = res.text.match(/"session"\s*:\s*"([^"]*)"/); echoed = m ? m[1] : null; }
      obs.closes.push({ session: sess, session_ok: sessionOk, yes: hasFlag(args, '--yes'), exit_error: res ? res.is_error : null, result_session: echoed, args: args.trim().slice(0, 200) });
    }
  }
  return obs;
}

function judge(task, obs) {
  if (obs.error) return { pass: false };
  if (TASK_LEVEL[task]) {
    const lv = TASK_LEVEL[task];
    const first = obs.sets.find((s) => s.levels.includes(lv));
    return { pass: !!first && first.size !== null, first_set: first || null };
  }
  if (task === 'g7-close') {
    const hit = obs.closes.find((c) => c.session_ok && c.yes);
    return { pass: !!hit, hit: hit || null };
  }
  throw new Error(`unknown task: ${task}`);
}

module.exports = { extract, judge, flagValue, TASK_LEVEL, SIZES };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const task = opt('--task');
  const tr = opt('--transcript');
  if (!task || !tr || !(TASK_LEVEL[task] || task === 'g7-close')) { console.error('usage: g67-cell.js --task g6-l4|g6-l5|g6-l6|g7-close --transcript <file> [--markers] [--extracted-out <file>]'); process.exit(2); }
  let obs;
  try { obs = extract(tr); } catch (e) { console.error(`g67-cell: ${e.message}`); process.exit(2); }
  const j = judge(task, obs);
  if (opt('--extracted-out')) {
    try { fs.writeFileSync(opt('--extracted-out'), `${JSON.stringify({ task, observed: obs, judged: j })}\n`); } catch (e) { console.error(`g67-cell: extracted-out: ${e.message}`); }
  }
  if (argv.includes('--markers')) console.log(`marker_${TASK_LEVEL[task] ? 'g6_size' : 'g7_close'}=${j.pass === true ? 'true' : 'false'}`);
  else console.log(JSON.stringify({ task, observed: obs, judged: j }));
}
