#!/usr/bin/env node
/**
 * check-seat-rules.js — Verify seat rules registry against repo sources, hooks, and snapshots.
 *
 * Usage:
 *   node scripts/check-seat-rules.js [--registry <path>] [--root <dir>] [--config <snapshot>] [--strict] [--json]
 *
 * Exit codes:
 *   0 = all checks passed
 *   1 = one or more rule checks failed (or guarantee broken)
 *   2 = usage / parse error
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RULE_LINE_RE = /\b(Never|must)\b|禁止|一律/;

function parseArgs(argv) {
  const opts = {
    registry: null,
    root: process.cwd(),
    config: null,
    strict: false,
    json: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--registry' && argv[i + 1]) {
      opts.registry = argv[++i];
    } else if (a === '--root' && argv[i + 1]) {
      opts.root = argv[++i];
    } else if (a === '--config' && argv[i + 1]) {
      opts.config = argv[++i];
    } else if (a === '--strict') {
      opts.strict = true;
    } else if (a === '--json') {
      opts.json = true;
    } else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/check-seat-rules.js [--registry <path>] [--root <dir>] [--config <snapshot>] [--strict] [--json]');
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

function loadHooksJson(root) {
  const p = path.join(root, 'hooks', 'hooks.json');
  if (!fs.existsSync(p)) return {};
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  return data.hooks || {};
}

function isHookWired(hooksMap, hookRelPath, event) {
  const entries = hooksMap[event];
  if (!Array.isArray(entries)) return false;
  const base = path.basename(hookRelPath);
  for (const entry of entries) {
    const list = entry.hooks || [];
    for (const h of list) {
      if (typeof h.command === 'string' && h.command.includes(base)) {
        return true;
      }
    }
  }
  return false;
}

function parseConfigSnapshot(configPath) {
  const raw = fs.readFileSync(configPath, 'utf8');
  if (configPath.endsWith('.json') || raw.trimStart().startsWith('{')) {
    return { type: 'json', data: JSON.parse(raw) };
  }
  // TSV format: event\thook\tkind\tcount
  const events = new Set();
  const hooks = new Set();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('event\t')) continue;
    const cols = trimmed.split('\t');
    if (cols.length >= 2) {
      events.add(cols[0]);
      hooks.add(cols[1]);
    }
  }
  return { type: 'tsv', events, hooks };
}

function isHookEnabledInSnapshot(snapshot, rule) {
  if (snapshot.type === 'json') {
    const data = snapshot.data;
    if (data.disabledHooks && Array.isArray(data.disabledHooks)) {
      const base = path.basename(rule.hook);
      if (data.disabledHooks.includes(rule.hook) || data.disabledHooks.includes(base)) {
        return false;
      }
    }
    if (data.hooks && typeof data.hooks === 'object') {
      const ev = data.hooks[rule.event];
      if (!ev || (Array.isArray(ev) && ev.length === 0)) return false;
      if (Array.isArray(ev)) {
        const base = path.basename(rule.hook);
        return ev.some((e) => (e.hooks || []).some((h) => typeof h.command === 'string' && h.command.includes(base)));
      }
    }
    return true;
  }
  // TSV snapshot: check event:matcher or event presence
  if (rule.matcher) {
    for (const m of rule.matcher.split('|')) {
      if (snapshot.hooks.has(`${rule.event}:${m}`)) return true;
    }
  }
  return snapshot.hooks.has(rule.event);
}

function runHookDenyFixture(root, rule) {
  const hookAbs = path.resolve(root, rule.hook);
  if (!fs.existsSync(hookAbs)) {
    return { ok: false, reason: `hook file not found: ${rule.hook}` };
  }
  const payload = JSON.stringify(rule.deny_fixture || {});
  const res = spawnSync(process.execPath, [hookAbs], {
    input: payload,
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: root },
  });
  if (res.error) {
    return { ok: false, reason: `hook execution error: ${res.error.message}` };
  }
  const stdout = (res.stdout || '').trim();
  const isDeny =
    res.status !== 0 ||
    /"permissionDecision"\s*:\s*"deny"/.test(stdout) ||
    /"decision"\s*:\s*"block"/.test(stdout);
  if (!isDeny) {
    return { ok: false, reason: `hook did not deny/block (rc=${res.status}, stdout=${stdout.slice(0, 120)})` };
  }
  return { ok: true };
}

function main() {
  const opts = parseArgs(process.argv);
  const registryPath = opts.registry || path.join(opts.root, 'project', 'registry', 'seat-rules.json');
  if (!fs.existsSync(registryPath)) {
    console.error(`Registry not found: ${registryPath}`);
    process.exit(2);
  }
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const rules = Array.isArray(registry.rules) ? registry.rules : [];
  const hooksMap = loadHooksJson(opts.root);
  const snapshot = opts.config ? parseConfigSnapshot(opts.config) : null;

  const failures = [];
  const warnings = [];
  const unchecked = [];
  let passed = 0;

  // Warn on skills missing Not for (non-blocking)
  const missingNotFor = (registry.warnings && registry.warnings.skills_missing_not_for) || [];
  for (const sk of missingNotFor) {
    warnings.push(`skill missing "Not for" boundary: ${sk}`);
  }

  for (const rule of rules) {
    if (rule.guarantee === 'external') {
      const extPath = rule.source.startsWith('~/')
        ? null // Do not read real HOME in v1 unless explicitly resolved
        : path.resolve(opts.root, rule.source);
      if (!extPath || !fs.existsSync(extPath)) {
        unchecked.push(`未檢查: ${rule.id} (${rule.source})`);
        continue;
      }
      const content = fs.readFileSync(extPath, 'utf8');
      if (!content.includes(rule.anchor)) {
        failures.push(`external rule anchor missing: ${rule.id}`);
      } else {
        passed++;
      }
      continue;
    }

    if (rule.guarantee === 'text') {
      const srcPath = path.resolve(opts.root, rule.source);
      if (!fs.existsSync(srcPath)) {
        failures.push(`source file missing for ${rule.id}: ${rule.source}`);
        continue;
      }
      const content = fs.readFileSync(srcPath, 'utf8');
      if (!content.includes(rule.anchor)) {
        failures.push(`text anchor missing for ${rule.id} in ${rule.source}: "${rule.anchor}"`);
      } else {
        passed++;
      }
      continue;
    }

    if (rule.guarantee === 'tool') {
      passed++;
      continue;
    }

    if (rule.guarantee === 'hook') {
      if (snapshot) {
        if (!isHookEnabledInSnapshot(snapshot, rule)) {
          failures.push(`保證失效：${rule.id}`);
          continue;
        }
      } else {
        if (!isHookWired(hooksMap, rule.hook, rule.event)) {
          failures.push(`hook not wired in hooks/hooks.json: ${rule.id} (${rule.hook} on ${rule.event})`);
          continue;
        }
      }
      const denyRes = runHookDenyFixture(opts.root, rule);
      if (!denyRes.ok) {
        failures.push(`hook deny fixture failed for ${rule.id}: ${denyRes.reason}`);
      } else {
        passed++;
      }
      continue;
    }

    failures.push(`unknown guarantee type "${rule.guarantee}" for ${rule.id}`);
  }

  if (opts.strict) {
    const anchors = rules.map((r) => r.anchor).filter(Boolean);
    for (const rel of ['CLAUDE.md', 'AGENTS.md']) {
      const p = path.join(opts.root, rel);
      if (!fs.existsSync(p)) continue;
      const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
      for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx];
        if (RULE_LINE_RE.test(line)) {
          const covered = anchors.some((a) => line.includes(a));
          if (!covered) {
            failures.push(`unregistered rule-style line (--strict) in ${rel}:${idx + 1}: ${line.trim().slice(0, 80)}`);
          }
        }
      }
    }
  }

  if (opts.json) {
    console.log(JSON.stringify({ passed, warnings, unchecked, failures }, null, 2));
  } else {
    for (const w of warnings) console.warn(`WARN: ${w}`);
    for (const u of unchecked) console.log(u);
    for (const f of failures) console.error(`FAIL: ${f}`);
    console.log(`seat-rules: ${passed} passed, ${unchecked.length} unchecked, ${warnings.length} warnings, ${failures.length} failed`);
  }

  process.exit(failures.length > 0 ? 1 : 0);
}

main();
