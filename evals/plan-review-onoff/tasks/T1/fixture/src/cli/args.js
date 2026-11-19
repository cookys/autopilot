exports.parseArgs = (argv) => ({ quiet: argv.includes('--quiet'), color: !argv.includes('--no-color'), paths: argv.filter((a) => !a.startsWith('--')) });
