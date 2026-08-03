'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { spawnSync } = require('child_process');

const {
  AA_ENDPOINT,
  readCurrent,
  refreshCapabilities,
} = require('./import-aa-capabilities');
const {
  appendEvidenceRecords,
  resolveStoreConfig,
} = require('./engine-capability-state');
const {
  capabilityEvidenceProducerHash,
  compileCapabilityEvidence,
} = require('../src/engine/capability-evidence');

// Synthetic protocol fixtures only. These are not copied Artificial Analysis records or scores.
function model(id, score, overrides = {}) {
  return {
    id,
    name: `Model ${id}`,
    slug: `model-${id}`,
    release_date: '2026-07-01',
    model_creator: {
      id: `creator-${id}`,
      name: `Creator ${id}`,
    },
    evaluations: {
      artificial_analysis_intelligence_index: score,
      artificial_analysis_coding_index: score,
      artificial_analysis_agentic_index: score,
    },
    ...overrides,
  };
}

function envelope(page, totalPages, data, version = 4.1) {
  return {
    tier: 'free',
    intelligence_index_version: version,
    pagination: {
      page,
      page_size: Math.max(3, data.length),
      total_pages: totalPages,
      has_more: page < totalPages,
    },
    data,
  };
}

function fakeResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get() {
        return null;
      },
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

function makeFetch(pages, calls, secret) {
  return async (url, options) => {
    calls.push({ url, options });
    assert.strictEqual(options.headers['x-api-key'], secret);
    assert.strictEqual(options.redirect, 'error');
    const page = Number(new URL(url).searchParams.get('page'));
    return fakeResponse(pages[page - 1]);
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
}

function mode(file) {
  return fs.statSync(file).mode & 0o777;
}

function fileTree(root) {
  if (!fs.existsSync(root)) return {};
  return Object.fromEntries(fs.readdirSync(root, { recursive: true })
    .filter((entry) => fs.statSync(path.join(root, entry)).isFile())
    .sort()
    .map((entry) => [entry, fs.readFileSync(path.join(root, entry), 'utf8')]));
}

function withTemp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-aa-import-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root,
    cacheDir: path.join(root, 'cache'),
    storeDir: path.join(root, 'evidence'),
  };
}

test('refresh fetches fixed paginated endpoint and writes only bounded provisional roles', async (t) => {
  const { root, cacheDir, storeDir } = withTemp(t);
  const secret = 'never-write-this-key';
  const calls = [];
  const pages = [
    envelope(1, 2, [model('a', 100), model('b', 100), model('c', 50)]),
    envelope(2, 2, [
      model('d', 20),
      model('e', 10, {
        slug: 'unsafe slug/value',
        release_date: null,
      }),
    ]),
  ];

  const result = await refreshCapabilities({
    apiKey: secret,
    cacheDir,
    store: storeDir,
    now: '2026-07-26T10:00:00.000Z',
    fetchImpl: makeFetch(pages, calls, secret),
  });

  assert.deepStrictEqual(
    calls.map((entry) => entry.url),
    [`${AA_ENDPOINT}?page=1`, `${AA_ENDPOINT}?page=2`],
  );
  for (const call of calls) {
    assert.deepStrictEqual(Object.keys(call.options.headers).sort(), ['Accept', 'x-api-key']);
    assert.ok(!call.url.includes(secret));
  }

  assert.strictEqual(result.intelligence_index_version, '4.1');
  assert.strictEqual(result.model_count, 5);
  assert.strictEqual(result.evidence_count, 4);
  assert.deepStrictEqual(result.roles, ['explorer', 'implementer']);
  assert.strictEqual(mode(cacheDir), 0o700);
  assert.strictEqual(mode(path.join(cacheDir, 'raw')), 0o700);
  assert.strictEqual(mode(path.join(cacheDir, 'normalized')), 0o700);
  assert.strictEqual(mode(path.join(cacheDir, 'current.json')), 0o600);

  const current = readJson(path.join(cacheDir, 'current.json'));
  assert.deepStrictEqual(readCurrent(cacheDir), current);
  assert.strictEqual(current.source.name, 'Artificial Analysis');
  assert.strictEqual(current.source.url, AA_ENDPOINT);
  assert.strictEqual(current.raw_pages.length, 2);
  assert.match(current.snapshot_hash, /^[a-f0-9]{64}$/);
  const snapshotFile = path.join(cacheDir, current.snapshot_path);
  assert.strictEqual(mode(snapshotFile), 0o600);
  const snapshotBytes = fs.readFileSync(snapshotFile, 'utf8');
  assert.strictEqual(
    require('crypto').createHash('sha256').update(snapshotBytes).digest('hex'),
    current.snapshot_hash,
  );
  const snapshot = JSON.parse(snapshotBytes);
  const a = snapshot.models.find((entry) => entry.id === 'a');
  const b = snapshot.models.find((entry) => entry.id === 'b');
  assert.strictEqual(a.indices.coding.percentile, 0.875);
  assert.strictEqual(b.indices.coding.percentile, 0.875);
  assert.deepStrictEqual(a.provisional_roles, ['explorer', 'implementer']);
  assert.deepStrictEqual(
    snapshot.models.find((entry) => entry.id === 'c').provisional_roles,
    [],
  );

  const evidenceFile = path.join(storeDir, 'qualification-evidence.jsonl');
  const rows = readJsonl(evidenceFile);
  assert.strictEqual(mode(storeDir), 0o700);
  assert.strictEqual(mode(evidenceFile), 0o600);
  assert.strictEqual(rows.length, 4);
  assert.ok(rows.every((row) => row.producer === 'aa-import-v1'));
  assert.ok(rows.every((row) => row.evidence.source === 'external_prior'));
  assert.ok(rows.every((row) => row.evidence.state === 'provisional'));
  assert.ok(rows.every((row) => row.evidence.identity.identity_resolved === false));
  assert.ok(rows.every((row) => row.evidence.scope.languages[0] === 'und'));
  assert.deepStrictEqual(
    [...new Set(rows.map((row) => row.evidence.role))].sort(),
    ['explorer', 'implementer'],
  );
  assert.ok(!rows.some((row) => (
    row.evidence.role === 'owner'
    || row.evidence.role === 'reviewer'
    || row.evidence.role === 'verification_author'
  )));

  const allWritten = fs.readdirSync(root, { recursive: true })
    .filter((entry) => fs.statSync(path.join(root, entry)).isFile())
    .map((entry) => fs.readFileSync(path.join(root, entry), 'utf8'))
    .join('\n');
  assert.ok(!allWritten.includes(secret));
  assert.ok(!JSON.stringify(result).includes(secret));
});

