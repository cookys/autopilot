#!/usr/bin/env bash
node index.js smoke || { echo "FAIL: startup crash"; exit 1; }
echo "PASS"
