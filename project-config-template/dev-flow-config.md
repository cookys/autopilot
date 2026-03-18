# Dev Flow -- Project Config
# Place this file at: .claude/dev-flow-config.md
# This is the unified config for the entire dev-flow lifecycle
# (session start, workflow execution, and session end).

## Size Rules (override defaults)
- **S**: single module, no interface change -> direct commit
- **L**: 3+ modules, public interface -> plan + project + PR

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

## Branch Rules
# Default branch name (e.g., main, master, develop):
# Branch freshness threshold (max commits behind before merge required):

## Knowledge Paths
# Where knowledge files live (e.g., .claude/knowledge/):
# Memory file (e.g., MEMORY.md):

## Pre-Work Gates
# Commands to run before starting any work:
# e.g., `git fetch origin && git status`

## Skip Conditions
# Conditions where Phase 1 (session start) gates can be skipped:
# e.g., branch already up-to-date, no pending digests

## Knowledge Extraction
# Auto-record triggers:
# - Build error fixed after 2+ attempts
# - Command fails then succeeds with different path
# - Architecture decision iterated multiple times
# Knowledge output path (e.g., .claude/knowledge/):

## Docs Sync
# Docs to check for staleness at session end:
# e.g., doc/projects/INDEX.md, doc/BACKLOG.md

## Backlog Management
# Backlog file path (e.g., doc/BACKLOG.md):
# Auto-add deferred items: true/false

## Post-Work Commands
# Commands to run after work is complete:
# e.g., `npm run check:copy` (i18n consistency)
# e.g., `cargo check` (build verification)

## Session Summary
# Generate session summary for L-size tasks: true/false
# Summary output path (e.g., .claude/session-digests/):
