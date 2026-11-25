'use strict';

/**
 * plan-inventory-lint.js — lint mechanism plans for a "既有計畫盤點" section.
 *
 * A plan is classified as a mechanism plan if its title or intro (everything
 * before the first `## ` heading, excluding fenced code blocks) contains any
 * of the mechanism keywords.
 */

// Multi-character terms only: bare 單 / 卡 / 等待 hit ordinary words (簡單, 清單, 卡片, 等待時間)
// and would block general feature plans.
const MECHANISM_KEYWORDS = [
  '工單',
  '子單',
  '父單',
  '單號',
  'fleet task',
  '計畫列',
  '收據',
  '裁定',
  'waiting_on',
  '待決卡',
  '決策卡',
  '接續',
  '巡查',
  '守門',
];

const REQUIRED_ITEMS = [
  {
    label: '盤點範圍（哪些 repo）',
    pattern: /(?:盤點範圍|(?:^|\s|[-*•])範圍\s*[:：])/,
  },
  {
    label: '重疊群組',
    pattern: /重疊群組/,
  },
  {
    label: '要退役的零件',
    pattern: /(?:要退役的零件|退役)/,
  },
];

function stripCodeBlocks(text) {
  return text.replace(/^```[\s\S]*?^```[ \t]*$/gm, '').replace(/^~~~[\s\S]*?^~~~[ \t]*$/gm, '');
}

function extractTitleAndIntro(markdown) {
  const firstH2 = markdown.search(/^##(?:\s|$)/m);
  const head = firstH2 === -1 ? markdown : markdown.slice(0, firstH2);
  return stripCodeBlocks(head);
}

/**
 * Determine whether a plan is a mechanism plan based on its title and intro
 * (before the first `##` heading, excluding code blocks).
 */
function isMechanismPlan(markdown) {
  if (typeof markdown !== 'string' || markdown.length === 0) return false;
  const intro = extractTitleAndIntro(markdown);
  return MECHANISM_KEYWORDS.some((kw) => intro.includes(kw));
}

function extractInventorySection(markdown) {
  const lines = markdown.split(/\r?\n/);
  let inSection = false;
  let sectionLevel = 0;
  const bodyLines = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2];
      if (!inSection) {
        if (title.includes('既有計畫盤點')) {
          inSection = true;
          sectionLevel = level;
        }
        continue;
      }
      if (level <= sectionLevel) {
        break;
      }
    }
    if (inSection) {
      bodyLines.push(line);
    }
  }

  if (!inSection) return null;
  return stripCodeBlocks(bodyLines.join('\n'));
}

/**
 * Lint a plan's "既有計畫盤點" section if it is a mechanism plan.
 * Returns an array of error strings (empty if valid or non-mechanism).
 */
function lintPlanInventory(markdown, opts = {}) {
  const classifier = opts.isMechanismPlan || isMechanismPlan;
  if (!classifier(markdown)) {
    return [];
  }

  const sectionBody = extractInventorySection(markdown);
  if (sectionBody === null) {
    return ['phases:v1: 機制類計畫缺少「既有計畫盤點」一節'];
  }

  const lines = sectionBody.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const errors = [];
  for (const item of REQUIRED_ITEMS) {
    const found = lines.some((line) => item.pattern.test(line));
    if (!found) {
      errors.push(`phases:v1: 「既有計畫盤點」一節缺少「${item.label}」`);
    }
  }
  return errors;
}

module.exports = {
  MECHANISM_KEYWORDS,
  REQUIRED_ITEMS,
  isMechanismPlan,
  extractInventorySection,
  lintPlanInventory,
};
