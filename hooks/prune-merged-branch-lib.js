/**
 * prune-merged-branch-lib — hosted in hooks/audit-log.js's PostToolUse process (not a standalone hook;
 * `-lib.js` suffix keeps check-hook-inventory from counting a new hook process).
 *
 * When a successful Bash command segment is `git [-C d] push <remote> <x>:<target>` or
 * `git push <remote> <target>` where <target> is the integration branch (same derivation as
 * merge-task-status-lib), inspects merge commits in `<old remote target>..<new tip>`, parses the
 * merged head branch from subjects of the form `Merge branch '<b>'` (incl. `into <target>`),
 * `Merge <b>`, or `Merge <b>: ...`, and runs `scripts/prune-merged-branch.js` for each DETACHED
 * (never adding to hook wall time), appending JSON lines to
 * `<live dir>/prune-merged-branch/<repo-key>.jsonl` and one stderr line per result.
 *
 * Knob: AUTOPILOT_PRUNE_MERGED_BRANCH (default on; `off`/`false`/`0`/`no` disables). Fail-open.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn, spawnSync } = require('child_process');
const L = require('./live-session-lib.js');
const { mask, segments, succeeded, integrationTarget } = require('./merge-task-status-lib.js');

const KNOB = 'AUTOPILOT_PRUNE_MERGED_BRANCH';
const ZERO_SHA = '0000000000000000000000000000000000000000';
const PRUNE_SCRIPT = path.join(__dirname, '..', 'scripts', 'prune-merged-branch.js');

const GIT_PRE = String.raw`(?:^|[\s(])(?:\S*\/)?git(?:\s+(?:-C\s+\S+|-c\s+\S+|--git-dir=\S+|--work-tree=\S+|--no-pager|--no-optional-locks))*\s+`;
const RE_PUSH = new RegExp(`${GIT_PRE}push(?=\\s|$)([^;&|\\n]*)`);
const VALUE_FLAGS = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
const STOP_FLAGS = new Set(['-d', '--delete', '-n', '--dry-run', '--mirror', '--all', '--tags']);

function unq(s) {
  return String(s).replace(/^[\x27\x22]|[\x27\x22]$/g, '');
}

function isValidBranchName(b) {
  if (typeof b !== 'string' || !b || b.length > 255) return false;
  if (b.startsWith('-') || b.startsWith('/') || b.startsWith('.') || b.endsWith('/') || b.endsWith('.') || b.endsWith('.lock')) return false;
  if (b.includes('..') || b.includes('@{') || b.includes('//') || b.includes('\\')) return false;
  if (/[\x00-\x20\x7f~^:?*\[]/.test(b)) return false;
  return !b.split('/').some((seg) => !seg || seg.startsWith('.') || seg.endsWith('.lock'));
}

// Parse the merged head branch name from a merge commit subject, or return null when unparseable.
function parseMergedBranch(subject, target) {
  if (typeof subject !== 'string' || !subject) return null;
  const s = subject.trim();

  // Form 1: Merge branch '<b>' [of <url>] [into <dest>]
  let m = /^Merge\s+branch\s+([\x27\x22])([^\x27\x22\s]+)\1(?:\s+of\s+\S+)?(?:\s+into\s+(\S+))?\s*$/.exec(s);
  if (m) {
    if (m[3] && target && m[3] !== target) return null;
    const b = m[2].startsWith('refs/heads/') ? m[2].slice('refs/heads/'.length) : m[2];
    return isValidBranchName(b) ? b : null;
  }

  // Form 2: Merge <b>: <summary>  (incl. Merge feat/...: ... and Merge <b>:)
  m = /^Merge\s+([^\s:\x27\x22]+):(?:\s.*)?$/.exec(s);
  if (m) {
    const b = m[1].startsWith('refs/heads/') ? m[1].slice('refs/heads/'.length) : m[1];
    return isValidBranchName(b) ? b : null;
  }

  // Form 3: Merge <b> [into <dest>]  (single branch token; skips multi-word subjects like "Merge pull request ...")
  m = /^Merge\s+([^\s:\x27\x22]+)(?:\s+into\s+(\S+))?\s*$/.exec(s);
  if (m) {
    if (m[2] && target && m[2] !== target) return null;
    const b = m[1].startsWith('refs/heads/') ? m[1].slice('refs/heads/'.length) : m[1];
    return isValidBranchName(b) ? b : null;
  }

  return null;
}

// Extract all `git [-C d] push <remote> <src>:<target>` and `git push <remote> <target>` candidates from cmd,
// ignoring quoted strings, comments, heredoc bodies, dry-runs, and delete pushes.
function findPushes(cmd) {
  if (typeof cmd !== 'string' || !cmd) return [];
  const out = [];
  let cdDir = null;
  for (const seg of segments(cmd)) {
    const cd = /^\s*cd\s+(\S+)\s*$/.exec(seg.masked);
    if (cd) {
      const idx = seg.masked.indexOf(cd[1]);
      cdDir = unq(seg.orig.slice(idx, idx + cd[1].length));
      continue;
    }
    const m = RE_PUSH.exec(seg.masked);
    if (!m) continue;
    const preEnd = m.index + m[0].length - m[1].length;
    const preMasked = seg.masked.slice(m.index, preEnd);
    let gitDir = null;
    const cRe = /\s-C\s+(\S+)/g;
    let cm;
    while ((cm = cRe.exec(preMasked)) !== null) {
      const valStart = m.index + cm.index + cm[0].length - cm[1].length;
      gitDir = unq(seg.orig.slice(valStart, valStart + cm[1].length));
    }
    const dir = gitDir || cdDir;
    const tailStart = preEnd;
    const rawTokens = [];
    const tokRe = /\S+/g;
    let tm;
    while ((tm = tokRe.exec(m[1])) !== null) {
      rawTokens.push(unq(seg.orig.slice(tailStart + tm.index, tailStart + tm.index + tm[0].length)));
    }
    let skipSeg = false;
    const pos = [];
    for (let i = 0; i < rawTokens.length; i += 1) {
      const t = rawTokens[i];
      if (t === '--') {
        pos.push(...rawTokens.slice(i + 1));
        break;
      }
      if (STOP_FLAGS.has(t)) {
        skipSeg = true;
        break;
      }
      if (VALUE_FLAGS.has(t)) {
        i += 1;
        continue;
      }
      if (t.startsWith('-')) continue;
      pos.push(t);
    }
    if (skipSeg || pos.length < 2) continue;
    const remote = pos[0];
    if (!remote || remote.startsWith('-') || /\s/.test(remote)) continue;
    for (const spec of pos.slice(1)) {
      if (!spec || spec.startsWith(':')) continue;
      const clean = spec.startsWith('+') ? spec.slice(1) : spec;
      const parts = clean.split(':');
      if (parts.length > 2) continue;
      const src = parts[0];
      const rawDst = parts.length === 2 ? parts[1] : parts[0];
      if (!src || !rawDst) continue;
      if (rawDst.startsWith('refs/tags/')) continue;
      let dst = rawDst;
      if (dst.startsWith('refs/heads/')) dst = dst.slice('refs/heads/'.length);
      else if (dst.startsWith('refs/')) continue;
      out.push({ dir, remote, src, target: dst });
    }
  }
  return out;
}

function git(dir, args) {
  try {
    return execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function repoKeyFor(commonDir) {
  const canonical = fs.realpathSync(commonDir);
  return crypto.createHash('sha256').update(`git-common-dir:${canonical}`).digest('hex').slice(0, 16);
}

function oldTipFromReflog(commonDir, remote, target, newTip) {
  const logFile = path.join(commonDir, 'logs', 'refs', 'remotes', ...remote.split('/'), ...target.split('/'));
  let raw;
  try {
    raw = fs.readFileSync(logFile, 'utf8');
  } catch {
    return null;
  }
  const lines = raw.split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const m = /^([0-9a-f]{40}) ([0-9a-f]{40})\b/.exec(lines[i]);
    if (m && m[2] === newTip && m[1] !== newTip) return m[1];
  }
  return null;
}

function oldTipFromResponse(top, resp) {
  if (!resp || typeof resp !== 'object') return null;
  const text = `${resp.stdout || ''}\n${resp.stderr || ''}`;
  const m = /\b([0-9a-f]{7,40})\.\.([0-9a-f]{7,40})\b/.exec(text);
  if (!m) return null;
  return git(top, ['rev-parse', '--verify', '-q', `${m[1]}^{commit}`]);
}

function resolvePushRange(top, commonDir, remote, src, target, resp) {
  if (git(top, ['remote', 'get-url', remote]) === null) return null;
  const newTip = git(top, ['rev-parse', '--verify', '-q', `${src}^{commit}`])
    || git(top, ['rev-parse', '--verify', '-q', `refs/heads/${src}^{commit}`]);
  if (!newTip) return null;

  const remoteRefSha = git(top, ['rev-parse', '--verify', '-q', `refs/remotes/${remote}/${target}^{commit}`]);
  let oldTip = null;
  if (remoteRefSha && remoteRefSha !== newTip) {
    oldTip = remoteRefSha;
  } else if (remoteRefSha === newTip) {
    const fromLog = oldTipFromReflog(commonDir, remote, target, newTip);
    if (fromLog && fromLog !== ZERO_SHA) {
      oldTip = fromLog;
    } else if (fromLog === ZERO_SHA) {
      oldTip = oldTipFromResponse(top, resp)
        || (git(top, ['rev-parse', '--verify', '-q', `${newTip}^2^{commit}`])
          ? git(top, ['rev-parse', '--verify', '-q', `${newTip}^1^{commit}`])
          : null);
    } else {
      oldTip = oldTipFromResponse(top, resp);
    }
  } else {
    oldTip = oldTipFromResponse(top, resp);
  }

  if (!oldTip || oldTip === newTip) return null;
  return { oldTip, newTip };
}

function mergedBranchesInRange(top, oldTip, newTip, target) {
  const raw = git(top, ['log', '--merges', '--reverse', '--format=%H%x00%P%x00%s', `${oldTip}..${newTip}`]);
  if (!raw) return [];
  const seen = new Set();
  const branches = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    const parts = line.split('\0');
    if (parts.length < 3) continue;
    const parents = parts[1].trim().split(/\s+/).filter(Boolean);
    if (parents.length < 2) continue; // require second parent
    const branch = parseMergedBranch(parts[2], target);
    if (!branch || branch === target || seen.has(branch)) continue;
    seen.add(branch);
    branches.push(branch);
  }
  return branches;
}

function detachedStderrTarget() {
  try {
    const st = fs.fstatSync(2);
    if (st.isFile() || st.isCharacterDevice()) return 2;
  } catch { /* ignore */ }
  return 'ignore';
}

