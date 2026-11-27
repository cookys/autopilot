'use strict';
// Plan AG: four read-only role agents (probe, hands, test-runner, transcript-digest).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const NAMES = ['probe', 'hands', 'test-runner', 'transcript-digest'];
const FORBIDDEN = /^(write|edit|notebookedit|multiedit|send|fleet\b.*|mcp__fleet__.*)$/i;
const RESOLVER = fs.readFileSync(path.join(ROOT, 'scripts', 'resolve-dispatch.sh'), 'utf8');

function parse(name) {
  const file = path.join(ROOT, 'agents', `${name}.md`);
  assert.ok(fs.existsSync(file), `agents/${name}.md must exist`);
  const text = fs.readFileSync(file, 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, `agents/${name}.md must start with frontmatter`);
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-z_-]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2];
  }
  return { fm, body: text.slice(m[0].length), text };
}

for (const name of NAMES) {
  test(`${name}: frontmatter and read-only tool list`, () => {
    const { fm } = parse(name);
    assert.equal(fm.name, name);
    assert.ok(fm.description && fm.description.length > 20, 'description');
    assert.ok(fm.model, 'model');
    const tools = (fm.tools || '').split(',').map((s) => s.trim()).filter(Boolean);
    assert.ok(tools.length > 0, 'explicit tools list required');
    for (const t of tools) assert.ok(!FORBIDDEN.test(t), `${name} must not have tool ${t}`);
    assert.ok(!tools.includes('Agent'), 'no sub-dispatch');
  });
}

test('hands and test-runner role names exist in resolve-dispatch.sh', () => {
  for (const role of ['hands', 'test-runner']) {
    assert.match(RESOLVER, new RegExp(`DEFAULTS\\[${role}\\]=`), `${role} role in resolver`);
  }
});

test('transcript-digest maps to resolver role ar-analyst and refuses non-Claude chairs', () => {
  assert.match(RESOLVER, /DEFAULTS\[ar-analyst\]=/);
  const { body } = parse('transcript-digest');
  assert.match(body, /ar-analyst/);
  assert.match(body, /non-Claude/i);
  assert.match(body, /refuse/i);
  assert.match(body, /REFUSED/);
});

test('hands and test-runner state the role name they resolve to', () => {
  assert.match(parse('hands').body, /resolve-dispatch\.sh --role hands/);
  assert.match(parse('test-runner').body, /resolve-dispatch\.sh --role test-runner/);
});
