'use strict';
require('./lib/test-git-env');
// node --test scripts/vision-guard.test.js
//
// Negative control: removing the vision-guard.js call in dispatch-review.sh makes
// the wired test red, because the stub runner is then invoked. The suite copies
// dispatch-review.sh, strips that one call, and requires the stub marker. A copy
// whose guard text no longer matches fails closed instead of pointing at nothing.
//
// The hetero, author, and consult wired tests go red when that script's
// vision-guard failure branch is replaced by `|| true`: the refusal is swallowed
// and the stub runner runs. A text-only check of the call site stays green.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const { guardVision, refuseNonTextBlocks, magicIsImage } = require('./lib/vision-guard');

const ROOT = path.join(__dirname, '..');
const GUARD_JS = path.join(__dirname, 'lib', 'vision-guard.js');
const STATE_JS = path.join(__dirname, 'engine-capability-state.js');
const REVIEW_SH = path.join(__dirname, 'dispatch-review.sh');
const HETERO_SH = path.join(__dirname, 'dispatch-hetero.sh');
const AUTHOR_SH = path.join(__dirname, 'dispatch-author.sh');
const CONSULT_SH = path.join(__dirname, 'dispatch-consult.sh');
const MUTATION = path.join(__dirname, 'vision-guard-wired-mut.test.sh');

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const GIF = Buffer.from('GIF89aXXXX', 'ascii');
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x18, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'ascii'),
]);
// BITMAPFILEHEADER (14) + BITMAPCOREHEADER (12) = 26. Reserved bytes 6..9 are NUL.
// A 2-byte "BM" is not this header.
const BMP = Buffer.from([
  0x42, 0x4d,
  0x1a, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0x1a, 0x00, 0x00, 0x00,
  0x0c, 0x00, 0x00, 0x00,
  0x01, 0x00,
  0x01, 0x00,
  0x01, 0x00,
  0x18, 0x00,
]);

// Exact block in dispatch-review.sh. The wired negative control deletes this
// and only this; removing the guard call makes the wired test red.
const REVIEW_GUARD = [
  '# vision-guard (scripts/lib/vision-guard.js): image magic bytes to a',
  '# non-supported engine refuse here, before any runner is invoked.',
  '_vg_args=(--runner "$RUNNER" --model "$MODEL")',
  '[ -n "${DIFF_FILE:-}" ] && _vg_args+=(--file "$DIFF_FILE")',
  '[ -n "${SPEC_FILE:-}" ] && _vg_args+=(--file "$SPEC_FILE")',
  '_vg_msg="$(node "$_REVIEW_SELF_DIR/lib/vision-guard.js" "${_vg_args[@]}" 2>&1 >/dev/null)" \\',
  '  || die_precondition "${_vg_msg:-vision-guard refused an image for engine ${RUNNER}/${MODEL} file ${DIFF_FILE}${SPEC_FILE:+ ${SPEC_FILE}}}"',
].join('\n');

const dirs = [];
function mk(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(MUTATION, { force: true });
});

function writeBytes(dir, name, bytes) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, bytes);
  return file;
}

function visionRow(runner, model, inputImage, evidence, eventId) {
  return {
    event_id: eventId,
    runner,
    model,
    capability: {
      vision: {
        input_image: inputImage,
        evidence,
        observed_at: '2026-11-12T00:00:00Z',
      },
    },
  };
}

function writeStore(dir, rows) {
  const file = path.join(dir, 'capability.jsonl');
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  return file;
}

function childEnv(extra) {
  const env = { ...process.env, ...extra };
  delete env.ENGINE_CAPABILITY_FILE;
  return env;
}

function baseEvent(extraCap) {
  return {
    schema_version: 1,
    observed_at: '2026-11-12T00:00:00Z',
    runner: 'grok',
    model: 'GLM-5.3',
    role: 'reviewer',
    capability: {
      quota: {
        status: 'available',
        confidence: 'high',
        ttl_seconds: 60,
        evidence: 'test evidence',
      },
      ...extraCap,
    },
  };
}

function recordEvent(dir, event) {
  return cp.spawnSync(process.execPath, [STATE_JS, 'record'], {
    input: JSON.stringify(event),
    encoding: 'utf8',
    env: childEnv({ ENGINE_CAPABILITY_DIR: dir }),
  });
}

