const { parseArgs } = require('./cli/args');
const { run } = require('./cli/run');
run(parseArgs(process.argv.slice(2)));
