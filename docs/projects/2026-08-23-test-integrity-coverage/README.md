# test-integrity coverage — make the anti-gaming gate actually see this repo

**Version**: v2.34.38 · **Date**: 2026-08-23 · **Size**: L (foreman run `test-integrity-l4`)
**BACKLOG row**: `check-test-integrity.sh` does not cover this repo's main test surface → RESOLVED

## The defect

`scripts/check-test-integrity.sh` is the gate that stops a delegated implementer from deleting
tests, weakening assertions or adding skips. On this repo it was blind:

```
$ scripts/check-test-integrity.sh validate --range 19816810..87b5fead
{ "ok": true, "test_paths_matched": 0, "violations": [], "source": "template" }
```

Two layers, not one — the second only became visible while fixing the first.

**Layer 1 — no project config.** autopilot had no `.claude/test-integrity-config.md`, so the
engine fell back to `project-config-template/test-integrity-config.md` (`source: "template"`),
whose `test_paths` are generic ecosystem conventions. This repo's test surface is 260
`*.test.sh` shell suites plus 40 `*.test.js` node suites. None of the template globs match
`hooks/tests/*.test.sh`.

**Layer 2 — the `test_paths` config surface had never worked, for anyone.** In
`scripts/lib/test-integrity-l1.py`, `parse_config` tested `line.startswith("#")` **before**
`line.startswith("##")`. Every section heading was swallowed as a comment, `section` never left
`None`, and every `- <glob>` line was rejected as an unrecognized config line → `malformed_config`.
Note what that means precisely: a project that *tried* to declare `test_paths` was not ignored
quietly — `malformed_config` is non-waivable, forces `mode: block` and returns `ok: false`, so the
attempt hard-failed on every range while the built-in defaults stood in. autopilot had no config
at all, which is why **its** failure was the silent one. No test had ever exercised the path: the
510-line acceptance suite only ever set `mode:`.

The proof is in the reproducer's attribution step — feeding the *new* config to the
*old* engine returns `malformed_config` and `test_paths_matched: 0`. Fixing layer 1 alone
would have changed nothing.

## What shipped

| | |
|---|---|
| `.claude/test-integrity-config.md` | new. `test_paths` = `**/*.test.{sh,js,mjs,cjs,ts}` → **300/300** tracked suites. `surface paths` = `hooks/tests/lib.sh`, `hooks/tests/lib/**`, `hooks/tests/run.sh`, `hooks/tests/fixtures/**`, eval task fixture repos + frozen oracle expectations, `.github/workflows/**`. (Deliberately **no** `package.json`: a glob with no `/` is matched against every path segment, so it would sweep in 13 unrelated tracked files, and this repo has no root `package.json` to protect.) `mode: warn`, with the reasoning in the file. |
| `scripts/lib/test-integrity-l1.py` | `##` heading test moved above the `#` comment skip (the layer-2 fix). New `shell` lang_key so `.sh`/`.bash`/`.bats` suites get skip-marker + comment-stripping semantics. |
| `hooks/tests/check-test-integrity.test.sh` | 70 → **101** assertions: configurable `test_paths`/`surface_paths` regressions, a coverage meta-test, the four negative controls, four evasion controls, and the documented gap pinned. |
| `docs/projects/.../evidence/negative-controls.sh` | runnable BEFORE/AFTER/BLOCK reproducer (four synthetic gaming moves). |
| `docs/projects/.../evidence/real-range-before-after.sh` | the same before/after over a real historical merge. |
| `docs/projects/.../evidence/skip-calibration.sh` | false-positive calibration by running the real gate over every tracked suite. |

### Why `warn` and not `block`

L0 raises a `deleted_line` violation for **every** removed line in a matched test file. Ordinary
test maintenance in this repo removes lines constantly, so `block` would refuse nearly every
honest commit — and the first thing anyone would then do is switch the gate off, which is how it
went blind in the first place. `block` also promotes every `surface_touch` to a violation, and
this repo's tests legitimately edit `hooks/tests/lib.sh` and fixtures. Flipping to `block` needs a
recorded true/false-positive rate first; that is a separate BACKLOG row.

## Evidence — negative controls

`bash docs/projects/2026-08-23-test-integrity-coverage/evidence/negative-controls.sh`
(recorded output: `evidence/negative-controls.out`). Each control runs the same commit three
ways in a throwaway repo under `$TMPDIR`: **BEFORE** = `origin/develop` toolchain + template
config; **AFTER** = this branch + the new config (warn); **BLOCK** = same config, `mode: block`.

