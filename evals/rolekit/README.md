# rolekit: pilot materials for the role-kit A/B

Prepared without any model call. Direction and rulings: `project/plans/2026-11-05-rolekit-direction.md` (section 3.3 is the design this implements). Nothing here changes a dispatch default; nothing is stamped; no cell has run.

## What the pilot measures

Whether a **role kit** lets the same weak model do a role's tasks better. A kit is the whole package the plan calls "narrow, shape, machine-check": a role card (`role.md`, at most 2 KB), only that role's skill (`plugin/`), a tool allowlist (`tools`), a fixed JSON output shape, and a script that checks the output. The 2026-07-15 skill-transport result (a skill-body pack gave a weak reviewer nothing) is the precedent this row must not repeat, so the same-length placebo arm is part of the design, not an extra.

| arm | system prompt / plugin / tools | model |
|---|---|---|
| A current brief | production default for the rail | weak: Haiku 5.5 (weak1); in the formal run also kimi (weak2) |
| B role kit | `kits/<role>/` compiled by `compile-kit.js` | weak |
| C placebo kit | `placebo/<role>/`: same byte length, irrelevant content, **same tools as B** (C isolates the content, not the tool surface) | weak |
| D ceiling | as A | strong: Sonnet |

The task prompt (`tasks/<role>/<id>/prompt.md`) is byte-identical in every arm and ends with one line naming the top-level JSON keys, so the machine check can read any arm's answer. Arms differ only in system prompt, plugin and tool list. The primary metric per role is a per-cell pass from the role's machine check; the headline number is `gap_closed = (B - A) / (D - A)`; B must also beat C by an exact discordant-pair test. The single mechanical verdict (thresholds, exclusions, what counts as infra) is `prereg/*.json` `verdict.rule`, computed by `score-rolekit.js`.

## Layout

```
README.md  COST-TABLE-pilot.md  COST-TABLE-formal.md  cost-model.json
kits/<role>/{role.md, tools, plugin/, sources.json}   six real kits (reviewer has no plugin)
placebo/<role>/{role.md, tools, plugin/}              six placebo kits
kimi/kits/<role>/{role.md, tools, sources.json}        kimi variant: method written into the card, no plugin/
kimi/placebo/<role>/{role.md, tools}                  kimi placebo, same length (+-5%) as the kimi card
tasks/<role>/<id>/{prompt.md, expected.json, input/}  18 frozen pilot tasks + tasks/manifest.json
checks/check-cell.js                                  the machine check for all six roles
compile-kit.js                                        kit validator + runner mapping (dry run)
prereg/{pilot,formal}.json                            drafts, status "draft", unstamped
score-rolekit.js  stamp-rolekit.js  cost-table.js     verdict, freeze, cost table
build-tasks.js  build-kits.js  prereg/build-prereg.js regenerators (before stamping only)
test/*.test.js                                        unit tests, fixtures only
```

Kit layout is the one the railkit lane builds: `role.md`, optional `plugin/`, `tools`. `tools` is one line of comma-separated names; an empty line means no tools (reviewer and verifier, `--tools ""`). `sources.json` is provenance only (not read by a runner).

## Kits

Each role card has: goal, inputs, hard rules, output contract (a fixed JSON shape), done criteria, escalation. Skills are copies, never moves; `sources.json` records the source path and git blob sha at base `63308bd8f`:

| role | skill in `plugin/` | source |
|---|---|---|
| planner | `plan-template` | `references/plan-template.md` (frontmatter added) |
| implementer | `test-strategy` | `skills/test-strategy/SKILL.md` |
| reviewer | none (tools off; method is in the card) | |
| verifier | `negative-control` | `references/evidence-discipline.md` lines 1259-1278, section 58 (frontmatter added) |
| debugger | `debug` | `skills/debug/SKILL.md` |
| explorer | `survey` | `skills/survey/SKILL.md` |

Deviation from plan 3.1: the verifier tool list is empty because the pilot verifier task is a plan written from a specification (the grader executes it); the plan's "worktree read/write" applies to a later task type.

## Task set (pilot: 3 per role)

Frozen by `build-tasks.js` from the git objects at base `63308bd8f` (not from the working tree, so the relayout cannot change it). `tasks/manifest.json` has, per task, the source paths with git object shas and the sha256 of every frozen file. Verify with `node build-tasks.js --repo <checkout> --base <base_sha> --check`.

