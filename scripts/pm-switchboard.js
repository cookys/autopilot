#!/usr/bin/env node
'use strict';

// pm-switchboard.js — 10-minute deterministic batch triage for the PM inbox.
//
// Fixed rules only (zero model calls). Side effects are restricted by construction
// to the inbox adapter (mark, wake, accept) and the local receipt file.
//
// Subcommands:
//   run [--dry-run] [--max-items 200] [--receipt-dir <dir>]
//   residue-report [--since 24h] [--receipt-dir <dir>] [--json]
//
// Kill switch: AUTOPILOT_PM_SWITCHBOARD=off -> `run` exits 0 doing nothing.
// Exit codes: 0 ok | 2 CLI usage or adapter precondition error | 1 runtime error.
// Node built-ins only.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAdapter } = require('./lib/pm-inbox-adapter.js');
const { extractItemStatus, evaluateTaskResult } = require('./lib/pm-result-rules.js');

const RECEIPT_SCHEMA = 'autopilot.pm-switchboard/1';
const MAX_PACKET_ITEMS = 5;
const MAX_PACKET_TOKENS = 1500;
const SINGLE_ITEM_MAX_CHARS = 4200;

const CREDENTIAL_REDLINE_ZH = Object.freeze(['憑證', '金鑰', '紅線']);
const CREDENTIAL_REDLINE_EN_RE = /\b(?:token|scope)\b/i;

function usageError(message) {
  const err = new Error(`pm-switchboard: ${message}`);
  err.exitCode = 2;
  return err;
}

function usageText() {
  return [
    'Usage:',
    '  node scripts/pm-switchboard.js run [--dry-run] [--max-items 200] [--receipt-dir <dir>]',
    '  node scripts/pm-switchboard.js residue-report [--since 24h] [--receipt-dir <dir>] [--json]',
  ].join('\n');
}

function parseRunArgs(argv) {
  const opts = {
    dryRun: false,
    maxItems: 200,
    receiptDir: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--max-items') {
      if (i + 1 >= argv.length) throw usageError('--max-items requires a positive integer');
      const raw = argv[++i];
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) throw usageError(`invalid --max-items "${raw}"`);
      opts.maxItems = n;
    } else if (arg.startsWith('--max-items=')) {
      const raw = arg.slice('--max-items='.length);
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) throw usageError(`invalid --max-items "${raw}"`);
      opts.maxItems = n;
    } else if (arg === '--receipt-dir') {
      if (i + 1 >= argv.length || !argv[i + 1]) throw usageError('--receipt-dir requires a path');
      opts.receiptDir = path.resolve(argv[++i]);
    } else if (arg.startsWith('--receipt-dir=')) {
      const val = arg.slice('--receipt-dir='.length);
      if (!val) throw usageError('--receipt-dir requires a path');
      opts.receiptDir = path.resolve(val);
    } else {
      throw usageError(`unknown argument for run: ${arg}`);
    }
  }
  return opts;
}

function parseDurationMs(spec) {
  const raw = String(spec || '').trim();
  const m = /^(\d+(?:\.\d+)?)\s*(s|m|h|d)$/i.exec(raw);
  if (!m) throw usageError(`invalid duration "${spec}" (expected e.g. 24h, 30m, 7d)`);
  const val = Number(m[1]);
  if (!Number.isFinite(val) || val <= 0) throw usageError(`invalid duration "${spec}"`);
  const unit = m[2].toLowerCase();
  const mult = unit === 's' ? 1000 : unit === 'm' ? 60000 : unit === 'h' ? 3600000 : 86400000;
  return Math.round(val * mult);
}

function parseReportArgs(argv) {
  const opts = {
    since: '24h',
    sinceMs: 24 * 3600 * 1000,
    receiptDir: null,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--since') {
      if (i + 1 >= argv.length) throw usageError('--since requires a duration');
      opts.since = argv[++i];
      opts.sinceMs = parseDurationMs(opts.since);
    } else if (arg.startsWith('--since=')) {
      opts.since = arg.slice('--since='.length);
      opts.sinceMs = parseDurationMs(opts.since);
    } else if (arg === '--receipt-dir') {
      if (i + 1 >= argv.length || !argv[i + 1]) throw usageError('--receipt-dir requires a path');
      opts.receiptDir = path.resolve(argv[++i]);
    } else if (arg.startsWith('--receipt-dir=')) {
      const val = arg.slice('--receipt-dir='.length);
      if (!val) throw usageError('--receipt-dir requires a path');
      opts.receiptDir = path.resolve(val);
    } else if (arg === '--json') {
      opts.json = true;
    } else {
      throw usageError(`unknown argument for residue-report: ${arg}`);
    }
  }
  return opts;
}

