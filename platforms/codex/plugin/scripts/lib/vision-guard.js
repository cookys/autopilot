#!/usr/bin/env node
// vision-guard.js — fail-closed image gate for a dispatch.
//
// An engine accepts image input only when its vision capability is "supported".
// Static defaults live in engine-vision.json (anything not listed is unknown).
// A capability.vision row in the engine capability JSONL overrides that default.
// unknown refuses: fail closed.
//
// Detection is magic bytes (PNG, JPEG, GIF, WEBP, BMP), not the file extension.
// Text is never an image. BMP needs "BM", a header of at least 26 bytes, and
// reserved bytes 6..9 all NUL. WEBP needs "RIFF" at 0 and "WEBP" at 8.
// Images are detected before the capability store is opened, so a text dispatch
// does not read the store.
//
// CLI:
//   node scripts/lib/vision-guard.js --runner <r> --model <m> --file <path> [--file <path> ...]
//     [--capability-state <jsonl>] [--static-table <json>]
// Exit: 0 allow (no stdout). 1 refuse (reason on stderr; names the engine and the file).
//       2 usage.
//
// Library: guardVision({ runner, model, files, capabilityStatePath, staticTablePath })
//          refuseNonTextBlocks({ runner, model, blocks, capabilityStatePath, staticTablePath })
// capabilityStatePath null or false skips the store. Omit it to resolve
// ENGINE_CAPABILITY_FILE, else ENGINE_CAPABILITY_DIR/capability.jsonl (even when
// that file is absent — no home fallback once the dir env is set), else the
// default engine capability store.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const VISION_STATES = new Set(['supported', 'unsupported', 'unknown']);

function defaultStaticTablePath() {
  return path.join(__dirname, 'engine-vision.json');
}

function defaultCapabilityStatePath() {
  if (process.env.ENGINE_CAPABILITY_FILE) return process.env.ENGINE_CAPABILITY_FILE;
  if (process.env.ENGINE_CAPABILITY_DIR) {
    return path.join(process.env.ENGINE_CAPABILITY_DIR, 'capability.jsonl');
  }
  return path.join(os.homedir(), '.autopilot', 'engine-capability', 'capability.jsonl');
}

// BMP's reserved NULs sit at bytes 6..9 of a header that is at least 26 bytes
// (BITMAPFILEHEADER + BITMAPCOREHEADER). The file sniff must cover that window.
const MAGIC_SNIFF_LEN = 26;