test('magic bytes identify PNG JPEG GIF WEBP and BMP', () => {
  assert.strictEqual(magicIsImage(PNG), true);
  assert.strictEqual(magicIsImage(JPEG), true);
  assert.strictEqual(magicIsImage(GIF), true);
  assert.strictEqual(magicIsImage(Buffer.from('GIF87a', 'ascii')), true);
  assert.strictEqual(magicIsImage(WEBP), true);
  assert.strictEqual(BMP.length, 26);
  assert.deepStrictEqual([BMP[6], BMP[7], BMP[8], BMP[9]], [0, 0, 0, 0]);
  assert.strictEqual(magicIsImage(BMP), true);
  assert.strictEqual(magicIsImage(Buffer.from('this is plain text\n')), false);
  assert.strictEqual(magicIsImage(Buffer.alloc(0)), false);
  assert.strictEqual(magicIsImage(Buffer.from([0x89, 0x50, 0x4e, 0x47])), false);
  assert.strictEqual(magicIsImage(Buffer.from('BM', 'ascii')), false);
  assert.strictEqual(magicIsImage(Buffer.from([0x42, 0x4d, 0x00, 0x00, 0x00, 0x00])), false);
  assert.strictEqual(magicIsImage(Buffer.from('RIFF....WAVE', 'ascii')), false);
  assert.strictEqual(magicIsImage(Buffer.from('GIF notes\n', 'ascii')), false);
});

test('BMAD and BMW text are not images and pass for GLM-5.3', () => {
  // Negative control: revert the BMP check to the 2-byte form
  // (`buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d`) and this test is red.
  const texts = [
    'BMAD plan\n',
    'BMW fleet notes\n',
    'BMAD plan\n' + 'scope: text prompt, not a bitmap.\n',
  ];
  assert.ok(Buffer.byteLength(texts[2]) >= 26);
  for (const text of texts) {
    assert.strictEqual(magicIsImage(Buffer.from(text, 'utf8')), false, text);
    const dir = mk('vg-bmtext-');
    const file = writeBytes(dir, 'notes.txt', text);
    const result = guardVision({
      runner: 'grok',
      model: 'GLM-5.3',
      files: [file],
      capabilityStatePath: null,
    });
    assert.strictEqual(result.ok, true, text);
    assert.strictEqual(result.input_image, null, text);
  }
});

test('a real minimal BMP header is still refused for GLM-5.3', () => {
  const dir = mk('vg-bmp26-');
  const file = writeBytes(dir, 'tiny.bmp', BMP);
  const result = guardVision({
    runner: 'grok',
    model: 'GLM-5.3',
    files: [file],
    capabilityStatePath: null,
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.message, /GLM-5\.3/);
  assert.match(result.message, /input_image=unsupported/);
  assert.ok(result.message.includes(file));
});

test('RIFF WAVE is not an image', () => {
  assert.strictEqual(magicIsImage(Buffer.from('RIFF....WAVE', 'ascii')), false);
  const wave = Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0x24, 0x00, 0x00, 0x00]),
    Buffer.from('WAVE', 'ascii'),
  ]);
  assert.strictEqual(magicIsImage(wave), false);
  const dir = mk('vg-wave-');
  const file = writeBytes(dir, 'notes.txt', 'RIFF....WAVE');
  const result = guardVision({
    runner: 'grok',
    model: 'GLM-5.3',
    files: [file],
    capabilityStatePath: null,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.input_image, null);
});

test('PNG bytes as a spec file to GLM-5.3 are refused as unsupported', () => {
  const dir = mk('vg-glm-');
  const spec = writeBytes(dir, 'spec.png', PNG);
  const result = guardVision({
    runner: 'grok',
    model: 'GLM-5.3',
    files: [spec],
    capabilityStatePath: null,
  });
  assert.strictEqual(result.ok, false);
  assert.notStrictEqual(result.code, 0);
  assert.match(result.message, /GLM-5\.3/);
  assert.match(result.message, /input_image=unsupported/);
  assert.match(result.message, /silent drop observed/);
  assert.ok(result.message.includes(spec));
});

test('PNG bytes renamed to .txt are still refused', () => {
  const dir = mk('vg-ext-');
  const spec = writeBytes(dir, 'spec.txt', PNG);
  const result = guardVision({
    runner: 'anthropic-compatible',
    model: 'GLM-5.3',
    files: [spec],
    capabilityStatePath: null,
  });
  assert.strictEqual(result.ok, false);
  assert.match(result.message, /input_image=unsupported/);
  assert.ok(result.message.includes(spec));
});

