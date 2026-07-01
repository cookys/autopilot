# Test Integrity Gate — Project Config
# Place this file at: .claude/test-integrity-config.md

## Mode
# Values: block | warn | off
# Default: warn
# - block: block commits/merges on any L0 static check violation
# - warn: report violations but do not block (exit 0)
# - off: disable the test integrity gate
mode: warn

## Protected Paths
# The following paths are protected and cannot be modified by a delegated task
# without triggering structural review or being denied:
# - .qc/** (verdict files)
# - scripts/check-test-integrity.sh (the gate script itself)
# - .claude/test-integrity-config.md (the project configuration)

## Test Paths
# Glob patterns matching test files. If specified, these override the built-in defaults.
# Default conventions:
# - **/*_test.go
# - **/*_test.py
# - **/test_*.py
# - **/*.{test,spec}.{js,ts,jsx,tsx,mjs,cjs,mts,cts}
# - **/__tests__/**
# - tests/**
# - test/**
# - spec/**
# - **/*_spec.rb
# - **/*Test.java
# - src/test/**
# - **/*.feature
# - **/*.bats

## Integrity Surface Paths
# Glob patterns matching files that define the integrity surface (fixtures, config, snap, etc.).
# If specified, these override the built-in defaults.
# Default surface:
# - **/conftest.py
# - **/fixtures/**
# - **/factories/**
# - **/__mocks__/**
# - **/__snapshots__/**
# - **/*.snap
# - **/setupTests.*
# - **/jest.setup.*
# - **/vitest.setup.*
# - **/*.matchers.*
# - pytest.ini
# - tox.ini
# - jest.config.*
# - vitest.config.*
# - playwright.config.*
# - cypress.config.*
# - package.json
# - .github/workflows/**
