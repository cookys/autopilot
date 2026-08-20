#!/usr/bin/env node
'use strict';

/**
 * `dispatch-author.sh` shim for the native Kimi transport.
 *
 * The adapter itself already exists and is tested (`src/runners/kimi.js`,
 * `hooks/tests/dispatch-author-kimi.test.sh`) — it was simply never wired into
 * the author path, so `dispatch-author.sh` rejected `--runner kimi` outright
 * while `resolve-review-loop.sh` happily seated `kimi-code/k3` on the QC panel.
 * The provider-readiness live probe runs through `dispatch-author.sh`, so that
 * seat could never be probed and reported `unavailable` forever.
 *
 * This shim is deliberately thin: it owns argv parsing and the stdout contract
 * that `dispatch-author.sh` expects (authored text on stdout, non-zero exit on
 * anything else) and nothing else. All transport policy — required CLI surface,
 * scratch cwd, argv shape, UTF-8 and empty-output rejection, transport envelope
 * — stays in the adapter, which is the module the contract test pins.
 *
 * Why it re-reads the adapter's private artifact rather than returning text:
 * `runKimiAuthor` deliberately returns only a digest plus a 0600
 * `private_raw_reference`, so the authored bytes never pass through a public
 * return value. The artifact is a framed transcript
 * (`stdout-bytes=<n>\n<stdout>\nstderr-bytes=<m>\n<stderr>`), so the stdout
 * slice is recovered from its own declared length — no parsing heuristics — and
 * the artifact is then removed, because on this path `$RAW_LOG` is the record
 * that survives and a second 0600 copy in the temp dir is pure residue.
 *
 * Usage: dispatch-author-kimi.js --model <id> --prompt-file <path>
 */

const fs = require('fs');
const path = require('path');

const { runKimiAuthor } = require(path.join(__dirname, '..', 'src', 'runners', 'kimi.js'));

function fail(message, code = 1) {
  process.stderr.write(`dispatch-author-kimi: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { model: null, promptFile: null };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--model') { out.model = value; i += 1; continue; }
    if (key === '--prompt-file') { out.promptFile = value; i += 1; continue; }
    fail(`unknown argument: ${key}`, 2);
  }
  if (!out.model) fail('--model is required', 2);
  if (!out.promptFile) fail('--prompt-file is required', 2);
  return out;
}

/**
 * Recover the stdout slice from the adapter's framed transcript using the
 * declared byte count. Returns null when the framing is not exactly as the
 * adapter writes it — a shape mismatch is a failure, never a best-effort read.
 */
function extractStdout(locator) {
  const bytes = fs.readFileSync(locator);
  const header = 'stdout-bytes=';
  if (!bytes.subarray(0, header.length).equals(Buffer.from(header, 'utf8'))) return null;
  const newline = bytes.indexOf(0x0a);
  if (newline < 0) return null;
  const declared = Number(bytes.subarray(header.length, newline).toString('utf8'));
  if (!Number.isInteger(declared) || declared < 0) return null;
  const start = newline + 1;
  if (start + declared > bytes.length) return null;
  return bytes.subarray(start, start + declared);
}

/**
 * Remove the bullet framing `kimi --output-format text` wraps every answer in.
 *
 * Measured on kimi 0.36.0: the CLI renders the whole reply as ONE bullet item —
 * `\u2022 ` on the first line and a two-space continuation indent on the rest.
 * "Respond only with OK." comes back as `\u2022 OK`, and a three-line answer as
 * `\u2022 Apple` / `  Banana` / `  Cherry`. That is presentation, not model
 * output: left in place it fails the readiness probe's exact `OK` comparison,
 * and — far worse on the real authoring path — it would prefix and re-indent
 * every line of authored verification code.
 *
 * Stripped HERE rather than in `src/runners/kimi.js` on purpose. The adapter's
 * job is faithful transport: its `output_digest` and transport envelope must
 * keep describing the bytes the CLI actually emitted. This shim's contract is
 * "the authored TEXT on stdout", so de-chroming belongs at this boundary — the
 * same split already used for agy, where `raw_log` keeps the `script(1)`
 * transcript and only the readiness probe strips its frames.
 *
 * Deliberately narrow: it fires only when the first line carries the bullet,
 * and only unindents continuation lines that are exactly two spaces deep.
 * Anything else is returned untouched, so a future CLI that stops decorating,
 * or genuinely indented model output, is not silently rewritten. The residual
 * ambiguity — a model whose real first line is itself a bullet item — is not
 * resolvable from the text alone and is accepted.
 */
function stripKimiListChrome(text) {
  const BULLET = '\u2022 ';
  const lines = text.split('\n');
  if (lines.length === 0 || !lines[0].startsWith(BULLET)) return text;
  return lines
    .map((line, index) => {
      if (index === 0) return line.slice(BULLET.length);
      return line.startsWith('  ') ? line.slice(2) : line;
    })
    .join('\n');
}

const args = parseArgs(process.argv.slice(2));

let prompt;
try {
  prompt = fs.readFileSync(args.promptFile, 'utf8');
} catch (error) {
  fail(`prompt file unreadable: ${error.message}`, 2);
}

const result = runKimiAuthor({ model: args.model, prompt });

const locator = result
  && result.private_raw_reference
  && typeof result.private_raw_reference.locator === 'string'
  ? result.private_raw_reference.locator
  : null;

const cleanup = () => {
  if (!locator) return;
  try {
    fs.rmSync(path.dirname(locator), { recursive: true, force: true });
  } catch (_error) { /* residue cleanup is best-effort */ }
};

if (!result || result.status !== 'authored') {
  const reason = (result && result.error) || 'kimi_author_failed';
  const status = (result && result.status) || 'unknown';
  cleanup();
  fail(`${status}: ${reason}`, status === 'precondition_failed' ? 2 : 1);
}

if (!locator) {
  fail('adapter reported authored with no private raw reference', 1);
}

const stdout = extractStdout(locator);
cleanup();
if (stdout === null) {
  fail('adapter private raw artifact framing was not recognised', 1);
}

process.stdout.write(Buffer.from(stripKimiListChrome(stdout.toString('utf8')), 'utf8'));
