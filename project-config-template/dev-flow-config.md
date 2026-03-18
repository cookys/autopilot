# Dev Flow — Project Config
# Place this file at: .claude/dev-flow-config.md

## Size Rules (override defaults)
- **S**: single module, no interface change → direct commit
- **L**: 3+ modules, public interface → plan + project + PR

## Quality Gate
# What to run before commits:
- S: `lint && test`
- L: `lint && test` per phase, full review before merge

## Build & Deploy
# Build command:
# Deploy/staging command:

## Project Paths
# Where projects live: `doc/projects/`
# Backlog: `doc/BACKLOG.md`

## Bootstrap (L-size)
# Command to create project structure:
# e.g., `node .claude/scripts/plan-bootstrap.js --plan <path> --name <name>`
