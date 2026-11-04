#!/usr/bin/env node
const { parse } = require('./lib/parser');
const { render } = require('./lib/render');
console.log(render(parse(process.argv.slice(2).join(' '))));
