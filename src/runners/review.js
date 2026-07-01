'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DISPATCH_REVIEW = path.join(REPO_ROOT, 'scripts', 'dispatch-review.sh');

function dispatchReview(args, options = {}) {
  const scriptPath = options.scriptPath || DISPATCH_REVIEW;
  if (!fs.existsSync(scriptPath)) {
    return {
      error: new Error(`dispatch-review.sh not found: ${scriptPath}`),
      status: null,
      signal: null,
    };
  }
  try {
    return spawnSync(scriptPath, args, {
      cwd: options.cwd || REPO_ROOT,
      env: options.env || process.env,
      shell: false,
      stdio: options.stdio || 'inherit',
    });
  } catch (error) {
    return { error, status: null, signal: null };
  }
}

module.exports = {
  dispatchReview,
  DISPATCH_REVIEW,
};
