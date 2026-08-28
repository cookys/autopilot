#!/usr/bin/env node
/**
 * check-foreman-polling.js — fail-closed gate on a depth-1 foreman transcript.
 *
 * A sub-orchestrator that waits on leaves with sleep loops, cats leaf
 * `<session>/tasks/*.output` into its own context, or burns >40 Bash calls is
 * a red-line (revival.3d session 5ca9b104: opus foreman polling cost).
 *
 * Usage:
 *   node scripts/check-foreman-polling.js <transcript> [transcript...]
 *   node scripts/check-foreman-polling.js --self-test
 *
 * Exit 0 = all GREEN. Exit 1 = any RED. Exit 2 = usage.
 *
 * Contract: stdout JSON. One path → one object; several → array of objects.
 * Object: {file, verdict, reasons[], counts}.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const BASH_CAP = 40;
const SLEEP_MIN_SECS = 30;
const SLEEP_TRIP = 3;

const HELP = `Usage:
  node scripts/check-foreman-polling.js <transcript> [transcript...]
  node scripts/check-foreman-polling.js --self-test
  -h, --help

Reads Claude Code task transcripts (JSONL or plain text). Red if any of:
  (a) >=${SLEEP_TRIP} Bash calls with sleep N (N>=${SLEEP_MIN_SECS})
  (b) cat|tail|sed -n|head targeting a path containing /tasks/ ending in .output
  (c) Bash call count > ${BASH_CAP}
`;

function printUsage() {
  process.stdout.write(HELP);
}

function usageError(message) {
  if (message) process.stderr.write(`${message}\n`);
  process.exit(2);
}

function walk(node, visit) {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (typeof node !== 'object') return;
  visit(node);
  for (const value of Object.values(node)) walk(value, visit);
}

function extractBashCommands(text) {
  const commands = [];
  const lines = text.split(/\r?\n/);
  let jsonlHits = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    walk(obj, (node) => {
      const name = node.name;
      const isTool = node.type === 'tool_use' || node.type === 'toolUse';
      if (!isTool || name !== 'Bash') return;
      const input = node.input || node.arguments || {};
      const cmd = input.command || input.cmd;
      if (typeof cmd === 'string' && cmd.length) {
        commands.push(cmd);
        jsonlHits += 1;
      }
    });
  }
  if (jsonlHits > 0) return commands;

  // Plain-text tool dumps: Bash(command: "...") or <invoke name="Bash">
  const re = /\bBash\b[\s\S]{0,400}?command["']?\s*[:=]\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    commands.push(m[1]);
  }
  return commands;
}

function sleepSeconds(command) {
  const hits = [];
  const re = /\bsleep\s+(\d+)\b/g;
  let m;
  while ((m = re.exec(command)) !== null) {
    hits.push(Number(m[1]));
  }
  return hits;
}

function leafOutputReads(command) {
  const reasons = [];
  // Split on common shell list separators but keep the whole command as one
  // scan: a pipeline `cat /tasks/x.output | tail` still has the path.
  const reader = /\b(cat|tail|sed\s+-n|head)\b/i;
  if (!reader.test(command)) return reasons;
  if (!command.includes('/tasks/')) return reasons;
  const pathRe = /(?:^|[\s"'=])(\S*\/tasks\/\S+\.output)\b/g;
  let m;
  while ((m = pathRe.exec(command)) !== null) {
    const target = m[1];
    if (target.endsWith('.output') && target.includes('/tasks/')) {
      reasons.push(target);
    }
  }
  return reasons;
}

function analyzeCommands(commands, file) {
  const sleepGe30 = [];
  const leafReads = [];
  for (const cmd of commands) {
    for (const secs of sleepSeconds(cmd)) {
      if (secs >= SLEEP_MIN_SECS) sleepGe30.push(secs);
    }
    for (const target of leafOutputReads(cmd)) {
      leafReads.push(target);
    }
  }

  const reasons = [];
  if (sleepGe30.length >= SLEEP_TRIP) {
    reasons.push(
      `sleep_loop: ${sleepGe30.length} Bash sleep N (N>=${SLEEP_MIN_SECS}) (threshold ${SLEEP_TRIP})`,
    );
  }
  if (leafReads.length > 0) {
    reasons.push(
      `leaf_output_read: ${leafReads.length} cat|tail|sed -n|head of /tasks/*.output`,
    );
  }
  if (commands.length > BASH_CAP) {
    reasons.push(`bash_cap: ${commands.length} Bash calls (cap ${BASH_CAP})`);
  }

  return {
    file,
    verdict: reasons.length ? 'RED' : 'GREEN',
    reasons,
    counts: {
      bash: commands.length,
      sleep_ge_30: sleepGe30.length,
      leaf_output_reads: leafReads.length,
    },
  };
}

function analyzeFile(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    usageError(`cannot read ${filePath}: ${err.message}`);
  }
  return analyzeCommands(extractBashCommands(text), filePath);
}

function expandPaths(argv) {
  const out = [];
  for (const raw of argv) {
    let st;
    try {
      st = fs.statSync(raw);
    } catch (err) {
      usageError(`cannot stat ${raw}: ${err.message}`);
    }
    if (st.isDirectory()) {
      const names = fs.readdirSync(raw).sort();
      for (const name of names) {
        if (name.endsWith('.output') || name.endsWith('.jsonl') || name.endsWith('.txt')) {
          out.push(path.join(raw, name));
        }
      }
    } else {
      out.push(raw);
    }
  }
  return out;
}

function jsonlTool(command) {
  return JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          name: 'Bash',
          input: { command },
        },
      ],
    },
  });
}

function runSelfTest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foreman-poll-'));
  const clean = path.join(dir, 'clean.output');
  const sleepRed = path.join(dir, 'sleep.output');
  const catRed = path.join(dir, 'cat.output');
  const bashRed = path.join(dir, 'bashcap.output');

  const gitCmd = jsonlTool('git status --short');
  fs.writeFileSync(clean, `${gitCmd}\n${jsonlTool('git diff --stat')}\n`);
  fs.writeFileSync(
    sleepRed,
    [jsonlTool('sleep 240; echo waited'), jsonlTool('sleep 30'), jsonlTool('sleep 90; echo x')].join('\n') + '\n',
  );
  fs.writeFileSync(
    catRed,
    `${gitCmd}\n${jsonlTool('cat /tmp/sess/tasks/leaf-abc.output')}\n`,
  );
  const many = [];
  for (let i = 0; i < 41; i += 1) many.push(jsonlTool(`echo ${i}`));
  fs.writeFileSync(bashRed, `${many.join('\n')}\n`);

  const cases = [
    { file: clean, want: 'GREEN' },
    { file: sleepRed, want: 'RED', reason: 'sleep_loop' },
    { file: catRed, want: 'RED', reason: 'leaf_output_read' },
    { file: bashRed, want: 'RED', reason: 'bash_cap' },
  ];

  const failures = [];
  for (const c of cases) {
    const result = analyzeFile(c.file);
    if (result.verdict !== c.want) {
      failures.push(`${path.basename(c.file)}: want ${c.want} got ${result.verdict}`);
      continue;
    }
    if (c.reason && !result.reasons.some((r) => r.startsWith(c.reason))) {
      failures.push(`${path.basename(c.file)}: missing reason ${c.reason}: ${JSON.stringify(result.reasons)}`);
    }
    if (c.want === 'GREEN' && result.reasons.length) {
      failures.push(`${path.basename(c.file)}: green but reasons ${JSON.stringify(result.reasons)}`);
    }
  }

  // Isolated: two short sleeps must stay GREEN (N<30).
  const short = path.join(dir, 'short-sleep.output');
  fs.writeFileSync(short, [jsonlTool('sleep 2'), jsonlTool('sleep 5'), jsonlTool('sleep 10')].join('\n'));
  const shortResult = analyzeFile(short);
  if (shortResult.verdict !== 'GREEN') {
    failures.push(`short-sleep should be GREEN: ${JSON.stringify(shortResult)}`);
  }

  if (failures.length) {
    process.stderr.write(`self-test FAIL\n${failures.join('\n')}\n`);
    process.exit(1);
  }
  process.stdout.write('self-test PASS\n');
  process.exit(0);
}

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) {
    printUsage();
    process.exit(0);
  }
  if (args.includes('--self-test')) {
    runSelfTest();
    return;
  }
  const files = args.filter((a) => !a.startsWith('-'));
  if (!files.length) usageError('need at least one transcript path');
  const expanded = expandPaths(files);
  if (!expanded.length) usageError('no transcript files under given paths');

  const results = expanded.map((f) => analyzeFile(f));
  const payload = results.length === 1 ? results[0] : results;
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(results.some((r) => r.verdict === 'RED') ? 1 : 0);
}

module.exports = {
  extractBashCommands,
  analyzeCommands,
  analyzeFile,
  BASH_CAP,
  SLEEP_MIN_SECS,
  SLEEP_TRIP,
};

if (require.main === module) {
  main(process.argv);
}
