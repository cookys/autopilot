'use strict';

/**
 * qualification-feed.js — read a qualification feed from a URL or a path, with a
 * content-addressed cache.
 *
 * WHY A FEED AT ALL: every consumer enabling a heterogeneous role pays 24 dispatches per seat to
 * qualify it. The "adopt someone else's administration" path already exists, but its artifact is
 * baked into the plugin release — static, invisible, and unable to carry a later strike. A feed is
 * the same disclosure, refreshable.
 *
 * WHAT THIS IS NOT (ADR-0001): nothing here is signed, witnessed, or attested. `digest` is a cache
 * key and a change detector, NOT a trust claim — a feed that hashes correctly is exactly as
 * untrusted as one that does not. Adoption remains an operator decision, and this module never
 * adopts: it fetches, caches, validates shape, and hands back rows. There is deliberately no
 * refresh timer and no auto-adopt path anywhere in this file.
 *
 * TRUST POSTURE. A feed is a remote document written by someone else. It is treated as untrusted
 * input end to end:
 *   - https only, no redirects followed, bounded body, bounded time;
 *   - it may not name a local file, and the cache may not live inside a git work tree;
 *   - every field consumed is re-derived or re-validated locally. In particular the consumer
 *     recomputes seat_hash from (engine, runner, role, effort) rather than believing the feed's —
 *     a hash you did not compute is a claim, and re-derivation is the whole point of ADR-0001.
 *
 * Node >= 20.10, built-ins only.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// A feed is a disclosure document, not a bulk dataset. 8 MB is far above the real article (the
// 2026-09-02 sample with 29 defaults / 1 strike / 53 priors is ~1 MB) and far below anything that
// could exhaust memory here.
const MAX_FEED_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;

function feedError(message) {
  const error = new Error(message);
  error.name = 'QualificationFeedError';
  return error;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function expandTilde(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

// A cache directory inside a git work tree gets committed by accident. This mirrors
// import-aa-capabilities.js's assertOutsideGit for the same reason.
function assertOutsideGit(dir, label) {
  let current = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(current, '.git'))) {
      throw feedError(`${label} must not live inside a git work tree: ${dir}`);
    }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function defaultCacheDir() {
  return path.join(os.homedir(), '.autopilot', 'qualification-feeds');
}

// Bounded byte read. Streams where the runtime supports it (undici's Response.body is an async
// iterable); falls back to arrayBuffer() only when there is no stream to read, and still enforces
// the ceiling on the result.
async function readBodyBounded(response, controller) {
  const chunks = [];
  let total = 0;
  const body = response.body;
  if (body && typeof body[Symbol.asyncIterator] === 'function') {
    for await (const chunk of body) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > MAX_FEED_BYTES) {
        try { controller.abort(); } catch { /* already finished */ }
        throw feedError(`qualification feed exceeds ${MAX_FEED_BYTES} bytes`);
      }
      chunks.push(buf);
    }
    return Buffer.concat(chunks, total);
  }
  const buf = Buffer.from(await response.arrayBuffer());
  if (buf.length > MAX_FEED_BYTES) {
    throw feedError(`qualification feed exceeds ${MAX_FEED_BYTES} bytes`);
  }
  return buf;
}

/**
 * Read a feed body from `--from`, which is either an https URL or a local path.
 * @returns {Promise<{ body: string, origin: string, kind: 'url'|'path' }>}
 */
