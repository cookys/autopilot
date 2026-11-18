#!/usr/bin/env node
'use strict';

// pm-result-rules.js — deterministic checks for auto-accepting a task_result inbox item.
//
// Auto-accept requires ALL Round 1 + Round 2 checks to pass; any miss routes the item to
// pending_decision naming every failed check:
//   1. status_done                — status is "done"
//   2. assignee_mismatch          — sender == task.assignee (from adapter.getTask)
//   3. attempt_mismatch           — bound to task_id AND task.attempt (current generation)
//   4. sha / remote / commit time — evidence commit resolves in repo, exists on remote
//                                   (`git branch -r --contains` / local `git ls-remote`),
//                                   AND commit timestamp > task.dispatched_at
//   5. missing_independent_verify — independent `Verify:` or receipt sha line distinct
//                                   from the implementer's commit SHA claim
//   6. acceptance_unmatched       — every criterion in task.acceptance matched item by item
//   7. used_line                  — `Used:` names user or e2e (`n/a` fails)
//   8. no_exception_words         — none of: 例外, exception, waiver, 豁免, skipped, 未跑, 沒跑
//   9. no_threshold_change        — none of: 門檻, threshold, bar changed
//
// Node built-ins only; never makes network calls.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const GIT_REPO_ENV_VARS = Object.freeze([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_PREFIX',
  'GIT_NAMESPACE',
  'GIT_SUPER_PREFIX',
  'GIT_INTERNAL_SUPER_PREFIX',
]);

const ZH_EXCEPTION_WORDS = Object.freeze(['例外', '豁免', '未跑', '沒跑']);
const EN_EXCEPTION_WORDS = Object.freeze([
  ['exception', /\bexception\b/i],
  ['waiver', /\bwaiver\b/i],
  ['skipped', /\bskipped\b/i],
]);

const REPO_LINE_RE = /^\s*(?:[-*]\s*)?(?:repo|repository|repo_path|worktree)\s*[:=：]\s*(\S+)\s*$/gim;
const REPO_EXTRACT_RE = /^\s*(?:[-*]\s*)?(?:repo|repository|repo_path|worktree)\s*[:=：]\s*(\S+)\s*$/im;
const NON_COMMIT_META_LINE_RE = /^\s*(?:[-*]\s*)?(?:verify|verify[-_]receipt|verify[-_]code|receipt|receipt[-_]sha|acceptance[-_]receipt|acceptance[-_]code|task|task[-_]id|fleet[-_]task)\s*[:=：].*$/gim;
const USED_LINE_RE = /^\s*(?:[-*]\s*)?Used:\s*(\S.*)$/im;
const VERIFY_OR_RECEIPT_LINE_RE = /^\s*(?:[-*]\s*)?(verify|verify[-_]receipt|verify[-_]code|receipt|receipt[-_]sha|acceptance[-_]receipt|acceptance[-_]code)\s*[:=：]\s*(.+)$/gim;
const TASK_LINE_RE = /^\s*(?:[-*]\s*)?(?:task|task[-_]id|fleet[-_]task)\s*[:=：]\s*(\S+)\s*$/gim;
const ATTEMPT_PATTERNS = Object.freeze([
  /^\s*(?:[-*]\s*)?(?:attempt|generation|gen|嘗試)\s*[:=：]\s*(\d+)\b/gim,
  /\[\s*(?:attempt|generation|gen)\s*[:=]\s*(\d+)\s*\]/gi,
  /\b(?:attempt|generation)\s*=\s*(\d+)\b/gi,
]);
const STANDALONE_SHA_RE = /(?<![0-9a-zA-Z_/-])([0-9a-f]{7,40})(?![0-9a-zA-Z_/-])/gi;
const COMMIT_URL_SHA_RE = /\/commit\/([0-9a-f]{7,40})(?![0-9a-zA-Z_/-])/gi;
const HEX_TOKEN_RE = /(?<![0-9a-zA-Z])([0-9a-f]{7,64})(?![0-9a-zA-Z])/gi;

const STATUS_MAP_ZH = Object.freeze({
  完成: 'done',
  失敗: 'failed',
  拒絕: 'declined',
  進行中: 'in_progress',
});

