Find the root cause of this symptom. Do not modify any file in the repository; this is a read-only task. Run commands to reproduce and to test each hypothesis; name the file and line of the root cause.

Symptom: Users changed "port" to 8080 in config/defaults.json but the tool still prints port 3000, and PORT/THEME env vars do not win over the files. A reviewer note blames lib/parser.js.

Final answer: one JSON object with top-level keys "evidence", "hypotheses", "root_cause".
