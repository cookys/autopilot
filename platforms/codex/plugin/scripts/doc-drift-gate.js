#!/usr/bin/env node
/**
 * Generic deterministic doc-drift gate (Layer 1 baseline) for autopilot:doc-sync.
 * Ported from scripts/doc-drift-gate.py.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_EXCLUDES = [
  ".git",
  "target",
  "node_modules",
  "_archive",
  ".venv",
  ".opencode",
  "_bodies",
  "platforms/codex/plugin"
];

// Regex configuration
const FILE_EXT = /\.[A-Za-z0-9]{1,8}$/;
const GH_REL = /(^|\/)(commit|commits|issues|pull|releases|blob|tree|compare|wiki)(\/|$)/;

/**
 * Normalizes text/markdown files only before any checks, using extension/UTF-8 checks.
 * Normalize CRLF to LF. Keep generated output strings LF only.
 */
function readTextFileNormalized(filePath) {
  if (!filePath.endsWith('.md')) {
    return null;
  }
  let buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch (err) {
    console.error(`Error reading file ${filePath}:`, err.message);
    process.exit(1); // Fail closed on file read exception
  }

  // Simple UTF-8 validation
  const text = buffer.toString('utf8');
  if (text.includes('\uFFFD') || text.includes('\u0000')) {
    // Binary or invalid UTF-8: skip, but DISCLOSE it (no-silent-caps) — a non-UTF-8
    // .md with a broken link would otherwise pass the gate unchecked.
    console.error(`[WARN] doc-drift-gate: skipped non-UTF-8 .md (unchecked): ${filePath}`);
    return null;
  }
  // Normalize CRLF to LF
  return text.replace(/\r\n/g, '\n');
}

/**
 * Traverse the directories recursively (using built-in fs synchronous APIs to replicate the behavior of os.walk).
 */
function getMdFiles(roots, excludes) {
  const out = new Set();

  function walk(dirpath) {
    if (excludes.some(x => dirpath.includes(x))) {
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(dirpath, { withFileTypes: true });
    } catch (err) {
      console.error(`Error reading directory ${dirpath}:`, err.message);
      process.exit(1); // Fail closed
    }

    for (const entry of entries) {
      const fullPath = path.join(dirpath, entry.name);
      if (excludes.some(x => fullPath.includes(x))) {
        continue;
      }

      let isFile = entry.isFile();
      let isDirectory = entry.isDirectory();
      if (entry.isSymbolicLink()) {
        try {
          const targetStat = fs.statSync(fullPath);
          isFile = targetStat.isFile();
          isDirectory = targetStat.isDirectory();
        } catch (err) {
          // Broken symlink, ignore
          continue;
        }
      }

      if (isDirectory && !entry.isSymbolicLink()) {
        walk(fullPath);
      } else if (isFile && entry.name.endsWith('.md')) {
        out.add(fullPath);
      }
    }
  }

  for (const root of roots) {
    let stat;
    try {
      stat = fs.statSync(root);
    } catch (err) {
      console.error(`Error stating root path ${root}:`, err.message);
      process.exit(2); // Exit with code 2 for usage/CLI errors (invalid root path)
    }

    if (stat.isDirectory()) {
      walk(root);
    }
  }

  return Array.from(out).sort();
}

function checkLinks(files) {
  const bad = [];
  for (const md of files) {
    const text = readTextFileNormalized(md);
    if (text === null) {
      continue;
    }
    const base = path.dirname(md);
    const relMd = path.relative(process.cwd(), md);

    const regex = /\]\(([^)]+)\)/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const link = match[1];
      if (link.startsWith("http://") || link.startsWith("https://") || link.startsWith("#") || link.startsWith("mailto:")) {
        continue;
      }
      if (/[<>{}|]/.test(link)) {
        continue;
      }
      const linkPath = link.split("#")[0];
      if (!linkPath || GH_REL.test(linkPath)) {
        continue;
      }
      // only judge links that clearly target a file (has extension) or a dir
      if (!(linkPath.endsWith("/") || FILE_EXT.test(linkPath))) {
        continue;
      }
      const targetPath = path.normalize(path.join(base, linkPath));
      if (!fs.existsSync(targetPath)) {
        bad.push(`${relMd}: ${link}`);
      }
    }
  }
  return { name: "links", ok: bad.length === 0, details: bad };
}

