'use strict';

// src/decision/cli.js - `autopilot decision list|show|answer --json` (contract: docs/dev/decision-cli.md).
//   main(argv, { stdout, stderr, cwd }) -> exit code. 0 ok | 2 usage | 4 not_found | 5 closed (or duplicate) | 6 bad_option | 7 too_long | 8 delivery_failed
// Every --json result is ONE JSON line on stdout; errors are {ok:false, code, message}. The shape has no console-specific field: the fleet console web page
// and the merged TUI read the same document.

const fs = require('fs');

const FLAGS = new Set(['--option', '--free-text', '--note', '--source', '--device', '--cwd']);

function syncStdout() {
  return { write(text) { const buf = Buffer.from(String(text), 'utf8'); let off = 0; while (off < buf.length) { try { off += fs.writeSync(1, buf, off, buf.length - off); } catch (e) { if (e && e.code === 'EAGAIN') continue; if (e && e.code === 'EPIPE') return true; throw e; } } return true; } };
}

function parse(argv) {
  const o = { _: [], json: false, all: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--all') o.all = true;
    else if (FLAGS.has(a)) { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); o[a.slice(2)] = argv[i + 1]; i += 1; } else if (a.startsWith('--')) throw new Error(`unknown argument: ${a}`);
    else o._.push(a);
  }
  return o;
}

function main(argv, io = {}) {
  const stdout = io.stdout || syncStdout();
  const stderr = io.stderr || process.stderr;
  const emit = (j) => stdout.write(`${JSON.stringify(j)}\n`);
  const lib = require('../../scripts/lib/decision-answer.js');
  let a;
  const usage = (m) => { emit({ ok: false, code: 'usage', message: m }); stderr.write(`autopilot decision: ${m}\n`); return 2; };
  try { a = parse(argv); } catch (e) { return usage(e.message); }
  const cwd = a.cwd || io.cwd || process.cwd();
  const sub = a._[0];
  if (sub === 'list') {
    if (a._.length !== 1) return usage('list takes no id');
    emit({ schema: lib.SCHEMA, cards: lib.listCards(cwd, { all: a.all }) });
    return 0;
  }
  if (sub === 'show') {
    if (a._.length !== 2) return usage('show needs <id>');
    const hit = lib.findCardView(cwd, a._[1]);
    if (!hit) { emit({ ok: false, code: 'not_found', message: `no such decision: ${a._[1]}` }); return 4; }
    emit({ schema: lib.SCHEMA, card: lib.viewOf(hit.entry) });
    return 0;
  }
  if (sub === 'answer') {
    if (a._.length !== 2) return usage('answer needs <id>');
    if ((a.option === undefined) === (a['free-text'] === undefined)) return usage('give exactly one of --option / --free-text');
    if (a.source !== 'console' && a.source !== 'pane') return usage('--source must be console or pane');
    if (typeof a.device !== 'string' || !lib.DEVICE.test(a.device)) return usage('--device must match ^[A-Za-z0-9._:@-]{1,128}$');
    const r = lib.answerCard({ cwd, id: a._[1], option: a.option, freeText: a['free-text'], note: a.note, source: a.source, device: a.device });
    if (r.ok) { emit({ schema: lib.SCHEMA, ...r }); return 0; }
    emit({ ok: false, code: r.code, message: r.message });
    return r.exit;
  }
  return usage('subcommand: list | show <id> | answer <id>');
}

module.exports = { main, parse };
