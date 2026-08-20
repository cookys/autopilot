# Task A — semver compare module

Create ONE new file at exactly this path (relative to the repository root):

    evals/engine-capabilities/impl-baseline/semver-compare.js

Requirements:

- CommonJS module, Node >= 20, zero dependencies, `'use strict';` at top.
- Export exactly one function: `module.exports = { compareSemver };`
- `compareSemver(a, b)` contract:
  - `a` and `b` must each be a string of exactly three dot-separated
    non-negative decimal integer parts, e.g. `"1.2.3"`. No pre-release
    suffixes, no build metadata, no `v` prefix, no signs.
  - Any input violating that contract (wrong type, wrong part count, empty
    part, non-digit characters, negative) must `throw new TypeError`.
  - Leading zeros are allowed and compare numerically: `"01.2.3"` equals
    `"1.2.3"`.
  - Compare major, then minor, then patch, numerically (NOT lexicographically).
  - Return `-1` when `a < b`, `0` when equal, `1` when `a > b`.

Rules:

- Touch ONLY that one file. Do not create tests, docs, or any other file.
- Commit the file with a single one-line commit message.