function cleanGitEnv() {
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1' };
  for (const k of GIT_REPO_ENV_VARS) delete env[k];
  return env;
}

function runGit(repoPath, args, timeoutMs = 10000) {
  return spawnSync('git', ['-C', repoPath, ...args], {
    env: cleanGitEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
  });
}

function gitCatFileExists(repoPath, sha) {
  const res = runGit(repoPath, ['cat-file', '-e', sha]);
  return !res.error && res.status === 0;
}

function gitResolveCommitSha(repoPath, sha) {
  const res = runGit(repoPath, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]);
  if (res.error || res.status !== 0) return null;
  const full = String(res.stdout || '').trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(full) ? full : null;
}

function isLocalRemoteUrl(remoteUrl, repoPath) {
  const raw = String(remoteUrl || '').trim();
  if (!raw) return false;
  if (/^file:\/\//i.test(raw)) return true;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return false;
  if (/^[^/\\]+@[^:]+:/.test(raw)) return false;
  const candidate = path.isAbsolute(raw) ? raw : path.resolve(repoPath, raw);
  try {
    return fs.existsSync(candidate);
  } catch {
    return false;
  }
}

function gitCommitOnRemote(repoPath, fullSha) {
  const branchRes = runGit(repoPath, ['branch', '-r', '--contains', fullSha]);
  if (!branchRes.error && branchRes.status === 0) {
    const remoteBranches = String(branchRes.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.replace(/^\*?\s+/, '').trim())
      .filter(Boolean);
    if (remoteBranches.some((ref) => ref.startsWith('origin/'))) {
      return true;
    }
  }

  const urlRes = runGit(repoPath, ['config', '--get', 'remote.origin.url']);
  if (urlRes.error || urlRes.status !== 0) return false;
  const remoteUrl = String(urlRes.stdout || '').trim();
  if (!isLocalRemoteUrl(remoteUrl, repoPath)) {
    return false;
  }

  const lsRes = runGit(repoPath, ['ls-remote', '--heads', '--tags', 'origin']);
  if (lsRes.error || lsRes.status !== 0) return false;
  const remoteShas = String(lsRes.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((tok) => /^[0-9a-f]{40}$/i.test(tok))
    .map((tok) => tok.toLowerCase());

  for (const tipSha of remoteShas) {
    if (tipSha === fullSha) return true;
    const anc = runGit(repoPath, ['merge-base', '--is-ancestor', fullSha, tipSha]);
    if (!anc.error && anc.status === 0) return true;
  }
  return false;
}

function gitCommitTimestampSec(repoPath, fullSha) {
  const res = runGit(repoPath, ['show', '-s', '--format=%ct', fullSha]);
  if (res.error || res.status !== 0) return null;
  const sec = Number(String(res.stdout || '').trim());
  return Number.isFinite(sec) ? sec : null;
}

function defaultRepoExists(repoPath) {
  if (typeof repoPath !== 'string' || repoPath.trim() === '') return false;
  try {
    const resolved = path.resolve(repoPath);
    if (!fs.statSync(resolved).isDirectory()) return false;
    if (fs.existsSync(path.join(resolved, '.git'))) return true;
    return fs.existsSync(path.join(resolved, 'HEAD')) && fs.existsSync(path.join(resolved, 'objects'));
  } catch {
    return false;
  }
}

function extractItemStatus(item) {
  if (item && typeof item.status === 'string' && item.status.trim() !== '') {
    const raw = item.status.trim();
    return STATUS_MAP_ZH[raw] || raw.toLowerCase();
  }
  const content = item && typeof item.content === 'string' ? item.content : '';
  const kvMatch = content.match(/^\s*(?:[-*]\s*)?(?:status|task_status|狀態)\s*[:=：]\s*([a-z_]+|完成|失敗|拒絕|進行中)\b/im);
  if (kvMatch) {
    const raw = kvMatch[1].trim();
    return STATUS_MAP_ZH[raw] || raw.toLowerCase();
  }
  const bracketMatch = content.match(/\[\s*(?:status\s*[:=]\s*)?(done|failed|declined|in_progress)\s*\]/i);
  if (bracketMatch) {
    return bracketMatch[1].toLowerCase();
  }
  if (/(?<!\b0\s)\bfailed\b/i.test(content)) return 'failed';
  if (/\bdeclined\b/i.test(content)) return 'declined';
  if (/\bin_progress\b/i.test(content)) return 'in_progress';
  if (/\bdone\b/i.test(content)) return 'done';
  return null;
}

function extractRepoFromItem(item) {
  if (!item || typeof item !== 'object') return null;
  for (const key of ['repo', 'repo_path', 'repoPath', 'worktree', 'cwd']) {
    if (typeof item[key] === 'string' && item[key].trim() !== '') {
      return item[key].trim();
    }
  }
  const content = typeof item.content === 'string' ? item.content : '';
  const m = content.match(REPO_EXTRACT_RE);
  return m ? m[1].trim() : null;
}

function extractCitedShas(content, item = null) {
  const stripped = String(content || '')
    .replace(REPO_LINE_RE, '')
    .replace(NON_COMMIT_META_LINE_RE, '');
  const seen = new Set();
  if (item && typeof item.commit === 'string') {
    const c = item.commit.trim().toLowerCase();
    if (/^[0-9a-f]{7,40}$/.test(c)) seen.add(c);
  }
  let m;
  COMMIT_URL_SHA_RE.lastIndex = 0;
  while ((m = COMMIT_URL_SHA_RE.exec(stripped)) !== null) {
    seen.add(m[1].toLowerCase());
  }
  STANDALONE_SHA_RE.lastIndex = 0;
  while ((m = STANDALONE_SHA_RE.exec(stripped)) !== null) {
    seen.add(m[1].toLowerCase());
  }
  return [...seen];
}

function parseTimestampMs(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw < 1e12 ? raw * 1000 : raw;
  }
  if (typeof raw !== 'string' || raw.trim() === '') return NaN;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    return n < 1e12 ? n * 1000 : n;
  }
  return Date.parse(trimmed);
}

