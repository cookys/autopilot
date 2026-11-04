#!/usr/bin/env node
'use strict';
// build-kits.js -- copy each role's skill text into kits/<role>/plugin/ (provenance in kits/<role>/sources.json) and
// generate the placebo kits (placebo/<role>/) with the same byte length as the real kit's files.
//   build-kits.js --repo <autopilot checkout> --base <40-hex sha> [--check]
// role.md and tools of the real kits are hand-written and are NOT touched here. Placebo content is the community-garden
// text bank below: plausible, well-formed, unrelated to any role, and carrying no instruction about answer format.
// No model call. Node built-ins only (git for blob shas).
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const repo = path.resolve(opt('--repo', path.join(__dirname, '..', '..')));
const base = opt('--base');
const check = argv.includes('--check');
const die = (m) => { console.error(`build-kits: ${m}`); process.exit(2); };
if (!base || !/^[0-9a-f]{40}$/.test(base)) die('usage: build-kits.js --repo <dir> --base <40-hex sha> [--check]');
const git = (...a) => cp.execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
const readSrc = (rel) => cp.execFileSync('git', ['-C', repo, 'show', `${base}:${rel}`], { maxBuffer: 1 << 26 }).toString('utf8'); // git objects at --base, not the working tree

// role -> skill source. mode whole = the file as is; excerpt = a line range; wrap = frontmatter added in front.
const SKILLS = {
  planner: { name: 'plan-template', src: 'references/plan-template.md', wrap: 'Use when writing a plan: the structure every plan follows.' },
  implementer: { name: 'test-strategy', src: 'skills/test-strategy/SKILL.md' },
  verifier: { name: 'negative-control', src: 'references/evidence-discipline.md', lines: [1259, 1278], wrap: 'Use when a check or test is written: it must be shown failing on a deliberately broken case.' },
  debugger: { name: 'debug', src: 'skills/debug/SKILL.md' },
  explorer: { name: 'survey', src: 'skills/survey/SKILL.md' },
  reviewer: null,
};

const BANK = [
  'The community garden at the end of the lane is watered by volunteers on a rota that is pinned to the shed door.',
  'Each bed has a small painted stone with a number, and the stone is turned face down once the bed has been watered for the day.',
  'Rain barrels are filled first, because tap water in the dry weeks is metered and the association pays for every cubic metre.',
  'Seedlings that were started indoors are hardened off for a week in the cold frame before they go into the ground.',
  'Compost is turned every second Saturday, and the thermometer reading is written on the whiteboard beside the bins.',
  'Tools are hung on the outlined shapes painted on the shed wall so that a missing spade is noticed at a glance.',
  'Tomatoes are staked on the day they are planted, never later, since the roots of a grown plant do not forgive a post driven beside them.',
  'Beans and peas are sown in succession every three weeks until midsummer, which keeps the picking table busy into autumn.',
  'The herb spiral by the gate is cut back lightly and often; mint is kept in its own sunken bucket to stop it travelling.',
  'Surplus produce goes into the blue crates by the gate, and whatever is left on Sunday evening is taken to the food bank.',
  'Slugs are collected by torchlight after rain, and the bucket is emptied far from the beds, past the hedge.',
  'New members are shown the hose reels, the tap key cupboard and the first aid box on their first morning.',
  'The wheelbarrow with the flat tyre is labelled and stays by the gate until the pump has been returned from the neighbour.',
  'In frost warnings the tender plants are covered with fleece at dusk and uncovered again once the sun is on the beds.',
  'The notice board lists the sowing calendar by month, with a column for what can still be planted under cover.',
  'Visitors are welcome at the open afternoon on the first Saturday of each month, and children may water the sunflower row.',
  'Paths between the beds are kept to a width a wheelbarrow can pass, and bark chip is topped up each spring.',
  'Water butts are scrubbed once a year in March, when the first warm days make it pleasant work for a small team.',
  'Seed packets are stored in a biscuit tin with a silica gel sachet, sorted by the month in which they should be sown.',
  'The allotment association meets in the village hall on the last Thursday of the month, and minutes are posted on the door.',
  'Pumpkins are given a whole bed to themselves and a generous handful of well rotted manure under each mound.',
  'Strawberry runners are pegged down in July to make next year\'s plants, and the oldest plants are lifted after three seasons.',
  'A shared logbook in the shed records first and last frost dates, the first ripe tomato and the largest courgette of the year.',
  'Broken canes are not thrown away: the short ones label the rows and the long ones are tied into wigwams for the climbers.',
  'The bee hotel on the south fence is checked in winter, and any damp or mouldy tubes are replaced with fresh ones.',
  'Weeds are pulled before they set seed, and the roots of bindweed are lifted whole and left to dry on the path.',
  'Onion sets go in during March, and the tops are bent over by hand when the leaves begin to yellow in late summer.',
  'Gloves of every size live in the box by the door, and anyone may borrow a pair provided they are washed before returning.',
  'The pond is left alone from spring until the tadpoles have grown legs, and the netting is only lifted for a short time.',
  'Beetroot, carrots and parsnips are thinned in two passes, the second when the thinnings are big enough to eat.',
  'Leaves are collected in the autumn into a wire cage to rot down for two years and become the best soil improver on the plot.',
  'The key to the shed is kept in a combination box, and the code is changed each January and told to members in person.',
];

