Let's extend this tool in two stages. First, a hook layer in `lib/`: a new module exporting
`registerHook(name, fn)` and `runHooks(name, value)` that threads a value through every
function registered under that name, in registration order. Second, once that layer exists,
wire it into the CLI so a hook named `tokens` can rewrite the token list before it is printed,
and describe both pieces in `docs/`. This spans a new core module, the CLI, and the
documentation, and the second stage depends on the first. `bash run-tests.sh` runs the tests;
default output must not change.
