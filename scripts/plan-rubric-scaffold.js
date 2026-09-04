#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function usage() {
  console.log('Usage: node scripts/plan-rubric-scaffold.js --plan <file> [--out <file>]');
  console.log('');
  console.log('Options:');
  console.log('  --plan <file>   Path to markdown plan file (required)');
  console.log('  --out <file>    Output rubric markdown file path (optional)');
  console.log('  --help          Show this usage message');
}

function parseArgs(args) {
  let planPath = null;
  let outPath = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help') {
      usage();
      process.exit(0);
    } else if (arg === '--plan') {
      if (i + 1 >= args.length) {
        console.error('Missing value for --plan');
        process.exit(1);
      }
      planPath = args[++i];
    } else if (arg === '--out') {
      if (i + 1 >= args.length) {
        console.error('Missing value for --out');
        process.exit(1);
      }
      outPath = args[++i];
    } else {
      console.error(`Unknown flag: ${arg}`);
      process.exit(1);
    }
  }

  if (!planPath) {
    console.error('Missing required flag: --plan');
    process.exit(1);
  }

  return { planPath, outPath };
}

function parsePlan(content) {
  const lines = content.split('\n');

  // Find all headings
  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(#{1,6})\s+(.*)$/);
    if (match) {
      const level = match[1].length;
      const text = match[2].trim();
      headings.push({ index: i, level, text });
    }
  }

  // Helper to find a heading matching a predicate
  function findHeading(pred) {
    return headings.find(h => pred(h.text));
  }

  // 1. Heading starting with "2." and containing "KR" (case-insensitive or sensitive? Spec says: starts with "2." and contains the substring "KR" anywhere in the heading text)
  const krHeading = findHeading(t => t.startsWith('2.') && t.includes('KR'));
  // 2. Heading starting with "2.5"
  const sec25Heading = findHeading(t => t.startsWith('2.5'));
  // 3. Heading starting with "6"
  const sec6Heading = findHeading(t => t.startsWith('6'));

  if (!krHeading) {
    console.error('missing section: KRs');
    process.exit(1);
  }
  if (!sec25Heading) {
    console.error('missing section: 2.5');
    process.exit(1);
  }
  if (!sec6Heading) {
    console.error('missing section: 6');
    process.exit(1);
  }

  function getSectionLines(heading) {
    const start = heading.index + 1;
    let end = lines.length;
    for (const h of headings) {
      if (h.index > heading.index && h.level <= heading.level) {
        end = h.index;
        break;
      }
    }
    return lines.slice(start, end);
  }

  const krBullets = [];
  for (const line of getSectionLines(krHeading)) {
    // top-level bullet starting with `- KR` followed by digits then a colon: `- KR1: text`
    const m = line.match(/^- KR\d+:\s*(.*)$/);
    if (m) {
      krBullets.push(m[1].trim());
    }
  }

  const sec25Bullets = [];
  for (const line of getSectionLines(sec25Heading)) {
    // top-level bullet starting with `- `
    if (line.startsWith('- ')) {
      sec25Bullets.push(line.slice(2).trim());
    }
  }

  const sec6Bullets = [];
  for (const line of getSectionLines(sec6Heading)) {
    // top-level bullet starting with `- `
    if (line.startsWith('- ')) {
      sec6Bullets.push(line.slice(2).trim());
    }
  }

  const allItems = [...krBullets, ...sec25Bullets, ...sec6Bullets];
  return allItems;
}

function main() {
  const { planPath, outPath: rawOutPath } = parseArgs(process.argv.slice(2));

  let outPath = rawOutPath;
  if (!outPath) {
    const parsed = path.parse(planPath);
    outPath = path.join(parsed.dir, `${parsed.name}.rubric.md`);
  }

  if (!fs.existsSync(planPath)) {
    console.error(`plan file not found: ${planPath}`);
    process.exit(1);
  }

  // Check if output file already exists BEFORE doing anything
  if (fs.existsSync(outPath)) {
    console.error(`output file already exists: ${outPath}`);
    process.exit(2);
  }

  const content = fs.readFileSync(planPath, 'utf8');
  const items = parsePlan(content);

  // If we reach here, required sections were found and output does not exist.
  // Re-check existence just in case? fs.existsSync already checked.
  // Output format:
  // line 1: "# Rubric — " immediately followed by the plan file's basename
  // line 2: blank
  // line 3: "> Source plan: " immediately followed by the plan path exactly as passed via --plan
  // line 4: blank
  // line 5 onward: "R1: " ...
  const basename = path.basename(planPath);
  const outLines = [
    `# Rubric — ${basename}`,
    '',
    `> Source plan: ${planPath}`,
    ''
  ];

  for (let i = 0; i < items.length; i++) {
    outLines.push(`R${i + 1}: ${items[i]}`);
  }

  const outputText = outLines.join('\n') + '\n';
  fs.writeFileSync(outPath, outputText, 'utf8');
  process.exit(0);
}

main();
