# Seat schema admits / and . : audit path consumers

BL-0291. Unit oqseat (peer llm-playground, lane/oqseat) lets engine and model ids contain `/` and `.`, so `../x` passes the schema. Audit every consumer that builds a filesystem path from an engine or model id. Today `scripts/lib/seat-id-guard.js` still rejects `..`. Trigger-Type ready. Effort S.