test('all-tie cohorts use a deterministic neutral percentile', async (t) => {
  const { cacheDir } = withTemp(t);
  const calls = [];
  await refreshCapabilities({
    apiKey: 'key',
    cacheDir,
    now: '2026-07-26T10:00:00.000Z',
    recordEvidence: false,
    fetchImpl: makeFetch([
      envelope(1, 1, [model('a', 42), model('b', 42), model('c', 42)]),
    ], calls, 'key'),
  });
  const current = readJson(path.join(cacheDir, 'current.json'));
  const snapshot = readJson(path.join(cacheDir, current.snapshot_path));
  assert.ok(snapshot.models.every((entry) => entry.indices.coding.percentile === 0.5));
  assert.ok(snapshot.models.every((entry) => entry.provisional_roles.length === 0));
});

test('index versions remain separate content-addressed cohorts', async (t) => {
  const { cacheDir } = withTemp(t);
  const firstPages = [envelope(1, 1, [
    model('a', 100),
    model('b', 80),
    model('c', 20),
    model('d', 10),
  ], 4.1)];
  await refreshCapabilities({
    apiKey: 'key',
    cacheDir,
    now: '2026-07-26T10:00:00.000Z',
    recordEvidence: false,
    fetchImpl: makeFetch(firstPages, [], 'key'),
  });
  const first = readJson(path.join(cacheDir, 'current.json'));

  const secondPages = [envelope(1, 1, [
    model('a', 1),
    model('b', 2),
    model('c', 3),
    model('d', 4),
  ], 5)];
  await refreshCapabilities({
    apiKey: 'key',
    cacheDir,
    now: '2026-07-27T10:00:00.000Z',
    recordEvidence: false,
    fetchImpl: makeFetch(secondPages, [], 'key'),
  });
  const second = readJson(path.join(cacheDir, 'current.json'));

  assert.strictEqual(first.intelligence_index_version, '4.1');
  assert.strictEqual(second.intelligence_index_version, '5');
  assert.notStrictEqual(first.snapshot_hash, second.snapshot_hash);
  assert.ok(fs.existsSync(path.join(cacheDir, first.snapshot_path)));
  assert.ok(fs.existsSync(path.join(cacheDir, second.snapshot_path)));
  assert.strictEqual(
    readJson(path.join(cacheDir, first.snapshot_path)).cohort,
    'aa-index-v4.1',
  );
  assert.strictEqual(
    readJson(path.join(cacheDir, second.snapshot_path)).cohort,
    'aa-index-v5',
  );
});

test('missing key and API failures preserve current cache and evidence bytes', async (t) => {
  const { cacheDir, storeDir } = withTemp(t);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(storeDir, { recursive: true });
  const currentFile = path.join(cacheDir, 'current.json');
  const evidenceFile = path.join(storeDir, 'qualification-evidence.jsonl');
  fs.writeFileSync(currentFile, '{"sentinel":"cache"}\n');
  fs.writeFileSync(evidenceFile, '{"sentinel":"evidence"}\n');
  const beforeCurrent = fs.readFileSync(currentFile, 'utf8');
  const beforeEvidence = fs.readFileSync(evidenceFile, 'utf8');

  const cases = [
    {
      name: 'missing key',
      apiKey: '',
      fetchImpl: async () => {
        throw new Error('fetch must not run');
      },
      pattern: /ARTIFICIAL_ANALYSIS_API_KEY/,
    },
    {
      name: '401',
      apiKey: 'secret',
      fetchImpl: async () => fakeResponse({ error: 'secret leaked' }, 401),
      pattern: /HTTP 401/,
    },
    {
      name: '429',
      apiKey: 'secret',
      fetchImpl: async () => fakeResponse({ error: 'rate limited' }, 429),
      pattern: /HTTP 429/,
    },
    {
      name: 'network error',
      apiKey: 'secret',
      fetchImpl: async () => {
        throw new Error('socket detail containing secret');
      },
      pattern: /request failed/,
    },
  ];

  for (const failure of cases) {
    await assert.rejects(
      refreshCapabilities({
        apiKey: failure.apiKey,
        cacheDir,
        store: storeDir,
        now: '2026-07-26T10:00:00.000Z',
        fetchImpl: failure.fetchImpl,
      }),
      failure.pattern,
      failure.name,
    );
    assert.strictEqual(fs.readFileSync(currentFile, 'utf8'), beforeCurrent);
    assert.strictEqual(fs.readFileSync(evidenceFile, 'utf8'), beforeEvidence);
  }
});

