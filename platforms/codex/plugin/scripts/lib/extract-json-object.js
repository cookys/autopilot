'use strict';

// extract-json-object — transport-layer JSON recovery shared by the
// qualification provider adapter and the engine-qualify host paths (review
// 2026-08-18 MUST-FIX: the host must apply the SAME static extraction rule
// the provider transport uses, or a competent local-panel answer followed by
// prose grades malformed).

// Transport-layer repair only: models at temperature 0 reproducibly drop a
// closing brace in the nested finding structure. Balancing brackets recovers
// content the model already produced; it never invents content.
function repairBrackets(candidate) {
  const stack = [];
  const out = [];
  let inString = false;
  let escaped = false;
  let inserted = 0;
  for (const ch of candidate) {
    if (inString) {
      out.push(ch);
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out.push(ch); continue; }
    if (ch === '{' || ch === '[') { stack.push(ch); out.push(ch); continue; }
    if (ch === '}' || ch === ']') {
      const wanted = ch === '}' ? '{' : '[';
      // A closer that does not match the innermost opener means an opener's own
      // closer was omitted — synthesize the missing closer(s) first.
      while (stack.length > 0 && stack[stack.length - 1] !== wanted) {
        out.push(stack.pop() === '{' ? '}' : ']');
        inserted += 1;
      }
      if (stack.length === 0) return null;
      stack.pop();
      out.push(ch);
      continue;
    }
    out.push(ch);
  }
  while (stack.length > 0) {
    out.push(stack.pop() === '{' ? '}' : ']');
    inserted += 1;
  }
  if (inserted === 0 || inserted > 8) return null;
  return out.join('');
}

function extractJsonObject(text) {
  const trimmed = String(text)
    .replace(/^\s*```(?:json)?\s*/u, '')
    .replace(/\s*```\s*$/u, '')
    .trim();
  const start = trimmed.indexOf('{');
  if (start === -1) return null;
  const body = trimmed.slice(start);
  for (const candidate of [trimmed, body, repairBrackets(body)]) {
    if (!candidate) continue;
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // try the next recovery form
    }
  }
  for (let end = body.length; end > 0; end -= 1) {
    if (body[end - 1] !== '}') continue;
    const candidate = body.slice(0, end);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // keep scanning shorter suffixes
    }
  }
  return null;
}

module.exports = { extractJsonObject, repairBrackets };
