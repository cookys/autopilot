/**
 * merge-task-status-lib — hosted in hooks/audit-log.js's PostToolUse process (mods P1W HOOKQ, plan R5.8). Not a hook
 * of its own (`-lib.js` suffix; no new node process per tool call). A successful Bash merge into the integration
 * branch of a session that has a job root re-writes that root's `autopilot status task` input bundle by running
 * scripts/write-task-status-input.js DETACHED (its run time is never added to the hook).
 *
 * Fires only when ALL hold (depth-0 and subagents alike — foremen merge too):
 *   1. knob AUTOPILOT_MERGE_TASK_STATUS is not off;
 *   2. the session's marker (plain-inclusive, unexpired) carries a root_run_id;
 *   3. a command segment is a merge / integration form — `git [-C d|-c k=v]... merge|pull`, `gh pr merge`,
 *      `git push ... develop`; the command is first masked so text inside quotes and heredoc bodies never counts
 *      (`git merge --abort|--quit` is not a merge);
 *   4. the tool reported success (PostToolUse only fires on success; an `is_error` / `interrupted` / non-zero
 *      exit field is also refused);
 *   5. the repo's current branch after the command is the integration target: origin/HEAD's name, else the one
 *      local develop/main (develop wins when both exist), else `develop` (the finish-flow derivation, minus the
 *      project-config read which has no stable file today).
 * At most once per (root, HEAD sha): a stamp `<live>/merge-task-status/<root>.json` {sha} is written BEFORE the
 * spawn. Identity + pointers only (the W1b contract); a false trigger writes a harmless bundle `status task`
 * re-derives. Fail-open: any error -> one stderr line.
 */
'use strict';

const L = require('./live-session-lib.js');

const KNOB = 'AUTOPILOT_MERGE_TASK_STATUS';

// Same-length copy of `cmd` where quoted interiors and heredoc bodies are blanked, so a regex on the copy never
// sees text a shell would treat as data, and indices still slice the original.
function mask(cmd) {
  const chars = cmd.split('');
  // heredocs first: <<[-]['"]TAG['"] ... TAG on its own line
  const re = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n/g;
  let m;
  while ((m = re.exec(cmd)) !== null) {
    const bodyStart = m.index + m[0].length;
    const endRe = new RegExp(`^[ \\t]*${m[2]}[ \\t]*$`, 'm');
    const rest = cmd.slice(bodyStart);
    const e = endRe.exec(rest);
    const bodyEnd = e ? bodyStart + e.index + e[0].length : cmd.length;
    for (let i = bodyStart; i < bodyEnd; i++) if (chars[i] !== '\n') chars[i] = ' ';
    re.lastIndex = bodyEnd;
  }
  // quotes (single, double with backslash escapes)
  let i = 0;
  const n = chars.length;
  while (i < n) {
    const c = chars[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '#' && (i === 0 || /\s/.test(chars[i - 1]))) { // shell comment to end of line
      while (i < n && chars[i] !== '\n') { chars[i] = ' '; i++; }
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && chars[j] !== c) { if (c === '"' && chars[j] === '\\') j++; j++; }
      for (let k = i + 1; k < Math.min(j, n); k++) chars[k] = '_';
      i = j + 1;
      continue;
    }
    i++;
  }
  return chars.join('');
}