function checkFences(files) {
  const bad = [];
  for (const md of files) {
    const text = readTextFileNormalized(md);
    if (text === null) {
      continue;
    }
    const lines = text.split('\n');
    let n = 0;
    for (const line of lines) {
      if (line.trimStart().startsWith('```')) {
        n++;
      }
    }
    if (n % 2 !== 0) {
      const relMd = path.relative(process.cwd(), md);
      bad.push(`${relMd}: ${n} fence lines (odd → unbalanced)`);
    }
  }
  return { name: "fences", ok: bad.length === 0, details: bad };
}

// Repo root resolved from this script's location (scripts/doc-drift-gate.js),
// so `scripts/...` references resolve correctly regardless of the scan cwd.
const REPO_ROOT = path.resolve(__dirname, '..');

// Known executable-script extensions a `scripts/...` reference can carry.
const SCRIPT_EXT_RE = /\.(sh|bash|js|mjs|cjs|ts|py|ps1)$/;
// Captures REPO-ROOT-relative script references like `scripts/foo.sh` in backticks
// or prose. The negative lookbehind anchors `scripts/` to the autopilot repo root:
// it rejects `.claude/scripts/...` (a consuming project's own script), `../x/scripts/...`
// (another repo), and `myscripts/...`. Relative-path *markdown links* to scripts
// (`[x](../scripts/foo.sh)`) are validated by checkLinks instead, so anchoring here
// loses no coverage. Stops at the extension (excludes a `:line@sha` evidence suffix);
// glob/placeholder refs are filtered out below.
const SCRIPT_REF_RE = /(?<![\w./-])(?:\.\/)?scripts\/[A-Za-z0-9_./-]+\.(?:sh|bash|js|mjs|cjs|ts|py|ps1)\b/g;
// Backticked BARE basename like `tree.sh` (no path). Only flagged when scripts/ holds
// that stem under a DIFFERENT extension (a rename) — so `jest.config.js` or a consumer
// script name never trips it, but `tree.sh` (→ scripts/tree.js) does. Non-backticked
// prose mentions are intentionally NOT gated (unbounded false-positive risk).
const BARE_SCRIPT_RE = /`([A-Za-z0-9_-]+\.(?:sh|bash|js|mjs|cjs|ts|py|ps1))`/g;

// The script-ref existence check applies to ACTIVE autopilot operational docs only.
// Exempt:
//   - docs/plans/, docs/projects/ — period-accurate history/tracking (named scripts
//     as they were at the time, e.g. tree.sh before the Node port)
//   - CHANGELOG.md — immutable release history (same period-accuracy rationale)
//   - project-config-template/ — templates describe a CONSUMING project's own
//     scripts (e.g. `scripts/check-doc-drift.py`), not autopilot's
function isScriptRefExemptDoc(relPath) {
  const p = relPath.replace(/\\/g, '/');
  return p.startsWith('docs/plans/')
    || p.startsWith('docs/projects/')
    || p.startsWith('project-config-template/')
    || p === 'CHANGELOG.md';
}

