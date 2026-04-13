# Quality Gate — Project Config
# Place this file at: .claude/quality-gate-config.md

## Test Command
# e.g., npm test, make test, ../deploy/scripts/dev.sh test

## Scan Command
# e.g., node .claude/scripts/pre-commit-scan.js, npx eslint .

## Code Review
# e.g., Dispatch superpowers:code-reviewer subagent

## Route Overrides
# S: scan → review (skip completeness if scan is clean)
# L: test → scan → completeness → review (full pipeline)
# hotfix: test → review only (skip scan/completeness for speed)

## Anti-Rationalization (optional — reference only)
# When enabled, quality-pipeline loads anti-rationalization patterns during review.
# See: skills/quality-pipeline/references/anti-rationalization.md
# anti_rationalization: true
