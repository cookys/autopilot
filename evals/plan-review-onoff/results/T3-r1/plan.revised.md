# Implementation plan

## Scope

Add email validation to `validateUser` in `src/validate.js`, extend `tests/run.sh`, and add the npm scripts and ESLint setup needed to verify the change. Limit email parsing to the syntax rules below. Full RFC 5322 parsing, deliverability checks, runtime dependencies, and unrelated modules are outside scope.

## Steps

1. **Establish the baseline.** Confirm that `tests/run.sh` exists and contains the supplied name-only success case. Run `npm run check` from the repository root and confirm the existing suite passes.

2. **Add regression tests before changing the validator.** Give the existing success case a valid email and assert `{ ok: true }`. Add exact-result assertions for omitted and `undefined` email, empty and whitespace-only strings, non-string values including `null`, and malformed strings. Cover a missing local part, a missing `@`, repeated `@`, embedded whitespace, a single-label domain, and empty domain labels. Verify that an invalid name still returns `{ ok: false, error: 'name required' }` when the email is also invalid. Run `npm run check` against the unchanged validator and confirm it exits nonzero because a valid name with an omitted email is incorrectly accepted.

3. **Implement email validation.** Keep the existing name check first and preserve its `name required` result. For a valid name, return `{ ok: false, error: 'email required' }` if the email is omitted, `undefined`, empty, or entirely whitespace. Return `{ ok: false, error: 'invalid email' }` for other non-string values or strings that fail the syntax check. Require a nonempty local part, exactly one `@`, at least two nonempty dot-separated domain labels, and no whitespace anywhere in the address. Return `{ ok: true }` when both checks pass.

4. **Set up the npm verification commands.** Keep `check` as `node scripts/check.js`, add `test` as `npm run check`, and add `lint` as `eslint src/validate.js scripts/check.js`. Run `npm install --save-dev --save-exact eslint@9` and include the resulting lockfile. Create `eslint.config.cjs` using ESLint 9’s flat config. Set `sourceType` to `commonjs` for the two linted files and enable `no-unused-vars` as an error. If installation fails because of registry access, retry with a populated npm cache or an available project-approved registry. If installation remains blocked, run the available test command and report lint verification as blocked.

5. **Verify that lint catches a violation.** Once ESLint is installed and the `lint` script is in place, temporarily add an unused variable to `src/validate.js`. Run `npm run lint` and confirm it exits nonzero with a `no-unused-vars` diagnostic for that variable. Remove the temporary line before final verification.

6. **Verify the final state.** From the repository root, run `npm test` and `npm run lint` after both scripts are configured and ESLint is installed. Resolve any failures and rerun both commands after the last change. Completion requires both commands to exit successfully.
