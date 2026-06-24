#!/usr/bin/env bash
# Wrapper delegating to pure Node.js implementation
node "$(dirname "$0")/tree.js" "$@"
