'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tempEnv } = require('./helpers');
const { setupClaude } = require('../src/setup');

test('setup claude merges an MCP entry and preserves unrelated config', (t) => {
  const fixture = tempEnv();
  t.after(fixture.cleanup);
  const config = path.join(fixture.base, '.mcp.json');
  fs.writeFileSync(config, JSON.stringify({ mcpServers: { existing: { command: 'x' } }, other: true }));
  const result = setupClaude({
    name: 'rw3d-claude',
    configPath: config,
    cwd: fixture.base,
    binPath: '/opt/agent-call/bin/agent-call.js',
  });
  const value = JSON.parse(fs.readFileSync(config, 'utf8'));
  assert.equal(value.other, true);
  assert.equal(value.mcpServers.existing.command, 'x');
  assert.equal(value.mcpServers['agent-call-local'].args[0], '/opt/agent-call/bin/agent-call.js');
  assert.deepEqual(value.mcpServers['agent-call-local'].args.slice(1), ['channel', '--name-env', 'AGENT_CALL_NAME']);
  assert.match(result.launch, /AGENT_CALL_PERSISTENT=1 AGENT_CALL_NAME=rw3d-claude/);
  assert.match(result.launch, /server:agent-call-local/);
});

test('setup claude fails closed on a conflicting entry unless forced', (t) => {
  const fixture = tempEnv();
  t.after(fixture.cleanup);
  const config = path.join(fixture.base, '.mcp.json');
  fs.writeFileSync(config, JSON.stringify({ mcpServers: { 'agent-call-local': { command: 'other' } } }));
  const args = { name: 'rw3d-claude', configPath: config, cwd: fixture.base, binPath: '/bin/agent-call' };
  assert.throws(() => setupClaude(args), /--force/);
  assert.equal(setupClaude({ ...args, force: true }).status, 'updated');
});


test('setup claude reuses one name-neutral MCP entry for multiple persistent sessions', (t) => {
  const fixture = tempEnv();
  t.after(fixture.cleanup);
  const config = path.join(fixture.base, '.mcp.json');
  const common = { configPath: config, binPath: '/opt/agent-call/bin/agent-call.js' };
  setupClaude({ ...common, name: 'rw3d-claude-a' });
  const second = setupClaude({ ...common, name: 'rw3d-claude-b' });
  const value = JSON.parse(fs.readFileSync(config, 'utf8'));
  assert.deepEqual(Object.keys(value.mcpServers), ['agent-call-local']);
  assert.match(second.launch, /AGENT_CALL_NAME=rw3d-claude-b/);
});

test('setup claude refuses to follow a symlinked MCP config', (t) => {
  const fixture = tempEnv();
  t.after(fixture.cleanup);
  const victim = path.join(fixture.base, 'victim.json');
  const config = path.join(fixture.base, '.mcp.json');
  fs.writeFileSync(victim, '{}');
  fs.symlinkSync(victim, config);
  assert.throws(() => setupClaude({
    name: 'rw3d-claude', configPath: config, cwd: fixture.base, binPath: '/bin/agent-call',
  }), /not a symlink/);
  assert.equal(fs.readFileSync(victim, 'utf8'), '{}');
});
