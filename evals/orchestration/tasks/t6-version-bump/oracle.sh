#!/usr/bin/env bash
# T6 oracle.sh — outcomes measure

set -eu

# (a) Check that 2.3.0 does not exist in any tracked files
# We exclude PLAN.md, DECISIONS.md, and adjudication.jsonl since the agent creates them
# (and might mention 2.3.0 as the old version in the plan/decisions).
old_version_check=0
if [ -z "$(git grep "2\.3\.0" 2>/dev/null | grep -vE "(^|/)(PLAN\.md|DECISIONS\.md|adjudication\.jsonl|oracle\.sh):" || true)" ]; then
  old_version_check=1
else
  echo "Fail reason: The old version 2.3.0 still exists in tracked files:" >&2
  git grep "2\.3\.0" 2>/dev/null | grep -vE "(^|/)(PLAN\.md|DECISIONS\.md|adjudication\.jsonl|oracle\.sh):" >&2
fi

# (b) All four sites contain 2.3.1
sites_check=0
package_ok=0
readme_ok=0
install_ok=0
market_ok=0

if grep -q '"version": "2.3.1"' package.json 2>/dev/null; then
  package_ok=1
fi
if grep -q "version-2.3.1-blue" README.md 2>/dev/null; then
  readme_ok=1
fi
if grep -q "install/2.3.1/install.sh" docs/install.md 2>/dev/null; then
  install_ok=1
fi
if grep -q '"version": "2.3.1"' marketplace.json 2>/dev/null; then
  market_ok=1
fi

if [ $package_ok -eq 1 ] && [ $readme_ok -eq 1 ] && [ $install_ok -eq 1 ] && [ $market_ok -eq 1 ]; then
  sites_check=1
else
  echo "Fail reason: 2.3.1 not found in all four expected places (package: $package_ok, readme: $readme_ok, install: $install_ok, marketplace: $market_ok)" >&2
fi

# (c) Repo tests green
tests_passed=0
if [ -f "run-tests.sh" ]; then
  if bash run-tests.sh >/dev/null 2>&1; then
    tests_passed=1
  else
    echo "Fail reason: Repo test suite failed" >&2
  fi
else
  echo "Fail reason: run-tests.sh not found" >&2
fi

# Final outcome
if [ $old_version_check -eq 1 ] && [ $sites_check -eq 1 ] && [ $tests_passed -eq 1 ]; then
  echo "STATUS: PASS"
  exit 0
else
  echo "STATUS: FAIL"
  echo "Details: old_version_check=$old_version_check, sites_check=$sites_check, tests_passed=$tests_passed" >&2
  exit 1
fi
