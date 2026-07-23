#!/usr/bin/env node
'use strict';

// check-l1-cache-key-parity.js — keep L1 test versions in sync with CI cache key.
//
// Exit contract:
//   - Exit 0: versions in parity
//   - Exit 1: mismatch or parse failure

const fs = require('fs');
const path = require('path');

function main() {
  const isJson = process.argv.includes('--json');
  const repoRoot = path.resolve(__dirname, '..');
  const workflowPath = path.join(repoRoot, '.github/workflows/test.yml');
  const testFilePath = path.join(repoRoot, 'hooks/tests/check-test-integrity-l1.test.sh');

  let workflowContent = '';
  let testFileContent = '';
  const missing = [];

  try {
    workflowContent = fs.readFileSync(workflowPath, 'utf8');
  } catch (err) {
    missing.push('workflowFile');
  }

  try {
    testFileContent = fs.readFileSync(testFilePath, 'utf8');
  } catch (err) {
    missing.push('testFile');
  }

  let workflowJest = null;
  let workflowVitest = null;
  let testJest = null;
  let testVitest = null;

  if (workflowContent) {
    const workflowMatch = workflowContent.match(/jest([0-9][0-9.]*)-vitest([0-9][0-9.]*)/);
    if (workflowMatch) {
      workflowJest = workflowMatch[1];
      workflowVitest = workflowMatch[2];
    } else {
      missing.push('workflowJest', 'workflowVitest');
    }
  } else {
    missing.push('workflowJest', 'workflowVitest');
  }

  if (testFileContent) {
    const jestMatch = testFileContent.match(/jest_ver="([^"]+)"/);
    if (jestMatch) {
      testJest = jestMatch[1];
    } else {
      missing.push('testJest');
    }

    const vitestMatch = testFileContent.match(/vitest_ver="([^"]+)"/);
    if (vitestMatch) {
      testVitest = vitestMatch[1];
    } else {
      missing.push('testVitest');
    }
  } else {
    missing.push('testJest', 'testVitest');
  }

  const uniqueMissing = Array.from(new Set(missing));

  if (uniqueMissing.length > 0) {
    if (isJson) {
      console.log(JSON.stringify({ ok: false, missing: uniqueMissing }));
    } else {
      console.error(`L1 cache-key parity DRIFT: Parse failed. Missing values: ${uniqueMissing.join(', ')}`);
    }
    process.exit(1);
  }

  const ok = (workflowJest === testJest) && (workflowVitest === testVitest);

  if (isJson) {
    console.log(JSON.stringify({
      ok,
      jest: {
        workflow: workflowJest,
        test: testJest
      },
      vitest: {
        workflow: workflowVitest,
        test: testVitest
      }
    }));
  } else if (!ok) {
    console.log('L1 cache-key parity DRIFT:');
    console.log(`  jest:   workflow=${workflowJest}  test=${testJest}`);
    console.log(`  vitest: workflow=${workflowVitest}  test=${testVitest}`);
    console.log('Fix: align .github/workflows/test.yml cache key and hooks/tests/check-test-integrity-l1.test.sh');
  } else {
    console.log('L1 cache-key parity: OK');
  }

  process.exit(ok ? 0 : 1);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify({ ok: false, error: err.message }));
    } else {
      console.error(`Unexpected error: ${err.message}`);
    }
    process.exit(1);
  }
}
