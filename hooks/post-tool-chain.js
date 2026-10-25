#!/usr/bin/env node
/**
 * post-tool-chain — PostToolUse (UNREGISTERED; guard-port Phase 1, BL-0241)
 *
 * One process for the five `.*` PostToolUse observers that precede opt-in-multiplexer.js. Forwards each
 * observer's bytes in order and never merges them; see hooks/post-tool-chain-lib.js for the contract.
 * Optional argv: observer stems to run instead of the default five (a plan fallback keeps stdout-writing
 * observers as separate registrations), validated against the default list.
 */
'use strict';

const { MEMBERS, runChain, readStdin } = require('./post-tool-chain-lib.js');

const argv = process.argv.slice(2);
const bad = argv.filter((s) => !MEMBERS.includes(s));
if (bad.length > 0) {
  process.stderr.write(`post-tool-chain: unknown member(s): ${bad.join(', ')}\n`);
  process.exit(0); // fail-open: a mis-wired registration must not block the tool call
}

process.exit(runChain({ stdin: readStdin(), members: argv.length ? argv : MEMBERS }));
