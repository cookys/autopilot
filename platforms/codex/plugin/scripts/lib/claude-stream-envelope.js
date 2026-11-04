'use strict';
/**
 * claude-stream-envelope.js - the candidate C2 conversion measured by BL-0372 (plan 2.0).
 *
 *   streamToEnvelope(streamText) -> { ok, bytes, reason }
 *
 * `streamText` is the stdout of `claude -p --output-format stream-json --verbose`. The function finds the LAST
 * line that parses to a non-array object with `type === 'result'` (the same "take the last result" rule as
 * `parseEnvelope` in claude-account.js) and returns the RAW bytes of that line plus one `\n`. The line is never
 * re-serialised: JSON.stringify could reorder keys or recompute floats, which is exactly the drift the
 * measurement looks for. A trailing `\r` (CRLF input) is dropped so the output ends with exactly one `\n`.
 * With no result line: { ok: false, bytes: '', reason: 'no_result_line' } and the caller emits the stream unchanged.
 *
 * Built-ins only. The measurement script and any future wrapper change import THIS file; no second rebuilder.
 */

function streamToEnvelope(streamText) {
  if (typeof streamText !== 'string') return { ok: false, bytes: '', reason: 'not_a_string' };
  const lines = streamText.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].endsWith('\r') ? lines[i].slice(0, -1) : lines[i];
    if (!line.trim().startsWith('{')) continue;
    let obj;
    try { obj = JSON.parse(line); } catch (_) { continue; }
    if (obj && typeof obj === 'object' && !Array.isArray(obj) && obj.type === 'result') {
      return { ok: true, bytes: line + '\n', reason: null };
    }
  }
  return { ok: false, bytes: '', reason: 'no_result_line' };
}

module.exports = { streamToEnvelope };
