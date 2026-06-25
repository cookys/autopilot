#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

try {
  const stateDir = process.env.AUTOPILOT_STATE_DIR || path.join(os.homedir(), '.autopilot', 'state');
  
  // Helper to run command and get trimmed output, or empty string on error
  function getCommandOutput(cmd) {
    try {
      return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
    } catch (e) {
      return '';
    }
  }

  let repoTop = getCommandOutput('git rev-parse --show-toplevel');
  let repoKey = 'norepo';
  if (repoTop) {
    repoKey = repoTop.replace(/\//g, '_').replace(/^_/, '');
  }

  let branchName = getCommandOutput('git branch --show-current');
  let branchKey = branchName ? branchName.replace(/\//g, '_') : 'no-branch';

  const stateFile = path.join(stateDir, `risk-${repoKey}-${branchKey}.json`);

  function initState() {
    fs.mkdirSync(stateDir, { recursive: true });
    const initial = { risk: 0, fixes: 0, reverted: 0, events: [] };
    fs.writeFileSync(stateFile, JSON.stringify(initial, null, 2) + '\n', 'utf8');
  }

  if (!fs.existsSync(stateFile)) {
    initState();
  }

  function mutateState(event, delta) {
    let d;
    try {
      d = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    } catch (e) {
      d = { risk: 0, fixes: 0, reverted: 0, events: [] };
    }
    
    d.risk = (d.risk || 0) + delta;
    d.fixes = (d.fixes || 0) + 1;
    if (event === 'reverted') {
      d.reverted = (d.reverted || 0) + 1;
    }
    
    if (!Array.isArray(d.events)) {
      d.events = [];
    }
    
    const now = new Date().toISOString();
    d.events.push({
      event: event,
      delta: delta,
      ts: now
    });
    
    fs.writeFileSync(stateFile, JSON.stringify(d, null, 2) + '\n', 'utf8');
  }

  function readRisk() {
    try {
      const d = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      return typeof d.risk === 'number' ? d.risk : 0;
    } catch (e) {
      return 0;
    }
  }

  const cmd = process.argv[2] || 'status';

  if (cmd === 'status') {
    if (fs.existsSync(stateFile)) {
      console.log(fs.readFileSync(stateFile, 'utf8').trim());
    } else {
      console.log('{"risk":0,"fixes":0,"reverted":0,"events":[]}');
    }
  } else if (cmd === 'reset') {
    initState();
    console.log(`reset: ${stateFile}`);
  } else if (cmd === 'increment') {
    let event = '';
    for (let i = 3; i < process.argv.length; i++) {
      if (process.argv[i] === '--event') {
        event = process.argv[i + 1] || '';
        break;
      }
    }
    if (!event) {
      console.error('missing --event');
      process.exit(2);
    }
    let delta = 0;
    switch (event) {
      case 'reverted':
        delta = 15;
        break;
      case 'multi-file':
        delta = 5;
        break;
      case 'late-fix':
        delta = 1;
        break;
      case 'unrelated-files':
        delta = 20;
        break;
      case 'fix':
        delta = 0;
        break;
      default:
        console.error(`unknown event: ${event} (known: reverted|multi-file|late-fix|unrelated-files|fix)`);
        process.exit(2);
    }
    mutateState(event, delta);
    console.log(fs.readFileSync(stateFile, 'utf8').trim());
  } else if (cmd === 'threshold-hit') {
    const risk = readRisk();
    console.log(`risk=${risk} threshold=20`);
    if (risk > 20) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } else if (cmd === 'path') {
    console.log(stateFile);
  } else {
    console.error(`usage: risk-counter.js {status|reset|increment --event <kind>|threshold-hit|path}`);
    process.exit(2);
  }
} catch (err) {
  console.warn(`[RiskCounter Warning] Unexpected error: ${err.message}`);
  process.exit(0);
}
