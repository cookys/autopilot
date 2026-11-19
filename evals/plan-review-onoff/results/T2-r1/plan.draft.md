# Sync worker retry plan

1. **Confirm the T-17 contract.** T-17 is absent from the supplied task board. Confirm its status and delivery point with the owning team, and obtain the `RetryConfig` import path, validation rules, defaults, and attempt-counting and backoff semantics. Treat the delivered schema as a prerequisite for wiring the policy into the worker.

2. **Wire configuration into the sync worker.** Trace the `syncOnce` call sites and pass the validated `RetryConfig` through the existing configuration path. Preserve the `syncOnce(client, batch)` call form using the defaults defined by T-17, and preserve the successful `client.push` return value.

3. **Define which failures can be retried.** Account for both rejected promises and unsuccessful HTTP responses, since `fetch` resolves for HTTP errors. Apply any retry eligibility rules supplied by T-17. If the schema leaves eligibility open, confirm which failures can safely be retried and whether the receiving endpoint deduplicates repeated pushes, especially when a request may have succeeded before its response was lost.

4. **Implement bounded retries in `src/sync/worker.js`.** Push immediately on the first attempt. After an eligible failure, wait for the configured backoff before retrying the same batch, with one push in flight per `syncOnce` call. Return on success. Surface the terminal failure when the policy stops further retries, and skip the delay when no attempt remains.

5. **Verify behavior in `tests/worker.test.js`.** Use a controlled clock or delay stub to assert the backoff schedule without real waits. Cover first-attempt success, recovery after a retryable failure, attempt exhaustion, immediate termination on a non-retryable failure, and HTTP error responses. Exercise the real T-17 schema and its defaults, then run `node --test tests/worker.test.js` and the repository’s full test suite.