function checkStatusDone(item) {
  const st = extractItemStatus(item);
  if (st === 'done') {
    return { name: 'status_done', pass: true, detail: 'status is done' };
  }
  return { name: 'status_done', pass: false, detail: `status is ${st || 'missing'} (expected done)` };
}

function checkAssigneeMatch(item, task, opts = {}) {
  if (opts.taskShowAvailable === false) {
    return {
      name: 'task_show_unavailable',
      pass: false,
      detail: 'AUTOPILOT_PM_TASK_SHOW_CMD is unset; task metadata unavailable',
    };
  }
  if (!task || typeof task !== 'object') {
    return {
      name: 'task_unavailable',
      pass: false,
      detail: 'task record not found via adapter.getTask',
    };
  }
  const sender = (item && typeof item.from === 'string' && item.from.trim())
    ? item.from.trim()
    : ((item && typeof item.sender === 'string' && item.sender.trim()) ? item.sender.trim() : '');
  const assignee = typeof task.assignee === 'string' ? task.assignee.trim() : '';
  if (!sender || !assignee || sender !== assignee) {
    return {
      name: 'assignee_mismatch',
      pass: false,
      detail: `sender "${sender || 'missing'}" !== assignee "${assignee || 'missing'}"`,
    };
  }
  return {
    name: 'assignee_matched',
    pass: true,
    detail: `sender matches assignee (${assignee})`,
  };
}

function extractClaimedAttempts(item, content) {
  const found = [];
  for (const field of ['attempt', 'generation']) {
    if (item && item[field] !== undefined && item[field] !== null && String(item[field]).trim() !== '') {
      const n = Number(item[field]);
      found.push(Number.isInteger(n) ? n : NaN);
    }
  }
  const text = String(content || '');
  for (const re of ATTEMPT_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      found.push(Number(m[1]));
    }
  }
  return found;
}

