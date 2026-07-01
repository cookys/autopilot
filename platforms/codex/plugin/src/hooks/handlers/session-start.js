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

function buildBaseContext() {
  return BASE_AUTOPILOT_CONTEXT;
}

function composeSessionStartContext({
  compactionRecovery = '',
  handoffInjected = '',
  intentHint = '',
  disableWarning = '',
  updateNotice = '',
  injectHandoffSection,
  limit = 10000,
  keep = 9999,
}) {
  let context = buildBaseContext();

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
