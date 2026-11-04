Find the root cause of this symptom. Do not modify any file in the repository; this is a read-only task. Run commands to reproduce and to test each hypothesis; name the file and line of the root cause.

Symptom: Running the tool with PORT=9999 THEME=dark still prints the values from the config files: environment variables do not win over the files as documented (Env Var > config/override.json > config/defaults.json). A reviewer note blames lib/parser.js.

Final answer: one JSON object with top-level keys "evidence", "hypotheses", "root_cause".
