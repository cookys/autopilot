#!/usr/bin/env node
/**
 * pm-intake-a — UserPromptSubmit, PM seat only (default-on).
 *
 * Runs `$PM_INTAKE_BIN --query -` with the operator prompt on stdin. The stub
 * contract is markdown on stdout. That markdown is injected as additionalContext.
 * A `## constraints` section is kept in full. Lines under a `## hits` heading are
 * capped at 10 (blank lines do not count). The next `##` heading ends the cap.
 *
 * Silent exit 0 when the seat is not `pm` (`resolveFleetSeat`), when the prompt
 * is empty, or when it starts with `<channel` or `[SYSTEM NOTIFICATION`.
 * Child timeout 4s. Fail-open: one stderr audit line, exit 0.
 */
'use strict';

const { spawnSync } = require('child_process');
const { resolveFleetSeat } = require('./_shared/fleet-seat.js');

const CHILD_MS = 4000;
const HITS_CAP = 10;

function capHits(markdown) {
  const lines = String(markdown).split('\n');
  const out = [];
  let inHits = false;
  let kept = 0;
  for (const line of lines) {
    if (/^##\s+hits\s*$/i.test(line)) {
      inHits = true;
      kept = 0;
      out.push(line);
      continue;
    }
    if (inHits && /^##\s+/.test(line)) {
      inHits = false;
      out.push(line);
      continue;
    }
    if (inHits) {
      if (line.trim() === '') {
        out.push(line);
        continue;
      }
      kept += 1;
      if (kept <= HITS_CAP) out.push(line);
      continue;
    }
    out.push(line);
  }
  return out.join('\n').replace(/\n+$/, '');
}

function skipPrompt(prompt) {
  if (typeof prompt !== 'string' || !prompt.trim()) return true;
  return prompt.startsWith('<channel') || prompt.startsWith('[SYSTEM NOTIFICATION');
}

function main() {
  let input = {};
  try {
    input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    if (resolveFleetSeat(input) !== 'pm') return;
    const prompt = input && input.prompt;
    if (skipPrompt(prompt)) return;
    const bin = process.env.PM_INTAKE_BIN;
    if (!bin) throw new Error('PM_INTAKE_BIN unset');
    const child = spawnSync(bin, ['--query', '-'], {
      input: prompt,
      encoding: 'utf8',
      timeout: CHILD_MS,
      maxBuffer: 1024 * 1024,
    });
    if (child.error) throw child.error;
    if (child.status !== 0) throw new Error(`pm-intake exit ${child.status}: ${(child.stderr || '').slice(0, 200)}`);
    const text = capHits(child.stdout || '');
    if (!text.trim()) return;
    process.stdout.write(`${JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text },
    })}\n`);
  } catch (err) {
    process.stderr.write(`pm-intake-a: fail-open: ${err && err.message}\n`);
  }
}

if (require.main === module) main();

module.exports = { capHits, skipPrompt };
