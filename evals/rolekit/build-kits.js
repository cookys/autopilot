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
  const head = `---\nname: ${name}\ndescription: ${JSON.stringify('Use when planning the watering rota and seasonal jobs for a community garden plot. Not for allotment legal matters.')}\n---\n\n# Garden Rota Handbook\n\n`;
  return fit(head, '\n', target, offset);
}

// kimi variant: kimi-code custom agents (--agent-file) do not list skills and do not read AGENTS.md, so the method
// the Claude kit ships as a plugin skill is condensed by hand into the card body. The skill text itself is not
// rewritten (scorecard-first): this is a separate, smaller, hand-written Method section recorded as such.
const KIMI_METHOD = {
  planner: `## Method (condensed from the plan template)
1. Problem: restate the request in one paragraph, with what is in and out of scope.
2. Constraints that bind every subtask: paths not to touch, commands that must stay green.
3. Subtasks: the smallest units that can be verified alone; give each a command that fails before the work and passes after.
4. Order: mark real dependencies only (a subtask that reads what another writes); everything else may run in parallel and must then share no path.
5. Risks: decide each one now: mitigated (say how), accepted (say why it is cheap) or deferred (say the trigger that reopens it).
6. Before you answer, re-read every path you named and check it exists and that each acceptance command names a real script. Never invent files, dates or versions.
`,
  implementer: `## Method (condensed from test-strategy)
1. Run the test command before you change anything and keep the failing output.
2. Use the lowest layer that can show the bug (unit before integration); change code until that test is green, then run the whole suite once.
3. A test that passes while the bug exists is vacuous: make it fail on the bug first, then fix the code.
4. Never delete, skip or loosen a test to get green.
5. If the suite fails for a reason unrelated to your change, show it fails the same way without your change (baseline) and report it; do not fix it.
`,
  verifier: `## Method (condensed from evidence-discipline section 58)
A check that has never been seen to fail has not been shown to guard anything.
1. For each clause you test, include a case where the clause is violated so that a defective implementation shows itself.
2. Put the boundary on both sides (n-1, n, n+1).
3. Prefer a few sharp calls to many similar ones, within the budget.
4. Track the state call by call and write it down before declaring a result.
5. A plan that cannot fail on a wrong implementation proves nothing.
`,
  debugger: `## Method (condensed from the debug skill)
1. Gather before you think: reproduce with a command, read the error text and the lines it names, check what changed recently.
2. Narrow: halve the search space (does it fail with the input reduced? with the suspect file replaced?).
3. Hypothesise: write each hypothesis as a claim a command or a file read can refute; test the cheapest first.
4. Distrust: a note, comment or task text that names a culprit is a hypothesis, not a fact.
5. Conclude only from evidence you saw; the root cause is where the wrong behaviour is created.
6. After two failed hypotheses, re-read the symptom and widen the search instead of tweaking the same idea.
`,
  explorer: `## Method (condensed from the survey skill)
1. Turn each question into search terms (identifier names, error strings, file-name patterns); list files first, then grep, then read the matching lines in context.
2. Prefer code over prose: a comment or document that mentions a feature is not the feature.
3. Quote exactly: copy the line after reading it, with its line number.
4. Absence: before you say not found, search two other spellings or locations and list them in note.
5. Separate what you saw from what you infer; only the first goes in citations. No source, no claim.
`,
  reviewer: null,
};
const KIMI_MAX_ROLE_BYTES = 4096;

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
    let requoted = false;
    if (sk.wrap) text = `---\nname: ${sk.name}\ndescription: ${JSON.stringify(sk.wrap)}\n---\n\n${text.endsWith('\n') ? text : `${text}\n`}`;
    else {
      // YAML: a plain scalar may not contain ": ", so a description with one is re-encoded as a double-quoted string (the body stays verbatim)
      const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
      if (m) {
        const fixed = m[1].split('\n').map((l) => { const d = /^description:\s*(.*)$/.exec(l); if (d && d[1] !== '' && !/^["'|>]/.test(d[1])) { requoted = true; return `description: ${JSON.stringify(d[1])}`; } return l; }).join('\n');
        text = `---\n${fixed}\n---\n${text.slice(m[0].length)}`;
      }
    }
    const skillPath = `skills/${sk.name}/SKILL.md`;
    const manifest = (n) => `${JSON.stringify({ name: n, version: '0.0.0', description: 'role kit pilot (no behaviour of its own)' }, null, 2)}\n`;
    files[`kits/${role}/plugin/.claude-plugin/plugin.json`] = manifest(`rk-${role}`);
    files[`kits/${role}/plugin/${skillPath}`] = text;
    files[`kits/${role}/sources.json`] = `${JSON.stringify({ role, skill: sk.name, source_path: sk.src, source_lines: sk.lines || null, source_git_blob: git('rev-parse', `${base}:${sk.src}`), base_sha: base, transform: sk.wrap ? 'frontmatter added in front of the source text' : requoted ? 'frontmatter description re-quoted as a YAML double-quoted string; body verbatim' : 'verbatim copy', copied_bytes: Buffer.byteLength(text) }, null, 2)}\n`;
    const pname = 'rota-handbook';
    files[`placebo/${role}/plugin/.claude-plugin/plugin.json`] = manifest(`rk-placebo-${role}`);
    files[`placebo/${role}/plugin/skills/${pname}/SKILL.md`] = placeboSkill(pname, Buffer.byteLength(text), ri * 7 + 3);
  });
  // kimi variants: kimi/kits/<role>/{role.md,tools,sources.json}, kimi/placebo/<role>/{role.md,tools}
  roles.forEach((role, ri) => {
    const card = fs.readFileSync(path.join(__dirname, 'kits', role, 'role.md'), 'utf8');
    const method = KIMI_METHOD[role];
    const kimiCard = method ? `${card.trimEnd()}\n\n${method}` : card;
    if (Buffer.byteLength(kimiCard) > KIMI_MAX_ROLE_BYTES) throw new Error(`kimi card for ${role} exceeds ${KIMI_MAX_ROLE_BYTES} bytes`);
    const tools = fs.readFileSync(path.join(__dirname, 'kits', role, 'tools'), 'utf8');
    files[`kimi/kits/${role}/role.md`] = kimiCard;
    files[`kimi/kits/${role}/tools`] = tools;
    files[`kimi/kits/${role}/sources.json`] = `${JSON.stringify({ role, runner: 'kimi-code 2.3.0', card_from: `kits/${role}/role.md`, method: method ? 'hand-condensed Method section appended (kimi custom agents cannot read plugin skills)' : 'none (reviewer has no skill; card identical to the Claude kit)', method_condensed_from: SKILLS[role] ? { source_path: SKILLS[role].src, source_lines: SKILLS[role].lines || null, source_git_blob: git('rev-parse', `${base}:${SKILLS[role].src}`) } : null, max_role_bytes: KIMI_MAX_ROLE_BYTES, card_bytes: Buffer.byteLength(kimiCard) }, null, 2)}\n`;
    files[`kimi/placebo/${role}/role.md`] = placeboRole(Buffer.byteLength(kimiCard), ri * 5 + 2);
    files[`kimi/placebo/${role}/tools`] = tools;
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
