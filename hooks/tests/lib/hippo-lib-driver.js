'use strict';
// Test driver for scripts/lib/hippo.js (hooks/tests/hippo-lib.test.sh). Subcommands print one JSON document on stdout.
//   execute <repo> <plan.json>            runs the step plan; exit code = the result's exit
//   spool <repo> <plan.json> <subcommand> writes a spool entry for the plan
//   list <repo>                           spoolList
const fs = require('fs');
const lib = require('../../../scripts/lib/hippo.js');
const [cmd, repo, planFile, sub] = process.argv.slice(2);
if (cmd === 'execute') {
  const r = lib.execute(repo, JSON.parse(fs.readFileSync(planFile, 'utf8')), { log: (s) => process.stderr.write(s + '\n') });
  process.stdout.write(JSON.stringify(r) + '\n');
  process.exitCode = r.exit;
} else if (cmd === 'spool') {
  process.stdout.write(JSON.stringify(lib.spoolWrite(repo, { subcommand: sub, plan: JSON.parse(fs.readFileSync(planFile, 'utf8')) })) + '\n');
} else if (cmd === 'list') {
  process.stdout.write(JSON.stringify(lib.spoolList(repo)) + '\n');
} else {
  process.stderr.write('usage: execute|spool|list\n');
  process.exitCode = 2;
}
