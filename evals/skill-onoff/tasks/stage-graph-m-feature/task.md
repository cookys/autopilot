This inventory tool needs a `report` subcommand. It should group items by category and show, per
category, the item count and the total value (qty times price), followed by a grand total row.
It should support `--sort name` (default) and `--sort total` (highest category total first), and
`--format table` (default, like `list`) or `--format csv`. Put the grouping/totals logic in its own
module under `lib/`, wire it into `cli.js`, add tests to `run-tests.sh` for the totals, both sort
orders and both formats, and document the subcommand in the README. `bash run-tests.sh` runs the
tests. Commit when done.
