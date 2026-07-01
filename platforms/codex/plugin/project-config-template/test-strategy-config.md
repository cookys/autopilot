# Test Strategy — Project Config
# Place this file at: .claude/test-strategy-config.md

## Test Commands
# Unit tests:
# e.g., `cargo test`, `npm test`, `pytest`
# Integration tests:
# e.g., `cargo test --test integration`, `npm run test:e2e`
# Lint/format:
# e.g., `cargo clippy`, `npm run lint`, `ruff check .`

## Test Pyramid
# Preferred ratio (unit : integration : e2e):
# e.g., 70 : 20 : 10

## Baseline Management
# How to establish test baseline:
# e.g., `npm test -- --updateSnapshot`
# Baseline file paths:
# e.g., __snapshots__/, fixtures/

## Feature Flag Levels
# How to gate features in tests:
# - Level 1 (dev): all flags on
# - Level 2 (staging): production flags + new features
# - Level 3 (production): production flags only

## Coverage
# Coverage command:
# e.g., `cargo tarpaulin`, `npm run test:coverage`
# Minimum threshold:
# e.g., 80%

## Pre-Existing Errors
# Known test failures to skip (with ticket references):
# e.g., test_legacy_auth — tracked in #1234
