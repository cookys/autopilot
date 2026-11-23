'use strict';
// Preload: collect CommonJS modules loaded under the configured repository.
try {
  const fs = require('fs');
  const path = require('path');
  const Module = require('module');
  const destination = process.env.AUTOPILOT_DEP_TRACE_FILE;
  if (destination) {
    const root = path.resolve(process.env.AUTOPILOT_DEP_TRACE_ROOT || process.cwd());
    const files = new Set();
    const original = Module._load;
    Module._load = function (request, parent, isMain) {
      try {
        const resolved = Module._resolveFilename(request, parent, isMain);
        if (typeof resolved === 'string' && path.isAbsolute(resolved)) {
          const rel = path.relative(root, resolved);
          if (rel && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)) files.add(resolved);
        }
      } catch (_) { /* let the original loader handle resolution errors */ }
      return original.apply(this, arguments);
    };
    process.on('exit', () => {
      try { fs.appendFileSync(destination, JSON.stringify({ pid: process.pid, files: [...files] }) + '\n'); } catch (_) { /* tracing must never break the program */ }
    });
  }
} catch (_) { /* tracing is best effort */ }
