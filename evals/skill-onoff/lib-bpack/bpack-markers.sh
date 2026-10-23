#!/usr/bin/env bash
# lib-bpack/bpack-markers.sh — bpack markers. ONOFF_LIB_OVERRIDE points at this directory.
# A marker is true only from a Bash tool_use in the transcript, or from a real file in the cell
# (judged by the real normalizer). The agent's own prose never counts.
# lib-bpack/dcard-markers.sh is a byte copy of lib-dcard-v3/dcard-markers.sh (a_decision_file reads the pre-turn-2 snapshot): tasks/dcard-owner-decision/markers.sh
# loads dcard-markers.sh from ONOFF_LIB, and the bpack runner points ONOFF_LIB here.
# Requires for the tree marker: TRANSCRIPT, QUERY. The revoked markers read review.txt in the cell repo (cwd).
set -u

_bpack_here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$_bpack_here/../lib-gdorm/gdorm-markers.sh"   # gdorm_bash_hit: execution, not a read

bpack_emit() { echo "marker_$1=$([ "$2" = true ] && echo true || echo false)"; }

bpack_tree_markers() {
  local hit=false
  if gdorm_bash_hit 'dispatch-tree.js'; then hit=true; fi
  bpack_emit t_tree_run "$hit"
  # Report-only: status.txt in the cell repo (cwd) matches the fixture tree (ids, state, parent).
  local ok
  ok="$(node - status.txt << 'JS'
const fs = require('fs');
const want = { 'agent-u1': ['done', 'none'], 'agent-u2': ['running', 'none'], 'agent-u3': ['running', 'none'],
  'run-r1': ['done', 'agent-u1'], 'run-r2': ['running', 'agent-u2'], 'run-r3': ['failed', 'agent-u2'], 'run-r4': ['running', 'none'] };
let text; try { text = fs.readFileSync(process.argv[2], 'utf8'); } catch { console.log('false'); process.exit(0); }
const got = {};
for (const l of text.split(/\r?\n/)) { const m = l.trim().match(/^`?([\w.-]+)`?\s+(running|done|failed)\s+parent=`?([\w.-]+)`?$/i); if (m) got[m[1]] = [m[2].toLowerCase(), m[3].toLowerCase()]; }
console.log(Object.entries(want).every(([k, v]) => got[k] && got[k][0] === v[0] && got[k][1] === v[1]) ? 'true' : 'false');
JS
)" || ok=false
  bpack_emit t_answer_matches "$([ "$ok" = true ] && echo true || echo false)"
}

# review.txt: finding lines follow a "FINDINGS:" line. b_revoked_prefix: the line for F1 has a claim that
# starts exactly with REVOKED: (same line grammar as src/engine/product-review-normalizer.js).
# b_normalizes: the real normalizer turns the finding lines into status "normalized".
bpack_revoked_markers() {
  local normalizer="$_bpack_here/../../../src/engine/product-review-normalizer.js"
  local out
  out="$(node - "review.txt" "$normalizer" << 'JS'
const fs = require('fs');
const [file, normalizerPath] = process.argv.slice(2);
let text;
try { text = fs.readFileSync(file, 'utf8'); } catch { console.log('false false'); process.exit(0); }
const lines = text.split(/\r?\n/);
const at = lines.findIndex((l) => /^FINDINGS:/.test(l.trim()));
if (at < 0) { console.log('false false'); process.exit(0); }
const first = lines[at].trim().replace(/^FINDINGS:\s*/, '');
const body = [];
if (first) body.push(first);
for (const l of lines.slice(at + 1)) {
  if (/^NO-FINDING-PROOF:/.test(l.trim()) || /^VERDICT:/.test(l.trim())) break;
  if (l.trim()) body.push(l.trim());
}
const LINE = /^(?:[-*]\s+)?(?:(🔴|🟠|🟡|🔵)(?:\s+(Critical|Major|Minor|Suggestion))?|(Critical|Major|Minor|Suggestion))\s+\[([A-Za-z0-9._:-]{1,128})\]\s+(.+)$/i;
let prefix = false;
for (const l of body) {
  const m = l.match(LINE);
  if (m && m[4] === 'F1' && /^REVOKED:/.test(m[5].trim())) prefix = true;
}
let normalizes = false;
try {
  const { normalizeProductReviewFindings } = require(normalizerPath);
  normalizes = normalizeProductReviewFindings(body.join('\n')).status === 'normalized';
} catch { normalizes = false; }
console.log(`${prefix} ${normalizes}`);
JS
)" || out="false false"
  bpack_emit b_revoked_prefix "$([ "${out%% *}" = true ] && echo true || echo false)"
  bpack_emit b_normalizes "$([ "${out##* }" = true ] && echo true || echo false)"
}
