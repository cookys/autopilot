'use strict';

// Tells whether this process was started by a dispatched "hand" (an agy or author-channel engine run), by walking the parent chain.
// A hand must never run the repo suites itself: the rail verifies afterwards. The rail's own verify step is NOT a descendant of the engine, so it passes.

const fs = require('fs');
const path = require('path');

const HAND_RE = /(^|\/)(agy|antigravity)(\s|$|\/)|dispatch-author\.sh/;

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (_e) { return null; }
}

// procRoot is injectable so the test can feed a fake /proc tree.
function handAncestor(pid = process.pid, procRoot = '/proc') {
  let cur = pid;
  for (let depth = 0; depth < 64 && cur > 1; depth += 1) {
    const stat = readText(path.join(procRoot, String(cur), 'stat'));
    if (stat === null) return null;
    const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
    const cmd = (readText(path.join(procRoot, String(cur), 'cmdline')) || '').split('\0').join(' ').trim();
    if (cur !== pid && HAND_RE.test(cmd)) return { pid: cur, cmd: cmd.slice(0, 120) };
    if (!Number.isInteger(ppid) || ppid === cur) return null;
    cur = ppid;
  }
  return null;
}

module.exports = { handAncestor, HAND_RE };
