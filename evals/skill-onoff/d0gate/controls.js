#!/usr/bin/env node
'use strict';
// d0gate/controls.js - negative controls of the d0gate markers and the impact walk (evidence-discipline sections 58 and 64).
//   node d0gate/controls.js            RED phase: every planted marker mutant must misjudge at least one trace (prints RED lines),
//                                      then GREEN phase: the real markers judge every trace as expected (prints one line per trace
//                                      with the value the marker returned = the impact walk). Exit 0 only when all mutants were
//                                      caught and all real judgements are right.
// The traces are really run through the stub dispatch (see traces.js); nothing is a hand-written ledger. No runner is started.
const T = require('./traces');
const L = require('./lib');

const only = (marker) => (tr) => tr.marker === marker;
let bad = 0;
console.log('--- RED phase: planted marker mutants (each must misjudge at least one trace)');
for (const [marker, ms] of Object.entries(L.MUTANTS)) {
  for (const [name, fn] of Object.entries(ms)) {
    const r = T.runControls({ [marker]: fn }, { only: only(marker) });
    const wrong = r.results.filter((x) => !x.pass);
    if (wrong.length === 0) { bad++; console.log(`NOT-CAUGHT ${marker} mutant ${name}: it judged every trace right (the controls cannot see this shortcut)`); } else console.log(`RED ${marker} mutant ${name} misjudged ${wrong.length}: ${wrong.map((x) => `${x.id}(got ${JSON.stringify(x.got)})`).join(', ')}`);
  }
}
console.log('--- GREEN phase: the real markers on every trace (impact walk)');
const g = T.runControls();
for (const x of g.results) {
  if (!x.pass) bad++;
  console.log(`${x.pass ? 'GREEN' : 'WRONG'} ${x.id} ${x.kind === 'neg' ? 'negative' : 'positive'} ${x.marker} expect=${JSON.stringify(x.expect)} got=${JSON.stringify(x.got)}`);
}
console.log(`controls: ${g.results.length} traces, ${g.results.filter((x) => x.pass).length} as expected, ${bad} problem(s)`);
T.dropCells();
process.exit(bad === 0 ? 0 : 1);
