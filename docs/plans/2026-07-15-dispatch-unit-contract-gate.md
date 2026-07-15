# Dispatch unit contract gate — spec / boundary / GO / NO-GO

Status: PROPOSED (follow-up; do not expand the verification-author roster fix)
Spec owner: depth-0 CEO
Origin: 2026-07-15 verification-author incident and repeated oversized author dispatches
Depends on: verification-author roster gate; existing rubric-freeze, disjointness, session-mode, and dispatch-manifest machinery

## Problem

Autopilot already documents a six-element task contract and a seven-element prompt, but the
write rails still accept a free-form prompt as sufficient authorization. `dispatch-hetero.sh`
can start a model without a machine-readable spec, file boundary, GO preconditions, NO-GO
conditions, or unit budget. The post-commit rail can prove that a commit exists; it cannot prove
the dispatch should have started or that the unit was bounded correctly.

This caused two distinct failures:

1. An orchestrator selected an unauthorized verification model because model authorization was
   prose-only.
2. Test-author tasks carried the whole project instead of a small unit, so multiple engines spent
   their wall-time reading/replanning and produced no artifact.

## Decision

Add an immutable, machine-validated **dispatch unit contract**. Under strict L5/L6 paths, a prompt
is task detail, not authorization. No valid contract and no mechanical GO verdict means no runner.

This plan does not replace the existing six/seven-element methodology. It makes its load-bearing
parts executable at the dispatch boundary.

## Frozen v1 contract

Canonical file: JSON validated by `schemas/dispatch-unit-contract.schema.json`.

```json
{
  "schema": 1,
  "unit_id": "author-roster-resolver-tests",
  "role": "implementer|verification-author|reviewer|explorer",
  "goal": "one observable outcome",
  "spec": {
    "path": "docs/plans/2026-07-15-example.md",
    "section": "Frozen v1 contract"
  },
  "base_sha": "40-hex immutable commit",
  "depends_on": ["40-hex commit"],
  "scope": {
    "allow_paths": ["hooks/tests/example.test.sh"],
    "deny_paths": ["scripts/**", "schemas/**"],
    "generated_mirrors": {
      "command": ["scripts/sync-codex-plugin-skills.sh"],
      "allow_paths": ["platforms/codex/plugin/hooks/tests/example.test.sh"]
    },
    "max_files": 1,
    "max_diff_lines": 180
  },
  "go": {
    "required_paths": ["hooks/tests/lib.sh"],
    "required_engine_role": "verifier",
    "required_red_command": ["bash", "hooks/tests/example.test.sh"]
  },
  "no_go": {
    "on_missing_spec": "stop",
    "on_dirty_base": "stop",
    "on_unknown_engine": "stop",
    "on_quota_unavailable": "stop",
    "on_scope_violation": "stop",
    "on_budget_exceeded": "stop",
    "on_clarification_needed": "stop",
    "forbidden_actions": ["push", "merge", "network", "dependency-change"]
  },
  "output": {
    "kind": "commit|raw-artifact|verdict",
    "paths": ["hooks/tests/example.test.sh"]
  },
  "acceptance": [
    {"argv": ["bash", "-n", "hooks/tests/example.test.sh"], "exit": 0}
  ],
  "budget": {
    "wall_seconds": 105,
    "max_attempts": 1,
    "max_context_files": 4
  }
}
```

### Schema rules

- `unit_id`, `role`, `goal`, `base_sha`, `scope`, `go`, `no_go`, `output`, `acceptance`, and
  `budget` are required. Unknown top-level keys fail validation.
- `base_sha` and every dependency are full 40-hex SHAs; branches/tags are not accepted as the
  immutable contract value.
- `allow_paths` is non-empty for write roles. `deny_paths` must not overlap an allowed exact path.
- `generated_mirrors` is optional, but when present both its argv-only repo-declared sync command
  and non-empty mirror `allow_paths` are required. Mirror paths count toward file/diff budgets and
  may not overlap `deny_paths`.
- A generated mirror is authorized only when both its canonical source and exact generated path are
  declared in the same unit. Discovering a pre-commit mirror requirement after dispatch is NO-GO;
  depth-0 must issue a corrected contract rather than bypass the hook or widen scope in prose.
- `max_files >= 1`, `max_diff_lines >= 1`, `wall_seconds` is 10..3600, `max_attempts` is 1..3,
  and `max_context_files` is 1..20.
- Acceptance commands are argv arrays, never shell strings. No `sh -c`, command substitution,
  environment assignment, redirection, or pipe syntax in v1.
- `spec.path` must exist under the consuming repo and the named section must be present.
- `forbidden_actions` is an enum. Absence never means permission; shipped defaults include
  `push`, `merge`, `network`, and `dependency-change`.

## Mechanical GO gate

New command:

```sh
node scripts/dispatch-contract.js check --contract <file> --repo <repo> --json
```

