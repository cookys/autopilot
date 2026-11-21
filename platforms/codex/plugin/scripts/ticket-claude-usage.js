#!/usr/bin/env node
'use strict';

/**
 * ticket-claude-usage — report Claude subagent spend for a given Fleet-Task ULID
 * from the session's subagent transcripts.
 *
 * Usage:
 *   node scripts/ticket-claude-usage.js --fleet-task <26-char ULID> [--session <id>] [--transcript <path>]
 *
 * Prints JSON: { fleet_task, usd, tokens, dispatches }
 */

const fs = require('fs');
const path = require('path');
const { resolveDir, firstUserMessage } = require('../hooks/subagent-budget.js');
const { parseAssistantTurns, costOf } = require('../hooks/cost-tracker-lib.js');
const { findTaskId, isValidTaskId } = require('./lib/fleet-task-ref.js');

function parseArgs(argv) {
  const out = { fleetTask: '', sessionId: process.env.CLAUDE_SESSION_ID || '', transcriptPath: process.env.CLAUDE_TRANSCRIPT_PATH || '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fleet-task' && i + 1 < argv.length) out.fleetTask = argv[++i];
    else if (a === '--session' && i + 1 < argv.length) out.sessionId = argv[++i];
    else if (a === '--transcript' && i + 1 < argv.length) out.transcriptPath = argv[++i];
  }
  return out;
}

function measureTicketUsage(fleetTask, opts = {}) {
  const result = { fleet_task: fleetTask, usd: 0, tokens: 0, dispatches: 0 };
  if (!isValidTaskId(fleetTask)) return result;
  const sessionId = opts.sessionId || '';
  const transcriptPath = opts.transcriptPath || '';
  if (!sessionId || !transcriptPath) return result;
  const dir = resolveDir({ session_id: sessionId, transcript_path: transcriptPath });
  if (!dir) return result;
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return result;
  }
  for (const name of names) {
    if (!/^agent-.+\.jsonl$/.test(name)) continue;
    const file = path.join(dir, name);
    try {
      const head = firstUserMessage(file);
      if (findTaskId(head) !== fleetTask) continue;
      result.dispatches += 1;
      const raw = fs.readFileSync(file, 'utf8');
      const turns = parseAssistantTurns(raw);
      for (const turn of turns) {
        result.usd += costOf(turn);
        result.tokens += Number(turn.input_tokens || turn.input || 0)
          + Number(turn.output_tokens || turn.output || 0)
          + Number(turn.cache_creation_input_tokens || turn.cacheCreate || 0)
          + Number(turn.cache_read_input_tokens || turn.cacheRead || 0);
      }
    } catch { /* fail-soft per transcript */ }
  }
  result.usd = Math.round(result.usd * 1e6) / 1e6;
  return result;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (!isValidTaskId(args.fleetTask)) {
    process.stderr.write('usage: ticket-claude-usage.js --fleet-task <26-char ULID> [--session <id>] [--transcript <path>]\n');
    process.exit(2);
  }
  const usage = measureTicketUsage(args.fleetTask, { sessionId: args.sessionId, transcriptPath: args.transcriptPath });
  process.stdout.write(`${JSON.stringify(usage)}\n`);
}

module.exports = { measureTicketUsage };
