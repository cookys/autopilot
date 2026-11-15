#!/usr/bin/env node
'use strict';
/*
 * ar-redact.js — redact one agent transcript (JSONL) into an excerpt that may leave the source host.
 * Usage: ar-redact.js --in <transcript.jsonl> --out <excerpt.jsonl> [--report <report.json>]
 * Exit: 0 written; 2 usage; 4 fail-closed (any exception, malformed line, or a hit left after the
 * re-scan): the out file is deleted and the session is dropped. Matched values are never printed.
 * Exit 4 means the session must not be sent anywhere; the raw file never leaves the source host.
 * Report: {schema:"ar-redact/1", in_lines, out_lines, counts:{class:n}, dropped:bool}: numbers, a boolean and
 * fixed rule-class names only, never a path, session id or any fragment of a matched value.
 * Rules: scripts/lib/ar-redact-rules.js. Plan: AR layer 2, block 1. Node built-ins only.
 * Test seam: require() this file and call run({in, out, report, rules, rescanRules}); no env knob.
 */
const fs = require('fs');
const { redactText, defaultRules, tag } = require('./lib/ar-redact-rules');

const CUT = 200;

function cutTail(s) {
  if (s.length <= CUT) return s;
  let head = s.slice(0, CUT);
  if (!/\s/.test(s[CUT])) head = head.replace(/\S+$/, ''); // never leave half a token
  return `${head}…[len=${s.length}]`;
}

const isTextBlock = (b) => b && typeof b === 'object' && !Array.isArray(b) && typeof b.text === 'string' && (b.type === undefined || b.type === 'text');

function makeSession(rules, { truncate }) {
  const counts = {};
  const add = (c) => { for (const [k, v] of Object.entries(c)) counts[k] = (counts[k] || 0) + v; };
  const scan = (s) => {
    const r = redactText(s, rules);
    return r;
  };
  const str = (s) => {
    const r = scan(s);
    add(r.counts);
    return r.text;
  };
  // adjacent text blocks of one message: a hit that appears only in the joined text means a split value
  function splitGuard(arr) {
    let i = 0;
    while (i < arr.length) {
      if (!isTextBlock(arr[i])) { i++; continue; }
      let j = i;
      while (j + 1 < arr.length && isTextBlock(arr[j + 1])) j++;
      if (j > i) {
        const spans = [];
        for (let a = i; a < j; a++) spans.push([a, a + 1]);
        spans.push([i, j]);
        for (const [a, b] of spans) {
          let joined = '';
          let parts = 0;
          for (let k = a; k <= b; k++) {
            joined += arr[k].text;
            parts += scan(arr[k].text).total;
          }
          if (scan(joined).total > parts) {
            for (let k = a; k <= b; k++) arr[k].text = tag('split');
            counts.split = (counts.split || 0) + 1;
          }
        }
      }
      i = j + 1;
    }
  }
  function walk(v, inResult) {
    if (typeof v === 'string') return str(inResult && truncate ? cutTail(v) : v);
    if (Array.isArray(v)) {
      const out = v.map((x) => walk(x, inResult));
      splitGuard(out);
      return out;
    }
    if (v && typeof v === 'object') {
      const out = {};
      const result = inResult || v.type === 'tool_result';
      for (const [k, x] of Object.entries(v)) {
        const key = str(k);
        out[key] = walk(x, result || k === 'toolUseResult');
      }
      return out;
    }
    return v;
  }
  return { counts, walk };
}

function sanitize(lines, rules, truncate) {
  const s = makeSession(rules, { truncate });
  const out = lines.map((o) => JSON.stringify(s.walk(o, false)));
  return { out, counts: s.counts };
}

function readLines(file) {
  const raw = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '');
  return raw.map((l, i) => {
    try {
      return JSON.parse(l);
    } catch (_) {
      throw new Error(`malformed JSONL at line ${i + 1}`);
    }
  });
}

function writeReport(file, rep) {
  if (file) fs.writeFileSync(file, JSON.stringify({ schema: 'ar-redact/1', ...rep }) + '\n');
}

/** @returns {number} exit code */
function run({ in: inFile, out: outFile, report, rules, rescanRules, err = process.stderr }) {
  const first = rules === undefined ? defaultRules() : rules;
  const second = rescanRules === undefined ? defaultRules() : rescanRules;
  let inLines = 0;
  let counts = {};
  try {
    const input = readLines(inFile);
    inLines = input.length;
    const r = sanitize(input, first, true);
    counts = r.counts;
    fs.writeFileSync(outFile, r.out.map((l) => `${l}\n`).join(''));
    // second look at what is about to leave: any hit at all drops the session
    const again = sanitize(readLines(outFile), second, false);
    if (Object.values(again.counts).some((n) => n > 0)) throw new Error('residual hit after re-scan');
    writeReport(report, { in_lines: inLines, out_lines: r.out.length, counts, dropped: false });
    return 0;
  } catch (e) {
    try { fs.unlinkSync(outFile); } catch (_) { /* none written */ }
    try { writeReport(report, { in_lines: inLines, out_lines: 0, counts, dropped: true }); } catch (_) { /* best effort */ }
    err.write(`ar-redact: session dropped (${/^(malformed JSONL at line \d+|residual hit after re-scan)$/.test(e.message) ? e.message : e.name})\n`);
    return 4;
  }
}

function main(argv) {
  const a = { in: null, out: null, report: null };
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    if (!['--in', '--out', '--report'].includes(k) || argv[i + 1] === undefined) {
      process.stderr.write('usage: ar-redact.js --in <transcript.jsonl> --out <excerpt.jsonl> [--report <json>]\n');
      return 2;
    }
    a[k.slice(2)] = argv[i + 1];
  }
  if (!a.in || !a.out) {
    process.stderr.write('usage: ar-redact.js --in <transcript.jsonl> --out <excerpt.jsonl> [--report <json>]\n');
    return 2;
  }
  return run(a);
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { run, sanitize };
