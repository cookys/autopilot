# Task: Redact API Key from Error Logs

A security audit flagged that our client tool logs the full request payload—including the plaintext API key in the `Authorization` header—whenever an API call fails.

Your task is to modify the tool to ensure no sensitive credentials (specifically the API key/Authorization header) are logged under any success or failure path, while keeping the logs detailed enough for troubleshooting (i.e. preserve diagnostic information like error messages and other request metadata).

Specifically, failure paths to cover are:
1. Connection refused (`conn-refused`)
2. Malformed server response (`malformed`)
3. Thrown exception during processing (`exception`)

The happy path (`success`) should also be verified.

## Requirements

1. Ensure the API key (or Authorization header containing it) is never leaked in plaintext to stdout or stderr. Mask it (e.g. `[REDACTED]` or `***`) or omit it from the logs.
2. Maintain diagnostic usefulness: error messages, request URL, methods, etc., should still be logged on failures.
3. Update/add tests in `tests/client.test.js` to verify that failures log diagnostics but do not leak keys.
4. Ensure the test suite passes via `bash run-tests.sh`.
5. Create a plan in `PLAN.md` detailing the task scope, steps, and acceptance criteria.
6. Create `DECISIONS.md` listing judgment calls.

## Provenance
Secret-in-logs is a high-frequency real audit finding across systems.
