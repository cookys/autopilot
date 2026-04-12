#!/usr/bin/env node
/**
 * design-quality — PostToolUse/Write|Edit [OPT-IN, timeout: 10s]
 * Warns when frontend edits show signs of generic template UI.
 * Non-blocking — encourages intentional design.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const FRONTEND_EXTS = /\.(tsx|jsx|vue|css|scss|html|svelte|astro)$/;

const SIGNALS = [
  { pattern: /["']Get Started["']/i, label: '"Get Started" CTA (generic)' },
  { pattern: /["']Learn More["']/i, label: '"Learn More" CTA (generic)' },
  { pattern: /grid-cols-[34]\b/, label: 'Uniform 3/4-column grid (stock layout)' },
  { pattern: /bg-gradient-to-[trbl]\b/, label: 'Stock Tailwind gradient' },
  { pattern: /font-family:.*\bInter\b/i, label: 'Inter font (overused default)' },
  { pattern: /font-family:.*\bRoboto\b/i, label: 'Roboto font (overused default)' },
];

try {
  const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
  const toolInput = input.tool_input || {};
  const filePath = toolInput.file_path;

  if (!filePath || !FRONTEND_EXTS.test(filePath)) process.exit(0);
  if (!fs.existsSync(filePath)) process.exit(0);

  const content = fs.readFileSync(filePath, 'utf8');
  const found = [];

  for (const { pattern, label } of SIGNALS) {
    if (pattern.test(content) && !found.includes(label)) {
      found.push(label);
    }
  }

  if (found.length > 0) {
    process.stderr.write(
      `Design quality check for ${path.basename(filePath)}:\n` +
      found.map(s => `  - ${s}`).join('\n') + '\n' +
      `Consider more intentional, distinctive design choices.\n`
    );
  }

  process.exit(0);
} catch (e) {
  process.stderr.write(`design-quality error: ${e.message}\n`);
  process.exit(0);
}