function pickBank(target, offset) { // sentences from the bank, rotated by offset, cut at the sentence boundary closest to target
  let best = ''; let acc = '';
  for (let i = 0; i < BANK.length * 3; i += 1) {
    const s = BANK[(i + offset) % BANK.length];
    const next = acc === '' ? s : `${acc} ${s}`;
    if (Math.abs(next.length - target) <= Math.abs(best.length - target) || best === '') best = next;
    else if (next.length > target) break;
    acc = next;
  }
  return best;
}

function fit(head, tail, target, offset) { // head + sentences + tail, total bytes closest to target
  const room = target - Buffer.byteLength(head) - Buffer.byteLength(tail);
  const body = pickBank(Math.max(room, 0), offset);
  return `${head}${body}${tail}`;
}

function placeboRole(target, offset) {
  const head = '# Role: garden rota volunteer\n\nGoal: keep the community garden watered and tidy so that every bed does well through the season.\n\nInputs: the rota on the shed door and the beds along the lane.\n\nHard rules and habits:\n';
  const tail = '\n\nDone when: every numbered stone is face down and the tap is off.\n\nEscalate: if the tap is dripping or the shed is open, tell the secretary at the next meeting.\n';
  return fit(head, tail, target, offset);
}
function placeboSkill(name, target, offset) {
  const head = `---\nname: ${name}\ndescription: Use when planning the watering rota and seasonal jobs for a community garden plot. Not for allotment legal matters.\n---\n\n# Garden Rota Handbook\n\n`;
  return fit(head, '\n', target, offset);
}

function build() {
  const files = {}; // relative path -> content
  const roles = Object.keys(SKILLS);
  roles.forEach((role, ri) => {
    const roleMd = fs.readFileSync(path.join(__dirname, 'kits', role, 'role.md'), 'utf8');
    files[`placebo/${role}/role.md`] = placeboRole(Buffer.byteLength(roleMd), ri * 5);
    files[`placebo/${role}/tools`] = fs.readFileSync(path.join(__dirname, 'kits', role, 'tools'), 'utf8');
    const sk = SKILLS[role];
    if (!sk) return;
    const raw = readSrc(sk.src);
    let text = sk.lines ? raw.split('\n').slice(sk.lines[0] - 1, sk.lines[1]).join('\n') : raw;
    if (sk.wrap) text = `---\nname: ${sk.name}\ndescription: ${sk.wrap}\n---\n\n${text.endsWith('\n') ? text : `${text}\n`}`;
    const skillPath = `skills/${sk.name}/SKILL.md`;
    const manifest = (n) => `${JSON.stringify({ name: n, version: '0.0.0', description: 'role kit pilot (no behaviour of its own)' }, null, 2)}\n`;
    files[`kits/${role}/plugin/.claude-plugin/plugin.json`] = manifest(`rk-${role}`);
    files[`kits/${role}/plugin/${skillPath}`] = text;
    files[`kits/${role}/sources.json`] = `${JSON.stringify({ role, skill: sk.name, source_path: sk.src, source_lines: sk.lines || null, source_git_blob: git('rev-parse', `${base}:${sk.src}`), base_sha: base, transform: sk.wrap ? 'frontmatter added in front of the source text' : 'verbatim copy', copied_bytes: Buffer.byteLength(text) }, null, 2)}\n`;
    const pname = 'rota-handbook';
    files[`placebo/${role}/plugin/.claude-plugin/plugin.json`] = manifest(`rk-placebo-${role}`);
    files[`placebo/${role}/plugin/skills/${pname}/SKILL.md`] = placeboSkill(pname, Buffer.byteLength(text), ri * 7 + 3);
  });
  return files;
}

const files = build();
if (check) {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(__dirname, rel);
    if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== content) die(`differs from a fresh build: ${rel}`);
  }
  console.log(`build-kits: ok (${Object.keys(files).length} files)`);
} else {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(__dirname, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  console.log(`build-kits: wrote ${Object.keys(files).length} files`);
}