function resolveReceiptDir(explicitDir, env = process.env) {
  if (explicitDir) return path.resolve(explicitDir);
  const xdg = env && env.XDG_RUNTIME_DIR;
  if (typeof xdg === 'string' && xdg.trim() !== '' && path.isAbsolute(xdg.trim())) {
    return path.join(xdg.trim(), 'autopilot', 'pm-switchboard');
  }
  return path.join(os.homedir(), '.autopilot', 'pm-switchboard');
}

function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 3);
}

function extractWaitingOnTarget(item) {
  if (item && typeof item.waiting_on === 'string' && item.waiting_on.trim() !== '') {
    return item.waiting_on.trim();
  }
  const content = item && typeof item.content === 'string' ? item.content : '';
  const kv = content.match(/^\s*(?:[-*]\s*)?waiting[_\s-]+on\s*[:=：]\s*(\S+)/im);
  if (kv) return kv[1].trim();
  const bracket = content.match(/\[\s*waiting[_\s-]+on\s*[:=]\s*([^\]]+)\]/i);
  if (bracket) return bracket[1].trim();
  const inline = content.match(/\bwaiting[_\s]+on\s+([A-Za-z0-9_./-]+)\b/i);
  if (inline) return inline[1].trim();
  if (/等待\s*pm\b/i.test(content)) return 'PM';
  return null;
}

function isPmHandle(target, member) {
  if (!target) return false;
  const low = String(target).trim().toLowerCase().replace(/[.,;:!?]+$/, '');
  const tail = low.includes('/') ? low.slice(low.lastIndexOf('/') + 1) : low;
  if (tail === 'pm' || tail.startsWith('pm--')) return true;
  if (member && (low === String(member).toLowerCase() || tail === String(member).toLowerCase())) return true;
  return false;
}

function hasCredentialRedlineMention(content) {
  const text = String(content || '');
  for (const w of CREDENTIAL_REDLINE_ZH) {
    if (text.includes(w)) return true;
  }
  return CREDENTIAL_REDLINE_EN_RE.test(text);
}

function hasQuestionToPm(content) {
  const text = String(content || '');
  const withoutUrls = text.replace(/https?:\/\/\S+/gi, '');
  if (withoutUrls.includes('?') || text.includes('？')) return true;
  if (text.includes('嗎') || text.includes('請裁') || text.includes('要不要')) return true;
  if (/\bgo\?/i.test(text)) return true;
  return false;
}

