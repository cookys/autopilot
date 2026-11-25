#!/usr/bin/env node
/**
 * fleet-send-work-order-guard — PreToolUse, matcher mcp__fleet__send (and
 * mcp__fleet__dispatch for PM plan-first guard).
 *
 * mcp__fleet__reply to a courier wake (`from` ends in `/courier`) is denied: reply cannot
 * reach that address (member_unknown). The reason tells the sender to use task_comment
 * and includes `task_id:` from that message body when the line is present. An id that
 * is not in the transcript is allowed.
 *
 * mcp__fleet__send, mcp__fleet__dispatch and mcp__fleet__task_comment: each real
 * ~/.claude path (`~/`, `$HOME/`, `/home/<user>/`, `/Users/<user>/`) is judged alone.
 * A path under `.claude/projects/` is allowed. Any other occurrence is allowed only
 * when its clause (split on 。；; newline and a sentence-ending `.`), within 12
 * characters before the path, contains a negator (不讀 / do not read / never / …).
 * One occurrence without that negator denies the message. Reading the real ~/.claude
 * needs the operator's card.
 *
 * mcp__fleet__reply (same rule, default-on): a reply that is a work order is denied unless it carries task context
 * (a `task_id: <26-char id>` header line at the top of the body, or a 26-char task id in the text). fyi=true does not exempt a send/reply that asks for work
 * (imperative phrases); only the bare mention 回報 stays allowed under fyi.
 *
 * mcp__fleet__send (default-on):
 *   A send that tells the peer to do the work now, or to return a deliverable,
 *   is a work order. New work uses dispatch. News about an existing task uses
 *   reply on that task's message. A pure fact uses send with fyi=true.
 *   [no-task: ...] is not an exemption. Broadcasts (to starts with @) always
 *   pass. Off switch: AUTOPILOT_SEND_WORK_ORDER_GUARD=off (false/0/no).
 *
 * mcp__fleet__dispatch (opt-in stem `pm-dispatch-plan-guard`, gated by
 * _shared/pm-console.js):
 *   Every PM dispatch must declare Size (XS|S|M|L|XL); Size M/L/XL must carry
 *   `Plan: <path>@<sha>` or `Plan: plan-first`.
 *
 * Fail-open: any error -> one stderr line, exit 0, no stdout.
 */
'use strict';

const fs = require('fs');
const { isEnabled } = require('./_shared/opt-in');
const { isPmConsole } = require('./_shared/pm-console');
const { parse: parseWorkOrder, isMPlus } = require('../scripts/lib/work-order-plan');
const { gateHint } = require('./lib/gate-hint.js');

// Deliberately small: only imperative work requests, so a plain fact question still passes.
// [no-task: ...] is not an exemption.
const WORK_ORDER_PHRASES = Object.freeze([
  '回一行', '回報', '附 run id', '回 sha', '交件', 'report back', 'reply with',
  '現在就跑', '去跑', '開跑', '請做', '請跑', '請修', '要你', 'run it now', 'please run', 'please implement',
]);