Exit contract: `0=GO`, `2=usage/schema error`, `3=NO-GO`.

GO requires all of the following before a runner process or temp worktree is created:

1. Schema valid and spec section present.
2. Current repository clean; `base_sha` resolves exactly; every dependency is an ancestor of base.
3. Required paths exist.
4. The role's engine tuple comes from the canonical resolver/roster and is known, qualified where
   that role has qualification, and quota/readiness is not `unavailable`.
5. Scope lists and budgets are internally consistent.
6. When `required_red_command` is present, the dispatcher records the command as the required
   base+oracle proof; the normal red/green verifier remains authoritative for execution semantics.
7. Every repo-declared generated mirror required by the allowed canonical paths is represented by
   `scope.generated_mirrors`; omitted mandatory mirrors are a pre-dispatch NO-GO.

The checker emits `{verdict, unit_id, contract_sha256, spec_sha256, reasons, resolved_engine}`.
There is no LLM override and no silent fallback. A changed contract is a new hash and a new GO check.

## Mechanical NO-GO and runtime stop

Pre-dispatch NO-GO is any failed GO condition. Runtime stop is triggered by wall budget, explicit
clarification/question outcome, engine/quota failure, or scope/budget breach. A stopped unit may not
be automatically widened; depth-0 writes a new smaller contract or records a different engine tuple.

After a write rail returns, actual git artifacts are checked:

- changed paths subset `allow_paths` and disjoint from `deny_paths`;
- generated paths subset `generated_mirrors.allow_paths`, produced only by the declared sync argv,
  and byte/parity checks pass after generation;
- actual file count and diff lines within budget;
- output kind/path matches the contract;
- acceptance argv commands are executed by depth-0, never trusted from worker prose.

Reuse `check-disjointness.sh` path semantics where possible. Its green result certifies paths only;
semantic correctness remains review/QC work.

## Dispatch integration

Strict canonical invocation:

```sh
scripts/dispatch-hetero.sh --strict-contract --contract-file <json> --prompt-file <task.md> ...
```

- Active L5/L6 sessions require `--strict-contract`; prompt-only write dispatch fails before runner.
- The dispatcher validates the contract, derives timeout from `budget.wall_seconds`, pins base to
  `base_sha`, then prepends a normalized read-only rendering of the contract to the worker prompt.
- Caller `--base`/timeout/model values that disagree with resolved contract/roster are rejected.
- Manifest/result add `unit_id`, `contract_sha256`, `spec_sha256`, GO verdict, budgets, and actuals.
- `dispatch-status.js` surfaces those fields so depth-0 can see what a live worker is authorized to do.
- `dispatch-author.sh` uses the same contract checker for verification-author role.
- `dispatch-review.sh` support is additive in v1; strict review-contract enforcement follows after
  write/author rails prove stable.
- Native harness Agent calls are out of scope for v1 because their tool schema has no contract-file
  field. A later hook/adapter may gate them; do not scrape free-form prompts in a security boundary.

## Units

1. **C1 schema/checker**: schema, validator, spec hash, generated-mirror declaration, GO/NO-GO fixtures.
2. **C2 write-rail preflight**: strict flag, base/timeout derivation, zero-runner negative proofs.
3. **C3 artifact boundary**: allow/deny/max-files/max-lines validation using git truth.
4. **C4 author rail**: verification-author role plus roster gate composition.
5. **C5 observability/docs**: manifest/status fields, L5/L6 canonical commands, migration.

Each unit has one immutable base, its own allowed paths, RED proof, commit, and review. Never dispatch
this whole plan as one implementation task.

## Required tests

- Missing/malformed contract blocks before fake runner.
- Missing spec section or changed spec hash blocks.
- Branch name in `base_sha`, dirty repo, missing dependency, or missing required path blocks.
- Prompt/manual base/timeout/model mismatch blocks.
- GO fixture reaches fake runner with derived base/timeout and records hashes.
- Out-of-scope path, denied path, excess files, or excess diff lines rejects the artifact.
- A required-but-undeclared mirror blocks before runner start; a declared mirror outside its exact
  mirror allowlist or generated by an undeclared command rejects the artifact.
- Quota unavailable/unknown engine blocks without fallback.
- Worker question/timeout returns stopped and cannot widen/retry past `max_attempts`.
- Legacy non-L5/L6 calls remain compatible during migration; strict L5/L6 prompt-only calls block.

## Migration and non-goals

- Phase 1 is opt-in `--strict-contract`; L5/L6 docs switch only after full tests and payload sync.
- Phase 2 makes active L5/L6 strict mechanically mandatory.
- Existing batch unit files remain supported; a converter can generate contracts, but there is one
  canonical schema after migration.
- No natural-language parser, model-authored GO verdict, automatic scope widening, auto-fallback,
  or secret-bearing contract fields.
