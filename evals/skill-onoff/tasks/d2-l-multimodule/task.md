Let's implement a plugin API for the parser: add a public `registerPlugin(name, fn)` interface
in `lib/`, wire plugin execution into `cli.js`, and document the new interface in `docs/`.
This spans the parser core, the CLI surface, and the documentation. `bash run-tests.sh` runs
the tests.
