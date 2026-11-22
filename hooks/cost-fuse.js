#!/usr/bin/env node
/**
 * cost-fuse — retired in-session PreToolUse fuse.
 *
 * Replaced by scripts/brain-tier-report.js (measurement/report) and
 * hooks/dispatch-model-guard.js (worker-level sonnet default + Model-Reason gate).
 * Kept as a fail-open no-op stub for any external caller; unregistered from hooks/hooks.json.
 * Its old AUTOPILOT_COST_FUSE_DIR seam is retired with it (see scripts/lib/config-keys.json ignore.env).
 */

'use strict';

process.exit(0);
