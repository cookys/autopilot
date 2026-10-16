#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'greet') {
  console.log(`hello ${args[1] || 'world'}`);
  process.exit(0);
}
console.error('usage: cli.js greet [name]');
process.exit(1);