const GIT_PRE = String.raw`(?:^|[\s(])(?:\S*\/)?git(?:\s+(?:-C\s+\S+|-c\s+\S+|--git-dir=\S+|--work-tree=\S+|--no-pager|--no-optional-locks))*\s+`;
const RE_MERGE = new RegExp(`${GIT_PRE}(merge|pull)(?=\\s|$)([^;&|\\n]*)`);
const RE_PUSH = new RegExp(`${GIT_PRE}push(?=\\s|$)([^;&|\\n]*)`);
const RE_GH = /(?:^|[\s(])gh\s+pr\s+merge(?=\s|$)/;

// Split the masked command at ; && || | & and newlines; returns [{ masked, orig }].
function segments(cmd) {
  const m = mask(cmd);
  const out = [];
  const re = /&&|\|\||[;|&\n]/g;
  let last = 0;
  let x;
  while ((x = re.exec(m)) !== null) {
    out.push({ masked: m.slice(last, x.index), orig: cmd.slice(last, x.index) });
    last = x.index + x[0].length;
  }
  out.push({ masked: m.slice(last), orig: cmd.slice(last) });
  return out;
}

function unq(s) { return String(s).replace(/^['"]|['"]$/g, ''); }

// -> { form: 'merge'|'pull'|'gh-merge'|'push-develop', dir: string|null } for the first matching segment, else null.
// dir = `git -C <d>` of that segment, else the target of an earlier `cd <d>` segment, else null (use payload cwd).
function classify(cmd, targets) {
  if (typeof cmd !== 'string' || !cmd) return null;
  let cdDir = null;
  for (const seg of segments(cmd)) {
    const cd = /^\s*cd\s+(\S+)\s*$/.exec(seg.orig);
    if (cd) { cdDir = unq(cd[1]); continue; }
    let m = RE_MERGE.exec(seg.masked);
    if (m) {
      if (m[1] === 'merge' && /(^|\s)--(abort|quit|continue)(\s|$)/.test(m[2])) continue;
      const c = /\s-C\s+(\S+)/.exec(seg.orig);
      return { form: m[1], dir: c ? unq(c[1]) : cdDir };
    }
    if (RE_GH.test(seg.masked)) return { form: 'gh-merge', dir: cdDir };
    m = RE_PUSH.exec(seg.masked);
    if (m) {
      const tail = m[1].split(/\s+/).filter(Boolean).filter((t) => !t.startsWith('-'));
      // `git push [remote] [refspec...]`: any refspec naming the target (develop or src:develop)
      const names = (targets && targets.length ? targets : ['develop']);
      if (tail.slice(1).some((r) => names.includes(r.split(':').pop()))) {
        const c = /\s-C\s+(\S+)/.exec(seg.orig);
        return { form: 'push-develop', dir: c ? unq(c[1]) : cdDir };
      }
    }
  }
  return null;
}

function succeeded(resp) {
  if (resp && typeof resp === 'object') {
    if (resp.is_error === true || resp.interrupted === true) return false;
    for (const k of ['exit_code', 'exitCode', 'returncode', 'status_code']) {
      if (typeof resp[k] === 'number' && resp[k] !== 0) return false;
    }
  }
  return true;
}

function git(dir, args) {
  const { execFileSync } = require('child_process');
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function integrationTarget(dir) {
  const head = git(dir, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD']);
  const mm = head && /^refs\/remotes\/origin\/([^/\s][^\s]*)$/.exec(head);
  if (mm) return mm[1];
  const has = (b) => git(dir, ['rev-parse', '--verify', '-q', `refs/heads/${b}`]) !== null;
  if (has('develop')) return 'develop';
  if (has('main')) return 'main';
  return 'develop';
}

function markerRoot(sessionId) {
  return require('./ask-decision.js').markerRoot(sessionId);
}

function onPostToolUse(p) {
  if (!p || p.tool_name !== 'Bash' || L.knobOff(KNOB)) return;
  const cmd = p.tool_input && p.tool_input.command;
  if (typeof cmd !== 'string' || !/\b(merge|pull|push)\b/.test(cmd)) return; // cheap prefilter, hot path
  if (typeof p.session_id !== 'string' || !p.session_id || !succeeded(p.tool_response)) return;
  const hit = classify(cmd, ['develop', 'main']);
  if (!hit) return;
  const root = markerRoot(p.session_id);
  if (!root) return;
  const path = require('path');
  const base = typeof p.cwd === 'string' && p.cwd ? p.cwd : process.cwd();
  const dir = hit.dir ? path.resolve(base, hit.dir) : base;
  const top = git(dir, ['rev-parse', '--show-toplevel']);
  const sha = top && git(top, ['rev-parse', 'HEAD']);
  const branch = top && git(top, ['symbolic-ref', '--short', '-q', 'HEAD']);
  if (!top || !sha || !branch || branch !== integrationTarget(top)) return;
  const stamp = path.join(L.liveBase(), 'merge-task-status', `${require('../scripts/lib/live-state-dir.js').sanitizeSessionId(root)}.json`);
  const prev = L.readJsonFile(stamp);
  if (prev && prev.sha === sha) return;
  L.atomicWriteJson(stamp, { schema: 'autopilot.merge-task-status/1', root_run_id: root, sha, at: new Date().toISOString() });
  const { spawn } = require('child_process');
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'scripts', 'write-task-status-input.js'), '--repo', top, '--root-run-id', root],
    { detached: true, stdio: 'ignore', env: process.env, cwd: top });
  child.on('error', () => {});
  child.unref();
}

module.exports = { onPostToolUse, classify, mask, segments, succeeded, integrationTarget };
