# Rubric — Codex plan-review trusted cwd fix

- R1: The implementation binds the Codex plan-review child cwd and `--repo-root` argument to the
  same canonical reviewed Git repository without disabling Codex repository-trust checks.
- R2: Private prompt permissions and the runner-specific isolation posture remain intact; non-Codex
  seats do not inherit an unintended repository cwd.
- R3: Deterministic tests prove the positive canonical binding and a pre-spend negative invalid-repo
  path, and the Codex generated mirror is byte-identical.
- R4: Focused tests, sync validation, repository validation, and diff hygiene pass with no unrelated
  compatibility layer or scope expansion.
