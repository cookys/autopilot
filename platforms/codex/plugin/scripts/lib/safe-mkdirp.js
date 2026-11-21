'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Create a directory and its parents without Node's recursive mkdirSync.
 * Avoids infinite loops on virtual filesystems like /proc where mkdir returns ENOENT.
 * @param {string} dir
 */
function mkdirp(dir) {
  const abs = path.resolve(dir);
  const { root } = path.parse(abs);
  const rel = abs.slice(root.length);
  if (!rel) return;

  let cur = root;
  for (const part of rel.split(path.sep)) {
    if (!part) continue;
    cur = path.join(cur, part);
    try {
      fs.mkdirSync(cur);
    } catch (err) {
      if (err.code === 'EEXIST') {
        if (!fs.statSync(cur).isDirectory()) {
          const notDir = new Error(`ENOTDIR: not a directory, mkdir '${cur}'`);
          notDir.code = 'ENOTDIR';
          notDir.path = cur;
          throw notDir;
        }
        continue;
      }
      throw err;
    }
  }
}

module.exports = { mkdirp };