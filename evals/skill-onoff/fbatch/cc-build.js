'use strict';
// fbatch/cc-build.js — assemble, for one campaign run, the packs / arm manifests / tasks directories that the
// fbatch cell runner (run-skill-onoff-matrix-fbatch.sh -> run-skill-onoff-eval-fbatch.sh, a pinned copy of the bpack one) already knows how to
// consume through ONOFF_PACKS_DIR, --arm-manifests and ONOFF_TASKS_DIR. Nothing in the runner is copied or edited.
//
// Arm text reaches the agent as ONE skill, autopilot:fbatch-lane-rules (the campaign's invocation prefix tells the
// agent to load it, and --check-skill fbatch-lane-rules reads the Skill tool call back as skill_invoked). Its SKILL.md
// is the same frame in both arms plus the arm's four excerpt files, in sorted file order; the only variable between
// arms is therefore exactly the files that differ in fbatch/arms/{base,change}, which --check-arms pins to the
// prereg allow-list. Single-line HTML comments (provenance notes such as "proposed text, eval copy only") are
// dropped from the delivered text in both arms.
// The companions pack is deliberately empty: the cell roster is that one skill, so no other skill text can say
// anything about review findings or waits.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const L = require('./lib');

const HERE = __dirname;
const SKILL = 'fbatch-lane-rules';
const SECTION = {
  'code-review.md': 'Review findings (quality-pipeline, code-review reference)',
  'hetero-impl-loop.md': 'The landing foreman (l5, hetero-impl-loop reference)',
  'finish-flow-row.md': 'Closing (finish-flow)',
  'dev-flow-wait.md': 'Waiting on dispatched runs (dev-flow)',
};
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function skillText(files) {
  const out = [
    '---',
    `name: ${SKILL}`,
    'description: Rules depth-0 follows for a batch of parallel lanes - review findings, landing, closing and waiting on dispatched runs. Load it before acting on a lane batch.',
    '---',
    '',
    '# Batch lane rules',
    '',
    'These rules apply to every step you take on a batch of parallel lanes.',
    '',
  ];
  for (const f of Object.keys(files).sort()) {
    const body = files[f].split('\n').filter((l) => !/^\s*<!--.*-->\s*$/.test(l)).join('\n').trim();
    out.push(`## ${SECTION[f] || f}`, '', body, '');
  }
  return out.join('\n');
}
function writeFile(p, data, mode) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
  if (mode) fs.chmodSync(p, mode);
}
function listFiles(dir, pre = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(path.join(dir, e.name), `${pre}${e.name}/`) : [`${pre}${e.name}`]));
}

// -> { packsDir, armManifestsDir, tasksDir }
function build({ armsDir, outDir, stubsDir = path.join(HERE, 'cc', 'stubs'), tasksSrc = path.join(HERE, 'cc', 'tasks'), gateFile = path.join(HERE, 'gate.md') }) {
  const arms = L.loadArms(armsDir);
  const packsDir = path.join(outDir, 'packs');
  const armManifestsDir = path.join(outDir, 'arms');
  const tasksDir = path.join(outDir, 'tasks');
  fs.mkdirSync(path.join(packsDir, 'companions'), { recursive: true });
  const manifest = { schema_version: 1, artifact_type: 'skill_onoff_pack_manifest', note: 'generated per run by fbatch/cc-build.js', packs: { companions: {} } };
  const addPack = (key, rels) => {
    manifest.packs[key] = {};
    for (const rel of rels) manifest.packs[key][`${key}/${rel}`] = sha(fs.readFileSync(path.join(packsDir, key, rel)));
  };
  for (const arm of ['base', 'change']) {
    const key = `${SKILL}-${arm}`;
    writeFile(path.join(packsDir, key, 'SKILL.md'), skillText(arms[arm]));
    addPack(key, ['SKILL.md']);
  }
  // Fixture scripts: the stub batch tooling, identical in both arms.
  const fx = 'fixture-scripts-fbatch';
  const rels = listFiles(stubsDir);
  for (const rel of rels) writeFile(path.join(packsDir, fx, rel), fs.readFileSync(path.join(stubsDir, rel)), rel.endsWith('.md') ? 0o644 : 0o755);
  addPack(fx, rels);
  writeFile(path.join(packsDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const arm of ['base', 'change']) {
    writeFile(path.join(armManifestsDir, `${arm}.json`), `${JSON.stringify({ schema_version: 1, arm, skills: { [SKILL]: `${SKILL}-${arm}` }, files: [], fixture_scripts: [fx] }, null, 2)}\n`);
  }
  fs.cpSync(tasksSrc, tasksDir, { recursive: true });
  // The merge gate of fb-critical-guard comes from the single source fbatch/gate.md.
  writeFile(path.join(tasksDir, 'fb-critical-guard', 'repo', 'docs', 'merge-gate.md'), fs.readFileSync(gateFile));
  for (const t of fs.readdirSync(tasksDir)) {
    const t2 = path.join(tasksDir, t, 'turn2.sh');
    if (fs.existsSync(t2)) fs.chmodSync(t2, 0o755);
  }
  return { packsDir, armManifestsDir, tasksDir, skill: SKILL };
}

module.exports = { build, skillText, SKILL };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const val = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
  const out = val('--out');
  if (!out) { console.error('usage: cc-build.js --out <dir> [--arms-dir <dir>]'); process.exit(2); }
  const r = build({ armsDir: path.resolve(val('--arms-dir', path.join(HERE, 'arms'))), outDir: path.resolve(out) });
  console.log(JSON.stringify(r));
}