| role | tasks | source | machine check (`checks/check-cell.js`) |
|---|---|---|---|
| reviewer | kb-01, kb-05, kb-09 | `evals/known-bad/*.diff` + `evals/skill-transport/match/*.match.json` | verdict FIX and a critical/major finding matching the predicate and citing a line inside a hunk; false must-fix reported |
| implementer | t1-fix-with-decoy, t4-config-layer, t11-boundary-fix | `evals/orchestration/tasks/*` (`oracle.sh`) | oracle exits 0, red/green evidence valid, no protected path touched |
| verifier | va-boundary-off-by-one, va-error-path-swallow, va-state-residue | `evals/va-eval-generator.js` seed `rolekit-pilot-v1`, trial 0, case 0 | `va-eval-grader.js gradeCase` outcome pass (regenerated from the seed; the envelope sha256 is pinned) |
| planner | d2-l-multimodule, d8-l-two-phase, dc-l-api | `evals/skill-onoff/tasks/*/task.md` + repo | six elements, runnable acceptance, scopes exist and parallel scopes disjoint, areas covered, dependency edge where required, no cycle, risks with dispositions |
| debugger | t4-config-layer, t11-boundary-fix, t15-cache-invalidation | `evals/orchestration/tasks/*/repo`; root cause planted there (the expected file/line window/claim wording are authored in `build-tasks.js`) | root cause file, line window and wording match; at least two decided hypotheses; repo untouched |
| explorer | t4-config-layer, t11-boundary-fix, t15-cache-invalidation | same repos; questions authored (two findable, one absent) | found/absent right and every citation is a real line containing the quote |

The engine-qualify implementer exam (`impl-eval-generator.js`) needs bwrap and git and is a formal-phase source, not used in the pilot. Checks exit 0 pass, 1 miss, 2 infra; the exit code 2 is how the runner knows an instrument problem from a model miss. The verifier check's executable dependencies (`va-eval-generator.js`, `va-eval-grader.js`, the corpus) are frozen copies in `checks/vendor/va/` (inside the stamped set), loaded only after their sha256 matches the `VA_PINS` constant in `check-cell.js`; there is no option to load them from elsewhere, so the relayout cannot move them.

## Second seat: kimi (weak2), and flash

PM ruling 2026-11-05: the formal run's second weak seat is **kimi** (kimi-code 2.3.0). Spike facts (`rolekit-probe.md`, zero model calls, session records only): `--agent-file role.md` injects the card (system prompt and its hash match); the tool allowlist is `tools: [...]` in the agent file (no CLI flag; `[Read, Grep]` gave exactly those two tools); a custom agent reads neither `AGENTS.md` nor skills.

