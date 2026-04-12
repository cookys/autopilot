#!/usr/bin/env node
/**
 * config-protection — PreToolUse/Write|Edit [OPT-IN]
 * Blocks modifications to linter/formatter config files.
 * Enforces fixing source code rather than weakening rules.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PROTECTED_BASENAMES = new Set([
  '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yaml', '.eslintrc.yml',
  'eslint.config.js', 'eslint.config.mjs', 'eslint.config.ts',
  '.prettierrc', '.prettierrc.js', '.prettierrc.json', '.prettierrc.yaml', '.prettierrc.yml',
  'prettier.config.js', 'prettier.config.mjs',
  'biome.json', 'biome.jsonc',
  '.ruff.toml', 'ruff.toml',
  '.stylelintrc', '.stylelintrc.json', '.stylelintrc.yaml',
]);

try {
  const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
  const toolInput = input.tool_input || {};
  const filePath = toolInput.file_path;

  if (!filePath) process.exit(0);

  const basename = path.basename(filePath);
  if (PROTECTED_BASENAMES.has(basename)) {
    process.stderr.write(
      `BLOCKED: '${basename}' is a protected config file. Fix the source code instead of weakening rules.\n`
    );
    process.exit(2);
  }

  process.exit(0);
} catch (e) {
  process.stderr.write(`config-protection error: ${e.message}\n`);
  process.exit(0);
}
