#!/usr/bin/env node
'use strict';
// author-wrap.js — stands in for scripts/dispatch-author.sh (dispatch-discuss.js --dispatch-author-bin
// seam, via author-wrap.sh). Forwards every argument to the real rail unchanged, except:
//   ARM=red : the second-turn paragraph of the prompt ("SECOND TURN: ..." up to the next blank line)
//             is replaced by a deliberately broken one (no respond-to-others, no evidence rule, no
//             stay-on-your-axis rule). If that paragraph is not found the wrapper exits 9, so a red
//             cell can never silently run an unmodified prompt.
// Always appends {arm, prompt_bytes, out_bytes, red_applied} to $WRAP_LOG (size proxy for cost).
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const REAL = process.env.REAL_DISPATCH_AUTHOR || path.join(__dirname, '..', '..', '..', '..', 'scripts', 'dispatch-author.sh');
const arm = process.env.ARM || 'B';
const args = process.argv.slice(2);
const i = args.indexOf('--prompt-file');
let promptBytes = 0; let redApplied = false; let tmp = null;
if (i >= 0) {
  const pf = args[i + 1];
  let text = fs.readFileSync(pf, 'utf8');
  if (arm === 'red') {
    const start = text.indexOf('SECOND TURN:');
    if (start < 0) { process.stderr.write('author-wrap: red arm but no SECOND TURN paragraph in prompt\n'); process.exit(9); }
    const end = text.indexOf('\n\n', start);
    const broken = 'SECOND TURN: the transcript below contains a round with role "this-seat" — that is your own earlier turn. State your position again concisely.';
    text = text.slice(0, start) + broken + text.slice(end);
    tmp = pf + '.red';
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    args[i + 1] = tmp;
    redApplied = true;
  }
  promptBytes = Buffer.byteLength(text);
}
const r = cp.spawnSync('bash', [REAL].concat(args), { encoding: 'utf8', maxBuffer: 1 << 26 });
if (tmp) { try { fs.unlinkSync(tmp); } catch (e) { /* best effort */ } }
let outBytes = 0;
try { const j = JSON.parse(r.stdout); if (j.raw_log) outBytes = fs.statSync(j.raw_log).size; } catch (e) { /* rail failed */ }
if (process.env.WRAP_LOG) fs.appendFileSync(process.env.WRAP_LOG, JSON.stringify({ arm, prompt_bytes: promptBytes, out_bytes: outBytes, red_applied: redApplied }) + '\n');
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
process.exit(r.status === null ? 1 : r.status);
