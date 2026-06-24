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
  "_bodies"
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
    // Binary or invalid UTF-8
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

function main(argv) {
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
  
  let out = `doc-drift gate (baseline: links + fences) — ${files.length} md files\n`;
  out += "========================================\n";
  
  let failed = 0;
  const checks = [checkLinks(files), checkFences(files)];
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