const HEADER_EXAMPLE = '訊息內文最上面逐行寫：\ntask_id: <26 碼任務 id>\ntag: progress|result|question|ruling|fyi\nwaiting_on: <對方地址>';
const DISPATCH_EXAMPLE = '\n\n可照抄的 dispatch 呼叫範例：\nmcp__fleet__dispatch({\n  to: "<對方地址>",\n  content: "Engine: <claude|codex|agy> | Role: <implementer|reviewer> | Lane: <lane> | Size: <XS|S|M|L|XL>\\n\\n<任務內容>"\n})';
const DENY_REASON = '這則 send 是在派工（要對方現在做事或回交件）。新工作請用 dispatch；既有任務的訊息請用 reply，並用標頭行綁定任務。' + HEADER_EXAMPLE + DISPATCH_EXAMPLE + '\n純資訊才用 send 並設 fyi=true（fyi 不能夾帶要對方做事的指令）。' + gateHint('新工作用 dispatch；既有任務留言用 task_comment(task_id, text)、回派工用 task_result(message_id, result, content)；純資訊 send 才設 fyi=true', 'hooks/README.md');
const REPLY_DENY_REASON = '這則 reply 是在派工（要對方現在做事或回交件）。新工作請用 dispatch；若是回答既有任務，請帶任務脈絡。' + HEADER_EXAMPLE + DISPATCH_EXAMPLE + '\n純資訊才設 fyi=true。' + gateHint('新工作用 dispatch；既有任務留言用 task_comment(task_id, text)、回派工用 task_result(message_id, result, content)；純資訊才設 fyi=true', 'hooks/README.md');
// 'fyi' means "needs no answer, no action": an ask hiding under it is still a work order. Only the bare
// noun 回報 (a mention, e.g. "晚點補完整回報") stays allowed under fyi.
const FYI_BENIGN_PHRASES = Object.freeze(['回報']);
const HEADER_TASK_ID_RE = /^task_id:\s*[0-9A-HJKMNP-TV-Z]{26}\s*$/m;
const BODY_TASK_ID_RE = /(?:^|\n)task_id:\s*([0-9A-HJKMNP-TV-Z]{26})\s*(?:\n|$)/;
const COURIER_REPLY_REASON = 'reply 不能回 courier 的 wake 訊息，請改用 task_comment（task_id 見該訊息的 task_id 行）' + gateHint('回 courier 的 wake 訊息改用 task_comment（task_id 見該訊息的 task_id 行）', 'hooks/README.md');
const CLAUDE_HOME_RE = /(?:~\/|\$HOME\/|\/home\/[^/\s]+\/|\/Users\/[^/\s]+\/)\.claude(?![\w-])(?!\/projects(?:\/|$))/;
const CLAUDE_NEGATOR_RE = /不需要讀|不必讀|不要讀|不用讀|不能讀|禁止讀|別讀|勿讀|不碰|不讀|never read|do not read|don't read|must not read|do not touch|never/i;
const CLAUDE_PATH_DENY = '這則訊息要對方讀真實的 ~/.claude。讀取真實 ~/.claude 需要操作員本人的卡。請改請該席用自己被允許的讀取方式提供資料，或拿掉這一步。' + gateHint('改請該席用自己被允許的讀取方式提供資料，或拿掉讀 ~/.claude 這一步', 'hooks/README.md');
const ULID_IN_TEXT_RE = /\b[0-9A-HJKMNP-TV-Z]{26}\b/;
const DISPATCH_OPT_IN = 'pm-dispatch-plan-guard';
const VALID_DISPATCH_SIZES = new Set(['XS', 'S', 'M', 'L', 'XL']);
const DISPATCH_SIZE_DENY_REASON = '每張派工都要帶 Size（XS|S|M|L|XL），請補上' + gateHint('在工單補 Size: XS|S|M|L|XL 再派', 'hooks/README.md');
const DISPATCH_SIZE_MISMATCH_DENY_REASON = '結構化 size 與內文 Size: 不一致，兩處須為相同值' + gateHint('將結構化 size 與內文 Size: 兩處改成同一個值再派', 'hooks/README.md');
const DISPATCH_PLAN_DENY_REASON = '工單 Size M 以上要帶「Plan: 路徑@sha」或「Plan: plan-first」' + gateHint('Size M 以上的工單補 Plan: 路徑@sha 或 Plan: plan-first 再派', 'hooks/README.md');
const DISPATCH_LEGACY_PLAN_DENY_REASON = '舊寫法 `.md@sha` 已退役，請改 `Plan: <路徑>@<sha>`' + gateHint('將舊寫法 `.md@sha` 改成 `Plan: <路徑>@<sha>` 表頭再派', 'hooks/README.md');

function envBag() {
  return process.env;
}

function knobOff(env) {
  const v = env && env.AUTOPILOT_SEND_WORK_ORDER_GUARD;
  return typeof v === 'string' && ['off', 'false', '0', 'no'].includes(v.trim().toLowerCase());
}

function isWorkOrder(content) {
  if (typeof content !== 'string' || !content) return false;
  const hay = content.toLowerCase();
  return WORK_ORDER_PHRASES.some((phrase) => hay.includes(phrase.toLowerCase()));
}

// reply: deny only an imperative addressed to the receiver, or a brief header block; first-person and bare nouns pass.
const REPLY_IMPERATIVE_RE = /請(?:你)?(?:做|跑|修|實作)|麻煩你|please (?:run|implement|fix)\b|^\s*(?:Engine|Role):/im;
function isReplyWorkOrder(content) {
  return typeof content === 'string' && REPLY_IMPERATIVE_RE.test(content);
}