function startsWithAscii(buf, offset, text) {
  if (buf.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i += 1) {
    if (buf[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

function magicIsImage(buf) {
  // PNG and JPEG begin with non-text bytes, so a text file cannot match them.
  if (buf.length >= 8
      && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
      && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
    return true;
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  // Full token only. "GIF" alone is text ("GIF notes"), not an image.
  if (startsWithAscii(buf, 0, 'GIF87a') || startsWithAscii(buf, 0, 'GIF89a')) return true;
  // "RIFF" at 0 is shared with WAVE and AVI. An image also needs "WEBP" at 8.
  if (startsWithAscii(buf, 0, 'RIFF') && startsWithAscii(buf, 8, 'WEBP')) return true;
  // "BM" alone is text ("BMAD", "BMW"). Real BMPs store NUL in reserved bytes 6..9.
  if (buf.length >= MAGIC_SNIFF_LEN
      && buf[0] === 0x42 && buf[1] === 0x4d
      && buf[6] === 0x00 && buf[7] === 0x00 && buf[8] === 0x00 && buf[9] === 0x00) {
    return true;
  }
  return false;
}

function classifyFile(filePath) {
  let fd;
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile()) return { image: false };
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(MAGIC_SNIFF_LEN);
    const n = fs.readSync(fd, buf, 0, MAGIC_SNIFF_LEN, 0);
    return { image: magicIsImage(buf.subarray(0, n)) };
  } catch (err) {
    return { error: err && err.message ? err.message : String(err) };
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_err) { /* close of a failed scan */ }
    }
  }
}

function escapeRegex(text) {
  return text.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globMatch(pattern, value) {
  const re = new RegExp(`^${pattern.split('*').map(escapeRegex).join('.*')}$`);
  return re.test(value);
}

function matchPattern(pattern, runner, model) {
  const slash = pattern.indexOf('/');
  if (slash < 0) return false;
  return globMatch(pattern.slice(0, slash), runner) && globMatch(pattern.slice(slash + 1), model);
}

function starCount(pattern) {
  let n = 0;
  for (const ch of pattern) if (ch === '*') n += 1;
  return n;
}

function loadStatic(tablePath) {
  let raw;
  try {
    raw = fs.readFileSync(tablePath, 'utf8');
  } catch (_err) {
    return { ok: false, evidence: 'static vision table unreadable' };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_err) {
    return { ok: false, evidence: 'static vision table unreadable' };
  }
  const entries = [];
  if (parsed && Array.isArray(parsed.entries)) {
    for (const entry of parsed.entries) {
      if (!entry || typeof entry !== 'object') continue;
      if (typeof entry.pattern !== 'string' || !VISION_STATES.has(entry.input_image)) continue;
      entries.push(entry);
    }
  }
  const fallback = parsed && VISION_STATES.has(parsed.default_input_image)
    ? parsed.default_input_image
    : 'unknown';
  return { ok: true, entries, default_input_image: fallback };
}

function staticVision(table, runner, model) {
  if (!table.ok) {
    return { input_image: 'unknown', evidence: table.evidence, source: 'static-unreadable' };
  }
  let best = null;
  let bestStars = Infinity;
  for (const entry of table.entries) {
    if (!matchPattern(entry.pattern, runner, model)) continue;
    const stars = starCount(entry.pattern);
    if (stars < bestStars) {
      best = entry;
      bestStars = stars;
    }
  }
  if (!best) {
    return {
      input_image: table.default_input_image,
      evidence: `no static vision row; default ${table.default_input_image}`,
      source: 'static-default',
    };
  }
  const evidence = typeof best.evidence === 'string' && best.evidence
    ? best.evidence
    : 'static vision row';
  return { input_image: best.input_image, evidence, source: 'static' };
}

function visionFromStore(filePath, runner, model) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    return {
      input_image: 'unknown',
      evidence: 'capability state unreadable',
      source: 'capability-state-unreadable',
    };
  }
  let best = null;
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch (_err) {
      continue;
    }
    if (!event || typeof event !== 'object') continue;
    if (event.runner !== runner || event.model !== model) continue;
    const vision = event.capability && event.capability.vision;
    if (!vision || typeof vision !== 'object' || Array.isArray(vision)) continue;
    if (!VISION_STATES.has(vision.input_image)) continue;
    const id = Number.isInteger(event.event_id) ? event.event_id : -1;
    if (!best || id > best.id || (id === best.id && i > best.line)) {
      best = { id, line: i, vision };
    }
  }
  if (!best) return null;
  const evidence = typeof best.vision.evidence === 'string' && best.vision.evidence
    ? best.vision.evidence
    : 'capability state vision row';
  return {
    input_image: best.vision.input_image,
    evidence,
    source: 'capability-state',
    observed_at: best.vision.observed_at,
  };
}

function resolveStatePath(capabilityStatePath) {
  if (capabilityStatePath === null || capabilityStatePath === false) return null;
  if (typeof capabilityStatePath === 'string') return capabilityStatePath;
  return defaultCapabilityStatePath();
}

function resolveVision(runner, model, capabilityStatePath, staticTablePath) {
  const table = loadStatic(staticTablePath || defaultStaticTablePath());
  let resolved = staticVision(table, runner, model);
  const statePath = resolveStatePath(capabilityStatePath);
  if (statePath) {
    const fromStore = visionFromStore(statePath, runner, model);
    if (fromStore) resolved = fromStore;
  }
  return resolved;
}

function engineLabel(runner, model) {
  return `${runner}/${model}`;
}

function guardVision(opts) {
  const runner = opts && opts.runner;
  const model = opts && opts.model;
  if (typeof runner !== 'string' || !runner || typeof model !== 'string' || !model) {
    return { ok: false, code: 2, message: 'vision-guard: --runner and --model are required' };
  }
  const files = opts && Array.isArray(opts.files) ? opts.files : [];
  const images = [];
  for (const file of files) {
    const found = classifyFile(file);
    if (found.error) {
      return {
        ok: false,
        code: 1,
        message: `vision-guard: refusing unreadable input ${file} for engine ${engineLabel(runner, model)}: ${found.error}`,
        file,
      };
    }
    if (found.image) images.push(file);
  }
  if (images.length === 0) return { ok: true, code: 0, input_image: null, images: [] };
  const resolved = resolveVision(runner, model, opts.capabilityStatePath, opts.staticTablePath);
  if (resolved.input_image === 'supported') {
    return {
      ok: true,
      code: 0,
      input_image: 'supported',
      evidence: resolved.evidence,
      source: resolved.source,
      images,
    };
  }
  const file = images[0];
  const message = `vision-guard: refusing image ${file} for engine ${engineLabel(runner, model)} (input_image=${resolved.input_image}): ${resolved.evidence}`;
  return {
    ok: false,
    code: 1,
    message,
    input_image: resolved.input_image,
    evidence: resolved.evidence,
    source: resolved.source,
    file,
    images,
  };
}

