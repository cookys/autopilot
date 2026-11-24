#!/usr/bin/env node
'use strict';
// baseline extractor stdout: JSONL rows {ts,id,packet_id,handled,latency_ms,engine,tokens,turns}.
// daily input: <state>/switchboard/handling/<YYYY-MM-DD>.jsonl
//   rows {ts,id,packet_id,handled,latency_ms,engine,kind,escalated}
//   plus optional boolean breach flags (authority_breach, missed_operator_ask, wrong_executor, sensitive_send)
//   and optional tokens/turns for baseline tokens_per_turn comparison.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { configPath } = require('./lib/config-path');
const cnGate = require('./lib/cn-model-dispatch-gate');

const BREACH_FIELDS = Object.freeze([
  'authority_breach',
  'missed_operator_ask',
  'wrong_executor',
  'sensitive_send',
]);
const VALID_VERDICTS = new Set(['auto', 'escalate', 'question']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SECOND_ENGINE_TIMEOUT_MS = 30000;

function stateRoot() {
  return process.env.AUTOPILOT_STATE_DIR || path.join(os.homedir(), '.autopilot');
}

function isValidDate(dateStr) {
  if (typeof dateStr !== 'string' || !DATE_RE.test(dateStr)) return false;
  const parsedDate = new Date(`${dateStr}T00:00:00Z`);
  return !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === dateStr;
}

function previousDate(dateStr) {
  const dt = new Date(`${dateStr}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

function compareById(a, b) {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

function sampleEquidistant10Pct(rows) {
  if (!rows.length) return [];
  const sorted = [...rows].sort(compareById);
  const sampleCount = Math.max(1, Math.floor((sorted.length + 9) / 10));
  const picked = [];
  for (let i = 0; i < sampleCount; i += 1) {
    picked.push(sorted[Math.floor((i * sorted.length) / sampleCount)]);
  }
  return picked;
}

function sampleFirst50(rows) {
  if (!rows.length) return [];
  return [...rows].sort(compareById).slice(0, 50);
}

function nearestRankPercentile(values, pct) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.floor((pct * sorted.length + 99) / 100);
  const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[idx];
}

function buildChildEnv(baseEnv) {
  const env = { ...baseEnv };
  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_MODEL;
  delete env.OPENAI_BASE_URL;
  delete env.OPENAI_API_BASE;
  for (const key of Object.keys(env)) {
    if (key.startsWith('ANTHROPIC_DEFAULT_')) delete env[key];
  }
  return env;
}

function verifySecondEngineAllowed(sb, secondCmd) {
  const cmdBase = path.basename(secondCmd);
  const runnerVal = typeof sb.second_engine_runner === 'string' ? sb.second_engine_runner : '';
  const modelVal = typeof sb.second_engine_model === 'string'
    ? sb.second_engine_model
    : (typeof sb.second_engine === 'string' ? sb.second_engine : '');
  const endpointVal = typeof sb.second_engine_endpoint === 'string' ? sb.second_engine_endpoint : '';

  const checks = [
    {
      runner: runnerVal || cmdBase,
      model: modelVal || cmdBase,
      endpoint: endpointVal,
    },
  ];
  if (runnerVal && modelVal) {
    checks.push({ runner: cmdBase, model: cmdBase, endpoint: '' });
  }
  for (const target of checks) {
    const gateRes = cnGate.check({ ...target, cwd: process.cwd(), files: [], env: {} });
    if (!gateRes.allowed || cnGate.BARRED_FAMILIES.includes(gateRes.family)) {
      throw Error(`拒絕呼叫中國系模型引擎（${gateRes.family}）`);
    }
  }
}

function invokeSecondEngine(secondCmd, row, childEnv) {
  const child = spawnSync(secondCmd, [], {
    input: `${JSON.stringify(row)}\n`,
    encoding: 'utf8',
    env: childEnv,
    timeout: SECOND_ENGINE_TIMEOUT_MS,
  });
  if (child.error || child.status !== 0) {
    throw Error('第二意見引擎執行失敗');
  }
  let reply;
  try {
    reply = JSON.parse(String(child.stdout || '').trim());
  } catch {
    throw Error('第二意見引擎回傳非有效 JSON');
  }
  if (!reply || typeof reply !== 'object' || Array.isArray(reply) || !VALID_VERDICTS.has(reply.verdict)) {
    throw Error('第二意見引擎回傳 verdict 無效');
  }
  return reply.verdict;
}

function readOptionalJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
  } catch {
    return null;
  }
}

function finitePositive(val) {
  return typeof val === 'number' && Number.isFinite(val) && val > 0 ? val : null;
}

function extractBaselineMetrics(baselineDoc) {
  if (!baselineDoc) return { tokensPerTurn: null, p95Latency: null };
  let tokensPerTurn = finitePositive(baselineDoc.tokens_per_turn);
  if (tokensPerTurn === null && Array.isArray(baselineDoc.daily)) {
    const vals = baselineDoc.daily.map((d) => (d ? finitePositive(d.tokens_per_turn) : null)).filter((v) => v !== null);
    if (vals.length) tokensPerTurn = vals.reduce((sum, v) => sum + v, 0) / vals.length;
  }
  let p95Latency = finitePositive(baselineDoc.latency_p95_ms)
    ?? finitePositive(baselineDoc.p95_latency_ms)
    ?? finitePositive(baselineDoc.latency_ms && baselineDoc.latency_ms.p95)
    ?? finitePositive(baselineDoc.p95);
  if (p95Latency === null && Array.isArray(baselineDoc.daily)) {
    const vals = baselineDoc.daily
      .map((d) => (d
        ? (finitePositive(d.latency_p95_ms)
          ?? finitePositive(d.p95_latency_ms)
          ?? finitePositive(d.latency_ms && d.latency_ms.p95)
          ?? finitePositive(d.p95))
        : null))
      .filter((v) => v !== null);
    if (vals.length) p95Latency = vals.reduce((sum, v) => sum + v, 0) / vals.length;
  }
  return { tokensPerTurn, p95Latency };
}

function isWorseBy20Pct(current, baselineVal) {
  if (typeof current !== 'number' || !Number.isFinite(current)) return false;
  if (typeof baselineVal !== 'number' || !Number.isFinite(baselineVal) || baselineVal <= 0) return false;
  return current * 10 >= baselineVal * 12;
}

function computeDailyTokensPerTurn(rows) {
  let totalTokens = 0;
  let totalTurns = 0;
  let hasExplicitTurns = false;
  let tokenRowCount = 0;
  const directRates = [];
  for (const row of rows) {
    if (typeof row.tokens === 'number' && Number.isFinite(row.tokens)) {
      totalTokens += row.tokens;
      tokenRowCount += 1;
      if (typeof row.turns === 'number' && Number.isFinite(row.turns)) {
        totalTurns += row.turns;
        hasExplicitTurns = true;
      }
    } else if (typeof row.turns === 'number' && Number.isFinite(row.turns)) {
      totalTurns += row.turns;
      hasExplicitTurns = true;
    }
    if (typeof row.tokens_per_turn === 'number' && Number.isFinite(row.tokens_per_turn)) {
      directRates.push(row.tokens_per_turn);
    }
  }
  if (hasExplicitTurns) return totalTurns > 0 ? totalTokens / totalTurns : null;
  if (tokenRowCount > 0) return totalTokens / tokenRowCount;
  if (directRates.length > 0) return directRates.reduce((sum, v) => sum + v, 0) / directRates.length;
  return null;
}

function parseHandlingRows(rawText) {
  const lines = rawText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const rows = [];
  for (const line of lines) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      throw Error('當日處理紀錄 JSONL 格式錯誤');
    }
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw Error('當日處理紀錄列格式錯誤');
    }
    if (typeof row.id !== 'string' || !row.id) {
      throw Error('處理紀錄缺少有效 id');
    }
    if (row.kind !== 'auto' && row.kind !== 'escalate') {
      throw Error('處理紀錄 kind 須為 auto 或 escalate');
    }
    if (typeof row.escalated !== 'boolean') {
      throw Error('處理紀錄 escalated 須為布林值');
    }
    if (
      row.latency_ms !== undefined
      && row.latency_ms !== null
      && (typeof row.latency_ms !== 'number' || !Number.isFinite(row.latency_ms) || row.latency_ms < 0)
    ) {
      throw Error('處理紀錄 latency_ms 數值無效');
    }
    for (const field of BREACH_FIELDS) {
      if (row[field] !== undefined && typeof row[field] !== 'boolean') {
        throw Error(`處理紀錄 ${field} 須為布林值`);
      }
    }
    rows.push(row);
  }
  return rows;
}

function runBaseline(args, sb) {
  const days = Number(args[2]);
  if (args[1] !== '--days' || !Number.isInteger(days) || days < 1 || args.length !== 3) throw Error('天數無效');
  const script = sb && sb.extract_script;
  if (typeof script !== 'string' || !script) throw Error('未設定擷取腳本');
  const child = spawnSync(script, ['--days', String(days)], { encoding: 'utf8' });
  if (child.error || child.status !== 0) throw Error('擷取腳本執行失敗');
  const rows = child.stdout.split('\n').filter(Boolean).map(JSON.parse);
  const groups = {};
  for (const row of rows) {
    if (typeof row.ts !== 'string' || !Number.isFinite(row.tokens) || !Number.isFinite(row.turns)) throw Error('基準資料格式錯誤');
    const date = row.ts.slice(0, 10);
    const group = groups[date] ||= { tokens: 0, turns: 0 };
    group.tokens += row.tokens; group.turns += row.turns;
  }
  const daily = Object.entries(groups).map(([date, value]) => ({ date, turns: value.turns, tokens_per_turn: value.turns ? value.tokens / value.turns : null }));
  const dir = path.join(stateRoot(), 'switchboard', 'quality');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, 'baseline.json'), JSON.stringify({ daily }, null, 2) + '\n', { mode: 0o600 });
  console.log('基準資料已建立');
}

function runDaily(args, sb) {
  if (args.length !== 3 || args[1] !== '--date' || !isValidDate(args[2])) {
    throw Error('日期參數無效，格式須為 YYYY-MM-DD');
  }
  const date = args[2];
  const switchboardDir = path.join(stateRoot(), 'switchboard');
  const inputPath = path.join(switchboardDir, 'handling', `${date}.jsonl`);
  if (!fs.existsSync(inputPath)) {
    throw Error(`找不到當日處理紀錄檔：${date}.jsonl`);
  }
  const secondCmd = sb && sb.second_engine_cmd;
  if (typeof secondCmd !== 'string' || !secondCmd) {
    throw Error('未設定第二意見引擎（switchboard.second_engine_cmd）');
  }
  verifySecondEngineAllowed(sb, secondCmd);

  const rawInput = fs.readFileSync(inputPath, 'utf8');
  const rows = parseHandlingRows(rawInput);

  const autoRows = rows.filter((row) => row.kind === 'auto');
  const autoSample = sampleEquidistant10Pct(autoRows);
  const nonEscalatedRows = rows.filter((row) => !row.escalated);
  const swallowSample = sampleFirst50(nonEscalatedRows);
  const escalatedLatencies = rows
    .filter((row) => row.escalated && typeof row.latency_ms === 'number' && Number.isFinite(row.latency_ms))
    .map((row) => row.latency_ms);

  const childEnv = buildChildEnv(process.env);
  let wrongIntake = 0;
  for (const row of autoSample) {
    if (invokeSecondEngine(secondCmd, row, childEnv) === 'escalate') {
      wrongIntake += 1;
    }
  }
  let swallowed = 0;
  for (const row of swallowSample) {
    if (invokeSecondEngine(secondCmd, row, childEnv) === 'question') {
      swallowed += 1;
    }
  }

  const p50 = nearestRankPercentile(escalatedLatencies, 50);
  const p95 = nearestRankPercentile(escalatedLatencies, 95);

  const breachCounts = {
    authority_breach: 0,
    missed_operator_ask: 0,
    wrong_executor: 0,
    sensitive_send: 0,
  };
  for (const row of rows) {
    for (const field of BREACH_FIELDS) {
      if (row[field] === true) breachCounts[field] += 1;
    }
  }

  const qualityDir = path.join(switchboardDir, 'quality');
  const baselineMetrics = extractBaselineMetrics(readOptionalJson(path.join(qualityDir, 'baseline.json')));
  const prevReport = readOptionalJson(path.join(qualityDir, `${previousDate(date)}.json`));

  const todayTokensPerTurn = computeDailyTokensPerTurn(rows);
  const todayTokensWorse = isWorseBy20Pct(todayTokensPerTurn, baselineMetrics.tokensPerTurn);
  const todayP95Worse = isWorseBy20Pct(p95, baselineMetrics.p95Latency);

  let prevTokensWorse = false;
  let prevP95Worse = false;
  if (prevReport) {
    const prevTokens = typeof prevReport.tokens_per_turn === 'number' && Number.isFinite(prevReport.tokens_per_turn)
      ? prevReport.tokens_per_turn
      : null;
    prevTokensWorse = isWorseBy20Pct(prevTokens, baselineMetrics.tokensPerTurn)
      || Boolean(prevReport.degraded && prevReport.degraded.tokens_per_turn === true);

    const prevP95 = (typeof prevReport.latency_p95_ms === 'number' && Number.isFinite(prevReport.latency_p95_ms))
      ? prevReport.latency_p95_ms
      : ((prevReport.latency_ms && typeof prevReport.latency_ms.p95 === 'number' && Number.isFinite(prevReport.latency_ms.p95))
        ? prevReport.latency_ms.p95
        : null);
    prevP95Worse = isWorseBy20Pct(prevP95, baselineMetrics.p95Latency)
      || Boolean(prevReport.degraded && prevReport.degraded.p95_latency === true);
  }

  const triggeredRules = [];
  for (const field of BREACH_FIELDS) {
    if (breachCounts[field] >= 1) triggeredRules.push(field);
  }
  if (wrongIntake >= 2) triggeredRules.push('wrong_intake');
  if (swallowed >= 1) triggeredRules.push('swallowed');
  if (prevReport && todayTokensWorse && prevTokensWorse) triggeredRules.push('tokens_per_turn_2day');
  if (prevReport && todayP95Worse && prevP95Worse) triggeredRules.push('p95_latency_2day');

  const rollback = triggeredRules.length > 0;
  const rollbackReason = rollback ? triggeredRules[0] : null;

  const report = {
    date,
    total_rows: rows.length,
    auto_total: autoRows.length,
    auto_sample_size: autoSample.length,
    wrong_intake: wrongIntake,
    non_escalated_total: nonEscalatedRows.length,
    swallow_sample_size: swallowSample.length,
    swallowed,
    escalated_total: escalatedLatencies.length,
    latency_ms: { p50, p95 },
    latency_p50_ms: p50,
    latency_p95_ms: p95,
    tokens_per_turn: todayTokensPerTurn,
    authority_breach: breachCounts.authority_breach,
    missed_operator_ask: breachCounts.missed_operator_ask,
    wrong_executor: breachCounts.wrong_executor,
    sensitive_send: breachCounts.sensitive_send,
    degraded: {
      tokens_per_turn: todayTokensWorse,
      p95_latency: todayP95Worse,
    },
    rollback,
    rollback_reason: rollbackReason,
    rollback_rules: triggeredRules,
  };

  fs.mkdirSync(qualityDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(qualityDir, `${date}.json`), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });

  if (rollback) {
    fs.writeFileSync(
      path.join(switchboardDir, 'mode.json'),
      `${JSON.stringify({ mode: 'shadow', reason: rollbackReason }, null, 2)}\n`,
      { mode: 0o600 },
    );
    const replayDir = path.join(switchboardDir, 'replay', date);
    fs.mkdirSync(replayDir, { recursive: true, mode: 0o700 });
    const replayFile = path.join(replayDir, `${date}.jsonl`);
    fs.copyFileSync(inputPath, replayFile);
    fs.chmodSync(replayFile, 0o600);
    console.log(`觸發回滾至 shadow（規則：${rollbackReason}，日期：${date}）：wrong_intake=${wrongIntake} swallowed=${swallowed} p50=${p50} p95=${p95}`);
  } else {
    console.log(`品質檢查通過（日期：${date}）：wrong_intake=${wrongIntake} swallowed=${swallowed} p50=${p50} p95=${p95}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] !== 'baseline' && args[0] !== 'daily') {
    throw Error('不支援的子命令，僅支援 baseline 或 daily');
  }
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    throw Error('無法讀取設定檔');
  }
  const sb = config && typeof config === 'object' ? config.switchboard : null;
  if (args[0] === 'baseline') {
    runBaseline(args, sb);
  } else {
    runDaily(args, sb);
  }
}

try {
  main();
} catch (err) {
  const msg = err && err.message ? err.message : '設定或輸入無效';
  process.stderr.write(`品質檢查失敗：${msg}\n`);
  process.exitCode = 1;
}
