#!/usr/bin/env node
/**
 * large-file-warner — PreToolUse/Read
 * Warns at 500KB, hard blocks at 2MB. Bypasses if offset/limit specified.
 */

'use strict';

const fs = require('fs');

const WARN_BYTES = 500 * 1024;
const BLOCK_BYTES = 2 * 1024 * 1024;

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
  return (bytes / 1024).toFixed(0) + 'KB';
}

try {
  const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
  const toolInput = input.tool_input || {};
  const filePath = toolInput.file_path;

  if (!filePath) process.exit(0);

  // If offset/limit specified, caller knows what they're doing
  if (toolInput.offset != null || toolInput.limit != null) process.exit(0);

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    // File doesn't exist or inaccessible — let the tool handle it
    process.exit(0);
  }

  const size = stat.size;

  if (size >= BLOCK_BYTES) {
    process.stderr.write(
      `BLOCKED: ${filePath} is ${formatSize(size)} (limit: ${formatSize(BLOCK_BYTES)}). ` +
      `Use offset/limit to read specific sections.\n`
    );
    process.exit(2);
  }

  if (size >= WARN_BYTES) {
    process.stderr.write(
      `WARNING: ${filePath} is ${formatSize(size)}. Consider using offset/limit for large files.\n`
    );
    process.exit(0);
  }

  process.exit(0);
} catch (e) {
  // Safe passthrough — hook failure should never block the tool
  process.stderr.write(`large-file-warner error: ${e.message}\n`);
  process.exit(0);
}