test('malformed later pages and endpoint overrides fail before cache publication', async (t) => {
  const { cacheDir, storeDir } = withTemp(t);
  const currentFile = path.join(cacheDir, 'current.json');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(currentFile, '{"sentinel":true}\n');
  const before = fs.readFileSync(currentFile, 'utf8');

  await assert.rejects(
    refreshCapabilities({
      apiKey: 'key',
      cacheDir,
      store: storeDir,
      now: '2026-07-26T10:00:00.000Z',
      fetchImpl: makeFetch([
        envelope(1, 2, [model('a', 100)]),
        envelope(2, 2, [model('b', 90)], 5),
      ], [], 'key'),
    }),
    /index version changed/,
  );
  assert.strictEqual(fs.readFileSync(currentFile, 'utf8'), before);
  assert.ok(!fs.existsSync(path.join(storeDir, 'qualification-evidence.jsonl')));

  await assert.rejects(
    refreshCapabilities({
      apiKey: 'key',
      cacheDir,
      now: '2026-07-26T10:00:00.000Z',
      endpoint: 'https://attacker.invalid/collect',
      recordEvidence: false,
      fetchImpl: async () => fakeResponse(envelope(1, 1, [])),
    }),
    /unsupported option "endpoint"/,
  );
  assert.strictEqual(fs.readFileSync(currentFile, 'utf8'), before);
});

test('CLI exposes no endpoint override and cache integrity is fail-closed', async (t) => {
  const { cacheDir } = withTemp(t);
  const script = path.join(__dirname, 'import-aa-capabilities.js');
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.strictEqual(help.status, 0);
  assert.match(help.stdout, /ARTIFICIAL_ANALYSIS_API_KEY/);
  assert.ok(!help.stdout.includes('--endpoint'));

  const override = spawnSync(
    process.execPath,
    [script, 'refresh', '--endpoint', 'https://attacker.invalid'],
    { encoding: 'utf8' },
  );
  assert.strictEqual(override.status, 2);
  assert.match(override.stderr, /unknown option/);

  await refreshCapabilities({
    apiKey: 'key',
    cacheDir,
    now: '2026-07-26T10:00:00.000Z',
    recordEvidence: false,
    fetchImpl: makeFetch([
      envelope(1, 1, [model('a', 100), model('b', 50), model('c', 10)]),
    ], [], 'key'),
  });
  const current = readJson(path.join(cacheDir, 'current.json'));
  fs.appendFileSync(path.join(cacheDir, current.snapshot_path), ' ');
  assert.throws(() => readCurrent(cacheDir), /content hash/);
});

test('refresh rejects a cache path inside a Git worktree before fetching', async () => {
  const cacheDir = path.join(__dirname, '.aa-import-should-not-exist');
  let called = false;
  await assert.rejects(
    refreshCapabilities({
      apiKey: 'key',
      cacheDir,
      recordEvidence: false,
      fetchImpl: async () => {
        called = true;
        return fakeResponse(envelope(1, 1, []));
      },
    }),
    /outside a Git worktree/,
  );
  assert.strictEqual(called, false);
  assert.strictEqual(fs.existsSync(cacheDir), false);
});

test('refresh resolves cache symlinks and refuses echoed credentials', async (t) => {
  const { root } = withTemp(t);
  const repoLink = path.join(root, 'repo-link');
  fs.symlinkSync(__dirname, repoLink, 'dir');
  let called = false;
  await assert.rejects(
    refreshCapabilities({
      apiKey: 'key',
      cacheDir: repoLink,
      recordEvidence: false,
      fetchImpl: async () => {
        called = true;
        return fakeResponse(envelope(1, 1, []));
      },
    }),
    /outside a Git worktree/,
  );
  assert.strictEqual(called, false);

  const cacheDir = path.join(root, 'safe-cache');
  const echoed = envelope(1, 1, [model('a', 100)]);
  echoed.debug = { credential: 'received:long-secret-key:accepted' };
  await assert.rejects(
    refreshCapabilities({
      apiKey: 'long-secret-key',
      cacheDir,
      recordEvidence: false,
      fetchImpl: async () => fakeResponse(echoed),
    }),
    /credential material/,
  );
  assert.strictEqual(fs.existsSync(cacheDir), false);
});