function checkTaskAndAttemptBound(item, task) {
  const taskId = item && typeof item.task_id === 'string' ? item.task_id.trim() : '';
  if (!taskId) {
    return { name: 'missing_task_id', pass: false, detail: 'missing task_id on result item' };
  }
  const content = item && typeof item.content === 'string' ? item.content : '';
  if (task && typeof task.task_id === 'string' && task.task_id.trim() !== '' && task.task_id.trim() !== taskId) {
    return {
      name: 'task_binding',
      pass: false,
      detail: `item task_id "${taskId}" !== task record "${task.task_id.trim()}"`,
    };
  }
  TASK_LINE_RE.lastIndex = 0;
  let tm;
  while ((tm = TASK_LINE_RE.exec(content)) !== null) {
    if (tm[1].trim() !== taskId) {
      return {
        name: 'task_binding',
        pass: false,
        detail: `content task reference "${tm[1].trim()}" !== task_id "${taskId}"`,
      };
    }
  }

  const expectedAttempt = task && Number.isInteger(task.attempt) && task.attempt > 0 ? task.attempt : null;
  if (expectedAttempt === null) {
    return {
      name: 'attempt_mismatch',
      pass: false,
      detail: 'task current attempt/generation is missing from adapter.getTask',
    };
  }

  const claimed = extractClaimedAttempts(item, content);
  if (claimed.length === 0) {
    return {
      name: 'attempt_mismatch',
      pass: false,
      detail: `result does not bind attempt/generation (expected ${expectedAttempt})`,
    };
  }
  if (claimed.some((n) => !Number.isInteger(n) || n !== expectedAttempt)) {
    return {
      name: 'attempt_mismatch',
      pass: false,
      detail: `claimed attempt [${claimed.join(', ')}] !== current attempt ${expectedAttempt}`,
    };
  }
  return {
    name: 'attempt_bound',
    pass: true,
    detail: `bound to task ${taskId} attempt ${expectedAttempt}`,
  };
}

function checkRemoteCommitAndTime(item, task, opts = {}) {
  const content = item && typeof item.content === 'string' ? item.content : '';
  const repo = extractRepoFromItem(item) || (task && typeof task.repo === 'string' ? task.repo.trim() : null);
  const repoExists = opts.repoExists || defaultRepoExists;
  const resolveCommitSha = opts.resolveCommitSha || gitResolveCommitSha;
  const shaExists = opts.shaExists || null;
  const commitOnRemote = opts.commitOnRemote || gitCommitOnRemote;
  const commitTimestampSec = opts.commitTimestampSec || gitCommitTimestampSec;

  if (!repo || !repoExists(repo)) {
    return {
      check: {
        name: 'sha_unverifiable',
        pass: false,
        detail: repo ? `repo cannot be verified: ${repo}` : 'repo cannot be determined from item',
      },
      resolvedShas: [],
      citedShas: [],
    };
  }

  const citedShas = extractCitedShas(content, item);
  if (citedShas.length === 0) {
    return {
      check: {
        name: 'sha_unverifiable',
        pass: false,
        detail: 'no 7-40 hex evidence commit sha cited in content',
      },
      resolvedShas: [],
      citedShas: [],
    };
  }

  const resolvedShas = [];
  const unresolved = [];
  for (const sha of citedShas) {
    if (shaExists) {
      if (!shaExists(repo, sha)) {
        unresolved.push(sha);
      } else {
        resolvedShas.push(resolveCommitSha(repo, sha) || sha);
      }
    } else {
      const full = resolveCommitSha(repo, sha);
      if (!full) unresolved.push(sha);
      else resolvedShas.push(full);
    }
  }
  if (unresolved.length > 0) {
    return {
      check: {
        name: 'sha_unresolved',
        pass: false,
        detail: `unresolved sha(s) in ${repo}: ${unresolved.join(', ')}`,
      },
      resolvedShas,
      citedShas,
    };
  }

  const notOnRemote = resolvedShas.filter((fullSha) => !commitOnRemote(repo, fullSha));
  if (notOnRemote.length > 0) {
    return {
      check: {
        name: 'commit_not_on_remote',
        pass: false,
        detail: `commit not found on origin remote: ${notOnRemote.join(', ')}`,
      },
      resolvedShas,
      citedShas,
    };
  }

  const dispatchedMs = parseTimestampMs(task && task.dispatched_at);
  if (!Number.isFinite(dispatchedMs)) {
    return {
      check: {
        name: 'commit_before_dispatch',
        pass: false,
        detail: 'task dispatched_at is missing or unparseable',
      },
      resolvedShas,
      citedShas,
    };
  }

  for (const fullSha of resolvedShas) {
    const sec = commitTimestampSec(repo, fullSha);
    if (!Number.isFinite(sec) || (sec * 1000) <= dispatchedMs) {
      return {
        check: {
          name: 'commit_before_dispatch',
          pass: false,
          detail: `commit ${fullSha.slice(0, 12)} time (${sec}) is not later than dispatched_at (${task.dispatched_at})`,
        },
        resolvedShas,
        citedShas,
      };
    }
  }

  return {
    check: {
      name: 'sha_verified',
      pass: true,
      detail: `verified ${resolvedShas.length} remote commit(s) after dispatch`,
    },
    resolvedShas,
    citedShas,
  };
}