function onPostToolUse(p) {
  if (!p || p.tool_name !== 'Bash' || L.knobOff(KNOB)) return;
  const cmd = p.tool_input && p.tool_input.command;
  if (typeof cmd !== 'string' || !/\bpush\b/.test(cmd)) return;
  if (!succeeded(p.tool_response)) return;
  const pushes = findPushes(cmd);
  if (!pushes.length) return;

  const base = typeof p.cwd === 'string' && p.cwd ? p.cwd : process.cwd();
  for (const hit of pushes) {
    const dir = hit.dir ? path.resolve(base, hit.dir) : base;
    const top = git(dir, ['rev-parse', '--show-toplevel']);
    if (!top) continue;
    if (hit.target !== integrationTarget(top)) continue;
    const commonDir = git(top, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    if (!commonDir) continue;
    const range = resolvePushRange(top, commonDir, hit.remote, hit.src, hit.target, p.tool_response);
    if (!range) continue;
    const branches = mergedBranchesInRange(top, range.oldTip, range.newTip, hit.target);
    if (!branches.length) continue;

    const repoKey = repoKeyFor(commonDir);
    const jsonlPath = path.join(L.liveBase(), 'prune-merged-branch', `${repoKey}.jsonl`);
    fs.mkdirSync(path.dirname(jsonlPath), { recursive: true, mode: 0o700 });
    process.stderr.write(`prune-merged-branch: pruning ${branches.join(', ')} on ${hit.remote} -> ${jsonlPath}\n`);

    const child = spawn(
      process.execPath,
      [__filename, 'run', '--repo', top, '--remote', hit.remote, '--target', hit.target, '--jsonl', jsonlPath, '--', ...branches],
      { detached: true, stdio: ['ignore', 'ignore', detachedStderrTarget()], cwd: top },
    );
    child.on('error', () => {});
    child.unref();
  }
}

function runBatch(argv) {
  let repo = null;
  let remote = 'origin';
  let target = 'develop';
  let jsonl = null;
  const branches = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--') {
      branches.push(...argv.slice(i + 1));
      break;
    }
    if (a === '--repo') repo = argv[++i];
    else if (a === '--remote') remote = argv[++i];
    else if (a === '--target') target = argv[++i];
    else if (a === '--jsonl') jsonl = argv[++i];
  }
  if (!repo || !jsonl || !branches.length) return 0;
  fs.mkdirSync(path.dirname(jsonl), { recursive: true, mode: 0o700 });

  for (const branch of branches) {
    try {
      const r = spawnSync(
        process.execPath,
        [PRUNE_SCRIPT, '--repo', repo, '--branch', branch, '--remote', remote, '--target', target],
        { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const line = String(r.stdout || '').trim().split('\n').filter(Boolean)[0] || '';
      let rec = null;
      if (line) {
        try { rec = JSON.parse(line); } catch { rec = null; }
      }
      if (!rec) {
        rec = {
          schema: 'autopilot.prune-merged-branch/1',
          repo,
          remote,
          branch,
          target,
          action: 'error',
          reason: String(r.stderr || 'prune_script_failed').trim().slice(0, 200) || 'prune_script_failed',
          unmerged: null,
          head_sha: null,
        };
      }
      process.stderr.write(`prune-merged-branch: ${rec.remote}/${rec.branch} -> ${rec.action}${rec.reason ? ` (${rec.reason})` : ''}\n`);
      fs.appendFileSync(jsonl, `${JSON.stringify(rec)}\n`, { mode: 0o600 });
    } catch (e) {
      process.stderr.write(`prune-merged-branch: fail-open on ${branch}: ${e && e.message ? e.message : e}\n`);
    }
  }
  return 0;
}

if (require.main === module && process.argv[2] === 'run') {
  try {
    process.exitCode = runBatch(process.argv.slice(3));
  } catch (e) {
    process.stderr.write(`prune-merged-branch: runner fail-open: ${e && e.message ? e.message : e}\n`);
    process.exitCode = 0;
  }
}

module.exports = {
  onPostToolUse,
  findPushes,
  parseMergedBranch,
  mergedBranchesInRange,
  repoKeyFor,
  mask,
};
