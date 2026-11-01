#!/usr/bin/env node
'use strict';
// d0gate-v2/controls-v2.js - negative controls of the G3v2 markers and the impact walk (evidence-discipline sections 58 and 64).
//   node d0gate-v2/controls-v2.js    RED phase: every planted marker mutant must misjudge at least one trace (prints RED lines); an
//                                    all-correct mutant exits non-zero (NOT-CAUGHT). GREEN phase: the real markers judge every trace as expected.
// The traces are really run through the two stubs; nothing is a hand-written ledger. No runner is started.
const T = require('./traces-v2');
const LV = require('./lib-v2');

let bad = 0;
console.log('--- RED phase: planted G3v2 marker mutants (each must misjudge at least one trace)');
for (const [marker, ms] of Object.entries(LV.MUTANTS_V2)) {
  for (const [name, fn] of Object.entries(ms)) {
    const r = T.runControls({ [marker]: fn }, { markers: [marker] });
    const wrong = r.results.filter((x) => !x.pass);
    if (wrong.length === 0) { bad++; console.log(`NOT-CAUGHT ${marker} mutant ${name}: it judged every trace right (the controls cannot see this shortcut)`); } else console.log(`RED ${marker} mutant ${name} misjudged ${wrong.length}: ${wrong.map((x) => `${x.id}(got ${JSON.stringify(x.got)})`).join(', ')}`);
  }
}
console.log('--- GREEN phase: the real G3v2 markers on every trace (impact walk)');
const g = T.runControls();
for (const x of g.results) {
  if (!x.pass) bad++;
  console.log(`${x.pass ? 'GREEN' : 'WRONG'} ${x.id} ${x.kind === 'neg' ? 'negative' : 'positive'} ${x.marker} expect=${JSON.stringify(x.expect)} got=${JSON.stringify(x.got)}`);
}
console.log(`controls-v2: ${g.results.length} judgements, ${g.results.filter((x) => x.pass).length} as expected, ${bad} problem(s)`);
T.dropCells();
process.exit(bad === 0 ? 0 : 1);
