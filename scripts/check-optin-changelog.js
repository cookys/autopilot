#!/usr/bin/env node
// check-optin-changelog.js — deterministic release-hygiene gate for opt-in hook CHANGELOG naming.
//
// Ensures that when the opt-in hook set changes, the current version's CHANGELOG entry
// (## v<version>) contains `opt-in` and names every changed opt-in stem in a paragraph
// that also mentions `opt-in`.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const FIRST_MANIFEST_VERSION = '2.26.2';

function showUsage() {
  console.log('Usage: check-optin-changelog.js [options]');
  console.log('');
  console.log('  --manifest <path>            current opt-in manifest (default hooks/opt-in-manifest.json)');
  console.log('  --changelog <path>           changelog file (default CHANGELOG.md)');
  console.log('  --version <X.Y.Z>            override canonical version (default: parse .claude-plugin/plugin.json)');
  console.log('  --baseline-manifest <path>    previous-release manifest file (test seam; missing file => exit 2)');
  console.log('  --base-ref <commitish>        force baseline commit (test seam)');
  console.log('  --allow-no-baseline           fail-closed no-baseline fallback override');
  console.log('  -h | --help');
}

function printHelp() {
  showUsage();
  process.exit(0);
}

function usageError(msg) {
  if (msg) console.error(msg);
  showUsage();
  process.exit(2);
}

function fail(msg, code) {
  console.error(msg);
  process.exit(code === undefined ? 1 : code);
}

function escapeRegex(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeStem(stem) {
  return String(stem).trim().toLowerCase();
}

function compareSemver(a, b) {
  const pa = a.split('.').map((n) => Number(n));
  const pb = b.split('.').map((n) => Number(n));
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function isValidSemver(v) {
  return /^\d+\.\d+\.\d+$/.test(v);
}

function readText(absPath) {
  return fs.readFileSync(absPath, 'utf8');
}

function parseManifestSet(absPath, label) {
  const raw = readText(absPath);
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(`cannot read/parse ${label}: ${err.message}`);
  }

  if (!json || !Array.isArray(json.opt_in)) {
    throw new Error(`missing or malformed opt_in array in ${label}`);
  }

  const set = new Set();
  for (const stem of json.opt_in) {
    if (typeof stem !== 'string') {
      throw new Error(`malformed opt_in stem in ${label}`);
    }
    const norm = normalizeStem(stem);
    if (norm) set.add(norm);
  }
  return set;
}

function parseVersionFromJson(text, label) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`cannot parse ${label} as JSON: ${err.message}`);
  }

  const version = parsed && parsed.version;
  if (typeof version !== 'string' || !isValidSemver(version)) {
    throw new Error(`missing/invalid version in ${label}`);
  }
  return version;
}

function gitShow(absRef, relPath) {
  try {
    return execFileSync('git', ['show', `${absRef}:${relPath}`], {
      cwd: REPO,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return null;
  }
}

function readVersionAtRef(ref) {
  const raw = gitShow(ref, '.claude-plugin/plugin.json');
  if (!raw) return null;
  try {
    return parseVersionFromJson(raw, `${ref}:.claude-plugin/plugin.json`);
  } catch {
    return null;
  }
}

function readManifestAtRef(ref) {
  const raw = gitShow(ref, 'hooks/opt-in-manifest.json');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.opt_in)) return null;
    const set = new Set();
    for (const stem of parsed.opt_in) {
      if (typeof stem === 'string') {
        const norm = normalizeStem(stem);
        if (norm) set.add(norm);
      }
    }
    return set;
  } catch {
    return null;
  }
}