test('refresh bounds streamed bodies and rejects cache child symlinks', async (t) => {
  const { root } = withTemp(t);
  const oversized = Buffer.alloc((4 * 1024 * 1024) + 1, 0x20);
  let sent = false;
  await assert.rejects(
    refreshCapabilities({
      apiKey: 'key',
      cacheDir: path.join(root, 'oversized-cache'),
      recordEvidence: false,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: {
          getReader() {
            return {
              async read() {
                if (sent) return { done: true };
                sent = true;
                return { done: false, value: oversized };
              },
              async cancel() {},
            };
          },
        },
        async text() {
          throw new Error('streaming response must not use text()');
        },
      }),
    }),
    /response-size limit/,
  );
  assert.strictEqual(fs.existsSync(path.join(root, 'oversized-cache')), false);

  const cacheDir = path.join(root, 'symlink-cache');
  fs.mkdirSync(cacheDir);
  fs.symlinkSync(__dirname, path.join(cacheDir, 'raw'), 'dir');
  const before = new Set(fs.readdirSync(__dirname));
  await assert.rejects(
    refreshCapabilities({
      apiKey: 'key',
      cacheDir,
      recordEvidence: false,
      fetchImpl: makeFetch([
        envelope(1, 1, [model('a', 100), model('b', 50), model('c', 10)]),
      ], [], 'key'),
    }),
    /must be a real directory/,
  );
  assert.deepStrictEqual(new Set(fs.readdirSync(__dirname)), before);
  assert.strictEqual(fs.existsSync(path.join(cacheDir, 'current.json')), false);
});

test('aa-import ledger producer rejects non-external evidence and unknown producers', async (t) => {
  const { cacheDir, storeDir } = withTemp(t);
  await refreshCapabilities({
    apiKey: 'key',
    cacheDir,
    now: '2026-07-26T10:00:00.000Z',
    recordEvidence: false,
    fetchImpl: makeFetch([
      envelope(1, 1, [
        model('a', 100),
        model('b', 50),
        model('c', 20),
        model('d', 10),
      ]),
    ], [], 'key'),
  });
  const current = readJson(path.join(cacheDir, 'current.json'));
  const external = readJson(path.join(cacheDir, current.snapshot_path)).evidence[0];
  const {
    evidence_id,
    evidence_hash,
    scope_hash,
    identity_hash,
    grant_identity_hash,
    trial_set_hash,
    ...body
  } = external;
  const selfReport = compileCapabilityEvidence({
    ...body,
    source: 'self_report',
    source_ref: 'manual-self-report',
    methodology: {
      ...body.methodology,
      kind: 'self_report',
      name: 'manual-self-report',
    },
  });
  const config = resolveStoreConfig({ store: storeDir });
  assert.throws(
    () => appendEvidenceRecords(config, [selfReport], 'aa-import-v1'),
    /external_prior/,
  );
  assert.throws(
    () => appendEvidenceRecords(config, [external], 'unregistered-importer'),
    /unsupported capability evidence producer/,
  );
  const ownerPrior = compileCapabilityEvidence({
    ...body,
    role: 'owner',
  });
  assert.throws(
    () => appendEvidenceRecords(config, [ownerPrior], 'aa-import-v1'),
    /implementer\/explorer/,
  );
  const forgedPrior = compileCapabilityEvidence({
    ...body,
    source_ref: 'forged-aa-source',
  });
  assert.throws(
    () => appendEvidenceRecords(config, [forgedPrior], 'aa-import-v1'),
    /canonical Artificial Analysis provenance/,
  );
  assert.ok(!fs.existsSync(path.join(storeDir, 'qualification-evidence.jsonl')));
  assert.throws(
    () => appendEvidenceRecords(config, [external], 'aa-import-v1', {
      commit() {
        throw new Error('synthetic publication failure');
      },
      rollback() {},
    }),
    /synthetic publication failure/,
  );
  assert.ok(!fs.existsSync(path.join(storeDir, 'qualification-evidence.jsonl')));
  fs.mkdirSync(storeDir, { recursive: true });
  fs.writeFileSync(path.join(storeDir, 'qualification-evidence.jsonl'), `${JSON.stringify({
    event_id: 1,
    producer: 'aa-import-v1',
    transcript_hash: capabilityEvidenceProducerHash(ownerPrior, 'aa-import-v1'),
    evidence: ownerPrior,
  })}\n`);
  const forgedRead = spawnSync(
    process.execPath,
    [
      path.join(__dirname, 'engine-capability-state.js'),
      'report-evidence',
      '--role',
      'owner',
      '--store',
      storeDir,
    ],
    { encoding: 'utf8' },
  );
  assert.strictEqual(forgedRead.status, 1);
  assert.match(forgedRead.stderr, /implementer\/explorer/);
});

