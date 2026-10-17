#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

# Every relative require() in the Codex mirror must resolve inside the mirror,
# and the mirrored engine-qualify.js must actually load (BL-0010 review: the
# foreman evals were missing from the mirror and broke every role's exam).
OUT="$(node -e '
const fs = require("fs");
const path = require("path");
const root = path.join(process.argv[1], "platforms/codex/plugin");
const missing = [];
const seen = new Set();
function resolve(base) {
  return [base, base + ".js", base + ".cjs", base + ".json", path.join(base, "index.js")]
    .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}
function visit(file) {
  if (seen.has(file)) return;
  seen.add(file);
  if (!/\.(js|cjs)$/u.test(file)) return;
  // Its require() calls sit inside fixture source strings, not in its own code.
  if (path.basename(file) === "impl-eval-generator.js") return;
  const text = fs.readFileSync(file, "utf8");
  for (const match of text.matchAll(/\brequire\(\s*["\x27](\.{1,2}\/[^"\x27]+)["\x27]\s*\)/gu)) {
    const found = resolve(path.resolve(path.dirname(file), match[1]));
    if (!found) missing.push(path.relative(root, file) + " -> " + match[1]);
    else visit(found);
  }
}
// Roots: the mirrored exam entry point and every mirrored foreman file or test.
const roots = [path.join(root, "scripts/engine-qualify.js")];
for (const dir of ["evals", "scripts"]) {
  for (const name of fs.readdirSync(path.join(root, dir))) {
    if (/^foreman-.*\.js$/u.test(name)) roots.push(path.join(root, dir, name));
  }
}
for (const file of roots) {
  if (!fs.existsSync(file)) missing.push("root missing: " + path.relative(root, file));
  else visit(file);
}
console.log("scanned " + seen.size + " mirror files from " + roots.length + " roots");
for (const entry of missing) console.log("UNRESOLVED " + entry);
process.exit(missing.length ? 1 : 0);
' "$REPO_ROOT" 2>&1)"
RC=$?
assert_exit_code "$RC" "0" "every relative require in the codex mirror resolves inside the mirror"
assert_contains "$OUT" "scanned" "the closure scan ran"

LOAD="$(cd "$REPO_ROOT/platforms/codex/plugin" && node -e 'require("./scripts/engine-qualify.js"); console.log("mirror engine-qualify loaded")' 2>&1)"
assert_contains "$LOAD" "mirror engine-qualify loaded" "the mirrored engine-qualify.js loads"

finalize_test
