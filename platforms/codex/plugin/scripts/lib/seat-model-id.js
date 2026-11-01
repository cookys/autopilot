'use strict';
// BL-0364: offline check that a seat's model is spelled in a form the runner's CLI accepts,
// run BEFORE any seat is dispatched. `claude -p --model claude-opus` dies at startup with
// [claude-code:unrecognized_model] (rc=1), which the collect loop records as a seat_gap and a
// wasted generation. The claude-native runner passes the model verbatim to `claude --model`, so
// only a CLI alias (opus, sonnet, ...) or a full versioned id (claude-opus-5-5) is valid; a bare
// family name like `claude-opus` is neither. Other runners take their own spellings and are not
// judged here. No network call is made.

const CLAUDE_CLI_ALIASES = ['opus', 'sonnet', 'haiku', 'fable', 'opusplan', 'default', 'best'];
// claude-<words>-<a segment with a digit>[-more][ [1m] ]  e.g. claude-opus-5-5, claude-haiku-4-5-20251001
const CLAUDE_FULL_ID_RE = /^claude-(?:[a-z]+-)*[a-z]*\d[a-z0-9-]*(?:\[1m\])?$/u;

function isClaudeNativeModel(model) {
  if (typeof model !== 'string') return false;
  const bare = model.replace(/\[1m\]$/u, '');
  return CLAUDE_CLI_ALIASES.includes(bare) || CLAUDE_FULL_ID_RE.test(model);
}

// -> [{ seat, runner, model, message }] for every seat whose model the runner would reject.
function invalidSeatModels(seats) {
  const bad = [];
  for (const seat of seats || []) {
    if (seat && seat.runner === 'claude-native' && !isClaudeNativeModel(seat.engine)) {
      bad.push({
        seat: seat.id,
        runner: seat.runner,
        model: seat.engine,
        message: `seat ${seat.id} (runner claude-native) model '${seat.engine}' is not a name the claude CLI accepts; use a CLI alias (${CLAUDE_CLI_ALIASES.join(', ')}) or a full model id such as claude-opus-5-5`,
      });
    }
  }
  return bad;
}

module.exports = { CLAUDE_CLI_ALIASES, isClaudeNativeModel, invalidSeatModels };
