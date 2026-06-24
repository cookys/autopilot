#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

try {
  const hookDir = path.join(__dirname, '..', 'hooks');
  const hooksJson = path.join(hookDir, 'hooks.json');
  const backup = path.join(hookDir, 'hooks.json.capture-backup');

  const cmd = process.argv[2] || 'status';

  if (cmd === 'enable') {
    if (fs.existsSync(backup)) {
      console.error(`ERROR: capture mode already enabled (${backup} exists).`);
      console.error("  Run 'disable' first, or delete the backup manually.");
      process.exit(1);
    }
    if (!fs.existsSync(hooksJson)) {
      console.error(`ERROR: hooks.json not found at ${hooksJson}`);
      process.exit(1);
    }
    fs.copyFileSync(hooksJson, backup);
    
    const content = fs.readFileSync(backup, 'utf8');
    const data = JSON.parse(content);
    
    if (data.hooks) {
      if (Array.isArray(data.hooks.PreToolUse)) {
        data.hooks.PreToolUse = data.hooks.PreToolUse.map(hook => {
          if (hook.matcher === 'Bash') {
            if (!hook.hooks) hook.hooks = [];
            hook.hooks.push({
              type: 'command',
              command: 'node ${CLAUDE_PLUGIN_ROOT}/hooks/capture-payload.js pre-bash'
            });
          } else if (hook.matcher === 'Read') {
            if (!hook.hooks) hook.hooks = [];
            hook.hooks.push({
              type: 'command',
              command: 'node ${CLAUDE_PLUGIN_ROOT}/hooks/capture-payload.js pre-read'
            });
          }
          return hook;
        });
      }
      
      if (Array.isArray(data.hooks.PostToolUse)) {
        data.hooks.PostToolUse = data.hooks.PostToolUse.map(hook => {
          if (hook.matcher === 'Bash') {
            if (!hook.hooks) hook.hooks = [];
            hook.hooks.push({
              type: 'command',
              command: 'node ${CLAUDE_PLUGIN_ROOT}/hooks/capture-payload.js post-bash'
            });
          } else if (hook.matcher === '.*') {
            if (!hook.hooks) hook.hooks = [];
            hook.hooks.push({
              type: 'command',
              command: 'node ${CLAUDE_PLUGIN_ROOT}/hooks/capture-payload.js post-star'
            });
          }
          return hook;
        });
      }
    }
    
    fs.writeFileSync(hooksJson, JSON.stringify(data, null, 2) + '\n', 'utf8');
    console.log("ENABLED — hooks.json wired with capture-payload entries.");
    console.log("");
    console.log("Next: open a NEW terminal and run:");
    console.log("  AUTOPILOT_CAPTURE_PAYLOAD=1 claude");
    console.log("Then in fresh claude, run any tool. Captures land at:");
    console.log("  ~/.autopilot/payloads/<ts>-<pid>-<marker>.json");
    console.log("");
    console.log(`Done? Run: scripts/toggle-payload-capture.sh disable`);
  } else if (cmd === 'disable') {
    if (!fs.existsSync(backup)) {
      console.error(`ERROR: no backup found (${backup}) — nothing to restore.`);
      process.exit(1);
    }
    fs.renameSync(backup, hooksJson);
    console.log("DISABLED — hooks.json restored from backup.");
  } else if (cmd === 'status') {
    if (fs.existsSync(backup)) {
      console.log("Capture mode: ENABLED");
      console.log(`Backup at: ${backup}`);
      console.log("Payloads:  ~/.autopilot/payloads/");
      try {
        const payloadsDir = path.join(os.homedir(), '.autopilot', 'payloads');
        if (fs.existsSync(payloadsDir)) {
          const files = fs.readdirSync(payloadsDir);
          if (files.length > 0) {
            files.forEach(file => console.log(file));
          } else {
            console.log("  (no captures yet)");
          }
        } else {
          console.log("  (no captures yet)");
        }
      } catch (e) {
        console.log("  (no captures yet)");
      }
    } else {
      console.log("Capture mode: DISABLED");
    }
  } else {
    console.error(`Usage: $0 enable|disable|status`);
    process.exit(1);
  }
} catch (err) {
  console.warn(`[TogglePayloadCapture Warning] Unexpected error: ${err.message}`);
  process.exit(0);
}
