'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const VA = path.join(ROOT, 'checks', 'vendor', 'va');
const ROLES = ['planner', 'implementer', 'reviewer', 'verifier', 'debugger', 'explorer'];
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rkt-'));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const taskDir = (role, id) => path.join(ROOT, 'tasks', role, id);
function runCheck(role, id, answer, extra = []) {
  const d = tmp();
  const f = path.join(d, 'answer.json');
  fs.writeFileSync(f, typeof answer === 'string' ? answer : JSON.stringify(answer));
  const r = cp.spawnSync('node', [path.join(ROOT, 'checks/check-cell.js'), '--role', role, '--task-dir', taskDir(role, id), '--answer', f, ...extra], { encoding: 'utf8' });
  rm(d);
  return { rc: r.status, out: r.stdout ? JSON.parse(r.stdout.trim().split('\n').pop()) : null, err: r.stderr };
}
// A copy of the tree in its pre-stamp state: the pilot prereg is stamped in the repo, but the stamper and the scorer tests need a draft
// to stamp or to refuse. Only the three stamp artefacts are reverted (status fields, FROZEN.json, receipt); nothing in the repo changes.
function draftCopy() {
  const d = tmp();
  fs.cpSync(ROOT, d, { recursive: true });
  const pj = path.join(d, 'prereg/pilot.json');
  const p = JSON.parse(fs.readFileSync(pj, 'utf8'));
  p.status = 'draft'; p.stamped = false; p.stamp = null;
  fs.writeFileSync(pj, `${JSON.stringify(p, null, 2)}\n`);
  for (const f of ['prereg/FROZEN.json', 'prereg/receipt-pilot.json']) fs.rmSync(path.join(d, f), { force: true });
  return d;
}
function gitWorkdir(role, id) { // a fresh git worktree of the task input with a base commit, like the runner makes
  const d = tmp();
  fs.cpSync(path.join(taskDir(role, id), 'input'), d, { recursive: true });
  const g = (...a) => cp.execFileSync('git', ['-C', d, ...a], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: ['t', 'x.invalid'].join('@'), GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: ['t', 'x.invalid'].join('@') } });
  g('init', '-q'); g('add', '-A'); g('commit', '-q', '-m', 'base', '--no-verify');
  return { dir: d, git: g };
}
module.exports = { ROOT, VA, ROLES, tmp, rm, draftCopy, taskDir, runCheck, gitWorkdir };
