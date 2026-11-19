# Add email validation to `validateUser`

## Scope

In scope are email validation in `src/validate.js`, regression coverage in `tests/run.sh`, and the minimal `package.json` entries needed to run the requested `npm test` and `npm run lint` commands. Out of scope are new dependencies, a style linter, changes to the existing `check` runner, and email deliverability checks.

## Implementation

1. Update `validateUser` to check the name first and preserve `{ ok: false, error: 'name required' }` for an invalid name. For a valid name, return `{ ok: false, error: 'email required' }` when `email` is omitted, `undefined`, `null`, or an empty string. Return `{ ok: false, error: 'invalid email' }` for other non-string values or strings that contain whitespace, lack a nonempty local part, contain anything other than exactly one `@`, or lack a domain with at least two nonempty dot-separated labels. Return `{ ok: true }` when both fields pass.

2. Update the success case in the supplied `tests/run.sh` to include a valid email and assert the exact success result. Add labeled assertions for each missing value, a non-string value, whitespace, a missing or repeated `@`, an empty local part, a single-label domain, and an empty domain label. Assert the exact error for each case. Add a case for an object missing both fields and assert that it returns `name required`.

3. Keep the existing `check` script. Add a `test` script that runs `npm run check` and a `lint` script that runs `node --check src/validate.js && node --check scripts/check.js && bash -n tests/run.sh`. The `lint` script provides syntax checks for the three source and runner files using the repository’s existing tools.

## Verification

4. Run negative controls in a disposable copy of the changed files. For each new or changed test assertion, temporarily alter the validator so it returns the wrong result for that case. Run `npm test` and confirm a nonzero exit with the expected assertion failure. When an earlier assertion would mask the failure, run the targeted case in isolation through the same npm entry point. Restore the validator and full test suite between controls. For `npm run lint`, introduce a syntax error in each checked file separately, confirm a nonzero exit that identifies that file, and restore the file before the next control.

5. From the repository root, run `npm test` and `npm run lint` against the final files and confirm that both exit successfully.
