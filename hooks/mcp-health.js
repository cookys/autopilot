#!/usr/bin/env node
/**
 * mcp-health — PreToolUse/mcp__* + PostToolUseFailure/mcp__* [OPT-IN]
 * Health tracking for MCP servers with exponential backoff.
 * Mode: 'pre' (check health) or 'failure' (mark unhealthy).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const CACHE_FILE = path.join(os.homedir(), '.claude', 'mcp-health-cache.json');
const BASE_BACKOFF_MS = 30000; // 30 seconds
const MAX_BACKOFF_MS = 600000; // 10 minutes

const INFRA_ERRORS = /ECONNREFUSED|ENOTFOUND|timed?\s*out|socket hang up|connection (?:failed|lost|reset|closed)/i;
const HTTP_ERRORS = /\b(401|403|429|503)\b/;
const DISCONNECT = /disconnected|unavailable/i;

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeCache(cache) {
  try {
    const dir = path.dirname(CACHE_FILE);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch {
    // Best effort
  }
}

function extractServer(toolName) {
  // mcp__servername__method → servername
  const parts = String(toolName || '').split('__');
  return parts.length >= 2 ? parts[1] : 'unknown';
}

try {
  const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
  const mode = process.argv[2] || 'pre';
  const server = extractServer(input.tool_name);

  const cache = readCache();
  const entry = cache[server] || { healthy: true, failures: 0, nextRetry: 0 };

  if (mode === 'pre') {
    if (!entry.healthy && Date.now() < entry.nextRetry) {
      const waitSec = Math.ceil((entry.nextRetry - Date.now()) / 1000);
      process.stderr.write(
        `MCP server '${server}' is unhealthy (${entry.failures} failures). ` +
        `Retry in ${waitSec}s. Last error: ${entry.lastError || 'unknown'}\n`
      );
      process.exit(2);
    }
    // Past retry window or healthy — clear and allow
    if (!entry.healthy && Date.now() >= entry.nextRetry) {
      entry.healthy = true;
      cache[server] = entry;
      writeCache(cache);
    }
  } else if (mode === 'failure') {
    const output = String(input.tool_output || '');
    if (INFRA_ERRORS.test(output) || HTTP_ERRORS.test(output) || DISCONNECT.test(output)) {
      entry.healthy = false;
      entry.failures = (entry.failures || 0) + 1;
      const backoff = Math.min(BASE_BACKOFF_MS * Math.pow(2, entry.failures - 1), MAX_BACKOFF_MS);
      entry.nextRetry = Date.now() + backoff;
      entry.lastError = output.slice(0, 200);
      cache[server] = entry;
      writeCache(cache);
      process.stderr.write(
        `MCP server '${server}' marked unhealthy (failure #${entry.failures}). ` +
        `Backoff: ${Math.round(backoff / 1000)}s.\n`
      );
    }
  }

  process.exit(0);
} catch (e) {
  process.stderr.write(`mcp-health error: ${e.message}\n`);
  process.exit(0);
}