test('aa importer cannot claim an evidence id owned by another producer', async (t) => {
  const { cacheDir, storeDir } = withTemp(t);
  await refreshCapabilities({
    apiKey: 'key',
    cacheDir,
    now: '2026-07-26T10:00:00.000Z',
    recordEvidence: false,
    fetchImpl: makeFetch([
      envelope(1, 1, [
        model('a', 100),
        model('b', 50),
        model('c', 20),
        model('d', 10),
      ]),
    ], [], 'key'),
  });
  const before = fs.readFileSync(path.join(cacheDir, 'current.json'), 'utf8');
  const manifest = JSON.parse(before);
  const snapshot = readJson(path.join(cacheDir, manifest.snapshot_path));
  const config = resolveStoreConfig({ store: storeDir });
  appendEvidenceRecords(config, [snapshot.evidence[0]], 'operator-record-v1');

  await assert.rejects(
    refreshCapabilities({
      apiKey: 'key',
      cacheDir,
      store: storeDir,
      now: '2026-07-26T10:00:00.000Z',
      fetchImpl: makeFetch([
        envelope(1, 1, [
          model('a', 100),
          model('b', 50),
          model('c', 20),
          model('d', 10),
        ]),
      ], [], 'key'),
    }),
    /owned by producer 'operator-record-v1'/,
  );
  assert.strictEqual(fs.readFileSync(path.join(cacheDir, 'current.json'), 'utf8'), before);
  assert.strictEqual(readCurrent(cacheDir).evidence_recorded, false);
});

test('refresh rejects an evidence store inside a Git worktree before fetching', async (t) => {
  const { root, cacheDir } = withTemp(t);
  const worktree = path.join(root, 'tracked');
  fs.mkdirSync(path.join(worktree, '.git'), { recursive: true });
  let called = false;
  await assert.rejects(
    refreshCapabilities({
      apiKey: 'key',
      cacheDir,
      store: path.join(worktree, 'state'),
      fetchImpl: async () => {
        called = true;
        return fakeResponse(envelope(1, 1, []));
      },
    }),
    /evidence store must be outside a Git worktree/,
  );
  assert.strictEqual(called, false);
  assert.strictEqual(fs.existsSync(cacheDir), false);
});

test('failed current publication rolls back evidence and new cache objects', async (t) => {
  const { cacheDir, storeDir } = withTemp(t);
  fs.mkdirSync(path.join(cacheDir, 'current.json'), { recursive: true });
  await assert.rejects(
    refreshCapabilities({
      apiKey: 'key',
      cacheDir,
      store: storeDir,
      now: '2026-07-26T10:00:00.000Z',
      fetchImpl: makeFetch([
        envelope(1, 1, [
          model('a', 100),
          model('b', 50),
          model('c', 20),
          model('d', 10),
        ]),
      ], [], 'key'),
    }),
    /current\.json/,
  );
  assert.strictEqual(fs.existsSync(path.join(storeDir, 'qualification-evidence.jsonl')), false);
  for (const directory of ['raw', 'normalized']) {
    const target = path.join(cacheDir, directory);
    assert.ok(!fs.existsSync(target) || fs.readdirSync(target).length === 0);
  }
});

test('ledger validation failure leaves prior current and cache objects unchanged', async (t) => {
  const { cacheDir, storeDir } = withTemp(t);
  await refreshCapabilities({
    apiKey: 'key',
    cacheDir,
    now: '2026-07-26T10:00:00.000Z',
    recordEvidence: false,
    fetchImpl: makeFetch([
      envelope(1, 1, [model('a', 100), model('b', 50), model('c', 10)]),
    ], [], 'key'),
  });
  const before = fileTree(cacheDir);
  fs.mkdirSync(storeDir, { recursive: true });
  fs.writeFileSync(path.join(storeDir, 'qualification-evidence.jsonl'), 'not-json\n');
  await assert.rejects(
    refreshCapabilities({
      apiKey: 'key',
      cacheDir,
      store: storeDir,
      now: '2026-07-27T10:00:00.000Z',
      fetchImpl: makeFetch([
        envelope(1, 1, [model('a', 1), model('b', 100), model('c', 10)], 5),
      ], [], 'key'),
    }),
    /malformed capability evidence line/,
  );
  assert.deepStrictEqual(fileTree(cacheDir), before);
  assert.strictEqual(
    fs.readFileSync(path.join(storeDir, 'qualification-evidence.jsonl'), 'utf8'),
    'not-json\n',
  );
});

test('new cohorts retire prior candidates that fall below floor or disappear', async (t) => {
  const { cacheDir, storeDir } = withTemp(t);
  await refreshCapabilities({
    apiKey: 'key',
    cacheDir,
    store: storeDir,
    now: '2026-07-26T10:00:00.000Z',
    fetchImpl: makeFetch([
      envelope(1, 1, [
        model('a', 100),
        model('gone', 100),
        model('b', 50),
        model('c', 10),
      ], 4.1),
    ], [], 'key'),
  });
  const firstManifest = readCurrent(cacheDir);
  const firstSnapshot = readJson(path.join(cacheDir, firstManifest.snapshot_path));
  const oldImplementer = firstSnapshot.evidence.find((entry) => (
    entry.identity.identity === 'aa-a' && entry.role === 'implementer'
  ));
  const oldGone = firstSnapshot.evidence.find((entry) => (
    entry.identity.identity === 'aa-gone' && entry.role === 'implementer'
  ));
  assert.ok(oldImplementer);
  assert.ok(oldGone);

  await refreshCapabilities({
    apiKey: 'key',
    cacheDir,
    store: storeDir,
    now: '2026-07-27T10:00:00.000Z',
    fetchImpl: makeFetch([
      envelope(1, 1, [
        model('a', 1),
        model('b', 100),
        model('c', 50),
        model('d', 10),
      ], 5),
    ], [], 'key'),
  });
  const secondManifest = readCurrent(cacheDir);
  const secondSnapshot = readJson(path.join(cacheDir, secondManifest.snapshot_path));
  assert.deepStrictEqual(
    secondSnapshot.models.find((entry) => entry.id === 'a').provisional_roles,
    [],
  );
  assert.deepStrictEqual(
    secondSnapshot.retirements.map((entry) => entry.reason).sort(),
    ['below_candidate_floor', 'below_candidate_floor', 'model_missing_current_cohort',
      'model_missing_current_cohort'],
  );
  const rows = readJsonl(path.join(storeDir, 'qualification-evidence.jsonl'));
  const evidence = rows.map((row) => row.evidence);
  for (const old of [oldImplementer, oldGone]) {
    const result = require('../src/engine/capability-evidence').evaluateCapabilityEvidence(
      evidence,
      {
        role: old.role,
        scope: old.scope,
        identity: old.identity,
        evaluation_time: '2026-07-27T10:00:01.000Z',
      },
    );
    assert.strictEqual(result.state, 'degraded');
    assert.notStrictEqual(result.evidence_id, old.evidence_id);
  }
});