function deriveVersionHistory() {
  let raw;
  try {
    raw = execFileSync('git', ['rev-list', '--first-parent', 'HEAD'], {
      cwd: REPO,
      encoding: 'utf8',
      maxBuffer: 40 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return null;
  }

  const commits = raw.trim().split(/\s+/).filter(Boolean);
  const out = [];
  for (const sha of commits) {
    const rawPlugin = gitShow(sha, '.claude-plugin/plugin.json');
    if (!rawPlugin) continue;
    let version;
    try {
      version = parseVersionFromJson(rawPlugin, `${sha}:.claude-plugin/plugin.json`);
    } catch {
      continue;
    }
    out.push({ sha, version });
  }
  return out;
}

function highestCommittedBelow(history, version) {
  let best = null;
  for (const entry of history) {
    if (compareSemver(entry.version, version) < 0) {
      if (!best || compareSemver(entry.version, best) > 0) {
        best = entry.version;
      }
    }
  }
  return best;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    manifest: 'hooks/opt-in-manifest.json',
    changelog: 'CHANGELOG.md',
    version: null,
    baselineManifest: null,
    baseRef: null,
    allowNoBaseline: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      printHelp();
    }
    if (arg === '--manifest') {
      if (i + 1 >= args.length) return usageError('--manifest requires a path');
      opts.manifest = args[++i];
      continue;
    }
    if (arg === '--changelog') {
      if (i + 1 >= args.length) return usageError('--changelog requires a path');
      opts.changelog = args[++i];
      continue;
    }
    if (arg === '--version') {
      if (i + 1 >= args.length) return usageError('--version requires a semver like 1.2.3');
      opts.version = args[++i];
      continue;
    }
    if (arg === '--baseline-manifest') {
      if (i + 1 >= args.length) return usageError('--baseline-manifest requires a path');
      opts.baselineManifest = args[++i];
      continue;
    }
    if (arg === '--base-ref') {
      if (i + 1 >= args.length) return usageError('--base-ref requires a commitish');
      opts.baseRef = args[++i];
      continue;
    }
    if (arg === '--allow-no-baseline') {
      opts.allowNoBaseline = true;
      continue;
    }
    if (arg.startsWith('--')) {
      return usageError(`unknown option: ${arg}`);
    }
    return usageError(`unknown argument: ${arg}`);
  }

  return opts;
}

// Split a section into co-location blocks for the "stem must sit alongside
// `opt-in`" check. A block breaks on a blank line OR at a markdown list-item
// marker (`-`/`*`/`+`/`N.`), so two ADJACENT bullets are distinct blocks — a
// stem named in a bullet that does not itself say `opt-in` is not credited by
// a neighbouring opt-in bullet. Continuation (indented) lines stay with their
// bullet, so a wrapped bullet is one block.
function splitCoLocationBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let cur = [];
  const isListItem = (l) => /^\s*([-*+]|\d+\.)\s/.test(l);
  const flush = () => { if (cur.length) { blocks.push(cur.join('\n')); cur = []; } };

  for (const line of lines) {
    if (line.trim() === '') { flush(); continue; }
    if (isListItem(line)) { flush(); cur.push(line); continue; }
    cur.push(line);
  }
  flush();
  return blocks;
}

function paragraphHasOptIn(text) {
  return /(?<![a-z0-9_-])opt-in(?![a-z0-9_-])/i.test(text);
}