| Gaming move | BEFORE | AFTER (warn) | BLOCK |
|---|---|---|---|
| delete assertions from a `*.test.sh` suite | `matched=0`, `violations=[]`, exit 0 | `matched=1`, `deleted_line`, names the removed line | exit 1, `ok:false` |
| weaken an assertion (`assert_eq` → `true`) | `matched=0`, `violations=[]`, exit 0 | `matched=1`, `deleted_line` | exit 1, `ok:false` |
| add a skip (pure addition, zero deletions) | `matched=0`, `violations=[]`, exit 0 | `matched=1`, `skip_marker` | exit 1, `ok:false` |
| delete an entire test file | `matched=0`, `violations=[]`, exit 0 | `matched=1`, `deleted_line`, names the file | exit 1, `ok:false` |

Attribution — new config + **old** engine: `malformed_config`, `matched=0`. New config + **new**
engine: `skip_marker`. So the skip control is bought by the engine change, and the config is
unusable without it.

### On real history, not only synthetic fixtures

`evidence/real-range-before-after.sh` (output: `.out`) runs the gate over
`687f9e56~1..687f9e56` — the real v2.34.35 merge, 38 files of which 10 are `*.test.sh`:

| | result |
|---|---|
| BEFORE (template config, as shipped on develop) | `source=template`, `test_paths_matched=0`, `violations=0`, `ok=true`, plus the `possible misconfiguration: zero test paths matched` warning |
| AFTER (the new config) | `test_paths_matched=10`, **22 `deleted_line` violations across 4 suites**, and `hooks/tests/lib.sh` correctly reported as a `surface_touch` |

Those 22 deletions were always in that merge. Nothing had ever looked at them.

**A note on when the config takes effect.** The engine reads its config from the
**base** commit's blob, so a range based on a commit that predates this ship still
resolves `source: "template"`. That is why the demonstration above supplies the config
via `--allow-env-config`, and why running the gate on *this* ship's own range still
reports `source=template, test_paths_matched=0`. From the next commit onward, ranges
based on this one resolve `source: "base"` and see the full surface.

### The coverage meta-test does not hardcode a number

`check-test-integrity.test.sh` §10 builds a throwaway repo containing the **real**
`.claude/test-integrity-config.md` and a placeholder at every path in
`git ls-files '*.test.sh' '*.test.js'`, then asserts `test_paths_matched` equals the file count
(300 today). Add a suite under a naming convention the config does not cover and it goes red — the
only thing that stops this gate going blind again. A floor guard fails the test if the enumeration
returns fewer than 200 files, so a broken enumeration cannot pass as `0 == 0`.

### Mutation verification

A green suite proves nothing until it goes red. Each production change reverted in turn:

| Mutation | Result |
|---|---|
| revert the `parse_config` ordering fix | **19** red (§9, §10, §11) |
| remove the `shell` lang_key | **8** red — every skip assertion, nothing else |
| delete `.claude/test-integrity-config.md` | **2** red (config-exists + coverage `300` → `0`) |
| drop `**/*.test.js` from the config | **1** red (coverage `300` → `260`) |
| revert the shell comment-strip rule to python's | **2** red (the `${#…}` evasion controls) |
| narrow the skip anchor back to line-start only | **6** red (conditional, `${#…}`, bare `skip`) |
| all restored | **101** assertions green |

Baseline for the delta was measured, not assumed: `git archive origin/develop` into a scratch
clone and run the pre-change suite → `PASS [check-test-integrity] 70 assertions`.

## Honest gap, deliberately left open

