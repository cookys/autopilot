'use strict';

// The three lines an Agent brief is expected to open with. Role is advisory:
// no hook denies for it. Engine and Lane are enforced by different hooks.
const BRIEF_HEADER_TEMPLATE = 'Engine: <model>\nRole: <role>\nLane: <slug>';

// Same lane line as hooks/subagent-budget.js (first 5 lines of the brief).
const LANE_RE = /^Lane:[ \t]*([A-Za-z0-9][A-Za-z0-9._-]{0,63})[ \t]*$/;

const { headLines } = require('./brief-head.js');

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
  if (firstLine !== null && modelNorm) {
    const m = firstLine.match(/^Engine:\s*(\S+)/);
    if (m) {
      const token = m[1].toLowerCase();
      if (token === modelNorm || token.startsWith(modelNorm + '@')) engineOk = true;
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
  if (bits.length === 0) return '';
  return `\n${BRIEF_HEADER_TEMPLATE}\nThis brief is still missing: ${bits.join('; ')}.`;
}

// One SessionStart line. The three template rows come from BRIEF_HEADER_TEMPLATE.
function sessionStartBriefHeaderLine() {
  const line = `Agent brief first three lines: ${BRIEF_HEADER_TEMPLATE.replace(/\n/g, ' | ')}`;
  if (line.length > 200) {
    throw new Error(`brief header hint is ${line.length} characters`);
  }
  return line;
}

module.exports = {
  BRIEF_HEADER_TEMPLATE,
  LANE_RE,
  missingBriefHeaders,
  headerDenialSuffix,
  sessionStartBriefHeaderLine,
};