function shasOverlap(hexA, hexB) {
  const a = String(hexA || '').toLowerCase();
  const b = String(hexB || '').toLowerCase();
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

function checkIndependentVerify(item, commitShas = []) {
  const content = item && typeof item.content === 'string' ? item.content : '';
  const candidates = [];
  for (const field of ['verify', 'verify_code', 'acceptance_code', 'receipt', 'receipt_sha']) {
    if (item && typeof item[field] === 'string' && item[field].trim() !== '') {
      candidates.push(item[field].trim());
    }
  }
  VERIFY_OR_RECEIPT_LINE_RE.lastIndex = 0;
  let m;
  while ((m = VERIFY_OR_RECEIPT_LINE_RE.exec(content)) !== null) {
    if (m[2] && m[2].trim() !== '') {
      candidates.push(m[2].trim());
    }
  }

  if (candidates.length === 0) {
    return {
      name: 'missing_independent_verify',
      pass: false,
      detail: 'missing Verify: or receipt sha line',
    };
  }

  for (const val of candidates) {
    if (/^(?:n\/a|na|none|null|pending|todo|-|無)$/i.test(val)) continue;
    if (/\b(?:self[-_\s]?report|implementer[-_\s]?claim|same\s+as\s+commit)\b/i.test(val)) continue;

    HEX_TOKEN_RE.lastIndex = 0;
    const hexTokens = [];
    let hm;
    while ((hm = HEX_TOKEN_RE.exec(val)) !== null) {
      hexTokens.push(hm[1].toLowerCase());
    }

    const overlapsCommit = hexTokens.some((tok) => commitShas.some((c) => shasOverlap(tok, c)))
      || commitShas.some((c) => shasOverlap(val.trim(), c));
    if (overlapsCommit) continue;

    const hasCodeOrReceipt = hexTokens.length > 0
      || /\b(?:rc=0|exit=0|exit\s+0|(?:receipt|code)[=:\s_-]*[A-Za-z0-9._/-]+|sha256:[0-9a-f]{7,64}|01[0-9A-HJKMNP-TV-Z]{24})\b/i.test(val)
      || /\.json\b/i.test(val);
    if (hasCodeOrReceipt) {
      return {
        name: 'independent_verify',
        pass: true,
        detail: `independent verification present: ${val.slice(0, 80)}`,
      };
    }
  }

  return {
    name: 'missing_independent_verify',
    pass: false,
    detail: 'Verify:/receipt line missing, n/a, or not distinct from implementer commit claim',
  };
}

function isLineFailedOrUnchecked(line) {
  if (/\[\s\]/.test(line)) return true;
  if (/\b(?:fail|failed|missing|unchecked|not\s+met|not\s+run|n\/a)\b/i.test(line)) return true;
  if (/未通過|未完成|失敗/.test(line)) return true;
  return false;
}

function checkAcceptanceCriteria(item, task) {
  const criteria = task && Array.isArray(task.acceptance) ? task.acceptance : null;
  if (!criteria || criteria.length === 0) {
    return {
      name: 'acceptance_unmatched',
      pass: false,
      detail: 'task dispatch has no acceptance criteria recorded',
    };
  }

  const content = item && typeof item.content === 'string' ? item.content : '';
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const missing = [];

  for (const rawCrit of criteria) {
    const crit = String(rawCrit || '').trim();
    if (!crit) {
      missing.push('(empty criterion)');
      continue;
    }
    const lowCrit = crit.toLowerCase();
    const matched = lines.some((line) => line.toLowerCase().includes(lowCrit) && !isLineFailedOrUnchecked(line));
    if (!matched) {
      missing.push(crit);
    }
  }

  if (missing.length > 0) {
    return {
      name: 'acceptance_unmatched',
      pass: false,
      detail: `unmatched acceptance criteria (${missing.length}/${criteria.length}): ${missing.join('; ')}`,
    };
  }

  return {
    name: 'acceptance_matched',
    pass: true,
    detail: `matched all ${criteria.length} acceptance criteria`,
  };
}

function checkUsedLine(content) {
  const m = String(content || '').match(USED_LINE_RE);
  if (!m) {
    return { name: 'used_line', pass: false, detail: 'missing Used: line in content' };
  }
  const val = m[1].trim();
  if (
    /^(?:n\/a|na|none|null|no|false|todo|tbd|pending|-|無|未驗證)$/i.test(val)
    || /\b(?:n\/a|not\s+(?:user|e2e)|no\s+(?:user|e2e)|without\s+(?:user|e2e))\b/i.test(val)
  ) {
    return { name: 'used_line', pass: false, detail: `Used: "${val.slice(0, 60)}" is n/a or negated` };
  }
  if (!/\b(?:user|e2e)\b/i.test(val)) {
    return { name: 'used_line', pass: false, detail: `Used: "${val.slice(0, 60)}" must be user or e2e` };
  }
  return { name: 'used_line', pass: true, detail: `Used: ${val.slice(0, 80)}` };
}

function checkNoExceptionWords(content) {
  const text = String(content || '');
  const hits = [];
  for (const w of ZH_EXCEPTION_WORDS) {
    if (text.includes(w)) hits.push(w);
  }
  for (const [label, re] of EN_EXCEPTION_WORDS) {
    if (re.test(text)) hits.push(label);
  }
  if (hits.length === 0) {
    return { name: 'no_exception_words', pass: true, detail: 'no exception words found' };
  }
  return { name: 'no_exception_words', pass: false, detail: `exception word(s) present: ${hits.join(', ')}` };
}

function checkNoThresholdChange(content) {
  const text = String(content || '');
  const hits = [];
  if (text.includes('門檻')) hits.push('門檻');
  if (/\bthreshold\b/i.test(text)) hits.push('threshold');
  if (/\bbar\s+changed\b/i.test(text)) hits.push('bar changed');
  if (hits.length === 0) {
    return { name: 'no_threshold_change', pass: true, detail: 'no threshold/bar change claimed' };
  }
  return { name: 'no_threshold_change', pass: false, detail: `threshold/bar claim: ${hits.join(', ')}` };
}

function evaluateTaskResult(item, opts = {}) {
  const content = item && typeof item.content === 'string' ? item.content : '';
  const task = opts.task || null;
  const commitEval = checkRemoteCommitAndTime(item, task, opts);
  const allCommitShas = [...new Set([...commitEval.citedShas, ...commitEval.resolvedShas])];

  const checks = [
    checkStatusDone(item),
    checkAssigneeMatch(item, task, opts),
    checkTaskAndAttemptBound(item, task),
    commitEval.check,
    checkIndependentVerify(item, allCommitShas),
    checkAcceptanceCriteria(item, task),
    checkUsedLine(content),
    checkNoExceptionWords(content),
    checkNoThresholdChange(content),
  ];
  const failed = [...new Set(checks.filter((c) => !c.pass).map((c) => c.name))];
  return {
    pass: failed.length === 0,
    checks,
    failed,
  };
}

module.exports = {
  gitCatFileExists,
  gitResolveCommitSha,
  gitCommitOnRemote,
  gitCommitTimestampSec,
  extractItemStatus,
  extractRepoFromItem,
  extractCitedShas,
  evaluateTaskResult,
};