A `exit 0` / `return 0` spliced into the middle of a bash suite neuters it with **no deletions and
no skip token**, and is **not detected**. A line-level regex cannot separate it from the
legitimate bail-outs this repo already writes. Measured over the 260 tracked `*.test.sh`:
**19** contain a top-level `exit 0` line, **41** contain one at some indentation, and only **2**
have it as their final non-blank line — so most are guard clauses, which is exactly the shape a
gaming early-exit takes. Telling them apart needs file-position context ("is there an assertion
after this exit?") that the L0 layer does not carry. The candidate real fix is a file-level
invariant (base-vs-head assertion counts, monotonically non-decreasing), which would also subsume
the deletion and weakening cases.

The gap is written in three places — the config comments, the engine comment, and a BACKLOG row —
and pinned by `check-test-integrity.test.sh` §11e, an assertion that **goes red when the gap is
closed**, telling whoever closes it to update all three.

## Note for the reviewer

This range trips `protected_path_touch` on itself: it modifies
`scripts/lib/test-integrity-l1.py` and adds `.claude/test-integrity-config.md`, both on the gate's
protected list. That violation kind is non-waivable and forces `ok: false` regardless of mode.
That is by design — changing the gate itself must go through structural review.

## Shell skip detection — the grammar, because three rounds of patching failed

Three separate reviews each found a **one-token evasion** of this heuristic:

| round | evasion | why it worked |
|---|---|---|
| first-pass | `[ -z "$x" ] && skip "r"` | anchored to line start only |
| first-pass | `[ "${#XS[@]}" -eq 0 ] && skip "r"` | shell borrowed python's comment stripper, which cuts at the `#` of `${#…}` |
| depth-0 panel | `skip;` · `printf ' #' && skip "r"` · `( skip "r" )` | tail required blank-or-EOL; `#` inside quotes still cut the line; `(` was not a command position |

Patching per bug moved the hole three times, so detection is now driven by an
**explicit enumeration of the shell grammar**, and `strip_trailing_comment`'s
shell branch is a quote/escape-aware scanner (`shell_code_view`) rather than a
regex. Controls in `check-test-integrity.test.sh` §11c-bis are **one per class**,
including the excluded and the uncovered ones.

### A — command position (where shell starts a simple command)

| | class | status |
|---|---|---|
| A1 | start of line | covered |
| A2 | after `;` (and `;;` `;&` `;;&`) | covered |
| A3/A4 | after `&&` / `\|\|` | covered |
| A5 | after a pipe | covered |
| A6 | after `&` (background) | covered |
| A7 | after `(` (subshell) | covered |
| A8 | after `{` (group command) | covered |
| A9 | reserved words `then` `else` `elif` `do` | covered |
| A10 | after `!` (negation) | covered |
| A11 | after newline | covered (≡ A1; L0 is line-oriented) |
| A12 | inside `$( … )` | covered (via A7) |
| A13 | inside backticks | covered |
| A15 | after `NAME=value` assignment prefixes | covered |
| A14 | after a `time` / `coproc` prefix | **UNCOVERED (named)** |
| A16 | after a leading redirection (`>f skip`) | **UNCOVERED (named)** |
| A17 | a `case` arm pattern (`in skip)`) | **deliberately excluded** — a pattern, not a command; including `in` would false-positive |

### B — a `#` that is not a comment

| | class | status |
|---|---|---|
| B1 | `${#var}` / `${#arr[@]}` | covered |
| B2 | `$#` | covered |
| B3/B4 | inside `"…"` / `'…'` | covered |
| B5 | escaped hash | covered |
| B6 | mid-word `a#b` | covered |
| B7/B8 | `$'…'` / `$"…"` quoting | covered |
| B9 | heredoc body | **UNCOVERED (named)** — multi-line state; L0 sees isolated added lines |

### C — the tail after the `skip` word

`blank+argument`, end-of-line, and `;` `&` `|` `)` all count as an invocation.
`(` is excluded from every tail class so `skip()` / `skip ()` stay **definitions**;
`}` is excluded so `${skip}` stays an **expansion**; `=` and word-continuation
(`skipped`) match nothing.

### D — data vs code

Quoted spans collapse to a `Q` placeholder **before** detection. That is what
separates a suite that *writes* `skip "x"` into a fixture from a suite that
skips — and it is what removed the self-referential false positives this very
test file used to produce. The accepted cost, named: **D2** a skip reached via
`eval "skip"`, and **D3** a skip inside a heredoc body, are both invisible.

### Still uncovered, by name

**A14** time/coproc prefix · **A16** leading redirection · **B9** heredoc body ·
**D2** eval-string skip · **D3** heredoc-body skip.
All five need multi-line or semantic context the L0 layer does not carry. Each
is pinned by a control asserting the *current* boundary, so closing one turns a
test red on purpose and forces this table, the config note and the BACKLOG row
to move together.

### Calibration

Calibration runs **the real gate**, not a re-typed copy of its regexes
(`evidence/skip-calibration.sh`): every tracked `*.test.sh` is copied into a
throwaway repo as a brand-new file, so every line arrives as an *added* line.
Result: `test_paths_matched: 260`, **5** `skip_marker` hits, all in
`hooks/tests/mission-terminal-rollover.test.sh`, all genuine conditional skips —
down from 7 before the data/code split, which removed the 2 self-referential
payload hits. `exit 0` was evaluated as a pattern and rejected on the evidence
above (19 top-level occurrences are legitimate).

Violations quote the **source line**, not the stripped projection, so a reader
gets the reason text instead of `skip Q`.