function classifyItem(item, opts = {}) {
  const category = item && typeof item.category === 'string' ? item.category.trim().toLowerCase() : '';
  const kind = item && typeof item.kind === 'string' ? item.kind.trim().toLowerCase() : '';
  const content = item && typeof item.content === 'string' ? item.content : '';
  const status = extractItemStatus(item);
  const waitingTarget = extractWaitingOnTarget(item);
  const member = opts.member || '';

  // 1. operator / urgent / credential_redline -> pending_decision
  if (category === 'operator') {
    return { disposition: 'pending_decision', rule: 'operator', failedChecks: [], isResidue: false };
  }
  if (category === 'urgent') {
    return { disposition: 'pending_decision', rule: 'urgent', failedChecks: [], isResidue: false };
  }
  if (category === 'credential_redline' || hasCredentialRedlineMention(content)) {
    return { disposition: 'pending_decision', rule: 'credential_redline', failedChecks: [], isResidue: false };
  }

  // 2. waiting_on PM, declined, failed, question to PM, or decision_request -> pending_decision
  if (category === 'decision_request') {
    return { disposition: 'pending_decision', rule: 'decision_request', failedChecks: [], isResidue: false };
  }
  if (waitingTarget && isPmHandle(waitingTarget, member)) {
    return { disposition: 'pending_decision', rule: 'waiting_on_pm', failedChecks: [], isResidue: false };
  }
  if (status === 'declined' || kind === 'declined' || /\bdeclined\b/i.test(content)) {
    return { disposition: 'pending_decision', rule: 'declined', failedChecks: [], isResidue: false };
  }
  if (status === 'failed' || kind === 'failed' || /(?<!\b0\s)\bfailed\b/i.test(content)) {
    return { disposition: 'pending_decision', rule: 'failed', failedChecks: [], isResidue: false };
  }
  if (hasQuestionToPm(content)) {
    return { disposition: 'pending_decision', rule: 'question_to_pm', failedChecks: [], isResidue: false };
  }

  // 3. task_result -> pm-result-rules
  if (category === 'task_result' || kind === 'task_result') {
    const evalRes = evaluateTaskResult(item, opts.resultRuleOpts);
    if (!evalRes.pass) {
      return {
        disposition: 'pending_decision',
        rule: 'result_check_failed',
        failedChecks: evalRes.failed,
        checks: evalRes.checks,
        isResidue: false,
      };
    }
    if (opts.canAccept === false) {
      return {
        disposition: 'pending_decision',
        rule: 'result_accept_unavailable',
        failedChecks: ['accept_unavailable'],
        checks: evalRes.checks,
        isResidue: false,
      };
    }
    const taskId = item && typeof item.task_id === 'string' ? item.task_id.trim() : '';
    if (!taskId) {
      return {
        disposition: 'pending_decision',
        rule: 'result_check_failed',
        failedChecks: ['missing_task_id'],
        checks: evalRes.checks,
        isResidue: false,
      };
    }
    return {
      disposition: 'done',
      rule: 'result_auto_accept',
      failedChecks: [],
      checks: evalRes.checks,
      isResidue: false,
    };
  }

  // 4. in_progress progress notes, or waiting on someone other than PM -> no_action
  if (waitingTarget && !isPmHandle(waitingTarget, member)) {
    return { disposition: 'no_action', rule: 'waiting_on_other', failedChecks: [], isResidue: false };
  }
  if (
    status === 'in_progress'
    || kind === 'in_progress'
    || category === 'in_progress'
    || /\[stage:[a-z0-9_/-]+\]/i.test(content)
  ) {
    return { disposition: 'no_action', rule: 'in_progress', failedChecks: [], isResidue: false };
  }

  // 5. ack, auto_merged (`[auto] merged`), fyi=true, patrol_summary -> no_action
  if (category === 'ack' || kind === 'ack') {
    return { disposition: 'no_action', rule: 'ack', failedChecks: [], isResidue: false };
  }
  if (category === 'auto_merged' || content.toLowerCase().includes('[auto] merged')) {
    return { disposition: 'no_action', rule: 'auto_merged', failedChecks: [], isResidue: false };
  }
  if ((item && item.fyi === true) || category === 'fyi') {
    return { disposition: 'no_action', rule: 'fyi', failedChecks: [], isResidue: false };
  }
  if (category === 'patrol_summary') {
    return { disposition: 'no_action', rule: 'patrol_summary', failedChecks: [], isResidue: false };
  }

  // 6. anything else -> pending_decision tagged 「未分類」, counted as residue
  return { disposition: 'pending_decision', rule: 'unclassified', failedChecks: [], isResidue: true };
}

function buildSuggestionForRule(rule, failedChecks) {
  switch (rule) {
    case 'operator':
    case 'urgent':
    case 'credential_redline':
      return '優先審閱此高優先／紅線項目並親自裁示';
    case 'result_check_failed':
      return `檢查未通過項目（${failedChecks.join(', ')}），確認補件或退回重修`;
    case 'result_accept_unavailable':
      return '驗收指令未設定，請人工核對工單成果後結案';
    case 'unclassified':
      return '檢視完整原文，判斷需執行動作或以 --no-action 歸檔';
    default:
      return '依工單脈絡裁示下一步，結案後以 pm-inbox-done.js 標記';
  }
}

function buildFactsForPending(entry) {
  const { item, rule, failedChecks, isResidue } = entry;
  const msgId = String((item && item.message_id) || 'unknown');
  const rawContent = String((item && item.content) || '').trim();

  if (isResidue) {
    return [
      `分類標籤：「未分類」（規則=${rule}，原類別=${(item && item.category) || '無'}） [evidence: ${msgId}]`,
      `完整原文：${rawContent || '（空內容）'} [evidence: ${msgId}]`,
    ];
  }

  const facts = [];
  if (failedChecks && failedChecks.length > 0) {
    facts.push(`未通過檢查：${failedChecks.join(', ')} [evidence: ${msgId}]`);
  } else {
    facts.push(`觸發規則=${rule}，來源類別=${(item && item.category) || '無'} [evidence: ${msgId}]`);
  }

  const lines = rawContent.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length && facts.length < 3; i += 1) {
    facts.push(`${lines[i]} [evidence: ${msgId}]`);
  }
  return facts.slice(0, 3);
}

