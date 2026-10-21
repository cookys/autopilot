'use strict';

const BASE_AUTOPILOT_CONTEXT = `You have **Autopilot** lifecycle skills. Before starting any task, check if one applies:

| Trigger | Skill |
|---------|-------|
| Starting code work, "I'm working on X", quick fix, hotfix, continuing from yesterday | \`autopilot:dev-flow\` |
| Research options, "what do others use", compare X vs Y, 業界怎麼做 | \`autopilot:survey\` |
| Strategic decision, need perspectives, tradeoff analysis, 要辯論一下 | \`autopilot:think-tank\` |
| Irreversible decision, genuine stalemate, Hegelian dialectic, 不可逆決策, 兩邊都有道理, 辯證一下 | \`autopilot:think-tank-dialectic\` |
| Full delegation, "get it done", CEO mode, 搞定, 全權處理 | \`autopilot:ceo-agent\` |
| Pre-commit/merge quality checks, "is this ready?" | \`autopilot:quality-pipeline\` |
| Archive project, bootstrap from plan, set up tracking | \`autopilot:project-lifecycle\` |
| Onboard a repo to autopilot, scaffold .claude config | \`autopilot:onboard\` |
| Save a lesson, "record this", knowledge audit | \`autopilot:learn\` |
| Retrospective, commit history analysis, 回顧 | \`autopilot:retro\` |
| What to work on next, /next, highest priority | \`autopilot:next\` |
| Compare two implementations, feature parity check | \`autopilot:audit\` |

If uncertain, invoke the skill — it will guide you. Autopilot sets the rules and runs them standalone.`;