test('an unknown engine with an image is refused', () => {
  const dir = mk('vg-unk-');
  const spec = writeBytes(dir, 'spec.png', PNG);
  const result = guardVision({
    runner: 'grok',
    model: 'no-such-model',
    files: [spec],
    capabilityStatePath: null,
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.input_image, 'unknown');
  assert.strictEqual(result.source, 'static-default');
  assert.match(result.message, /no-such-model/);
  assert.match(result.message, /input_image=unknown/);
  assert.ok(result.message.includes(spec));
});

test('a .txt renamed .png passes because detection is magic bytes', () => {
  const dir = mk('vg-txt-');
  const spec = writeBytes(dir, 'notes.png', 'this is plain text, not an image\n');
  const result = guardVision({
    runner: 'grok',
    model: 'GLM-5.3',
    files: [spec],
    capabilityStatePath: null,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.input_image, null);
});

test('JPEG GIF WEBP and BMP are refused for GLM-5.3', () => {
  for (const [name, bytes] of [['a.jpg', JPEG], ['a.gif', GIF], ['a.webp', WEBP], ['a.bmp', BMP]]) {
    const dir = mk('vg-fmt-');
    const spec = writeBytes(dir, name, bytes);
    const result = guardVision({
      runner: 'grok',
      model: 'GLM-5.3',
      files: [spec],
      capabilityStatePath: null,
    });
    assert.strictEqual(result.ok, false, name);
    assert.match(result.message, /input_image=unsupported/);
  }
});

test('a directory is not an image and a missing file fails closed', () => {
  const dir = mk('vg-io-');
  const asDir = guardVision({
    runner: 'grok',
    model: 'GLM-5.3',
    files: [dir],
    capabilityStatePath: null,
  });
  assert.strictEqual(asDir.ok, true);
  const missing = path.join(dir, 'gone.png');
  const unread = guardVision({
    runner: 'grok',
    model: 'GLM-5.3',
    files: [missing],
    capabilityStatePath: null,
  });
  assert.strictEqual(unread.ok, false);
  assert.match(unread.message, /GLM-5\.3/);
  assert.ok(unread.message.includes(missing));
});

test('text inputs do not refuse GLM-5.3', () => {
  const dir = mk('vg-text-');
  const diff = writeBytes(dir, 'diff.txt', 'diff --git a/a b/a\n+hello\n');
  const result = guardVision({
    runner: 'grok',
    model: 'GLM-5.3',
    files: [diff],
    capabilityStatePath: null,
  });
  assert.strictEqual(result.ok, true);
});

test('empty --model with a text file is ok', () => {
  // Negative control: move the runner/model check back above classification
  // in guardVision and this test is red (code 2, "--runner and --model are required").
  const dir = mk('vg-empty-model-text-');
  const file = writeBytes(dir, 'notes.txt', 'plain text, not an image\n');
  const result = guardVision({
    runner: 'grok',
    model: '',
    files: [file],
    capabilityStatePath: null,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.code, 0);
  assert.strictEqual(result.input_image, null);
  const cli = cp.spawnSync(process.execPath, [
    GUARD_JS, '--runner', 'grok', '--model', '', '--file', file,
  ], { encoding: 'utf8', env: childEnv({ ENGINE_CAPABILITY_DIR: dir }) });
  assert.strictEqual(cli.status, 0, cli.stderr);
  assert.strictEqual(cli.stdout, '');
});

test('empty --model with a PNG is refused', () => {
  const dir = mk('vg-empty-model-png-');
  const file = writeBytes(dir, 'shot.png', PNG);
  const result = guardVision({
    runner: 'grok',
    model: '',
    files: [file],
    capabilityStatePath: null,
  });
  assert.strictEqual(result.ok, false);
  assert.notStrictEqual(result.code, 0);
  assert.ok(result.message.includes(file), result.message);
  assert.match(result.message, /runner and model required/);
  const cli = cp.spawnSync(process.execPath, [
    GUARD_JS, '--runner', 'grok', '--model', '', '--file', file,
  ], { encoding: 'utf8', env: childEnv({ ENGINE_CAPABILITY_DIR: dir }) });
  assert.notStrictEqual(cli.status, 0, cli.stderr);
  assert.ok(cli.stderr.includes(file), cli.stderr);
});

test('empty --file with a text file is ok and a missing path is refused', () => {
  const dir = mk('vg-empty-file-');
  const text = writeBytes(dir, 'notes.txt', 'plain text, not an image\n');
  const skipped = guardVision({
    runner: 'grok',
    model: '',
    files: ['', text],
    capabilityStatePath: null,
  });
  assert.strictEqual(skipped.ok, true);
  assert.strictEqual(skipped.code, 0);
  const cli = cp.spawnSync(process.execPath, [
    GUARD_JS, '--runner', 'grok', '--model', '', '--file', '', '--file', text,
  ], { encoding: 'utf8', env: childEnv({ ENGINE_CAPABILITY_DIR: dir }) });
  assert.strictEqual(cli.status, 0, cli.stderr);

  const missing = path.join(dir, 'no-such-input.txt');
  const unread = guardVision({
    runner: 'grok',
    model: '',
    files: ['', missing],
    capabilityStatePath: null,
  });
  assert.strictEqual(unread.ok, false);
  assert.strictEqual(unread.code, 1);
  assert.ok(unread.message.includes(missing), unread.message);
  const cliMissing = cp.spawnSync(process.execPath, [
    GUARD_JS, '--runner', 'grok', '--model', '', '--file', missing,
  ], { encoding: 'utf8', env: childEnv({ ENGINE_CAPABILITY_DIR: dir }) });
  assert.notStrictEqual(cliMissing.status, 0, cliMissing.stderr);
  assert.ok(cliMissing.stderr.includes(missing), cliMissing.stderr);
});

test('a supported engine with an image passes via capability state', () => {
  const dir = mk('vg-sup-');
  const spec = writeBytes(dir, 'spec.png', PNG);
  const store = writeStore(dir, [
    visionRow('grok', 'some-vision-model', 'supported', 'fixture: image input accepted', 1),
  ]);
  const result = guardVision({
    runner: 'grok',
    model: 'some-vision-model',
    files: [spec],
    capabilityStatePath: store,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.input_image, 'supported');
  assert.strictEqual(result.source, 'capability-state');
});

test('capability-state override wins over the static unsupported default', () => {
  const dir = mk('vg-over-');
  const spec = writeBytes(dir, 'spec.png', PNG);
  const store = writeStore(dir, [
    visionRow('anthropic-compatible', 'GLM-5.3', 'supported', 'fixture override: declared supported', 1),
  ]);
  const result = guardVision({
    runner: 'anthropic-compatible',
    model: 'GLM-5.3',
    files: [spec],
    capabilityStatePath: store,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.source, 'capability-state');
  assert.strictEqual(result.input_image, 'supported');
  assert.match(result.evidence, /fixture override/);
});

test('an explicit unknown in capability state overrides static unsupported and still refuses', () => {
  const dir = mk('vg-unk-over-');
  const spec = writeBytes(dir, 'spec.png', PNG);
  const store = writeStore(dir, [
    visionRow('grok', 'GLM-5.3', 'unknown', 'fixture: observation withdrawn', 1),
  ]);
  const result = guardVision({
    runner: 'grok',
    model: 'GLM-5.3',
    files: [spec],
    capabilityStatePath: store,
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.input_image, 'unknown');
  assert.strictEqual(result.source, 'capability-state');
  assert.match(result.message, /observation withdrawn/);
});

test('a malformed vision row does not override the static default', () => {
  const dir = mk('vg-badrow-');
  const spec = writeBytes(dir, 'spec.png', PNG);
  const store = writeStore(dir, [{
    event_id: 9,
    runner: 'grok',
    model: 'GLM-5.3',
    capability: { vision: { input_image: 'sometimes', evidence: 'no', observed_at: '2026-11-12T00:00:00Z' } },
  }]);
  const result = guardVision({
    runner: 'grok',
    model: 'GLM-5.3',
    files: [spec],
    capabilityStatePath: store,
  });
  assert.strictEqual(result.input_image, 'unsupported');
  assert.strictEqual(result.source, 'static');
  assert.match(result.evidence, /silent drop observed/);
});

test('the highest event_id wins, then the later line', () => {
  const dir = mk('vg-latest-');
  const spec = writeBytes(dir, 'spec.png', PNG);
  const store = writeStore(dir, [
    visionRow('grok', 'some-vision-model', 'supported', 'older supported', 5),
    visionRow('grok', 'some-vision-model', 'unsupported', 'later but lower id', 2),
  ]);
  const higher = guardVision({
    runner: 'grok',
    model: 'some-vision-model',
    files: [spec],
    capabilityStatePath: store,
  });
  assert.strictEqual(higher.ok, true);
  assert.match(higher.evidence, /older supported/);

  const tied = writeStore(dir, [
    visionRow('grok', 'some-vision-model', 'supported', 'first', 4),
    visionRow('grok', 'some-vision-model', 'unsupported', 'later same id', 4),
  ]);
  const later = guardVision({
    runner: 'grok',
    model: 'some-vision-model',
    files: [spec],
    capabilityStatePath: tied,
  });
  assert.strictEqual(later.ok, false);
  assert.match(later.evidence, /later same id/);
});

test('Qwen3.8-27B-QUASAR-NVFP4 static row is unsupported and load-bearing', () => {
  const dir = mk('vg-qwen-');
  const spec = writeBytes(dir, 'spec.png', PNG);
  const result = guardVision({
    runner: 'anthropic-compatible',
    model: 'Qwen3.8-27B-QUASAR-NVFP4',
    files: [spec],
    capabilityStatePath: null,
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.input_image, 'unsupported');
  assert.strictEqual(result.source, 'static');
  assert.match(result.evidence, /local server rejects image input with HTTP 500/);
});

test('deepseek-v4* static row is unsupported', () => {
  // matchPattern splits on the first slash: runner glob "*", model glob "deepseek-v4*".
  const dir = mk('vg-ds-');
  const spec = writeBytes(dir, 'spec.png', PNG);
  for (const model of ['deepseek-v4-pro', 'deepseek-v4.1-flash']) {
    const result = guardVision({
      runner: 'opencode',
      model,
      files: [spec],
      capabilityStatePath: null,
    });
    assert.strictEqual(result.ok, false, model);
    assert.strictEqual(result.input_image, 'unsupported', model);
    assert.strictEqual(result.source, 'static', model);
    assert.match(result.evidence, /HTTP 400 for image input/);
    assert.ok(result.message.includes(spec), model);
  }
  const other = guardVision({
    runner: 'opencode',
    model: 'deepseek-v3',
    files: [spec],
    capabilityStatePath: null,
  });
  assert.strictEqual(other.input_image, 'unknown');
  assert.strictEqual(other.source, 'static-default');
});

test('the first image file is the one named in the refusal', () => {
  const dir = mk('vg-first-');
  const diff = writeBytes(dir, 'diff.txt', 'plain diff\n');
  const spec = writeBytes(dir, 'spec.png', PNG);
  const result = guardVision({
    runner: 'grok',
    model: 'GLM-5.3',
    files: [diff, spec],
    capabilityStatePath: null,
  });
  assert.strictEqual(result.file, spec);
});

test('CLI refuses a PNG for GLM-5.3 on stderr and exits non-zero', () => {
  const dir = mk('vg-cli-');
  const spec = writeBytes(dir, 'spec.png', PNG);
  const res = cp.spawnSync(process.execPath, [
    GUARD_JS, '--runner', 'grok', '--model', 'GLM-5.3', '--file', spec,
  ], {
    encoding: 'utf8',
    env: childEnv({ ENGINE_CAPABILITY_DIR: dir }),
  });
  assert.strictEqual(res.status, 1, res.stderr);
  assert.strictEqual(res.stdout, '');
  assert.match(res.stderr, /GLM-5\.3/);
  assert.match(res.stderr, /input_image=unsupported/);
  assert.match(res.stderr, /silent drop observed/);
  assert.ok(res.stderr.includes(spec));
});

test('CLI usage is exit 2', () => {
  // No files and an empty model is not usage: there is no image, so the guard
  // allows it. A flag the parser does not know is still usage.
  const bare = cp.spawnSync(process.execPath, [GUARD_JS], { encoding: 'utf8' });
  assert.strictEqual(bare.status, 0, bare.stderr);
  const res = cp.spawnSync(process.execPath, [GUARD_JS, '--nope'], { encoding: 'utf8' });
  assert.strictEqual(res.status, 2);
  assert.match(res.stderr, /unknown argument/);
});

test('record accepts vision and rejects a bad vision object', () => {
  const ok = recordEvent(mk('vg-rec-'), baseEvent({
    vision: {
      input_image: 'unsupported',
      evidence: 'text-only',
      observed_at: '2026-11-12T00:00:00Z',
    },
  }));
  assert.strictEqual(ok.status, 0, ok.stderr);

  const badEnum = recordEvent(mk('vg-rec-'), baseEvent({
    vision: { input_image: 'sometimes', evidence: 'x', observed_at: '2026-11-12T00:00:00Z' },
  }));
  assert.strictEqual(badEnum.status, 1, badEnum.stderr);
  assert.match(badEnum.stderr, /input_image/);

  const missingEvidence = recordEvent(mk('vg-rec-'), baseEvent({
    vision: { input_image: 'unknown', evidence: '', observed_at: '2026-11-12T00:00:00Z' },
  }));
  assert.strictEqual(missingEvidence.status, 1, missingEvidence.stderr);
  assert.match(missingEvidence.stderr, /evidence/);

  const badTime = recordEvent(mk('vg-rec-'), baseEvent({
    vision: { input_image: 'unknown', evidence: 'x', observed_at: 'yesterday' },
  }));
  assert.strictEqual(badTime.status, 1, badTime.stderr);
  assert.match(badTime.stderr, /observed_at/);

  const noVision = recordEvent(mk('vg-rec-'), baseEvent({}));
  assert.strictEqual(noVision.status, 0, noVision.stderr);

  const unknownKey = recordEvent(mk('vg-rec-'), baseEvent({ nope: true }));
  assert.strictEqual(unknownKey.status, 1, unknownKey.stderr);
  assert.match(unknownKey.stderr, /unknown key in capability: nope/);
});

test('all-text content blocks pass without reading a store', () => {
  const result = refuseNonTextBlocks({
    runner: 'anthropic-compatible',
    model: 'GLM-5.3',
    blocks: [{ type: 'text', text: 'hi' }],
    capabilityStatePath: null,
  });
  assert.strictEqual(result.ok, true);
});

test('a non-text content block to GLM-5.3 is refused', () => {
  const result = refuseNonTextBlocks({
    runner: 'anthropic-compatible',
    model: 'GLM-5.3',
    blocks: [{ type: 'image', source: { path: 'shot.png' } }],
    capabilityStatePath: null,
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, 'VISION_REFUSED');
  assert.match(result.message, /GLM-5\.3/);
  assert.match(result.message, /shot\.png/);
  assert.match(result.message, /input_image=unsupported/);
});

test('a non-text content block passes when capability state says supported', () => {
  const dir = mk('vg-block-');
  const store = writeStore(dir, [
    visionRow('anthropic-compatible', 'vision-model', 'supported', 'fixture: blocks accepted', 1),
  ]);
  const result = refuseNonTextBlocks({
    runner: 'anthropic-compatible',
    model: 'vision-model',
    blocks: [{ type: 'image' }],
    capabilityStatePath: store,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.input_image, 'supported');
});

test('dispatch-anthropic-review.js refuses non-text blocks before the HTTP request', () => {
  const src = fs.readFileSync(path.join(__dirname, 'dispatch-anthropic-review.js'), 'utf8');
  const callAt = src.indexOf('refuseNonTextBlocks({');
  const reqAt = src.indexOf('transport.request');
  assert.ok(callAt > 0, 'refuseNonTextBlocks call missing');
  assert.ok(reqAt > callAt, 'guard must run before transport.request');
  assert.ok(src.includes("err.code === 'VISION_REFUSED'"));
  const dieAt = src.indexOf('diePrecondition(model, err.message)');
  assert.ok(dieAt > reqAt);
});

test('hetero, author, and consult call the guard on their input files', () => {
  const hetero = fs.readFileSync(path.join(__dirname, 'dispatch-hetero.sh'), 'utf8');
  const author = fs.readFileSync(path.join(__dirname, 'dispatch-author.sh'), 'utf8');
  const consult = fs.readFileSync(path.join(__dirname, 'dispatch-consult.sh'), 'utf8');
  assert.ok(hetero.includes('VISION_PROMPT_FILE="$PROMPT_FILE"'));
  assert.ok(hetero.indexOf('VISION_PROMPT_FILE="$PROMPT_FILE"') < hetero.indexOf('lib/vision-guard.js'));
  assert.ok(hetero.includes('current_runner_name'));
  assert.ok(hetero.includes('[ -n "${VISION_PROMPT_FILE:-}" ] && _vg_args+=(--file "$VISION_PROMPT_FILE")'));
  assert.ok(!hetero.includes('--model "$MODEL" --file "$VISION_PROMPT_FILE"'));
  assert.ok(author.includes('lib/vision-guard.js'));
  assert.ok(author.includes('[ -n "${PROMPT_FILE:-}" ] && _vg_args+=(--file "$PROMPT_FILE")'));
  assert.ok(!author.includes('--model "$MODEL" --file "$PROMPT_FILE"'));
  assert.ok(consult.includes('lib/vision-guard.js'));
  assert.ok(consult.includes('vision_refused'));
  assert.ok(consult.includes('[ -n "${QUESTION_FILE:-}" ] && _vg_args+=(--file "$QUESTION_FILE")'));
  assert.ok(consult.includes('[ -n "${PROMPT_FILE:-}" ] && _vg_args+=(--file "$PROMPT_FILE")'));
  assert.ok(consult.includes('${ARTIFACTS[@]+"${ARTIFACTS[@]}"}'));
  assert.ok(!consult.includes('for _a in "${ARTIFACTS[@]}";'));
  const review = fs.readFileSync(REVIEW_SH, 'utf8');
  assert.ok(review.includes('[ -n "${DIFF_FILE:-}" ] && _vg_args+=(--file "$DIFF_FILE")'));
  assert.ok(!review.includes('--model "$MODEL" --file "$DIFF_FILE"'));
});

function writeStub(dir) {
  const marker = path.join(dir, 'called');
  const stub = path.join(dir, 'stub.sh');
  fs.writeFileSync(
    stub,
    `#!/bin/sh\necho called >> ${JSON.stringify(marker)}\necho stub-ran\nexit 0\n`,
    { mode: 0o755 },
  );
  return { stub, marker };
}

function runReview(script, dir, spec, stub) {
  const diff = path.join(dir, 'diff.txt');
  fs.writeFileSync(diff, 'diff --git a/a b/a\n+hello\n');
  const cap = path.join(dir, 'empty-cap');
  fs.mkdirSync(cap, { recursive: true });
  return cp.spawnSync('bash', [
    script,
    '--runner', 'grok',
    '--model', 'GLM-5.3',
    '--bin', stub,
    '--diff-file', diff,
    '--spec-file', spec,
    '--timeout', '5s',
    '--effort', 'low',
  ], {
    encoding: 'utf8',
    cwd: ROOT,
    timeout: 40000,
    env: childEnv({
      DISPATCH_QUIET: '1',
      DISPATCH_DETACH: '0',
      AUTOPILOT_GROK_EFFORT_PROBE: '0',
      AUTOPILOT_DISPATCH_USAGE: 'off',
      AUTOPILOT_RUNNER_HOME_FALLBACK: 'off',
      AUTOPILOT_EMPTY_GRACE_MS: '200',
      AUTOPILOT_SETTLE_MS: '1000',
      AUTOPILOT_STABLE_POLLS: '1',
      ENGINE_CAPABILITY_DIR: cap,
      TMPDIR: dir,
    }),
  });
}

test('dispatch-review.sh refuses a PNG spec before the stub runner', { timeout: 40000 }, () => {
  const dir = mk('vg-wire-');
  const spec = writeBytes(dir, 'spec.png', PNG);
  const { stub, marker } = writeStub(dir);
  const res = runReview(REVIEW_SH, dir, spec, stub);
  const combined = `${res.stdout || ''}\n${res.stderr || ''}`;
  assert.notStrictEqual(res.status, 0, combined);
  assert.ok(!fs.existsSync(marker), `stub was invoked:\n${combined}`);
  assert.match(combined, /GLM-5\.3/);
  assert.ok(combined.includes(spec), combined);
  assert.match(combined, /input_image=unsupported/);
  assert.match(combined, /silent drop observed/);
  assert.match(combined, /precondition_failed/);
});

test('negative control: removing the guard call makes the wired test red', { timeout: 40000 }, () => {
  // Removing the vision-guard.js call in dispatch-review.sh makes the wired
  // test red: the stub runner is invoked and writes its marker.
  const src = fs.readFileSync(REVIEW_SH, 'utf8');
  assert.strictEqual(src.split(REVIEW_GUARD).length - 1, 1, 'guard block missing or duplicated');
  const mutated = src.replace(REVIEW_GUARD, '# vision-guard call removed by negative control');
  assert.notStrictEqual(mutated, src);
  assert.ok(!mutated.includes('lib/vision-guard.js'));
  fs.writeFileSync(MUTATION, mutated);
  try {
    const dir = mk('vg-mut-');
    const spec = writeBytes(dir, 'spec.png', PNG);
    const { stub, marker } = writeStub(dir);
    const res = runReview(MUTATION, dir, spec, stub);
    const combined = `${res.stdout || ''}\n${res.stderr || ''}`;
    assert.ok(
      fs.existsSync(marker),
      `RED(vision-guard): removing the guard call must invoke the stub before this can go green.\n${combined}`,
    );
  } finally {
    fs.rmSync(MUTATION, { force: true });
  }
});

function railEnv(dir, extra) {
  const cap = path.join(dir, 'cap');
  const mode = path.join(dir, 'mode');
  fs.mkdirSync(cap, { recursive: true });
  fs.mkdirSync(mode, { recursive: true });
  const env = childEnv({
    DISPATCH_QUIET: '1',
    DISPATCH_DETACH: '0',
    AUTOPILOT_GROK_EFFORT_PROBE: '0',
    AUTOPILOT_DISPATCH_USAGE: 'off',
    AUTOPILOT_RUNNER_HOME_FALLBACK: 'off',
    AUTOPILOT_EMPTY_GRACE_MS: '200',
    AUTOPILOT_SETTLE_MS: '1000',
    AUTOPILOT_STABLE_POLLS: '1',
    ENGINE_CAPABILITY_DIR: cap,
    AUTOPILOT_SESSION_MODE_DIR: mode,
    TMPDIR: dir,
    ...extra,
  });
  for (const key of [
    'AUTOPILOT_PARENT_RUN_ID',
    'AUTOPILOT_ROOT_RUN_ID',
    'AUTOPILOT_WORKTREE_ROOT_RUN_ID',
    'AUTOPILOT_PARENT_SESSION_ID',
    'AUTOPILOT_DISPATCH_DEPTH',
    'AUTOPILOT_MISSION_ROOT_RUN_ID',
    'AUTOPILOT_CONTINUATION_CHECKPOINT',
    'AUTOPILOT_CONTINUATION_DURABLE',
    'AUTOPILOT_CONTINUATION_STRICT',
    'AUTOPILOT_RECONCILE_RECEIPT',
  ]) delete env[key];
  return env;
}

function initRepo(dir) {
  const git = (args) => {
    // test-identity-guard: an argv 'commit' in a *.test.js must carry its own identity.
    const res = cp.spawnSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...railEnv(dir),
        GIT_AUTHOR_NAME: 'vision-guard-test',
        GIT_AUTHOR_EMAIL: 'vision-guard-test@example.invalid',
        GIT_COMMITTER_NAME: 'vision-guard-test',
        GIT_COMMITTER_EMAIL: 'vision-guard-test@example.invalid',
      },
    });
    assert.strictEqual(res.status, 0, `${args.join(' ')}\n${res.stderr || ''}`);
  };
  git(['init', '-q', '-b', 'develop']);
  git(['commit', '-q', '--allow-empty', '-m', 'base']);
}

function assertRefused(res, marker, engine, file) {
  const combined = `${res.stdout || ''}\n${res.stderr || ''}`;
  assert.notStrictEqual(res.status, 0, combined);
  assert.ok(!fs.existsSync(marker), `stub was invoked:\n${combined}`);
  assert.match(combined, engine, combined);
  assert.ok(combined.includes(file), combined);
  assert.match(combined, /vision-guard:/, combined);
  assert.match(combined, /input_image=unsupported/, combined);
  return combined;
}

test('dispatch-hetero.sh refuses a PNG prompt before the stub runner', { timeout: 40000 }, () => {
  // Replacing `|| die_precondition ...` after the vision-guard call with `|| true`
  // makes this test red: the refusal is swallowed and the stub runner is invoked.
  const dir = mk('vg-hetero-');
  initRepo(dir);
  const prompt = writeBytes(dir, 'prompt.png', PNG);
  const { stub, marker } = writeStub(dir);
  const res = cp.spawnSync('bash', [
    HETERO_SH,
    '--runner', 'grok',
    '--model', 'GLM-5.3',
    '--grok-bin', stub,
    '--prompt-file', prompt,
    '--branch', 'vg-hetero-png',
    '--effort', 'low',
    '--timeout', '5s',
    '--context-window', 'off',
    '--scaffold-tier', 'off',
  ], {
    encoding: 'utf8',
    cwd: dir,
    timeout: 40000,
    env: railEnv(dir),
  });
  assertRefused(res, marker, /grok\/GLM-5\.3/, prompt);
});

test('dispatch-author.sh refuses a PNG prompt before the stub runner', { timeout: 40000 }, () => {
  // Replacing `|| die_precondition ...` after the vision-guard call with `|| true`
  // makes this test red: the refusal is swallowed and the stub runner is invoked.
  const dir = mk('vg-author-');
  const prompt = writeBytes(dir, 'prompt.png', PNG);
  const { stub, marker } = writeStub(dir);
  const res = cp.spawnSync('bash', [
    AUTHOR_SH,
    '--runner', 'grok',
    '--model', 'GLM-5.3',
    '--bin', stub,
    '--prompt-file', prompt,
    '--timeout', '5s',
    '--effort', 'low',
    '--context-window', 'off',
  ], {
    encoding: 'utf8',
    cwd: ROOT,
    timeout: 40000,
    env: railEnv(dir),
  });
  assertRefused(res, marker, /grok\/GLM-5\.3/, prompt);
});

test('dispatch-consult.sh refuses a PNG question before the stub runner', { timeout: 40000 }, () => {
  // Replacing the vision-guard failure branch (`|| { echo; emit vision_refused; }`)
  // with `|| true` makes this test red: the refusal is swallowed and the stub
  // author rail is invoked.
  const dir = mk('vg-consult-');
  const question = writeBytes(dir, 'question.png', PNG);
  const artifact = writeBytes(dir, 'artifact.diff', 'diff --git a/a b/a\n+hello\n');
  const { stub, marker } = writeStub(dir);
  const cfg = path.join(dir, 'consult.md');
  fs.writeFileSync(cfg, [
    '- override: consult | until 2099-01-01 | vision-guard fixture',
    '- consult_engine: GLM-5.3',
    '- consult_runner: grok',
    '- consult_effort: low',
    '- consult_dispatch: on',
    '',
  ].join('\n'));
  const override = path.join(dir, 'override.json');
  fs.writeFileSync(override, JSON.stringify({
    schema: 1,
    overrides: [{
      engine: 'GLM-5.3',
      runner: 'grok',
      role: 'consult',
      reason: 'vision-guard fixture',
      operator: 'vision-guard.test',
      expires: '2099-01-01',
    }],
  }));
  const res = cp.spawnSync('bash', [
    CONSULT_SH,
    '--question-file', question,
    '--artifact', artifact,
    '--repo-root', dir,
    '--dispatch-author-bin', stub,
    '--timeout', '5s',
  ], {
    encoding: 'utf8',
    cwd: ROOT,
    timeout: 40000,
    env: railEnv(dir, {
      REVIEW_LOOP_CONFIG_OVERRIDE: cfg,
      AUTOPILOT_QUALIFICATION_OVERRIDE: override,
    }),
  });
  assertRefused(res, marker, /grok\/GLM-5\.3/, question);
  assert.match(`${res.stdout || ''}`, /vision_refused/);
});
