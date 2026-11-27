'use strict';
require('./test-git-env'); // fixture repos must not run the account's global git config
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const gate = require('./cn-model-dispatch-gate');
const legacy = require('./fixtures/cn-gate-legacy.js');

const clean = 'Brief-Class: clean-sandbox\nTask: Compose a cheerful summary.\nInputs: Public observations.\nOutput: A short overview.\nLimits: Keep it concise.\n';
function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-gate-test-'));
  try {
    const runtime = fs.mkdtempSync('/dev/shm/cn-gate-test-');
    try {
      const repo = path.join(root, 'repo'), sandbox = path.join(root, 'sandbox');
      fs.mkdirSync(repo); fs.mkdirSync(sandbox);
      execFileSync('git', ['init', '-q', repo]);
      fs.writeFileSync(path.join(repo, 'source.js'), 'const peculiar = alpha beta gamma delta epsilon zeta eta theta iota kappa lambda;\n');
      execFileSync('git', ['-C', repo, 'add', 'source.js']);
      const brief = path.join(sandbox, 'brief');
      const opts = { runner: 'kimi', endpoint: 'https://api.moonshot.cn/v1', tier: 'T0', cwd: sandbox, files: [brief], sourceRepo: repo, env: { XDG_RUNTIME_DIR: runtime } };
      const check = (text, overrides = {}) => { fs.writeFileSync(brief, text); return gate.check({ ...opts, ...overrides }); };
      fn({ root, runtime, repo, sandbox, brief, opts, check });
    } finally { fs.rmSync(runtime, { recursive: true, force: true }); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
test('(a) clean template is allowed', () => fixture(({ check }) => {
  assert.equal(check(clean).allowed, true);
}));
// The frozen fixture lives one directory below its original inventory; redirect
// only its inventory reads so that the original decision logic remains intact.
function legacyCheck(opts) {
  const read = fs.readFileSync;
  fs.readFileSync = function (file, ...args) {
    if (typeof file === 'string' && path.dirname(file) === path.join(__dirname, 'fixtures') && ['cloud-operators.json', 'local-sandbox-endpoints.json', 'leak-guard-hosts.example.json'].includes(path.basename(file))) file = path.join(__dirname, path.basename(file));
    return read.call(this, file, ...args);
  };
  try { return legacy.check(opts); } finally { fs.readFileSync = read; }
}
const functionLines = Array.from({ length: 20 }, (_, i) => `value_${i} = calculate_unique_${i}(alpha_${i}, beta_${i}, gamma_${i});`).join('\n');
const withInputs = (s) => clean.replace('Inputs: Public observations.', `Inputs: Public observations.\n${s}`);
test('(b) legacy permits copied function and oversized block; new layers reject', () => fixture(({ repo, brief, opts, check }) => {
  fs.writeFileSync(path.join(repo, 'source.js'), functionLines);
  const copied = withInputs(functionLines);
  assert.equal(check(copied).cls, 'restricted_operator_brief_shingle');
  assert.equal(legacyCheck(opts).allowed, true);
  const block = withInputs('```\n' + Array.from({ length: 50 }, (_, i) => `line_${i}`).join('\n') + '\n```');
  assert.equal(check(block).cls, 'restricted_operator_brief_template');
  assert.equal(legacyCheck(opts).allowed, true);
}));
test('(c) template fields, fences, indentation and paths', () => fixture(({ check }) => {
  const bad = [
    clean.replace('Inputs: Public observations.\n', ''),
    clean.replace('Inputs:', 'Task: Duplicate\nInputs:'),
    clean.replace('Inputs: Public observations.', 'Inputs:'),
    clean.replace('Inputs: Public observations.\nOutput: A short overview.', 'Output: A short overview.\nInputs: Public observations.'),
    withInputs('```\n' + Array(41).fill('item').join('\n')),
    withInputs('~~~\n' + Array(41).fill('item').join('\n') + '\n~~~'),
    withInputs(Array(41).fill('    item').join('\n')),
    ...['a/b.js', './x', '~/x', 'path:12'].map(p => withInputs(p)),
  ];
  for (const text of bad) assert.equal(check(text).cls, 'restricted_operator_brief_template', text);
  assert.equal(check(withInputs(Array(20).fill('    item').join('\n'))).allowed, true);
}));
test('(d) source, runtime, field limits, cache and large sources', () => fixture(({ root, runtime, repo, check }) => {
  for (const override of [{ sourceRepo: undefined }, { sourceRepo: '' }, { sourceRepo: root }, { sourceRepos: [repo, repo] }])
    assert.equal(check(clean, override).cls, 'restricted_operator_shingle_source_missing');
  assert.equal(check(clean, { env: {} }).cls, 'restricted_operator_shingle_unavailable');
  for (const field of ['Output', 'Limits']) {
    assert.equal(check(clean.replace(`${field}:`, `${field}: ./secret`)).cls, 'restricted_operator_brief_template');
    assert.equal(check(clean.replace(`${field}:`, `${field}: ${'x'.repeat(2050)}`)).cls, 'restricted_operator_brief_template');
  }
  fs.writeFileSync(path.join(repo, 'source.js'), functionLines);
  fs.writeFileSync(path.join(repo, 'second.js'), functionLines);
  execFileSync('git', ['-C', repo, 'add', 'second.js']);
  assert.equal(check(withInputs(functionLines)).cls, 'restricted_operator_brief_shingle');
  const cache = path.join(runtime, 'autopilot', 'cn-shingle');
  for (const file of fs.readdirSync(cache)) fs.writeFileSync(path.join(cache, file), 'truncated');
  assert.equal(check(withInputs(functionLines)).cls, 'restricted_operator_brief_shingle');
  assert.equal(check(clean).allowed, true);
  fs.writeFileSync(path.join(repo, 'source.js'), 'other unique source words alpha bravo charlie delta echo foxtrot golf hotel');
  fs.writeFileSync(path.join(repo, 'second.js'), 'different unique source words alpha bravo charlie delta echo foxtrot golf hotel');
  fs.writeFileSync(path.join(repo, 'large.js'), 'padding '.repeat(140000) + '\n' + functionLines);
  assert.equal(check(withInputs(functionLines)).cls, 'restricted_operator_brief_shingle');
  // Permission-denied reads cannot be reliably induced when the test runs as root.
}));
test('(e) a common isolated eight-token sentence does not block', () => fixture(({ repo, check }) => {
  const common = 'bright birds gather near quiet gardens during spring';
  for (let i = 0; i < 21; i++) fs.writeFileSync(path.join(repo, `common${i}.txt`), `${common}\nunique${i} extra words for distinct source windows here\n`);
  assert.equal(check(withInputs(common)).allowed, true);
}));
test('(f) local gateway and non-restricted operator bypass both layers; Kimi remains paused', () => {
  const poison = { runner: 'kimi', cwd: '/nonexistent', files: ['/nonexistent'], sourceRepo: '/nonexistent', env: {} };
  assert.equal(gate.check({ ...poison, endpoint: 'http://127.0.0.1:1234' }).allowed, true);
  assert.equal(gate.check({ ...poison, endpoint: 'https://openrouter.ai/api' }).allowed, true);
  assert.equal(require('./kimi-local-stop').isStopped({}), true);
  // Kimi pause is a separate exported guard, not a path inside check().
});
test('(g) refusal output contains neither brief nor source path', () => fixture(({ repo, check }) => {
  fs.writeFileSync(path.join(repo, 'source.js'), functionLines);
  const brief = withInputs(functionLines), result = check(brief);
  assert.equal(result.cls, 'restricted_operator_brief_shingle');
  assert.ok(!result.line.includes(brief));
  assert.ok(!result.line.includes(functionLines.split('\n')[0]));
  assert.ok(!result.line.includes(repo));
}));
test('(h) working tree content, punctuation and Chinese comments are detected', () => fixture(({ repo, check }) => {
  const tracked = path.join(repo, 'source.js');
  fs.writeFileSync(tracked, functionLines);
  assert.equal(check(withInputs(functionLines)).cls, 'restricted_operator_brief_shingle');
  fs.writeFileSync(tracked, 'const unrelated = one two three four five six seven eight nine ten;\n');
  fs.writeFileSync(path.join(repo, 'untracked.js'), functionLines);
  assert.equal(check(withInputs(functionLines)).cls, 'restricted_operator_brief_shingle');
  assert.equal(check(withInputs(functionLines.replace(/[=(),;]/g, ' '))).cls, 'restricted_operator_brief_shingle');
  const chinese = '這是一段私有註解用來描述特殊資料處理流程以及驗證結果';
  fs.writeFileSync(path.join(repo, 'untracked.js'), `// ${chinese}\n`);
  assert.equal(check(withInputs(chinese)).cls, 'restricted_operator_brief_shingle');
}));
test('(h2) repeated function, extra header text and contaminated git environment', () => fixture(({ repo, opts, check }) => {
  for (let i = 0; i < 21; i++) fs.writeFileSync(path.join(repo, `copy${i}.js`), functionLines);
  const copied = withInputs(functionLines);
  assert.equal(check(copied).cls, 'restricted_operator_brief_shingle');
  assert.equal(legacyCheck(opts).allowed, true);
  assert.equal(check(clean.replace('Brief-Class: clean-sandbox\n', 'Brief-Class: clean-sandbox\nextra\n')).cls, 'restricted_operator_brief_template');
  const keys = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY'];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try {
    for (const key of keys) process.env[key] = '/nonexistent';
    assert.equal(check(copied).cls, 'restricted_operator_brief_shingle');
  } finally {
    for (const key of keys) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }
}));