test('recorded candidates are retired even when their cache was lost', async (t) => {
  const { cacheDir, storeDir } = withTemp(t);
  await refreshCapabilities({
    apiKey: 'key',
    cacheDir,
    store: storeDir,
    now: '2026-07-26T10:00:00.000Z',
    fetchImpl: makeFetch([
      envelope(1, 1, [
        model('a', 100),
        model('b', 50),
        model('c', 20),
        model('d', 10),
      ], 4.1),
    ], [], 'key'),
  });
  const firstManifest = readCurrent(cacheDir);
  const firstSnapshot = readJson(path.join(cacheDir, firstManifest.snapshot_path));
  const oldImplementer = firstSnapshot.evidence.find((entry) => (
    entry.identity.identity === 'aa-a' && entry.role === 'implementer'
  ));
  assert.ok(oldImplementer);
  fs.rmSync(cacheDir, { recursive: true, force: true });

  await refreshCapabilities({
    apiKey: 'key',
    cacheDir,
    store: storeDir,
    now: '2026-07-27T10:00:00.000Z',
    fetchImpl: makeFetch([
      envelope(1, 1, [
        model('a', 1),
        model('b', 100),
        model('c', 50),
        model('d', 10),
      ], 5),
    ], [], 'key'),
  });
  const current = readCurrent(cacheDir);
  const snapshot = readJson(path.join(cacheDir, current.snapshot_path));
  assert.ok(snapshot.retirements.some((entry) => (
    entry.model_id === 'a' && entry.role === 'implementer'
  )));
  const evidence = readJsonl(path.join(storeDir, 'qualification-evidence.jsonl'))
    .map((row) => row.evidence);
  const result = require('../src/engine/capability-evidence').evaluateCapabilityEvidence(
    evidence,
    {
      role: oldImplementer.role,
      scope: oldImplementer.scope,
      identity: oldImplementer.identity,
      evaluation_time: '2026-07-27T10:00:01.000Z',
    },
  );
  assert.strictEqual(result.state, 'degraded');
});

test('equal-time retirement evidence wins over a provisional prior', async (t) => {
  const { cacheDir, storeDir } = withTemp(t);
  const now = '2026-07-26T10:00:00.000Z';
  await refreshCapabilities({
    apiKey: 'key',
    cacheDir,
    store: storeDir,
    now,
    fetchImpl: makeFetch([
      envelope(1, 1, [
        model('a', 100),
        model('b', 50),
        model('c', 20),
        model('d', 10),
      ], 4.1),
    ], [], 'key'),
  });
  const firstManifest = readCurrent(cacheDir);
  const firstSnapshot = readJson(path.join(cacheDir, firstManifest.snapshot_path));
  const oldImplementer = firstSnapshot.evidence.find((entry) => (
    entry.identity.identity === 'aa-a' && entry.role === 'implementer'
  ));

  await refreshCapabilities({
    apiKey: 'key',
    cacheDir,
    store: storeDir,
    now,
    fetchImpl: makeFetch([
      envelope(1, 1, [
        model('a', 1),
        model('b', 100),
        model('c', 50),
        model('d', 10),
      ], 5),
    ], [], 'key'),
  });
  const evidence = readJsonl(path.join(storeDir, 'qualification-evidence.jsonl'))
    .map((row) => row.evidence);
  const result = require('../src/engine/capability-evidence').evaluateCapabilityEvidence(
    evidence,
    {
      role: oldImplementer.role,
      scope: oldImplementer.scope,
      identity: oldImplementer.identity,
      evaluation_time: now,
    },
  );
  assert.strictEqual(result.state, 'degraded');
});