function renderPendingItemBlock(entry, indexOneBased) {
  const { item, rule, failedChecks, isResidue } = entry;
  const msgId = String((item && item.message_id) || `idx-${indexOneBased}`);
  const lane = (item && typeof item.from === 'string' && item.from.trim()) ? item.from.trim() : '無';
  const taskId = (item && typeof item.task_id === 'string' && item.task_id.trim()) ? item.task_id.trim() : '無';
  const typeLabel = isResidue
    ? `「未分類」 (${rule})`
    : (failedChecks && failedChecks.length > 0 ? `${rule} [${failedChecks.join(', ')}]` : rule);

  const suggestion = buildSuggestionForRule(rule, failedChecks || []);
  const optionsLine = `1) 裁示結案（pm-inbox-done.js ${msgId} --ref <id>）；2) 無需動作（pm-inbox-done.js ${msgId} --no-action <reason>）；3) 續留待決`;

  const renderWithFacts = (factsList) => [
    `### 項目 ${indexOneBased}`,
    `- 編號：${indexOneBased} (${msgId})`,
    `- lane：${lane}`,
    `- 工單：${taskId}`,
    `- 類型：${typeLabel}`,
    '- 事實：',
    ...factsList.map((f, idx) => `  ${idx + 1}. ${f}`),
    `- 選項：${optionsLine}`,
    `- 建議（「建議，不是決定」）：${suggestion}`,
  ].join('\n');

  const facts = buildFactsForPending(entry);
  let rendered = renderWithFacts(facts);
  if (rendered.length <= SINGLE_ITEM_MAX_CHARS) {
    return rendered;
  }

  // Oversized single item: truncate facts and leave an explicit pointer to message_id.
  const pointerSuffix = ` …[內容過長已截斷，請查閱原始訊息 message_id=${msgId}] [evidence: ${msgId}]`;
  const shellWithoutFacts = renderWithFacts(['']);
  const availableForFact = Math.max(120, SINGLE_ITEM_MAX_CHARS - shellWithoutFacts.length - pointerSuffix.length - 40);
  const combinedFactText = facts.join(' / ').replace(/\s*\[evidence:[^\]]+\]/g, '');
  const truncatedFact = `${combinedFactText.slice(0, availableForFact)}${pointerSuffix}`;
  rendered = renderWithFacts([truncatedFact]);
  return rendered;
}

function formatPacket(blocks, packetIndex, totalPackets) {
  const header = `## PM 收件匣待裁決批次包（第 ${packetIndex}/${totalPackets} 包，共 ${blocks.length} 筆）`;
  return `${header}\n\n${blocks.join('\n\n')}`;
}

