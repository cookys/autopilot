#!/usr/bin/env node
'use strict';
// Read the current project's open cards whose recorded opener is not the PM seat.
const { projectScopeFiles, readEntries } = require('./open-decision.js');
const pm = process.env.AUTOPILOT_PM_SEAT || 'cookys/aimax395/pm--claude';
const cards = projectScopeFiles(process.cwd(), {}).flatMap((file) => readEntries(file))
  .map((card) => ({ id: card.id, opener: card.asker || card.opener, question: card.question.split(/\r?\n/)[0] }))
  .filter((card) => card.opener && card.opener !== pm);
if (process.argv.includes('--json')) console.log(JSON.stringify(cards));
else for (const card of cards) console.log(`${card.id}\t${card.opener}\t${card.question}`);