function isFyiWorkOrder(content) {
  if (typeof content !== 'string' || !content) return false;
  const hay = content.toLowerCase();
  return WORK_ORDER_PHRASES.some((p) => !FYI_BENIGN_PHRASES.includes(p) && hay.includes(p.toLowerCase()));
}

function hasTaskContext(toolInput) {
  if (typeof toolInput.task_id === 'string' && toolInput.task_id.trim()) return true;
  if (typeof toolInput.content === 'string' && HEADER_TASK_ID_RE.test(toolInput.content.split('\n').slice(0, 5).join('\n'))) return true;
  return typeof toolInput.content === 'string' && ULID_IN_TEXT_RE.test(toolInput.content);
}

function preToolDeny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

function preToolAllowUpdatedInput(updatedInput) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput,
    },
  };
}

function decideDispatch(input) {
  if (!isEnabled(DISPATCH_OPT_IN)) return null;
  if (!isPmConsole(input)) return null;
  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const hasStructuredSize = toolInput.size !== undefined && toolInput.size !== null && toolInput.size !== '';
  if (hasStructuredSize && !VALID_DISPATCH_SIZES.has(toolInput.size)) {
    return preToolDeny(DISPATCH_SIZE_DENY_REASON);
  }
  const structuredSize = hasStructuredSize ? toolInput.size : null;
  const parsed = parseWorkOrder(toolInput.task);
  if (parsed.size === 'conflict') {
    return preToolDeny(DISPATCH_SIZE_DENY_REASON);
  }
  if (parsed.size && structuredSize && parsed.size !== structuredSize) {
    return preToolDeny(`結構化 size=${structuredSize} 與內文 Size: ${parsed.size} 不一致。${DISPATCH_SIZE_MISMATCH_DENY_REASON}`);
  }
  const effectiveSize = parsed.size || structuredSize;
  if (!effectiveSize) {
    return preToolDeny(DISPATCH_SIZE_DENY_REASON);
  }
  if (isMPlus(effectiveSize)) {
    if (!parsed.plan) {
      return preToolDeny(DISPATCH_PLAN_DENY_REASON);
    }
    if (parsed.plan.legacy) {
      return preToolDeny(DISPATCH_LEGACY_PLAN_DENY_REASON);
    }
  }
  return null;
}

function channelAttrs(attrText) {
  const attrs = {};
  const re = /([A-Za-z_][\w-]*)="([^"]*)"/g;
  let m;
  while ((m = re.exec(attrText))) attrs[m[1]] = m[2];
  return attrs;
}

function textParts(content) {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  return content.filter((b) => b && typeof b.text === 'string').map((b) => b.text);
}

// Last matching inbound channel. Missing file or id => null (allow; do not guess).
function fleetChannel(transcriptPath, messageId) {
  if (typeof transcriptPath !== 'string' || !transcriptPath || typeof messageId !== 'string' || !messageId) return null;
  let raw;
  try { raw = fs.readFileSync(transcriptPath, 'utf8'); } catch { return null; }
  if (!raw.includes(messageId)) return null;
  let found = null;
  for (const line of raw.split('\n')) {
    if (!line.includes(messageId)) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    const content = rec && rec.message && rec.message.content;
    for (const text of textParts(content)) {
      const openRe = /<channel\s+([^>]+)>/g;
      let m;
      while ((m = openRe.exec(text))) {
        const attrs = channelAttrs(m[1]);
        if (attrs.source !== 'fleet' || attrs.message_id !== messageId) continue;
        const next = text.indexOf('<channel ', m.index + m[0].length);
        let inner = text.slice(m.index + m[0].length, next === -1 ? text.length : next);
        const close = inner.lastIndexOf('</channel>');
        if (close >= 0) inner = inner.slice(0, close);
        found = { from: String(attrs.from || '').replace(/@[^@/]*$/, ''), body: inner };
      }
    }
  }
  return found;
}

