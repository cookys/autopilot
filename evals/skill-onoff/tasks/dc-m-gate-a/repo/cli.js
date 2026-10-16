#!/usr/bin/env node
const { build, renderText } = require('./lib/report');
const rows = [{ name: 'widget', qty: 3, price: 19.99 }, { name: 'gadget', qty: 1, price: 5 }];
console.log(renderText(build(rows)));
