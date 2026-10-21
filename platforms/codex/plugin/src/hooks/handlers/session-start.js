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

Anything that needs the owner's decision or answer: open a card with node ${OPEN_DECISION_JS} open --question ... and write the card id (d- + 8 hex) in the reply.
When the owner answers in the live panel, a message starting with [待決回覆] arrives: act on the answers; the cards close automatically.
To show the owner a file or a diff, use the show tool; do not paste the content.
Cross-harness token discipline (advisory only): read ${TOKEN_DISCIPLINE_DOC}.${openDecisionCardLine(cwd)}`;
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
