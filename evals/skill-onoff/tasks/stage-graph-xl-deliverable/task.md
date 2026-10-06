We are cutting a release of this metrics tool with three deliverables. They are independent of each
other, each is shippable alone, and each needs its own module under `lib/`, its own CLI subcommand,
its own tests in `run-tests.sh` and its own page under `docs/`:
(A) an exporter: `export --format csv|ndjson` writing the records to stdout, with correct quoting
of commas and quotes in values;
(B) an importer: `import <file> [--dry-run]` that validates each row (id is a positive integer, name
non-empty, value numeric), reports every bad row with its line number, and only adds rows when the
whole file is valid;
(C) an activity log: every add/import/export appends one line to a log file, and the file rotates
to `<name>.1` once it passes a configurable number of lines.
`bash run-tests.sh` runs the tests. Commit as you go.