// checkScriptRefs — a referenced scripts/<name>.<ext> that does not exist is
// drift (an operational command a future agent will try to run). Mechanizes the
// finding class where docs kept naming tree.sh/qc-panel.sh/risk-counter.sh after
// they became .js. When the exact file is missing but a sibling with a different
// known extension exists, the message points at the likely rename.
function checkScriptRefs(files) {
  const bad = [];
  // Inventory of scripts/ stems → filenames, to catch BARE backticked renamed refs
  // (`tree.sh` when only scripts/tree.js exists). Built once; absent dir → bare check
  // is a no-op.
  const scriptStems = new Map();
  try {
    for (const f of fs.readdirSync(path.join(REPO_ROOT, 'scripts'))) {
      if (!SCRIPT_EXT_RE.test(f)) continue;
      const stem = f.replace(SCRIPT_EXT_RE, '');
      if (!scriptStems.has(stem)) scriptStems.set(stem, new Set());
      scriptStems.get(stem).add(f);
    }
  } catch { /* no scripts/ dir → skip bare check */ }
  for (const md of files) {
    const relMd = path.relative(process.cwd(), md);
    if (isScriptRefExemptDoc(path.relative(REPO_ROOT, md))) {
      continue;
    }
    const text = readTextFileNormalized(md);
    if (text === null) {
      continue;
    }
    const seen = new Set();
    let m;
    SCRIPT_REF_RE.lastIndex = 0;
    while ((m = SCRIPT_REF_RE.exec(text)) !== null) {
      const ref = m[0];
      if (ref.includes('*') || ref.includes('?') || ref.includes('{') || ref.includes('<')) {
        continue; // glob / placeholder, not a concrete path
      }
      if (seen.has(ref)) {
        continue;
      }
      seen.add(ref);
      if (fs.existsSync(path.join(REPO_ROOT, ref))) {
        continue;
      }
      // Missing — does a sibling with a different known extension exist?
      const stem = ref.replace(SCRIPT_EXT_RE, '');
      let hint = 'no such file';
      try {
        const dir = path.dirname(path.join(REPO_ROOT, stem));
        const base = path.basename(stem);
        const sibling = fs.readdirSync(dir).find(
          f => f.replace(SCRIPT_EXT_RE, '') === base && SCRIPT_EXT_RE.test(f)
        );
        if (sibling) {
          hint = `did you mean scripts/${sibling}? (renamed)`;
        }
      } catch { /* dir unreadable → keep generic hint */ }
      bad.push(`${relMd}: \`${ref}\` — ${hint}`);
    }
    // Bare backticked basenames: `tree.sh` etc. Flag only when the exact file is
    // absent from scripts/ but the stem exists under another extension (a rename).
    let bm;
    BARE_SCRIPT_RE.lastIndex = 0;
    while ((bm = BARE_SCRIPT_RE.exec(text)) !== null) {
      const base = bm[1];
      if (seen.has(base)) continue;
      if (fs.existsSync(path.join(REPO_ROOT, 'scripts', base))) continue; // real bare script ref
      const siblings = scriptStems.get(base.replace(SCRIPT_EXT_RE, ''));
      if (siblings && siblings.size > 0) {
        seen.add(base);
        bad.push(`${relMd}: \`${base}\` — did you mean scripts/${[...siblings][0]}? (renamed; bare ref)`);
      }
      // else: not a known autopilot script stem → not flagged (avoid prose false positives)
    }
  }
  return { name: "script-refs", ok: bad.length === 0, details: bad };
}

const HELP = `doc-drift-gate.js — deterministic doc-drift gate (links + fences + script refs).

Usage:
  scripts/doc-drift-gate.js [root ...] [--exclude <dir-substring> ...]

  root        one or more paths to scan for .md files (default: ".")
  --exclude   add a directory-name substring to the skip list (repeatable)

Checks:
  links        intra-repo markdown links resolve
  fences       code-fence balance
  script-refs  scripts/<name>.<ext> and ./scripts/... refs exist, plus backticked
               BARE renamed refs (\`tree.sh\` when only scripts/tree.js exists).
               Active docs only (docs/plans, docs/projects, CHANGELOG.md,
               project-config-template/ are period-accurate / consumer-scoped, skipped).
               Non-backticked prose mentions are not gated (false-positive risk).

Exit codes:
  0  no drift found
  1  drift found (broken intra-repo link / unbalanced fence / stale script ref) / read error
  2  usage error
`;

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  const roots = [];
  const excludes = [...DEFAULT_EXCLUDES];
  let i = 0;
  while (i < argv.length) {
    if (argv[i] === "--exclude") {
      if (i + 1 >= argv.length) {
        console.error("Error: --exclude requires an argument.");
        process.exit(2);
      }
      excludes.push(argv[i + 1]);
      i += 2;
    } else {
      roots.push(argv[i]);
      i += 1;
    }
  }
  if (roots.length === 0) {
    roots.push(".");
  }

  const files = getMdFiles(roots, excludes);

  let out = `doc-drift gate (baseline: links + fences + script-refs) — ${files.length} md files\n`;
  out += "========================================\n";

  let failed = 0;
  const checks = [checkLinks(files), checkFences(files), checkScriptRefs(files)];
  for (const check of checks) {
    const status = check.ok ? "PASS" : "FAIL";
    out += `[${status}] ${check.name}\n`;
    for (const detail of check.details) {
      out += `       - ${detail}\n`;
    }
    if (!check.ok) {
      failed += 1;
    }
  }
  out += "========================================\n";
  if (failed > 0) {
    out += `${failed} check(s) FAILED\n`;
    process.stdout.write(out);
    process.exit(1);
  }
  out += "baseline doc-drift checks green\n";
  process.stdout.write(out);
  process.exit(0);
}

// Trap any unexpected error to Fail Closed
process.on('uncaughtException', (err) => {
  console.error("CRITICAL: Unexpected exception in doc-drift-gate:", err);
  process.exit(1);
});

if (require.main === module) {
  main(process.argv.slice(2));
}