function blockId(block, index) {
  if (!block || typeof block !== 'object') return `content-block[${index}]`;
  const source = block.source;
  const named = (source && (source.path || source.url)) || block.file || block.path;
  if (named) return String(named);
  return `content-block[${index}]:${block.type || 'unknown'}`;
}

function refuseNonTextBlocks(opts) {
  const runner = opts && opts.runner;
  const model = opts && opts.model;
  const blocks = opts && Array.isArray(opts.blocks) ? opts.blocks : [];
  const nonText = [];
  blocks.forEach((block, index) => {
    if (!block || typeof block !== 'object' || block.type !== 'text') {
      nonText.push(blockId(block, index));
    }
  });
  if (nonText.length === 0) return { ok: true, code: 0 };
  if (typeof runner !== 'string' || !runner || typeof model !== 'string' || !model) {
    const message = `vision-guard: refusing non-text content ${nonText[0]} for engine (runner and model required)`;
    const error = new Error(message);
    error.code = 'VISION_REFUSED';
    return { ok: false, code: 2, message, error };
  }
  const resolved = resolveVision(
    runner,
    model,
    opts.capabilityStatePath,
    opts.staticTablePath,
  );
  if (resolved.input_image === 'supported') {
    return { ok: true, code: 0, input_image: 'supported', evidence: resolved.evidence, source: resolved.source };
  }
  const message = `vision-guard: refusing non-text content ${nonText[0]} for engine ${engineLabel(runner, model)} (input_image=${resolved.input_image}): ${resolved.evidence}`;
  const error = new Error(message);
  error.code = 'VISION_REFUSED';
  return {
    ok: false,
    code: 1,
    message,
    error,
    input_image: resolved.input_image,
    evidence: resolved.evidence,
    source: resolved.source,
    file: nonText[0],
  };
}

function printHelp() {
  process.stdout.write(
    'Usage: node scripts/lib/vision-guard.js --runner <runner> --model <model> --file <path> [--file <path> ...]\n'
    + '       [--capability-state <jsonl>] [--static-table <json>]\n'
    + 'Exit 0 when every file is non-image, or the engine vision is supported.\n'
    + 'Exit 1 when an image (magic bytes) would be handed to an engine whose vision is not supported.\n'
    + 'Exit 2 on usage. unknown refuses (fail closed).\n',
  );
}

function parseCli(argv) {
  const out = { files: [], runner: '', model: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const need = (flag) => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        return { error: `${flag} needs a value` };
      }
      i += 1;
      return { value };
    };
    if (arg === '--runner') {
      const got = need(arg);
      if (got.error) return got;
      out.runner = got.value;
    } else if (arg === '--model') {
      const got = need(arg);
      if (got.error) return got;
      out.model = got.value;
    } else if (arg === '--file') {
      const got = need(arg);
      if (got.error) return got;
      out.files.push(got.value);
    } else if (arg === '--capability-state') {
      const got = need(arg);
      if (got.error) return got;
      out.capabilityStatePath = got.value;
    } else if (arg === '--static-table') {
      const got = need(arg);
      if (got.error) return got;
      out.staticTablePath = got.value;
    } else if (arg === '--help' || arg === '-h') {
      out.help = true;
    } else {
      return { error: `unknown argument: ${arg}` };
    }
  }
  return out;
}

function main() {
  const args = parseCli(process.argv.slice(2));
  if (args.error) {
    process.stderr.write(`vision-guard: ${args.error}\n`);
    process.exit(2);
  }
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  const opts = { runner: args.runner, model: args.model, files: args.files };
  if (Object.prototype.hasOwnProperty.call(args, 'capabilityStatePath')) {
    opts.capabilityStatePath = args.capabilityStatePath;
  }
  if (Object.prototype.hasOwnProperty.call(args, 'staticTablePath')) {
    opts.staticTablePath = args.staticTablePath;
  }
  const result = guardVision(opts);
  if (!result.ok) {
    process.stderr.write(`${result.message}\n`);
    process.exit(result.code || 1);
  }
}

if (require.main === module) main();

module.exports = {
  guardVision,
  refuseNonTextBlocks,
  magicIsImage,
};
