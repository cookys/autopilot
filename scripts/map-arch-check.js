#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const DEFAULT_MAX_INPUT_CHARS = 60000;
const DEFAULT_TIMEOUT_MS = 600000;
const MAX_CANDIDATES = 5;

function parseArgs(argv) {
  const args = {
    repo: process.cwd(),
    engineCmd: '',
    maxInputChars: DEFAULT_MAX_INPUT_CHARS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    write: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    const val = argv[i + 1];
    if (flag === '--repo' && val !== undefined) {
      args.repo = path.resolve(val);
      i++;
    } else if (flag === '--engine-cmd' && val !== undefined) {
      args.engineCmd = val;
      i++;
    } else if (flag === '--max-input-chars' && val !== undefined) {
      const n = Number(val);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`Invalid --max-input-chars: ${val}`);
      }
      args.maxInputChars = Math.floor(n);
      i++;
    } else if (flag === '--timeout-ms' && val !== undefined) {
      const n = Number(val);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`Invalid --timeout-ms: ${val}`);
      }
      args.timeoutMs = Math.floor(n);
      i++;
    } else if (flag === '--write') {
      args.write = true;
    }
  }
  return args;
}

function listTrackedFiles(repo) {
  try {
    const out = execFileSync('git', ['ls-files'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function buildPrompt(archContent, files, maxInputChars) {
  const header = [
    '請閱讀以下 ARCHITECTURE.md 與檔案清單，產出最多 5 條重構候選。',
    '請只回傳 JSON 陣列，每個元素格式為：',
    '{"title":"...","why":"...","files":["..."],"recommendation":"..."}',
    '',
    '=== ARCHITECTURE.md ===',
    archContent,
    '',
    '=== git ls-files ===',
    '',
  ].join('\n');

  const filesText = files.join('\n');
  const full = header + filesText;
  if (full.length <= maxInputChars) {
    return { prompt: full, truncated: false };
  }

  const remaining = Math.max(0, maxInputChars - header.length);
  const truncatedFiles = filesText.slice(0, remaining);
  return { prompt: header + truncatedFiles, truncated: true };
}

function parseCandidates(stdout) {
  const raw = (stdout || '').trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, reason: `invalid_json: ${err.message}` };
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, reason: 'invalid_json: expected JSON array' };
  }

  let dropped = 0;
  const valid = [];
  for (const item of parsed) {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.title !== 'string' ||
      !item.title.trim() ||
      typeof item.why !== 'string' ||
      !item.why.trim() ||
      typeof item.recommendation !== 'string' ||
      !item.recommendation.trim()
    ) {
      dropped++;
      continue;
    }
    const files = Array.isArray(item.files)
      ? item.files.filter((f) => typeof f === 'string' && f.trim()).map((f) => f.trim())
      : [];
    valid.push({
      title: item.title.trim(),
      why: item.why.trim(),
      files,
      recommendation: item.recommendation.trim(),
    });
  }

  return {
    ok: true,
    candidates: valid.slice(0, MAX_CANDIDATES),
    dropped,
  };
}

function formatSection(candidates, incomplete) {
  const lines = ['## 重構候選'];
  if (incomplete) {
    lines.push('（未完整）');
  }
  for (const c of candidates) {
    const filesStr = c.files.length > 0 ? c.files.join(', ') : '無';
    lines.push(`- ${c.title}：${c.why}（檔案：${filesStr}）；推薦：${c.recommendation}`);
  }
  return lines.join('\n');
}

function replaceRefactorSection(archContent, sectionText) {
  const headingRe = /^## 重構候選[ \t]*$/m;
  const match = headingRe.exec(archContent);
  if (!match) {
    const sep = archContent.endsWith('\n') ? '\n' : '\n\n';
    return archContent + sep + sectionText + '\n';
  }

  const startIdx = match.index;
  const afterHeadingIdx = startIdx + match[0].length;
  const rest = archContent.slice(afterHeadingIdx);
  const nextHeadingMatch = /\n## [^\n]+/.exec(rest);

  if (!nextHeadingMatch) {
    return archContent.slice(0, startIdx) + sectionText + '\n';
  }

  const endIdx = afterHeadingIdx + nextHeadingMatch.index + 1;
  return archContent.slice(0, startIdx) + sectionText + '\n\n' + archContent.slice(endIdx);
}

function runMapArchCheck(options) {
  const repo = path.resolve(options.repo);
  const mapPath = path.join(repo, 'ARCHITECTURE.md');

  if (!fs.existsSync(mapPath)) {
    return { ok: true, skipped: 'no_map' };
  }

  if (!options.engineCmd || !options.engineCmd.trim()) {
    return { ok: false, reason: 'missing_engine_cmd' };
  }

  const archContent = fs.readFileSync(mapPath, 'utf8');
  const files = listTrackedFiles(repo);
  const maxInputChars = options.maxInputChars || DEFAULT_MAX_INPUT_CHARS;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

  const { prompt, truncated } = buildPrompt(archContent, files, maxInputChars);

  const argv = options.engineCmd.trim().split(/\s+/);
  const cmd = argv[0];
  const cmdArgs = argv.slice(1);

  const proc = spawnSync(cmd, cmdArgs, {
    cwd: repo,
    input: prompt,
    encoding: 'utf8',
    shell: false,
    timeout: timeoutMs,
  });

  if (proc.error) {
    const reason =
      proc.error.code === 'ETIMEDOUT'
        ? `engine_timeout_after_${timeoutMs}ms`
        : `engine_error: ${proc.error.message}`;
    return { ok: false, reason };
  }

  if (proc.status !== 0) {
    return { ok: false, reason: `engine_exit_${proc.status}` };
  }

  const parsed = parseCandidates(proc.stdout);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason };
  }

  const incomplete = Boolean(truncated);
  const result = {
    ok: true,
    candidates: parsed.candidates,
    dropped: parsed.dropped,
    incomplete,
  };

  if (options.write) {
    const sectionText = formatSection(parsed.candidates, incomplete);
    const updated = replaceRefactorSection(archContent, sectionText);
    fs.writeFileSync(mapPath, updated, 'utf8');
  }

  return result;
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv);
    const result = runMapArchCheck(args);
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, reason: err.message }) + '\n');
    process.exit(1);
  }
}

module.exports = {
  runMapArchCheck,
  buildPrompt,
  parseCandidates,
  formatSection,
  replaceRefactorSection,
};
