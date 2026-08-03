#!/usr/bin/env node
'use strict';

// Deterministic Mission Convergence checker CLI (plan P2 surface). Thin
// executable wrapper over src/mission/cli.js so the documented
// `init|grant|consume|control|check|receipt` operations and the
// `node bin/autopilot.js mission ...` route share one canonical implementation
// built on the pure Mission reducer. No operation bypasses canonical
// state/grant/control validation.

const { runMissionCli } = require('../src/mission/cli');

process.exit(runMissionCli(process.argv.slice(2), { cwd: process.cwd() }));
