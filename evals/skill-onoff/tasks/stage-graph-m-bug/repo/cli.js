#!/usr/bin/env node
'use strict';
const { invoiceTotal } = require('./lib/report');
const items = [
  { name: 'widget', price: 19.99, qty: 3, discountPct: 10 },
  { name: 'gadget', price: 5, qty: 2 },
];
console.log(invoiceTotal(items).toFixed(2));
