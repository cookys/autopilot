'use strict';

// The header lines an autopilot Agent brief is expected to open with. Role is advisory:
// no hook denies for it. Engine and Lane are enforced by different hooks; Size and
// Used-by are checked by dispatch-model-guard for autopilot briefs (Lane: present).
// Fable/opus add a Cost line (see costLineFor); the session hint names it.
const BRIEF_HEADER_TEMPLATE = 'Engine: <model>\nRole: <role>\nLane: <slug>\nSize: XS|S|M|L|XL\nUsed-by: user|e2e|n/a <reason>';

// Same lane line as hooks/subagent-budget.js (first 5 lines of the brief).
const LANE_RE = /^Lane:[ \t]*([A-Za-z0-9][A-Za-z0-9._-]{0,63})[ \t]*$/;

// Autopilot dispatch brief metadata (checked within BRIEF_HEAD_WINDOW lines when Lane: is present).
const SIZE_RE = /^Size:[ \t]*(XS|S|M|L|XL)[ \t]*$/;
const USED_BY_RE = /^Used-by:[ \t]*(?:(?:user|e2e)(?:[ \t]+\S.*)?|n\/a[ \t]+\S.*)[ \t]*$/;
const STAGES_RE = /^Stages:[ \t]*\S/;

// Coarse stage lists per size (derived from references/stage-graph.json, D8b Open Q3 default).
const STAGES_BY_SIZE = Object.freeze({
  XS: 'build,review,merged',
  S: 'build,review,merged',
  M: 'plan,build,review,merged',
  L: 'explore,plan,build,review,merged,shipped,used',
  XL: 'explore,plan,build,review,merged,shipped,used',
});

// A Cost line is present when a head line starts with "Cost:" and a token.
const COST_LINE_RE = /^Cost:\s*\S/;

const FABLE_OPUS_COST_LINE = 'Cost: 最貴的模型，會燒光共用池；只做最難的判斷，讀檔、搜尋、整理一律派 haiku/sonnet subagent';
const SONNET_COST_LINE = 'Cost: 中價模型；機械性讀檔與搜尋可再派 haiku';

const { BRIEF_HEAD_WINDOW, headLines, findHeadMatch } = require('./brief-head.js');

function hasBriefLane(prompt) {
  return headLines(prompt, 5).some((line) => LANE_RE.test(line));
}

function briefSizeFromHead(prompt) {
  const m = findHeadMatch(prompt, SIZE_RE, BRIEF_HEAD_WINDOW);
  return m ? m[1] : '';
}

function hasValidUsedBy(prompt) {
  return Boolean(findHeadMatch(prompt, USED_BY_RE, BRIEF_HEAD_WINDOW));
}

function hasStagesHeader(prompt) {
  return Boolean(findHeadMatch(prompt, STAGES_RE, BRIEF_HEAD_WINDOW));
}

function stagesLineForSize(size) {
  const list = typeof size === 'string' ? STAGES_BY_SIZE[size.trim()] : undefined;
  return list ? `Stages: ${list}` : '';
}

// Same normalisation as missingBriefHeaders (trim, lower-case). A full id
// (claude-opus-5-5, claude-fable-5-2) counts as that family. An @-suffixed
// token (opus@agy) is classified on the part before @.
function costModelToken(model) {
  const norm = String(model == null ? '' : model).trim().toLowerCase();
  const at = norm.indexOf('@');
  return at === -1 ? norm : norm.slice(0, at);
}

function tokenHasFamily(token, family) {
  if (!token) return false;
  return new RegExp('(?:^|[^a-z0-9])' + family + '(?:[^a-z0-9]|$)').test(token);
}

// Fable/opus → the expensive line. Sonnet → the mid-price line.
// Haiku, anything else, and empty → '' (no line).
function costLineFor(model) {
  const token = costModelToken(model);
  if (!token) return '';
  if (tokenHasFamily(token, 'fable') || tokenHasFamily(token, 'opus')) return FABLE_OPUS_COST_LINE;
  if (tokenHasFamily(token, 'sonnet')) return SONNET_COST_LINE;
  return '';
}