async function readFeedSource(from, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof from !== 'string' || from.length === 0) {
    throw feedError('--from requires an https URL or a file path');
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(from)) {
    let url;
    try {
      url = new URL(from);
    } catch {
      throw feedError(`--from is not a valid URL: ${from}`);
    }
    // http:// is refused rather than upgraded: silently "fixing" a caller's transport hides that
    // they asked for the wrong one.
    if (url.protocol !== 'https:') {
      throw feedError(`--from URL must be https (got ${url.protocol.replace(':', '')})`);
    }
    if (typeof fetchImpl !== 'function') {
      throw feedError('no fetch implementation available (Node >= 18 required)');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response;
    try {
      try {
        response = await fetchImpl(url.toString(), {
          method: 'GET',
          // `redirect: 'error'` rather than following: a redirect can move the request to another
          // origin, and the operator authorized THIS url.
          redirect: 'error',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
      } catch {
        throw feedError(`qualification feed request failed: ${url.toString()}`);
      }
      if (!response || typeof response.status !== 'number' || typeof response.text !== 'function') {
        throw feedError('qualification feed returned an invalid response');
      }
      if (response.redirected === true) {
        throw feedError('qualification feed redirect was refused');
      }
      if (!response.ok) {
        throw feedError(`qualification feed returned HTTP ${response.status}`);
      }
      const declared = response.headers && typeof response.headers.get === 'function'
        ? Number(response.headers.get('content-length'))
        : NaN;
      if (Number.isFinite(declared) && declared > MAX_FEED_BYTES) {
        throw feedError(`qualification feed exceeds ${MAX_FEED_BYTES} bytes`);
      }
      // Read the body as a bounded BYTE stream, aborting as soon as the ceiling is crossed.
      // `response.text()` would buffer the whole thing first, so a server lying about (or
      // omitting) content-length could force unbounded buffering before we ever checked — the
      // declared length is a hint from the server, and a hint is not a bound.
      //
      // Bytes, not decoded text, are also what we hash and cache: decoding and re-encoding can
      // change them (a BOM, a lone surrogate), and the digest has to describe what actually
      // arrived, since that is the value recorded in an adopted row's provenance.
      const raw = await readBodyBounded(response, controller);
      return { body: raw.toString('utf8'), bytes: raw, origin: url.toString(), kind: 'url' };
    } finally {
      clearTimeout(timer);
    }
  }

  const file = path.resolve(expandTilde(from));
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (err) {
    throw feedError(`cannot read qualification feed: ${file} (${err.code || err.message})`);
  }
  if (stat.isSymbolicLink()) throw feedError(`qualification feed must not be a symlink: ${file}`);
  if (!stat.isFile()) throw feedError(`qualification feed is not a regular file: ${file}`);
  if (stat.size > MAX_FEED_BYTES) throw feedError(`qualification feed exceeds ${MAX_FEED_BYTES} bytes`);
  const bytes = fs.readFileSync(file);
  return { body: bytes.toString('utf8'), bytes, origin: file, kind: 'path' };
}

/**
 * Shape validation. Deliberately shallow: this checks that the document is a qualification feed
 * and that its collections are arrays. Every ENTRY is validated where it is consumed, against the
 * same rules a locally-produced row faces — a feed entry gets no easier path than a local one.
 */
function parseFeed(body, origin, bytes) {
  let doc;
  try {
    doc = JSON.parse(body);
  } catch (err) {
    throw feedError(`qualification feed is not valid JSON (${err.message})`);
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw feedError('qualification feed must be a JSON object');
  }
  // Two shapes are accepted, and the distinction is the producer's, not ours:
  //   - a model-dyno FEED, which declares `schema: "model-dyno.qualification-feed.v<n>"` and reuses
  //     `artifact_type: official-qualification-defaults` so it stays readable by everything that
  //     already understands the shipped artifact;
  //   - the shipped artifact itself, so `--from <path-to-a-plain-artifact>` works and a consumer
  //     can diff one against the other without a second code path.
  // Checked in that order because the feed is the more specific shape.
  const isFeedSchema = typeof doc.schema === 'string'
    && /^model-dyno\.qualification-feed\.v\d+$/.test(doc.schema);
  // BOTH spellings, because the two producers genuinely use different ones and neither is wrong:
  // the shipped artifact has always been `official_qualification_defaults` (underscores — see
  // schemas/official-qualification-defaults.schema.json and readArtifact()), while the model-dyno
  // feed reuses the hyphenated form. Accepting only the hyphenated one silently broke the
  // documented `--from <path-to-the-shipped-artifact>` path.
  const isDefaultsArtifact = doc.artifact_type === 'official_qualification_defaults'
    || doc.artifact_type === 'official-qualification-defaults';
  if (!isFeedSchema && !isDefaultsArtifact) {
    throw feedError(
      'not a qualification feed or defaults artifact '
      + `(schema: ${JSON.stringify(doc.schema)}, artifact_type: ${JSON.stringify(doc.artifact_type)})`,
    );
  }
  for (const key of ['defaults', 'strikes', 'priors']) {
    if (doc[key] !== undefined && !Array.isArray(doc[key])) {
      throw feedError(`qualification feed ${key} must be an array`);
    }
  }
  // Hash the BYTES we received, not the decoded string: decode/re-encode is not guaranteed to be
  // byte-preserving, and this digest is what an adopted row records as its provenance.
  const digest = sha256(bytes === undefined ? Buffer.from(body, 'utf8') : bytes);
  // The feed may advertise its own digest. It is REPORTED, never trusted — our cache key is always
  // the hash of what we actually received.
  //
  // `digest_basis`, when the producer states one, says what their digest is computed over. That
  // turns a difference from a possible discrepancy into a stated fact: the model-dyno feed's value
  // is a producer-internal change-detection fingerprint over a SUBSET of the document (defaults +
  // strikes + priors, with per-prior timestamps stripped), not a hash of the wire bytes, and is
  // not meant to be independently recomputed. Without this field we could only observe "it differs
  // from ours" and had to warn; with it we can say which it is, and stop alarming every reader
  // about something that is working as designed. Absent basis keeps the old, louder wording —
  // an unexplained difference still deserves a warning.
  const advertised = typeof doc.digest === 'string' ? doc.digest : null;
  const advertisedBasis = typeof doc.digest_basis === 'string' && doc.digest_basis.length > 0
    ? doc.digest_basis
    : null;
  return {
    doc,
    feed_schema: isFeedSchema ? doc.schema : null,
    // A plain shipped artifact carries no feed block, no strikes and no priors. Saying so
    // explicitly stops a caller reading "0 strikes" as "the producer reported no strikes".
    is_feed: isFeedSchema,
    digest,
    advertised_digest: advertised,
    advertised_digest_basis: advertisedBasis,
    digest_matches_advertised: advertised === null ? null : advertised === digest,
    // Whether a difference is EXPECTED. A producer that declares a basis has told us their digest
    // is not a hash of the bytes we hold, so a difference carries no information about integrity.
    // This never affects the cache key, the provenance record, or any admission decision — it only
    // decides how loudly the difference is reported.
    advertised_digest_is_producer_internal: advertisedBasis !== null,
    origin,
    defaults: doc.defaults || [],
    strikes: doc.strikes || [],
    priors: doc.priors || [],
  };
}

/**
 * Content-addressed cache: <cacheDir>/<digest>/feed.json plus a `current` manifest naming the most
 * recently fetched digest. Content-addressed so two digests can coexist — that is what makes
 * "what changed since I adopted?" answerable without a network round trip.
 */
function writeCache(cacheDir, parsed, body, nowIso) {
  const root = path.resolve(expandTilde(cacheDir));
  assertOutsideGit(root, 'qualification feed cache');
  const dir = path.join(root, parsed.digest);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const feedFile = path.join(dir, 'feed.json');
  if (!fs.existsSync(feedFile)) {
    const tmp = `${feedFile}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, body, { mode: 0o600 });
    fs.renameSync(tmp, feedFile);
  }
  const manifest = {
    schema_version: 1,
    digest: parsed.digest,
    origin: parsed.origin,
    fetched_at: nowIso,
    n_defaults: parsed.defaults.length,
    n_strikes: parsed.strikes.length,
    n_priors: parsed.priors.length,
  };
  const currentFile = path.join(root, 'current.json');
  const tmpCurrent = `${currentFile}.tmp.${process.pid}`;
  fs.writeFileSync(tmpCurrent, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmpCurrent, currentFile);
  return { feedFile, currentFile, manifest };
}

function readCurrentManifest(cacheDir) {
  const currentFile = path.join(path.resolve(expandTilde(cacheDir)), 'current.json');
  if (!fs.existsSync(currentFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(currentFile, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Fetch (or read), validate, and cache. Never adopts.
 */
async function loadFeed(from, {
  cacheDir = defaultCacheDir(),
  fetchImpl = globalThis.fetch,
  now = new Date().toISOString(),
  noCache = false,
} = {}) {
  const { body, bytes, origin, kind } = await readFeedSource(from, { fetchImpl });
  const parsed = parseFeed(body, origin, bytes);
  const previous = noCache ? null : readCurrentManifest(cacheDir);
  const cache = noCache ? null : writeCache(cacheDir, parsed, bytes, now);
  return {
    ...parsed,
    source_kind: kind,
    fetched_at: now,
    cache,
    previous_digest: previous ? previous.digest : null,
    // A digest change is the ONLY change signal here. What actually changed is computed by the
    // consumer against its own adopted rows, because only it knows what it adopted.
    changed: previous ? previous.digest !== parsed.digest : null,
  };
}

module.exports = {
  MAX_FEED_BYTES,
  loadFeed,
  readFeedSource,
  parseFeed,
  writeCache,
  readCurrentManifest,
  defaultCacheDir,
  sha256,
};
