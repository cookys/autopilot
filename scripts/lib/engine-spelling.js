'use strict';
// BL-0157 / BL-0187: the Kimi Code seat has been recorded under two spellings -- scorecard rows use
// `kimi-code-k3`, strike rows `kimi-code/k3`. The equivalence is the `kimi-code` provider prefix
// followed by `/` or `-`; nothing else is aliased (`kimi-codex-k3`, `kimi-code/k3-256k` stay
// distinct). Normalise on READ/COMPARE only: recorded rows and seat_hash inputs are never
// rewritten, because seat_hash is part of each row's identity.

const KIMI_CODE_ENGINE_RE = /^kimi-code[/-](.+)$/u;

// Every spelling equivalent to `engine` (the engine itself when it has no alias).
function engineSpellings(engine) {
  const m = typeof engine === 'string' ? KIMI_CODE_ENGINE_RE.exec(engine) : null;
  return m ? [`kimi-code/${m[1]}`, `kimi-code-${m[1]}`] : [engine];
}

function sameEngine(a, b) {
  return a === b || engineSpellings(a).includes(b);
}

// One stable spelling per equivalence class, for grouping / dedupe keys only.
function canonicalEngine(engine) {
  return engineSpellings(engine)[0];
}

module.exports = { engineSpellings, sameEngine, canonicalEngine };
