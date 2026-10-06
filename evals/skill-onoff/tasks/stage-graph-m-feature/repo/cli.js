#!/usr/bin/env node
'use strict';
const path = require('path');
const { loadItems } = require('./lib/items');
const { table } = require('./lib/format');
const items = loadItems(path.join(__dirname, 'data', 'items.csv'));
const cmd = process.argv[2];
if (cmd === 'list') {
  console.log(table(['name', 'category', 'qty', 'price'], items.map((i) => [i.name, i.category, i.qty, i.price.toFixed(2)])));
  process.exit(0);
}
console.error('usage: cli.js list');
process.exit(1);