const path = require('path');
const OPEN_DECISION_JS = path.join(__dirname, '..', '..', '..', 'scripts', 'open-decision.js');
function shellQuotePath(p) {
  if (/^[A-Za-z0-9_/.:@%+=,-]+$/.test(p)) return p;
  return `'${String(p).replace(/'/g, `'\\''`)}'`;
}
const OPEN_DECISION_CMD = shellQuotePath(OPEN_DECISION_JS);
const TOKEN_DISCIPLINE_DOC = path.join(__dirname, '..', '..', '..', 'docs', 'token-discipline.md');
const DECISION_SCHEMA = 'autopilot.decision/2';

// Open cards the way scripts/open-decision.js show does. Read failure => no line.
function openDecisionCardLine(cwd) {
  try {
    const fs = require('fs');
    const { scopeFromCwd } = require('../../status/project-key');
    const { commonDirOf, listScopeFiles, readScopeFile } = require('../../status/scope-key');
    const scope = scopeFromCwd(path.resolve(cwd || process.cwd()));
    const commonDir = commonDirOf(scope.repo_identity);
    if (!scope.project_key || !commonDir) return '';
    const dir = path.join(commonDir, 'autopilot', 'decisions');
    const entries = [];
    for (const file of listScopeFiles(dir, scope.project_key)) {
      if (!readScopeFile(file, { schema: DECISION_SCHEMA, projectKey: scope.project_key, identity: scope.repo_identity })) continue;
      let decisions = [];
      try {
        const v = JSON.parse(fs.readFileSync(file, 'utf8'));
        decisions = v && v.schema === DECISION_SCHEMA && Array.isArray(v.decisions) ? v.decisions : [];
      } catch { decisions = []; }
      for (const e of decisions) {
        if (e && typeof e.id === 'string' && e.id && typeof e.question === 'string' && e.question) entries.push(e);
      }
    }
    entries.sort((a, b) => (Date.parse(a.opened_at) || 0) - (Date.parse(b.opened_at) || 0) || String(a.id).localeCompare(String(b.id)));
    if (entries.length === 0) return '';
    return `\nOpen decision cards (${entries.length}): ${entries.map((e) => e.id).join(', ')}`;
  } catch {
    return '';
  }
}

function buildBaseContext(cwd = process.cwd()) {
  return `${BASE_AUTOPILOT_CONTEXT}

Anything that needs the owner's decision or answer: open a card with node ${OPEN_DECISION_CMD} open --question ... and write the card id (d- + 8 hex) in the reply.
When the owner answers in the live panel, a message whose first line is [待決回覆] arrives: act on the answers; the cards close automatically.
To show the owner a file or a diff, use the show tool; do not paste the content.
Cross-harness token discipline (advisory only): read ${TOKEN_DISCIPLINE_DOC}.${openDecisionCardLine(cwd)}`;
}

// Appended to a trimmed recovery body. Counted inside the room left for that body.
const RECOVERY_CUT_LINE = '\n[...cut to fit the injection limit]';

function isRecoveryParts(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof value.head === 'string'
    && typeof value.body === 'string'
    && typeof value.tail === 'string';
}

function fitBodyToRoom(body, room) {
  if (room < 0) room = 0;
  if (body.length <= room) return body;
  const marker = RECOVERY_CUT_LINE;
  if (room >= marker.length) return body.slice(0, room - marker.length) + marker;
  return marker.slice(0, room);
}

// head+tail fit in keep, but base + later blocks + head + tail do not, so the
// body room is negative. An empty body plus slice(0, keep) would cut the tail.
// Keep the full head (it carries the DATA sentence) and the full tail (closing
// wrapper tag), then the cut notice, then as much of the front of the base as
// still fits. The tail sits at the end; a length guard drops the front. Never throws.
function negativeRoomFallback(base, head, tail, keep) {
  const core = head + tail;
  let spare = keep - core.length;
  let notice = '';
  if (spare > 0) {
    notice = RECOVERY_CUT_LINE.slice(0, Math.min(RECOVERY_CUT_LINE.length, spare));
    spare -= notice.length;
  }
  const front = spare > 0 ? String(base).slice(0, spare) : '';
  let out = front + head + notice + tail;
  if (out.length > keep) out = out.slice(out.length - keep);
  return out;
}

// Last-resort length guard. Drop from the front so a tail that fits in keep
// is never the part that gets cut.
function guardKeepTail(context, tail, keep) {
  if (tail.length >= keep) return tail.slice(tail.length - keep);
  if (context.length <= keep && context.endsWith(tail)) return context;
  const roomForFront = keep - tail.length;
  const front = context.endsWith(tail)
    ? context.slice(0, context.length - tail.length).slice(-roomForFront)
    : context.slice(0, roomForFront);
  const out = front + tail;
  return out.length > keep ? out.slice(out.length - keep) : out;
}

// Object form reserves head and tail. A plain string stays on the original path.
function composeWithRecoveryObject({
  compactionRecovery,
  handoffInjected = '',
  intentHint = '',
  disableWarning = '',
  budgetWarning = '',
  updateNotice = '',
  injectHandoffSection,
  limit = 10000,
  keep = 9999,
  cwd,
}) {
  const head = compactionRecovery.head;
  const body = compactionRecovery.body;
  const tail = compactionRecovery.tail;
  const base = buildBaseContext(cwd);

  const applySections = (recoveryText) => {
    let context = base;
    if (recoveryText) context += recoveryText;
    if (!handoffInjected && intentHint) context += intentHint;
    if (handoffInjected && typeof injectHandoffSection === 'function') {
      context = injectHandoffSection(context, handoffInjected);
    }
    if (disableWarning) context += disableWarning;
    if (budgetWarning) {
      const budgetBlock = `\n\n${budgetWarning}`;
      if (context.length + budgetBlock.length < limit) context += budgetBlock;
    }
    if (updateNotice) {
      const updateNoticeBlock = `\n\n${updateNotice}`;
      if (context.length + updateNoticeBlock.length < limit) context += updateNoticeBlock;
    }
    return context;
  };

  const fullRecovery = head + body + tail;
  const full = applySections(fullRecovery);
  // Under the limit, head+body+tail is the old string and nothing was trimmed.
  if (full.length < limit) return full;

  // Degenerate: head+tail alone exceed keep. The base, the body, and every
  // later block cannot all stay. Emit only the tail plus the one-line cut
  // notice, then truncate that to keep as a last resort. Never throws.
  if (head.length + tail.length > keep) {
    let out = tail + RECOVERY_CUT_LINE;
    if (out.length > keep) out = out.slice(0, keep);
    return out;
  }

  let context;
  if (full.startsWith(base + fullRecovery)) {
    // Later pieces were decided against the full recovery (same limit checks
    // as the string path) and are a pure suffix. Room for the body is
    // keep minus that suffix-and-base length, minus head, minus tail.
    const later = full.slice((base + fullRecovery).length);
    const othersLen = base.length + later.length;
    const room = keep - othersLen - head.length - tail.length;
    if (room < 0) return negativeRoomFallback(base, head, tail, keep);
    let fitted = fitBodyToRoom(body, room);
    context = base + head + fitted + tail + later;
    if (context.length >= limit) {
      const overflow = context.length - keep;
      fitted = fitted.slice(0, Math.max(0, fitted.length - overflow));
      context = base + head + fitted + tail + later;
    }
  } else {
    // A later rewriter (handoff spare <= 0 slices to keep) already cut the
    // full string. Measure the assembly with an empty body, which still
    // runs the same section order, and size the body from that.
    const emptyBody = applySections(head + tail);
    let othersLen = Math.max(0, emptyBody.length - head.length - tail.length);
    const afterHead = base.length + head.length;
    if (emptyBody.startsWith(base + head) && emptyBody.slice(afterHead).startsWith(tail)) {
      const later = emptyBody.slice(afterHead + tail.length);
      othersLen = base.length + later.length;
    }
    const room = keep - othersLen - head.length - tail.length;
    if (room < 0) return negativeRoomFallback(base, head, tail, keep);
    let fitted = fitBodyToRoom(body, room);
    context = applySections(head + fitted + tail);
    if (context.length >= limit) {
      const overflow = context.length - keep;
      const start = context.indexOf(head);
      const tailAt = start >= 0 ? context.indexOf(tail, start + head.length) : -1;
      if (start >= 0 && tailAt >= 0) {
        const prefix = context.slice(0, start + head.length);
        const mid = context.slice(start + head.length, tailAt);
        const suffix = context.slice(tailAt);
        context = prefix + mid.slice(0, Math.max(0, mid.length - overflow)) + suffix;
      }
    }
  }
  if (context.length >= limit) context = guardKeepTail(context, tail, keep);
  return context;
}

function composeSessionStartContext({
  compactionRecovery = '',
  handoffInjected = '',
  intentHint = '',
  disableWarning = '',
  budgetWarning = '',
  updateNotice = '',
  injectHandoffSection,
  limit = 10000,
  keep = 9999,
  cwd,
}) {
  if (isRecoveryParts(compactionRecovery)) {
    return composeWithRecoveryObject({
      compactionRecovery,
      handoffInjected,
      intentHint,
      disableWarning,
      budgetWarning,
      updateNotice,
      injectHandoffSection,
      limit,
      keep,
      cwd,
    });
  }

  let context = buildBaseContext(cwd);

  if (compactionRecovery) {
    context += compactionRecovery;
  }
  if (!handoffInjected && intentHint) {
    context += intentHint;
  }
  if (handoffInjected && typeof injectHandoffSection === 'function') {
    context = injectHandoffSection(context, handoffInjected);
  }
  if (disableWarning) {
    context += disableWarning;
  }
  if (budgetWarning) {
    const budgetBlock = `\n\n${budgetWarning}`;
    if (context.length + budgetBlock.length < limit) {
      context += budgetBlock;
    }
  }
  if (updateNotice) {
    const updateNoticeBlock = `\n\n${updateNotice}`;
    if (context.length + updateNoticeBlock.length < limit) {
      context += updateNoticeBlock;
    }
  }
  if (context.length >= limit) {
    context = context.slice(0, keep);
  }
  return context;
}

function buildSessionStartOutput({ context, claudePluginRoot }) {
  if (claudePluginRoot) {
    return {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: context,
      },
    };
  }
  return {
    additional_context: context,
  };
}

module.exports = {
  BASE_AUTOPILOT_CONTEXT,
  buildBaseContext,
  composeSessionStartContext,
  buildSessionStartOutput,
};