// Return a per-line "cleaned" view of the CHANGELOG where content that must not
// influence the gate is neutralised:
//   - lines inside a ``` / ~~~ fenced code block → blanked (CommonMark: a fence
//     opens with N≥3 of one char and closes only with ≥N of the SAME char with
//     no info string, so a 4-backtick fence may legally contain ``` lines);
//   - the interior of multi-line <!-- … --> HTML comments → blanked;
//   - an inline <!-- … --> span on an otherwise real line → only the span is
//     stripped, so a real heading like `## v2.26.2 <!-- marker -->` survives as a
//     terminator.
// Heading detection AND opt-in/stem matching both run on these cleaned lines.
function cleanChangelogLines(rawLines) {
  const cleaned = new Array(rawLines.length);
  let fence = null; // { char, len }
  let inComment = false;

  for (let i = 0; i < rawLines.length; i++) {
    let line = rawLines[i];

    if (inComment) {
      const endIdx = line.indexOf('-->');
      if (endIdx === -1) { cleaned[i] = ''; continue; }
      line = line.slice(endIdx + 3); // process whatever follows the comment close
      inComment = false;
    }

    if (fence) {
      cleaned[i] = '';
      const m = line.match(/^\s*(`{3,}|~{3,})\s*$/);
      if (m && m[1][0] === fence.char && m[1].length >= fence.len) fence = null;
      continue;
    }

    // Detect a fence OPENER before comment handling: a fence info string is not
    // HTML-comment territory, so a `<!--` inside it must not start a comment.
    const fm = line.match(/^\s*(`{3,}|~{3,})/);
    if (fm) {
      fence = { char: fm[1][0], len: fm[1].length };
      cleaned[i] = '';
      continue;
    }

    // Strip fully-contained inline comments, then handle an unterminated opener.
    line = line.replace(/<!--[\s\S]*?-->/g, '');
    const openIdx = line.indexOf('<!--');
    if (openIdx !== -1) {
      line = line.slice(0, openIdx);
      inComment = true;
    }

    cleaned[i] = line;
  }
  return cleaned;
}

// ATX headings (CommonMark) may carry 0–3 leading spaces. Tolerating them is
// also what makes a real heading appended after a comment close on the same
// line — `--> ## v2.26.2` → cleaned ` ## v2.26.2` — still register as a section
// terminator (so an older section can't bleed into the target).
const HEADING_PREFIX = '^ {0,3}##';

function extractSection(changelogText, version) {
  const escaped = escapeRegex(version);
  // Require whitespace or end-of-line right after the version so `v2.26.3` does
  // NOT match `v2.26.30` (digit) or `v2.26.3-alpha` (prerelease) headings.
  const heading = new RegExp(`${HEADING_PREFIX}\\s+v${escaped}(?=\\s|$)`);
  const terminator = new RegExp(`${HEADING_PREFIX}\\s+`);
  const lines = cleanChangelogLines(changelogText.split(/\r?\n/));

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (heading.test(lines[i])) { start = i; break; }
  }
  if (start < 0) return null;

  let end = start + 1;
  while (end < lines.length && !terminator.test(lines[end])) end += 1;
  return lines.slice(start + 1, end).join('\n');
}