// True only for a fable/opus cost line that none of the first 6 lines satisfies.
function missingCostLine(prompt, model) {
  if (costLineFor(model) !== FABLE_OPUS_COST_LINE) return false;
  return !headLines(prompt, 6).some((line) => COST_LINE_RE.test(line));
}

// Which of the three header lines are absent. Engine uses the same first
// non-blank line and the same model normalisation as dispatch-model-guard
// (trim, lower-case; token equals the model or starts with model + "@").
// Lane uses LANE_RE on the first 5 lines. Role is missing when no line in
// those 5 starts with "Role:"; callers must not deny for Role alone.
function missingBriefHeaders(prompt, model) {
  const modelNorm = String(model == null ? '' : model).trim().toLowerCase();
  const raw = String(prompt == null ? '' : prompt);
  let firstLine = null;
  for (const line of raw.split('\n')) {
    if (line.trim().length > 0) {
      firstLine = line;
      break;
    }
  }
  let engineOk = false;
  if (firstLine !== null && /^Engine:/.test(firstLine)) {
    if (!modelNorm) {
      // No model to compare. A leading Engine: line is enough.
      engineOk = true;
    } else {
      const m = firstLine.match(/^Engine:\s*(\S+)/);
      if (m) {
        const token = m[1].toLowerCase();
        if (token === modelNorm || token.startsWith(modelNorm + '@')) engineOk = true;
      }
    }
  }
  const head = headLines(raw, 5);
  const roleOk = head.some((line) => line.startsWith('Role:'));
  const laneOk = head.some((line) => LANE_RE.test(line));
  const missing = [];
  if (!engineOk) missing.push('engine');
  if (!roleOk) missing.push('role');
  if (!laneOk) missing.push('lane');
  return missing;
}

// Appended to an existing deny reason. laneBy/engineBy is 'self' when this
// hook enforces that line, or 'other' when the sibling hook does.
// dispatch-model-guard cannot see the autopilot-dispatch condition, so its
// Lane note must not claim the brief is an autopilot dispatch.
function headerDenialSuffix(prompt, model, { engineBy, laneBy, includeLane = true } = {}) {
  const bits = [];
  for (const key of missingBriefHeaders(prompt, model)) {
    if (key === 'lane' && !includeLane) continue;
    if (key === 'engine') {
      bits.push(engineBy === 'other'
        ? 'Engine: (required by dispatch-model-guard)'
        : 'Engine:');
    } else if (key === 'lane') {
      bits.push(laneBy === 'other'
        ? 'Lane: (subagent-budget requires Lane: for autopilot dispatches)'
        : 'Lane:');
    } else if (key === 'role') {
      bits.push('Role: recommended, not enforced');
    }
  }
  const exactCost = missingCostLine(prompt, model) ? costLineFor(model) : '';
  if (bits.length === 0 && !exactCost) return '';
  let out = '';
  if (bits.length > 0) {
    out = `\n${BRIEF_HEADER_TEMPLATE}\nThis brief is still missing: ${bits.join('; ')}.`;
  }
  if (exactCost) out += `\n${exactCost}`;
  return out;
}

// One SessionStart line. Engine / Role / Lane, then the Cost slot for fable/opus.
function sessionStartBriefHeaderLine() {
  const line = `Agent brief first lines: ${BRIEF_HEADER_TEMPLATE.replace(/\n/g, ' | ')} | Cost: <fable/opus 必填，見 costLineFor>`;
  if (line.length > 200) {
    throw new Error(`brief header hint is ${line.length} characters`);
  }
  return line;
}

module.exports = {
  BRIEF_HEADER_TEMPLATE,
  LANE_RE,
  SIZE_RE,
  USED_BY_RE,
  STAGES_RE,
  STAGES_BY_SIZE,
  COST_LINE_RE,
  hasBriefLane,
  briefSizeFromHead,
  hasValidUsedBy,
  hasStagesHeader,
  stagesLineForSize,
  costLineFor,
  missingCostLine,
  missingBriefHeaders,
  headerDenialSuffix,
  sessionStartBriefHeaderLine,
};