- **Kit variant** (`kimi/kits/<role>`): the Claude card plus a hand-condensed `## Method` section (from the same skill sources; the skill files themselves are not rewritten), no `plugin/`. The reviewer has no skill and its kimi card is the Claude card. **Card cap: 4096 bytes** (the Claude cap is 2048): the method that the Claude kit ships as a plugin skill has to live in the card, and 4 KB (measured cards: 1.5 to 2.4 KB) keeps the card small next to the task input. Placebo (`kimi/placebo/<role>`) is within 5% of the kimi card, same tools.
- `compile-kit.js --runner kimi` prints `-p --agent-file <agent.md>`, `KIMI_CODE_HOME`, and the generated agent file (frontmatter `name`, `description`, `tools: [...]`, then the card). A kit with `plugin/` is refused for kimi; `tools: []` is only a warning because the spike did not exercise an empty list.
- **Reporting:** weak2 gets the same arithmetic in a separate `weak2_report`; nothing in the verdict rules 1 to 8 reads it, and weak2 infra cannot cause INCONCLUSIVE_INFRA.
- **Precondition before the formal run:** one minimal real-model check per weak seat (Haiku and kimi, same method: a nonce in a throwaway copy of the compiled card, the runner's session record equal to the compiled kit, a reply containing the nonce). `stamp-rolekit.js` refuses the formal stamp until `prereg/preconditions-formal.json` lists `real-check-weak1` and `real-check-weak2` with `met: true` and an evidence path. Model-follows-card is UNVERIFIED for both until then.
- **Cost:** kimi cells run on the kimi-code subscription (its own quota), not the Claude quota. No unit price is measured; the cost table uses the Haiku rate as a labelled placeholder so the cells still count against the estimate and the 75 USD cap.
- **flash (agy 1.5.0): unproven, not a candidate.** Without credentials agy cannot create a request (it asks for OAuth first), so the injected card cannot be observed, and a non-empty tool allowlist cannot be discovered with zero calls; the empty-allowlist evidence in the repo is from older agy versions. Recorded as `seats_not_used` in `formal.json`.

## Prereg, stamping, cost

`prereg/pilot.json` and `prereg/formal.json` are drafts. The existing `skill-onoff/stamp-prereg.js` needs packs and arm manifests; a role-kit arm is a directory, so `stamp-rolekit.js` is the same idea (digest every frozen file into `prereg/FROZEN.json`, refuse a second stamp, `--check` re-derives). The PM runs `node evals/rolekit/stamp-rolekit.js --row pilot --authorized-by <id>` before any real cell. The formal task set is not frozen yet (see `task_set` in `formal.json`).

The formal row estimates 29.98 to 38.56 USD (1014 cells; 57.84 USD with the 50% margin) against the 75 USD cap that includes pilot spend; the pilot estimates 5.17 to 7.15 USD (126 cells) with its own 15 USD cap. Only one Haiku cell cost is recorded (0.0162 USD) and no Haiku tool-loop cost exists, so the pilot's per-role measured cost is an explicit output (`score-rolekit.js` pilot mode) and gate G5.

## compile-kit

```
node compile-kit.js --kit kits/debugger --runner claude|codex|agy [--config-dir D] [--json]
```
Prints the argv/env/files it maps to and validates the kit; it never runs a binary and writes nothing.
claude: `-p --setting-sources project --strict-mcp-config --system-prompt <role.md> [--plugin-dir <plugin>] --tools <list>`, env `CLAUDE_CONFIG_DIR` (the rail seeds credentials). codex: `CODEX_HOME` with `AGENTS.md` and `skills/`; **no tool allowlist** (warning). agy: `HOME` with `GEMINI.md`; **no allowlist, skills not read** (warnings). Verified vs unverified status is printed per runner and follows plan 3.2.

## Reuse

| asset | how |
|---|---|
| `evals/known-bad`, `skill-transport/match` | reviewer tasks and the predicate rule (re-implemented inline in `check-cell.js`, tested against the same files) |
| `skill-transport` placebo idea, discordant pairs, flip band | arm C and the B-vs-C test (exact binomial) |
| `skill-onoff` prereg/FROZEN/stamp shape, `--max-budget-usd`, auth/quota stop (exit 4) | prereg fields, `stamp-rolekit.js`, stop-loss; the runner itself (a kit runner using `compile-kit.js`) is the railkit lane's |
| `orchestration/tasks`, `va-eval-*` | implementer, debugger, explorer, verifier tasks |
| `engine-qualify` per-role exams | formal-phase sources (implementer, verifier, reviewer clean controls) |

## Negative controls

Every grader or check has at least one test where a bad output must be judged a failure, next to a good output so the control cannot pass by failing everything. "Result" is what the grader returned for the bad output.

| grader | negative-control test (file: name) | bad output | result |
|---|---|---|---|
| check-cell reviewer | checks.test.js: reviewer: a matching critical finding ... | cited line outside every hunk; SHIP-AS-IS verdict; minor severity; matching words but off-topic claim | exit 1 (miss), detail false_must_fix=1 |
| check-cell reviewer kb-05, kb-09 | negative-controls.test.js: negctl reviewer kb-05 / kb-09 | unrelated claim; SHIP-AS-IS; correct claim citing line 5 (outside the hunk) | exit 1 |
| check-cell (all roles), answer file | checks.test.js: answer file problems | prose instead of JSON; a JSON array | exit 1; a missing answer file is exit 2 (infra) |
| check-cell implementer | checks.test.js: implementer: the real fix ...; implementer t1 and t4 ... | untouched repo (oracle red); red evidence with exit 0; edited `run-tests.sh`; no workdir | exit 1 (detail names the protected file); no workdir exit 2 |
| check-cell verifier | checks.test.js: verifier: a plan derived from the contract passes ... (3 cases) | wrong declared value; empty plan; wrong case_id | exit 1 (declared_mismatch, malformed_plan) |
| check-cell planner | checks.test.js: planner: a complete disjoint plan passes ...; negative-controls.test.js: negctl planner d2 / dc-l-api / d8 | empty boundaries; prose acceptance; shared parallel scope; no dependency edge; scope not in the repo; uncovered docs/; cycle; no risks; empty acceptance | exit 1, detail names the broken property |
| check-cell debugger | checks.test.js: debugger: the planted cause passes ...; negctl debugger t4 / t11 / t15 | decoy file blamed; wrong line; one hypothesis; no confirmed hypothesis; repo edited | exit 1 (decoy_blamed, repo_clean=false) |
| check-cell explorer | checks.test.js: explorer: real citations ...; negctl explorer t4 / t11 | fabricated line or quote; path escape; citation on an absent thing; missing answer | exit 1; score 2/3 for the missing answer |
| score-rolekit formal | score.test.js: score-rolekit: a row outside the frozen schedule ...; scheduled cells that were never submitted count as infra; headroom exactly 0.15; harm exactly -0.10; gap_closed exactly 0.5; the discordant p value is compared exactly; a kit no better than the placebo | extra or duplicate row; B's failing cells quietly dropped; A=0.55 D=0.70; A=0.70 B=0.60; B equal to placebo; thresholds written as 5e-1 | refused; INCONCLUSIVE_INFRA; headroom (not no_headroom); harm; NOT_SHIP; refused |
| score-rolekit pilot | score.test.js: score-rolekit: pilot G5 ...; pilot G6 ...; pilot gates G1-G4 ... | cost missing / NaN / negative / a string; no evidence, failing tests, a grader without a negative control, sentinel call, wrong row, malformed head; kit_applied=false; unparsable answers; every arm at ceiling; a third of the cells missing | PILOT_FIX naming G5, G6, G2, G3, G4, G1 |
| infra vs miss (check-cell) | hardening.test.js: infra classification (2 tests) | a task file deleted or corrupt, an invalid pattern in expected.json (must be rc 2); garbage answers such as `[null, 5]` (must be rc 1, no crash) | rc 2 / rc 1 |
| verifier vendored dependencies | hardening.test.js: vendored verifier dependencies | a grader patched to always pass; a changed or missing generator | rc 2, grader not run |
| implementer harness | hardening.test.js: implementer: an oracle.sh committed by the candidate ...; implementer fixtures ... | committed fake oracle with the bug unfixed; committed edit of run-tests.sh; rewritten base commit; deleted .git | rc 1 (the fixed tree passes: rc 0) |
| reviewer predicates | hardening.test.js: reviewer: a claim with the right keyword but the wrong point | `emit_event should be renamed`, `flock timeout is a style choice`, `-ge operator is used`, `jq is used here`, a right claim on a far line | rc 1 |
| debugger evidence | hardening.test.js: debugger: one confirmed plus one open ... | confirmed + open; evidence [null]; empty strings; dangling evidence_ref | rc 1 |
| planner scopes | hardening.test.js: planner: a dependency chain ... | `./lib/hooks.js` vs `lib/hooks.js`; `lib/../lib/hooks.js`; `../x`; absolute path | rc 1 (a chain A->B->C sharing a file passes) |
| skill frontmatter | hardening.test.js: skill frontmatter | unquoted `: ` in a description; unterminated quote; no description | validator error (PyYAML parses every shipped SKILL.md) |
| compile-kit kimi | kimi.test.js: compile-kit kimi: negative controls | a Claude kit with plugin/; a kimi card of 4097+ bytes; a kimi card under the Claude cap | refused with its own reason |
| weak2 isolation | kimi.test.js: score-rolekit: weak2 (kimi) results never change the verdict | weak2 winning, losing, all-zero or entirely missing | verdict identical; a weak2 win cannot rescue a weak1 loss |
| formal preconditions | kimi.test.js: stamp-rolekit formal | no preconditions file; one id missing; met=false; empty evidence | stamp refused, nothing written |
| score-rolekit CLI binding | binding.test.js: score-rolekit: the CLI scores only a stamped root ...; duplicate task ids ... | unstamped row; manifest with invented ids; edited prereg; changed grader; a stamper replaced by `exit 0`; `--prereg`/`--tasks`; duplicate ids | rc 2 naming the file / refused |
| G6 evidence replay | binding.test.js: score-rolekit: G6 evidence is tied to the tree ... | evidence collected before a test was edited; a partial run; a hand-typed identity; a `head_sha`-only file | PILOT_FIX, G6 (artifact_sha256 does not match) |
| answer file read | binding.test.js: check-cell: an answer file that exists but cannot be read | a directory as --answer; chmod 000 file | rc 2 (invalid JSON stays rc 1) |
| prototype keys | binding.test.js: check-cell: answer-controlled keys ... | file or id or q = constructor, __proto__, hasOwnProperty, toString, valueOf, objects, null, 5; a tracked file named `constructor` | rc 1, never rc 2 |
| task-dir binding | binding.test.js: check-cell: --task-dir must be a frozen task | fabricated trivial task outside tasks/; another role; a directory above; a symlink to a fake | rc 2 |
| collect-evidence | score.test.js: collect-evidence derives graders_red ... | a partial run of the tests | graders_red lists only graders whose negative control passed |
| compile-kit validator | kits.test.js: negative controls: each broken kit is rejected | oversized role.md; missing role.md or tools; unknown, duplicate or two-line tools; symlink; second skill; stray plugin file; no plugin.json; extra top-level entry | exit 2 with its own reason |
| build-tasks --check | frozen-tasks.test.js: negative control: --check refuses a frozen file that changed | a prompt edited after freezing | exit 2 |
| stamp-rolekit | stamp.test.js: (a) after stamping ...; (b) a second stamp is refused ...; (c) the receipt ...; stamping without --authorized-by | edited task, role card, placebo, skill, tools, check, score script, prereg rule, cost model; added or deleted frozen file; tampered receipt field; second stamp; missing authoriser; placebo size drift | `--check` exit 2 naming the file or receipt field; stamp refused and nothing written |

Pilot G6 evidence is produced, not typed: `node collect-evidence.js --row rolekit-pilot --sentinel-calls <N> > <file outside the root>` (run under the suite wrapper) runs the unit tests itself, lists a grader only if a test of its negative control passed, and derives the identity of what it tested (`lib-identity.js`: sha256 over every file under `evals/rolekit/`, tests included; the stamp files are excluded because `--check` covers them). `score-rolekit.js` recomputes that identity from the tree it is scoring and accepts G6 only if it is equal, if the run covered every test file, and if all the other conditions hold; evidence collected before a grader or a test was edited is void. `--sentinel-calls` is the one attested number (the wrapper prints it); only the integer 0 is accepted.

Scoring is bound to the stamped root: `node score-rolekit.js --row pilot --results R [--evidence E]` first runs `stamp-rolekit.js --row pilot --check` (an unstamped row or any changed frozen file is refused), checks that `stamp-rolekit.js`, `score-rolekit.js` and `lib-identity.js` are the frozen ones, and reads the prereg and the task manifest only from the stamped root; there are no `--prereg` or `--tasks` options. The stamper, the scorer and the collector are the trust root: run them from a checkout you trust (an independent `--check` of a copy is the way to audit them). `check-cell.js --task-dir` must be a frozen task of that role under its own `tasks/`.

Stamp receipt: `stamp-rolekit.js --row <row> --authorized-by <id>` writes `prereg/receipt-<row>.json` (schema_version, stamped_at, authorized_by, prereg_sha256, one digest each for kits, placebo, tasks, checks and the verdict code) next to `FROZEN.json`; `--check` re-derives all of it. Every receipt field is compared with a recomputed value or with metadata pinned in `FROZEN.json` (authoriser, stamped_at, receipt sha256, file count); a swapped-in legal value is red.

## Tests

`bash <suite env> node --test evals/rolekit/test/kits.test.js evals/rolekit/test/checks.test.js evals/rolekit/test/prereg.test.js evals/rolekit/test/frozen-tasks.test.js evals/rolekit/test/stamp.test.js evals/rolekit/test/negative-controls.test.js evals/rolekit/test/hardening.test.js evals/rolekit/test/score.test.js evals/rolekit/test/kimi.test.js evals/rolekit/test/binding.test.js`
