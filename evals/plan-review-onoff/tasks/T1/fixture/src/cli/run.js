exports.run = (opts) => { for (const p of opts.paths) console.log(opts.quiet ? p : `found: ${p}`); };
