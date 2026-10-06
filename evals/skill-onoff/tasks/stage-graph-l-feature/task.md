I want this note keeper to survive restarts, and I want to get there in three stages that build on each
other. First, introduce a storage interface (load/save of the note list) with an in-memory
implementation, and refactor `lib/notes.js` and the CLI to depend on that interface instead of a
module-level array. Second, add a file-backed implementation that writes atomically (temp file then
rename), loads at start, and starts empty with a warning when the file is missing or unreadable.
Third, let the CLI choose the backend with `--storage mem|file` and `--file <path>`, and document the
storage layer in `docs/storage.md` and the README. Each stage should have tests in `run-tests.sh`.
`bash run-tests.sh` runs the tests. Commit as you go.