function main() {
  const opts = parseArgs();
  const manifestPath = path.resolve(REPO, opts.manifest);
  const changelogPath = path.resolve(REPO, opts.changelog);

  let canonical;
  try {
    canonical = parseVersionFromJson(readText(path.join(REPO, '.claude-plugin/plugin.json')), '.claude-plugin/plugin.json');
  } catch (err) {
    return fail(err.message, 2);
  }

  const version = opts.version || canonical;
  if (!isValidSemver(version)) {
    return fail(`bad --version ${opts.version}`, 2);
  }

  let currentSet;
  try {
    currentSet = parseManifestSet(manifestPath, 'manifest');
  } catch (err) {
    return fail(err.message, 1);
  }

  let baselineSet = null;
  let baselineRef = null;
  let previousVersion = null;
  let noBaselineReason = null;

  if (opts.baselineManifest) {
    const absBaseline = path.resolve(REPO, opts.baselineManifest);
    if (!fs.existsSync(absBaseline)) {
      return fail(`--baseline-manifest file not found: ${opts.baselineManifest}`, 2);
    }
    try {
      baselineSet = parseManifestSet(absBaseline, '--baseline-manifest');
      baselineRef = absBaseline;
    } catch (err) {
      return fail(err.message, 1);
    }
  } else {
    const history = deriveVersionHistory();
    if (!history) {
      baselineRef = opts.baseRef || 'HEAD';
      baselineSet = null;
      noBaselineReason = `expected a previous opt-in manifest at ${baselineRef} but none was readable; pass --base-ref or --allow-no-baseline`;
    } else {
      if (opts.baseRef) {
        const forced = opts.baseRef;
        baselineRef = forced;
        baselineSet = readManifestAtRef(forced);
        previousVersion = baselineSet ? readVersionAtRef(forced) : null;
        if (!previousVersion) {
          previousVersion = highestCommittedBelow(history, version);
        }
        if (!baselineSet) {
          noBaselineReason = `expected a previous opt-in manifest at ${forced} but none was readable; pass --base-ref or --allow-no-baseline`;
        }
      } else {
        const positions = [];
        for (let i = 0; i < history.length; i++) {
          if (history[i].version === version) positions.push(i);
        }

        let boundary;
        if (positions.length === 0) {
          // Current version not yet committed to first-parent history. We CANNOT
          // safely diff against HEAD: a manifest change already committed under
          // the prior version label would be masked (added/removed would compute
          // empty). Fail closed via the no-baseline policy — unless the previous
          // version predates the manifest (bootstrap) or an explicit override is
          // supplied.
          baselineRef = 'HEAD';
          baselineSet = null;
          previousVersion = highestCommittedBelow(history, version);
          noBaselineReason = `v${version} is not yet committed to first-parent history; commit the version bump first, or pass --base-ref/--baseline-manifest/--allow-no-baseline`;
        } else {
          let contiguous = true;
          for (let i = 0; i < positions.length; i++) {
            if (positions[i] !== i) {
              contiguous = false;
              break;
            }
          }
          if (!contiguous) {
            return fail(`ambiguous version history for v${version}; pass --base-ref <commit> to pin the previous-release baseline`, 1);
          }
          const boundaryIndex = positions[positions.length - 1];
          boundary = history[boundaryIndex];
          baselineRef = boundary ? `${boundary.sha}^` : null;
          baselineSet = baselineRef ? readManifestAtRef(baselineRef) : null;
          if (!baselineSet) {
            noBaselineReason = `expected a previous opt-in manifest at ${baselineRef} but none was readable; pass --base-ref or --allow-no-baseline`;
          }
          previousVersion = baselineRef ? readVersionAtRef(baselineRef) : null;
        }
        if (!previousVersion) previousVersion = highestCommittedBelow(history, version);
      }

      if (!baselineSet && !noBaselineReason) {
        const source = baselineRef || 'HEAD';
        noBaselineReason = `expected a previous opt-in manifest at ${source} but none was readable; pass --base-ref or --allow-no-baseline`;
      }
    }
  }

  const bootstrapAllowed = previousVersion && compareSemver(previousVersion, FIRST_MANIFEST_VERSION) < 0;

  if (!baselineSet) {
    if (opts.allowNoBaseline) {
      console.log(`allow-no-baseline active; skipping opt-in CHANGELOG gate for v${version}`);
      process.exit(0);
    }
    if (bootstrapAllowed) {
      console.log(`no previous opt-in manifest; previous version ${previousVersion} predates FIRST_MANIFEST_VERSION (${FIRST_MANIFEST_VERSION}), gate inert`);
      process.exit(0);
    }
    return fail(noBaselineReason || `expected a previous opt-in manifest at ${baselineRef || 'HEAD'} but none was readable; pass --base-ref or --allow-no-baseline`, 1);
  }

  const added = [];
  const removed = [];
  for (const stem of currentSet) {
    if (!baselineSet.has(stem)) added.push(stem);
  }
  for (const stem of baselineSet) {
    if (!currentSet.has(stem)) removed.push(stem);
  }

  if (added.length === 0 && removed.length === 0) {
    console.log(`opt-in set unchanged since v${previousVersion || version}; gate inert`);
    process.exit(0);
  }

  let changelogText;
  try {
    changelogText = readText(changelogPath);
  } catch (err) {
    return fail(`cannot read CHANGELOG at ${opts.changelog}: ${err.message}`, 1);
  }

  const section = extractSection(changelogText, version);
  if (section === null) {
    return fail(`no CHANGELOG section for v${version} to verify the opt-in change`, 1);
  }

  const sectionText = section.toLowerCase();
  if (!paragraphHasOptIn(sectionText)) {
    return fail(`missing literal "opt-in" mention in v${version} entry`, 1);
  }

  const paragraphs = splitCoLocationBlocks(section).map((p) => p.toLowerCase());
  const stemMissing = [];

  const stems = [...added.map((s) => ({ name: s, kind: 'added' })), ...removed.map((s) => ({ name: s, kind: 'removed' }))]
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const item of stems) {
    const escaped = escapeRegex(item.name);
    const re = new RegExp(`(?<![a-z0-9_-])${escaped}(?![a-z0-9_-])`, 'i');
    const hasInOptInParagraph = paragraphs.some((para) => paragraphHasOptIn(para) && re.test(para));
    if (!hasInOptInParagraph) {
      stemMissing.push(`opt-in hook "${item.name}" (${item.kind}) not named alongside "opt-in" in the v${version} CHANGELOG entry`);
    }
  }

  if (stemMissing.length) {
    for (const m of stemMissing) {
      console.error(m);
    }
    return process.exit(1);
  }

  console.log(`\u2713 v${version} CHANGELOG names the opt-in change (added: ${added.join(', ') || 'none'}, removed: ${removed.join(', ') || 'none'})`);
}

main();
