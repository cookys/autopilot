# Sync worker retry plan

## Scope

- **In scope** — Wire T-17’s `RetryConfig` into `syncOnce`, implement bounded retries with backoff in `src/sync/worker.js`, and verify the policy in `tests/worker.test.js`.
- **Out of scope** — Implementing T-17, changing `src/sync/client.js` or receiving endpoint deduplication, and altering T-12 batching, T-15 client timeouts, or T-18 metrics.

## Implementation

1. **Confirm the T-17 contract.** T-17 is absent from the supplied task board. Confirm its status and delivery point with the owning team. Obtain the schema’s import path, validation rules, defaults, attempt-counting semantics, and backoff rules. The delivered schema is a prerequisite for implementing and verifying the integration.

2. **Resolve how the worker receives configuration.** Search the full task repository for additional `syncOnce` callers and an existing configuration path. The supplied files show only the test caller and establish no configuration path. Resolve that wiring prerequisite before implementation. If a suitable path exists, validate `RetryConfig` at its existing configuration boundary and pass it to the worker. Otherwise, add an optional third argument, `syncOnce(client, batch, retryConfig)`, and validate explicit configuration with the T-17 schema before the first push. In either case, preserve `syncOnce(client, batch)` with T-17 defaults and preserve the successful `client.push` return value.

3. **Define retry eligibility and terminal outcomes.** Cover both rejected pushes and unsuccessful HTTP responses, because `fetch` resolves for HTTP errors. Apply T-17’s eligibility rules where specified. Resolve any remaining cases against the receiving endpoint’s replay guarantees before enabling retries, particularly when a request may have been applied before its response was lost. Preserve the existing caller-facing contract on terminal failure by propagating the final rejection or returning the final unsuccessful response, as applicable.

4. **Implement bounded retries.** Push immediately on the first attempt. After an eligible failure, wait for the configured backoff only if another attempt remains. Retry the same batch with at most one push in flight per `syncOnce` call. Stop on success, an ineligible failure, or exhaustion of the configured attempt budget.

## Verification

5. **Prove each new or changed test can detect its regression.** Use a controlled clock or delay stub to assert the backoff schedule without real waits. Cover first-attempt success and return-value preservation, recovery after a retryable rejection, attempt exhaustion with no final delay, immediate termination on an ineligible failure, retryable and ineligible HTTP responses, and configuration validation and defaults using the real T-17 schema. Run each new or changed test against the original worker or a temporary, targeted defect and confirm it fails for the expected assertion before confirming it passes with the correct implementation. Use targeted defects for checks the original worker already passes. For example, alter the returned success value, skip a delay, allow one extra attempt, retry an ineligible failure, treat an HTTP error as success, or bypass schema validation or defaults. Remove all temporary defects before the passing run.

6. **Run the tests.** Run `node --test tests/worker.test.js` with the correct implementation. During repository inspection, check for a broader suite in the package scripts, test runner, or CI configuration. If one exists, record its exact command and run it. The worker test command is the only one established by the supplied files.