function courierReplyDeny(input) {
  if (!input || input.tool_name !== 'mcp__fleet__reply') return null;
  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  // The courier's model-reply probe (message_id model-probe-*) is answered with reply by design; denying it makes the probe retry every few seconds and burn a model turn each time.
  if (typeof toolInput.message_id === 'string' && toolInput.message_id.startsWith('model-probe-')) return null;
  const hit = fleetChannel(input.transcript_path, toolInput.message_id);
  if (!hit || !hit.from.endsWith('/courier')) return null;
  const id = BODY_TASK_ID_RE.exec(hit.body);
  const reason = id
    ? `reply 不能回 courier 的 wake 訊息，請改用 task_comment（task_id: ${id[1]}）` + gateHint('回 courier 的 wake 訊息改用 task_comment（task_id: ' + id[1] + '）', 'hooks/README.md')
    : COURIER_REPLY_REASON;
  return preToolDeny(reason);
}

function clauseStart(text, index) {
  const prefix = text.slice(0, index);
  const boundary = /[。；;\n]|\.(?=\s|$)/g;
  let start = 0;
  let m;
  while ((m = boundary.exec(prefix))) start = m.index + m[0].length;
  return start;
}

function pathOccurrenceNegated(text, index) {
  const clause = text.slice(clauseStart(text, index), index);
  const negator = new RegExp(CLAUDE_NEGATOR_RE.source, 'ig');
  let m;
  while ((m = negator.exec(clause))) {
    if (clause.length - (m.index + m[0].length) <= 12) return true;
  }
  return false;
}

function claudePathDeny(input) {
  const name = input && input.tool_name;
  if (name !== 'mcp__fleet__send' && name !== 'mcp__fleet__dispatch' && name !== 'mcp__fleet__task_comment') return null;
  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const text = name === 'mcp__fleet__dispatch' ? toolInput.task : name === 'mcp__fleet__task_comment' ? toolInput.text : toolInput.content;
  if (typeof text !== 'string') return null;
  const re = new RegExp(CLAUDE_HOME_RE.source, 'g');
  let m;
  while ((m = re.exec(text))) {
    if (!pathOccurrenceNegated(text, m.index)) return preToolDeny(CLAUDE_PATH_DENY);
  }
  return null;
}

function decide(input, env = envBag()) {
  if (!input || typeof input !== 'object') return null;
  const courier = courierReplyDeny(input);
  if (courier) return courier;
  const claudePath = claudePathDeny(input);
  if (claudePath) return claudePath;
  if (input.tool_name === 'mcp__fleet__dispatch') {
    return decideDispatch(input);
  }
  if (knobOff(env)) return null;
  if (input.tool_name !== 'mcp__fleet__send' && input.tool_name !== 'mcp__fleet__reply') return null;
  const toolInput = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  if (input.tool_name === 'mcp__fleet__reply') {
    // A reply that answers a task carries task context and is fine; an uncontexted work order is not.
    const asks = isReplyWorkOrder(toolInput.content);
    if (!asks || hasTaskContext(toolInput)) return null;
    const hit = fleetChannel(input.transcript_path, toolInput.message_id);
    const idMatch = hit && typeof hit.body === 'string' ? BODY_TASK_ID_RE.exec(hit.body) : null;
    if (idMatch) {
      const content = typeof toolInput.content === 'string' ? toolInput.content : '';
      return preToolAllowUpdatedInput({
        ...toolInput,
        content: `task_id: ${idMatch[1]}\n${content}`,
      });
    }
    return preToolDeny(REPLY_DENY_REASON);
  }
  const hasNoTask = typeof toolInput.content === 'string' && /\[no-task/i.test(toolInput.content);
  if (hasTaskContext(toolInput)) return null;
  if (toolInput.fyi === true && !(hasNoTask && isWorkOrder(toolInput.content)) && !isFyiWorkOrder(toolInput.content)) return null;
  if (typeof toolInput.to === 'string' && toolInput.to.startsWith('@')) return null;
  if (!isWorkOrder(toolInput.content)) return null;
  return preToolDeny(DENY_REASON);
}

function main() {
  try {
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    const out = decide(input && typeof input === 'object' ? input : {});
    if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
  } catch (err) {
    process.stderr.write(`fleet-send-work-order-guard: fail-open: ${err && err.message}\n`);
  }
}

if (require.main === module) main();
module.exports = {
  decide,
  WORK_ORDER_PHRASES,
  DISPATCH_SIZE_DENY_REASON,
  DISPATCH_SIZE_MISMATCH_DENY_REASON,
  DISPATCH_PLAN_DENY_REASON,
};