function buildPackets(pendingEntries) {
  if (!pendingEntries || pendingEntries.length === 0) {
    return [];
  }
  const renderedBlocks = pendingEntries.map((entry, idx) => renderPendingItemBlock(entry, idx + 1));
  const groups = [];
  let current = [];

  for (const block of renderedBlocks) {
    if (current.length === 0) {
      current.push(block);
      continue;
    }
    const candidate = [...current, block];
    const probeText = formatPacket(candidate, 999, 999);
    if (candidate.length > MAX_PACKET_ITEMS || estimateTokens(probeText) > MAX_PACKET_TOKENS) {
      groups.push(current);
      current = [block];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) {
    groups.push(current);
  }

  return groups.map((grp, idx) => {
    const text = formatPacket(grp, idx + 1, groups.length);
    return {
      index: idx + 1,
      item_count: grp.length,
      token_estimate: estimateTokens(text),
      text,
    };
  });
}

function mintTimestampStem(dir, now = new Date()) {
  const base = now.toISOString().replace(/[:.]/g, '-');
  let stem = base;
  let seq = 1;
  while (fs.existsSync(path.join(dir, `${stem}.json`))) {
    stem = `${base}-${seq}`;
    seq += 1;
  }
  return stem;
}

function writeFileAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, content, { mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
}

function runSwitchboard(opts, env = process.env) {
  const switchVal = typeof env.AUTOPILOT_PM_SWITCHBOARD === 'string'
    ? env.AUTOPILOT_PM_SWITCHBOARD.trim().toLowerCase()
    : '';
  if (switchVal === 'off') {
    return { killed: true };
  }

  const adapter = createAdapter(env);
  const unreadAll = adapter.listUnread();
  const batch = unreadAll.slice(0, opts.maxItems);
  const canAccept = adapter.canAccept();

  const countsByRule = {};
  const bumpRule = (r) => { countsByRule[r] = (countsByRule[r] || 0) + 1; };

  let accepted = 0;
  let pending = 0;
  let noAction = 0;
  let residue = 0;

  const pendingEntries = [];
  const itemRecords = [];

  for (const item of batch) {
    const msgId = String((item && item.message_id) || '');
    let decision = classifyItem(item, { member: adapter.member, canAccept });

    if (decision.disposition === 'done' && decision.rule === 'result_auto_accept') {
      if (!opts.dryRun) {
        try {
          adapter.accept(item.task_id, `result_auto_accept:${msgId}`);
          adapter.mark(msgId, 'done', { ref: msgId, rule: decision.rule });
          accepted += 1;
          bumpRule(decision.rule);
        } catch (err) {
          const fallbackCheck = err && err.code === 'ACCEPT_UNAVAILABLE' ? 'accept_unavailable' : 'accept_failed';
          decision = {
            disposition: 'pending_decision',
            rule: fallbackCheck === 'accept_unavailable' ? 'result_accept_unavailable' : 'result_check_failed',
            failedChecks: [fallbackCheck],
            isResidue: false,
          };
        }
      } else {
        accepted += 1;
        bumpRule(decision.rule);
      }
    }

    if (decision.disposition === 'no_action') {
      if (!opts.dryRun) {
        adapter.mark(msgId, 'no_action', { reason: decision.rule, rule: decision.rule });
      }
      noAction += 1;
      bumpRule(decision.rule);
    } else if (decision.disposition === 'pending_decision') {
      const reasonDetail = decision.failedChecks && decision.failedChecks.length > 0
        ? `${decision.rule}:${decision.failedChecks.join(',')}`
        : decision.rule;
      if (!opts.dryRun) {
        adapter.mark(msgId, 'pending_decision', {
          reason: reasonDetail,
          rule: decision.rule,
          failed_checks: decision.failedChecks,
        });
      }
      pending += 1;
      if (decision.isResidue) residue += 1;
      bumpRule(decision.rule);
      pendingEntries.push({
        item,
        rule: decision.rule,
        failedChecks: decision.failedChecks || [],
        isResidue: Boolean(decision.isResidue),
      });
    }

    itemRecords.push({
      message_id: msgId,
      rule: decision.rule,
      disposition: decision.disposition,
      failed_checks: decision.failedChecks || [],
    });
  }

  const packets = buildPackets(pendingEntries);
  const processed = batch.length;
  const residueRatio = processed === 0 ? 0 : Number((residue / processed).toFixed(6));

  const now = new Date();
  const receiptDir = resolveReceiptDir(opts.receiptDir, env);
  let packetPath = null;
  let woke = false;

  if (!opts.dryRun) {
    fs.mkdirSync(receiptDir, { recursive: true, mode: 0o700 });
    const stem = mintTimestampStem(receiptDir, now);
    if (packets.length > 0) {
      packetPath = path.join(receiptDir, `${stem}.packet.md`);
      const combinedPacketText = `${packets.map((p) => p.text).join('\n\n---\n\n')}\n`;
      writeFileAtomic(packetPath, combinedPacketText);
      adapter.wake(packetPath);
      woke = true;
    }
    const receiptPath = path.join(receiptDir, `${stem}.json`);
    const receipt = {
      schema: RECEIPT_SCHEMA,
      at: now.toISOString(),
      member: adapter.member,
      adapter: adapter.mode,
      unread_total: unreadAll.length,
      processed,
      counts_by_rule: countsByRule,
      accepted,
      pending,
      no_action: noAction,
      residue,
      residue_ratio: residueRatio,
      packets: packets.length,
      packet_item_counts: packets.map((p) => p.item_count),
      packet_token_estimates: packets.map((p) => p.token_estimate),
      packet_file: packetPath,
      woke,
      items: itemRecords,
    };
    writeFileAtomic(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    return { ...receipt, receipt_path: receiptPath };
  }

  return {
    schema: RECEIPT_SCHEMA,
    dry_run: true,
    at: now.toISOString(),
    member: adapter.member,
    adapter: adapter.mode,
    unread_total: unreadAll.length,
    processed,
    counts_by_rule: countsByRule,
    accepted,
    pending,
    no_action: noAction,
    residue,
    residue_ratio: residueRatio,
    packets: packets.length,
    packet_item_counts: packets.map((p) => p.item_count),
    packet_token_estimates: packets.map((p) => p.token_estimate),
    packet_file: null,
    woke: false,
    items: itemRecords,
  };
}

function runResidueReport(opts, env = process.env, nowMs = Date.now()) {
  const receiptDir = resolveReceiptDir(opts.receiptDir, env);
  const cutoffMs = nowMs - opts.sinceMs;

  let runs = 0;
  let processed = 0;
  let accepted = 0;
  let pending = 0;
  let noAction = 0;
  let residue = 0;
  let packets = 0;
  let wakes = 0;
  const countsByRule = {};

  if (fs.existsSync(receiptDir)) {
    const names = fs.readdirSync(receiptDir).filter((f) => f.endsWith('.json') && !f.includes('.tmp.')).sort();
    for (const name of names) {
      const fullPath = path.join(receiptDir, name);
      let doc;
      try {
        doc = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      } catch {
        continue;
      }
      if (!doc || doc.schema !== RECEIPT_SCHEMA) continue;
      let ts = Date.parse(doc.at);
      if (!Number.isFinite(ts)) {
        try { ts = fs.statSync(fullPath).mtimeMs; } catch { continue; }
      }
      if (ts < cutoffMs) continue;

      runs += 1;
      const itemTotal = Number.isFinite(doc.processed)
        ? doc.processed
        : (Number(doc.accepted || 0) + Number(doc.pending || 0) + Number(doc.no_action || 0));
      processed += itemTotal;
      accepted += Number(doc.accepted || 0);
      pending += Number(doc.pending || 0);
      noAction += Number(doc.no_action || 0);
      residue += Number(doc.residue || 0);
      packets += Number(doc.packets || 0);
      if (doc.woke) wakes += 1;
      if (doc.counts_by_rule && typeof doc.counts_by_rule === 'object') {
        for (const [rule, cnt] of Object.entries(doc.counts_by_rule)) {
          countsByRule[rule] = (countsByRule[rule] || 0) + Number(cnt || 0);
        }
      }
    }
  }

  const residueRatio = processed === 0 ? 0 : Number((residue / processed).toFixed(6));
  const summary = {
    schema: RECEIPT_SCHEMA,
    since: opts.since,
    runs,
    processed,
    accepted,
    pending,
    no_action: noAction,
    residue,
    residue_ratio: residueRatio,
    packets,
    wakes,
    counts_by_rule: countsByRule,
  };

  if (opts.json) {
    return JSON.stringify(summary);
  }
  return `pm-switchboard residue-report (since=${opts.since}): runs=${runs} processed=${processed} accepted=${accepted} pending=${pending} no_action=${noAction} residue=${residue} residue_ratio=${residueRatio} packets=${packets} wakes=${wakes}`;
}

function main(argv = process.argv.slice(2), env = process.env) {
  const sub = argv[0];
  if (!sub || sub === '-h' || sub === '--help') {
    if (!sub) {
      process.stderr.write(`${usageText()}\n`);
      process.exit(2);
    }
    process.stdout.write(`${usageText()}\n`);
    process.exit(0);
  }

  try {
    if (sub === 'run') {
      const opts = parseRunArgs(argv.slice(1));
      const res = runSwitchboard(opts, env);
      if (res.killed) {
        process.exit(0);
      }
      process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
      process.exit(0);
    }
    if (sub === 'residue-report') {
      const opts = parseReportArgs(argv.slice(1));
      const line = runResidueReport(opts, env);
      process.stdout.write(`${line}\n`);
      process.exit(0);
    }
    throw usageError(`unknown subcommand "${sub}"`);
  } catch (err) {
    const code = err && Number.isInteger(err.exitCode) ? err.exitCode : 1;
    process.stderr.write(`${err && err.message ? err.message : String(err)}\n`);
    process.exit(code);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  RECEIPT_SCHEMA,
  MAX_PACKET_ITEMS,
  MAX_PACKET_TOKENS,
  estimateTokens,
  classifyItem,
  buildPackets,
  runSwitchboard,
  runResidueReport,
  resolveReceiptDir,
};
