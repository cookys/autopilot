#!/usr/bin/env node
'use strict';

// pm-result-rules.js — deterministic checks for auto-accepting a task_result inbox item.
//
// All five checks must pass, else the item routes to pending_decision naming failed checks:
//   1. status_done          — status is "done"
//   2. used_line            — content contains a non-empty `Used:` line
//   3. no_exception_words   — content contains none of: 例外, exception, waiver, 豁免, skipped, 未跑, 沒跑
//   4. sha_verified         — every 7-40 hex sha cited in content resolves via `git cat-file -e`
//                             in the repo named by the item (if repo cannot be determined or no
//                             sha is cited, fails as `sha_unverifiable`; unresolved sha fails as
//                             `sha_unresolved`)
//   5. no_threshold_change  — content claims none of: 門檻, threshold, bar changed
//
// Exports pure check evaluation plus one git helper (`gitCatFileExists`).
// Node built-ins only.

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
const USED_LINE_RE = /^\s*(?:[-*]\s*)?Used:\s*(\S.*)$/m;
const STANDALONE_SHA_RE = /(?<![0-9a-zA-Z_/-])([0-9a-f]{7,40})(?![0-9a-zA-Z_/-])/gi;
const COMMIT_URL_SHA_RE = /\/commit\/([0-9a-f]{7,40})(?![0-9a-zA-Z_/-])/gi;

const STATUS_MAP_ZH = Object.freeze({
  完成: 'done',
  失敗: 'failed',
  拒絕: 'declined',
  進行中: 'in_progress',
});

function gitCatFileExists(repoPath, sha) {
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1' };
  for (const k of GIT_REPO_ENV_VARS) delete env[k];
  const res = spawnSync('git', ['-C', repoPath, 'cat-file', '-e', sha], {
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'ignore'],
    timeout: 10000,
  });
  return !res.error && res.status === 0;
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

function extractCitedShas(content) {
  const stripped = String(content || '').replace(REPO_LINE_RE, '');
  const seen = new Set();
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

function checkStatusDone(item) {
  const st = extractItemStatus(item);
  if (st === 'done') {
    return { name: 'status_done', pass: true, detail: 'status is done' };
  }
  return { name: 'status_done', pass: false, detail: `status is ${st || 'missing'} (expected done)` };
}

function checkUsedLine(content) {
  const m = String(content || '').match(USED_LINE_RE);
  if (m) {
    return { name: 'used_line', pass: true, detail: `Used: ${m[1].trim().slice(0, 80)}` };
  }
  return { name: 'used_line', pass: false, detail: 'missing Used: line in content' };
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

function checkShasInRepo(item, opts = {}) {
  const content = item && typeof item.content === 'string' ? item.content : '';
  const repo = extractRepoFromItem(item);
  const repoExists = opts.repoExists || defaultRepoExists;
  const shaExists = opts.shaExists || gitCatFileExists;

  if (!repo || !repoExists(repo)) {
    return {
      name: 'sha_unverifiable',
      pass: false,
      detail: repo ? `repo cannot be verified: ${repo}` : 'repo cannot be determined from item',
    };
  }

  const shas = extractCitedShas(content);
  if (shas.length === 0) {
    return {
      name: 'sha_unverifiable',
      pass: false,
      detail: 'no 7-40 hex sha cited in content',
    };
  }

  const unresolved = shas.filter((sha) => !shaExists(repo, sha));
  if (unresolved.length > 0) {
    return {
      name: 'sha_unresolved',
      pass: false,
      detail: `unresolved sha(s) in ${repo}: ${unresolved.join(', ')}`,
    };
  }

  return {
    name: 'sha_verified',
    pass: true,
    detail: `verified ${shas.length} sha(s)`,
  };
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
  const checks = [
    checkStatusDone(item),
    checkUsedLine(content),
    checkNoExceptionWords(content),
    checkShasInRepo(item, opts),
    checkNoThresholdChange(content),
  ];
  const failed = checks.filter((c) => !c.pass).map((c) => c.name);
  return {
    pass: failed.length === 0,
    checks,
    failed,
  };
}

module.exports = {
  gitCatFileExists,
  extractItemStatus,
  extractRepoFromItem,
  extractCitedShas,
  evaluateTaskResult,
};
