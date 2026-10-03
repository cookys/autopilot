# Final review panel fans out all seats at once — no bounded concurrency

- **Context**: `scripts/lib/review-fanout.js` `main()` runs `Promise.all(jobs.map(runJob))`, so every seat starts at once. Call chain: engine, review, fanout. A host with limited memory or rate limits cannot cap concurrent seats.
- **Fix**: a named config for the concurrency limit (default: all seats, unchanged behaviour). Seats, identity, the canonical receipt and per-seat timeouts stay unchanged.
- **Test**: 4 seats with limit 2 produce 4 bound verdicts and never more than 2 concurrent.
- **Source**: peer-reported cuda/chatgpt-tunnel 2026-10-03, msg 01M40RQEANXNCRZS4B9BC8VB28.