test('transactional evidence cannot become visible before cache publication', async (t) => {
  const { root, cacheDir, storeDir } = withTemp(t);
  await refreshCapabilities({
    apiKey: 'key',
    cacheDir,
    now: '2026-07-26T10:00:00.000Z',
    recordEvidence: false,
    fetchImpl: makeFetch([
      envelope(1, 1, [
        model('a', 100),
        model('b', 50),
        model('c', 20),
        model('d', 10),
      ]),
    ], [], 'key'),
  });
  const manifest = readCurrent(cacheDir);
  const evidence = readJson(path.join(cacheDir, manifest.snapshot_path)).evidence[0];
  const evidenceFile = path.join(root, 'evidence.json');
  const publishedFile = path.join(root, 'published');
  fs.writeFileSync(evidenceFile, JSON.stringify(evidence));
  const child = spawnSync(process.execPath, [
    '-e',
    `
      const fs = require('fs');
      const state = require(process.argv[1]);
      const evidence = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
      const config = state.resolveStoreConfig({ store: process.argv[3] });
      state.appendEvidenceRecords(config, [evidence], 'aa-import-v1', {
        commit() {
          fs.writeFileSync(process.argv[4], 'published');
          process.kill(process.pid, 'SIGKILL');
        },
        rollback() {},
      });
    `,
    path.join(__dirname, 'engine-capability-state.js'),
    evidenceFile,
    storeDir,
    publishedFile,
  ], { encoding: 'utf8' });
  assert.strictEqual(child.signal, 'SIGKILL');
  assert.strictEqual(fs.readFileSync(publishedFile, 'utf8'), 'published');
  assert.strictEqual(fs.existsSync(path.join(storeDir, 'qualification-evidence.jsonl')), false);
});

test('a later recorded refresh carries retirement debt across no-record snapshots', async (t) => {
  const { cacheDir, storeDir } = withTemp(t);
  await refreshCapabilities({
    apiKey: 'key',
    cacheDir,
    store: storeDir,
    now: '2026-07-26T10:00:00.000Z',
    fetchImpl: makeFetch([
      envelope(1, 1, [
        model('a', 100),
        model('b', 50),
        model('c', 20),
        model('d', 10),
      ], 4.1),
    ], [], 'key'),
  });
  const firstManifest = readCurrent(cacheDir);
  const firstSnapshot = readJson(path.join(cacheDir, firstManifest.snapshot_path));
  const oldImplementer = firstSnapshot.evidence.find((entry) => (
    entry.identity.identity === 'aa-a' && entry.role === 'implementer'
  ));
  assert.ok(oldImplementer);

  const belowFloor = [
    envelope(1, 1, [
      model('a', 1),
      model('b', 100),
      model('c', 50),
      model('d', 10),
    ], 5),
  ];
  await refreshCapabilities({
    apiKey: 'key',
    cacheDir,
    now: '2026-07-27T10:00:00.000Z',
    recordEvidence: false,
    fetchImpl: makeFetch(belowFloor, [], 'key'),
  });
  assert.strictEqual(readCurrent(cacheDir).evidence_recorded, false);
  assert.strictEqual(
    readJsonl(path.join(storeDir, 'qualification-evidence.jsonl')).length,
    firstSnapshot.evidence.length,
  );

  await refreshCapabilities({
    apiKey: 'key',
    cacheDir,
    store: storeDir,
    now: '2026-07-28T10:00:00.000Z',
    fetchImpl: makeFetch(belowFloor, [], 'key'),
  });
  const current = readCurrent(cacheDir);
  const snapshot = readJson(path.join(cacheDir, current.snapshot_path));
  assert.strictEqual(current.evidence_recorded, true);
  assert.ok(snapshot.retirements.some((entry) => (
    entry.model_id === 'a' && entry.role === 'implementer'
  )));
  const evidence = readJsonl(path.join(storeDir, 'qualification-evidence.jsonl'))
    .map((row) => row.evidence);
  const result = require('../src/engine/capability-evidence').evaluateCapabilityEvidence(
    evidence,
    {
      role: oldImplementer.role,
      scope: oldImplementer.scope,
      identity: oldImplementer.identity,
      evaluation_time: '2026-07-28T10:00:01.000Z',
    },
  );
  assert.strictEqual(result.state, 'degraded');
});

