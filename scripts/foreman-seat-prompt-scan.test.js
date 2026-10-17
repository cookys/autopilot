#!/usr/bin/env node
'use strict';

// Spec §7 says the seat prompt uses no family, variant, version, or fixture
// term, and that scanPromptForLeaks must accept it. The text is installed
// verbatim. The phase-1 projection classifies ordinary words in that text as
// oracle vocabulary. The spec and the projection now agree: the schema allowlist
// (evals/foreman-eval-generator.js buildSchemaAllowlist) deliberately admits
// good, changed, clean and worktree as ordinary wire prose. This test is green
// and must stay green. Do not edit the prompt to hide hits.

const crypto = require('crypto');
const { FOREMAN_SYSTEM_PROMPT } = require('./qualification-review-provider');
const {
  generateForemanExam,
  scanPromptForLeaks,
} = require('../evals/foreman-eval-generator');

const seed = crypto.createHash('sha256').update('foreman-prompt-scan').digest('hex');
const exam = generateForemanExam(seed);
const hits = scanPromptForLeaks(
  FOREMAN_SYSTEM_PROMPT,
  exam.vocabulary_projection,
  new Set(exam.schema_allowlist),
);
if (hits.length !== 0) {
  const terms = [...new Set(hits.map((hit) => `${hit.category}:${hit.term}`))].sort();
  console.error(
    `PROMPT_SCAN_GAP: installed §7 prompt does not pass scanPromptForLeaks (${terms.join(', ')})`,
  );
  process.exit(1);
}
console.log('seat prompt scan passed');
