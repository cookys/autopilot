#!/usr/bin/env node
'use strict';
// layout-mutate-reader.js - test helper: rewrite a COPY of scripts/lib/repo-layout.js so that isThisProject reads the identity
// files the old, unbounded way (plain readFileSync of plugin.json, with its failures left uncaught like an out-of-memory one, and statSync of the lib). Used as a negative control by
// layout-readers-guard.test.sh. Exit 3/4 when the code to mutate is not found (the control would be meaningless).
const fs = require('fs');
const f = process.argv[2];
let s = fs.readFileSync(f, 'utf8');
const read = "const text = readSmallRegularFile(path.join(root, dir, 'plugin.json'));";
if (!s.includes(read)) process.exit(3);
s = s.replace(read, "let text = fs.readFileSync(path.join(root, dir, 'plugin.json'), 'utf8'); // unbounded: a failure (memory exhaustion) is not contained");
const stat = "fs.lstatSync(path.join(key, 'scripts', 'lib', 'repo-layout.js')).isFile()";
if (!s.includes(stat)) process.exit(4);
s = s.replace(stat, "fs.statSync(path.join(key, 'scripts', 'lib', 'repo-layout.js')).isFile()");
fs.writeFileSync(f, s);