test('retirement after an unrecorded provisional targets recorded lineage', async (t) => {
  const { cacheDir, storeDir } = withTemp(t);
  const candidate = [
    envelope(1, 1, [
      model('a', 100),
      model('b', 50),
      model('c', 20),
      model('d', 10),
    ], 4.1),
  ];
  await refreshCapabilities({
    apiKey: 'key',
    cacheDir,
    store: storeDir,
    now: '2026-07-26T10:00:00.000Z',
    fetchImpl: makeFetch(candidate, [], 'key'),
  });
  const first = readCurrent(cacheDir);
  const firstSnapshot = readJson(path.join(cacheDir, first.snapshot_path));
  const recorded = firstSnapshot.evidence.find((entry) => (
    entry.identity.identity === 'aa-a' && entry.role === 'implementer'
  ));

  await refreshCapabilities({
    apiKey: 'key',
    cacheDir,
    now: '2026-07-27T10:00:00.000Z',
    recordEvidence: false,
    fetchImpl: makeFetch(candidate, [], 'key'),
  });
  const unrecordedManifest = readCurrent(cacheDir);
  const unrecordedSnapshot = readJson(path.join(cacheDir, unrecordedManifest.snapshot_path));
  const unrecorded = unrecordedSnapshot.evidence.find((entry) => (
    entry.identity.identity === 'aa-a' && entry.role === 'implementer'
  ));
  assert.notStrictEqual(unrecorded.evidence_id, recorded.evidence_id);

  await refreshCapabilities({
    apiKey: 'key',
    cacheDir,
    store: storeDir,
    now: '2026-07-28T10:00:00.000Z',
    fetchImpl: makeFetch([
      envelope(1, 1, [
        model('a', 1),
        model('b', 100),
        model('c', 50),
        model('d', 10),
      ], 5),
    ], [], 'key'),
  });
  const current = readCurrent(cacheDir);
  const snapshot = readJson(path.join(cacheDir, current.snapshot_path));
  const retirement = snapshot.retirements.find((entry) => (
    entry.model_id === 'a' && entry.role === 'implementer'
  ));
  assert.strictEqual(retirement.target_evidence_id, recorded.evidence_id);
  const ledgerIds = new Set(readJsonl(
    path.join(storeDir, 'qualification-evidence.jsonl'),
  ).map((row) => row.evidence.evidence_id));
  assert.ok(ledgerIds.has(retirement.target_evidence_id));
  assert.ok(!ledgerIds.has(unrecorded.evidence_id));
});

test('readCurrent binds manifest metadata and every raw object to the snapshot', async (t) => {
  const { cacheDir } = withTemp(t);
  await refreshCapabilities({
    apiKey: 'key',
    cacheDir,
    now: '2026-07-26T10:00:00.000Z',
    recordEvidence: false,
    fetchImpl: makeFetch([
      envelope(1, 1, [model('a', 100), model('b', 50), model('c', 10)]),
    ], [], 'key'),
  });
  const currentFile = path.join(cacheDir, 'current.json');
  const original = readJson(currentFile);
  fs.writeFileSync(currentFile, JSON.stringify({
    ...original,
    intelligence_index_version: '999',
    cohort: 'aa-index-v999',
    roles: ['owner', 'reviewer'],
    evidence_count: 999,
  }));
  assert.throws(() => readCurrent(cacheDir), /manifest metadata/);

  fs.writeFileSync(currentFile, JSON.stringify(original));
  fs.appendFileSync(path.join(cacheDir, original.raw_pages[0].path), ' ');
  assert.throws(() => readCurrent(cacheDir), /raw page failed its content hash/);

  const replacement = envelope(1, 1, [
    model('x', 100),
    model('y', 50),
    model('z', 10),
  ]);
  const replacementBytes = JSON.stringify(replacement);
  const replacementHash = require('crypto')
    .createHash('sha256')
    .update(replacementBytes)
    .digest('hex');
  fs.writeFileSync(path.join(cacheDir, 'raw', `${replacementHash}.json`), replacementBytes);
  fs.writeFileSync(currentFile, JSON.stringify({
    ...original,
    raw_pages: [{
      page: 1,
      hash: replacementHash,
      path: `raw/${replacementHash}.json`,
    }],
  }));
  assert.throws(() => readCurrent(cacheDir), /raw pages do not derive snapshot/);
});

test('an older completed fetch cannot overwrite a newer current snapshot', async (t) => {
  const { cacheDir } = withTemp(t);
  await refreshCapabilities({
    apiKey: 'key',
    cacheDir,
    now: '2026-07-27T10:00:00.000Z',
    recordEvidence: false,
    fetchImpl: makeFetch([
      envelope(1, 1, [model('new', 100), model('b', 50), model('c', 10)]),
    ], [], 'key'),
  });
  const newer = fs.readFileSync(path.join(cacheDir, 'current.json'), 'utf8');
  const result = await refreshCapabilities({
    apiKey: 'key',
    cacheDir,
    now: '2026-07-26T10:00:00.000Z',
    recordEvidence: false,
    fetchImpl: makeFetch([
      envelope(1, 1, [model('old', 100), model('b', 50), model('c', 10)]),
    ], [], 'key'),
  });
  assert.strictEqual(fs.readFileSync(path.join(cacheDir, 'current.json'), 'utf8'), newer);
  assert.strictEqual(result.retrieved_at, '2026-07-27T10:00:00.000Z');
});

test('cache destination is re-resolved after fetch to catch ancestor swaps', async (t) => {
  const { root } = withTemp(t);
  const parent = path.join(root, 'parent');
  const movedParent = path.join(root, 'parent-old');
  const tracked = path.join(root, 'tracked');
  fs.mkdirSync(parent);
  fs.mkdirSync(path.join(tracked, '.git'), { recursive: true });
  const cacheDir = path.join(parent, 'cache');
  await assert.rejects(
    refreshCapabilities({
      apiKey: 'key',
      cacheDir,
      recordEvidence: false,
      fetchImpl: async () => {
        fs.renameSync(parent, movedParent);
        fs.symlinkSync(tracked, parent, 'dir');
        return fakeResponse(envelope(1, 1, [
          model('a', 100),
          model('b', 50),
          model('c', 10),
        ]));
      },
    }),
    /cache destination changed during refresh/,
  );
  assert.strictEqual(fs.existsSync(path.join(tracked, 'cache')), false);
});
