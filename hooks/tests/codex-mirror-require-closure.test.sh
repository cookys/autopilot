#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

# # RED at 572041858: FAIL [codex-mirror-require-closure] every relative require in the codex mirror resolves inside the mirror: expected exit 0, got 1

# Every relative require() in the Codex mirror must resolve inside the mirror,
# and the mirrored engine-qualify.js must actually load (BL-0010 review: the
# foreman evals were missing from the mirror and broke every role's exam).
# The second argument, when present, is an arbitrary root: every .js/.cjs under
# it is a scan root. Comment text is stripped before require() is matched.
read -r -d '' SCANNER <<'END' || true
const fs = require("fs");
const path = require("path");
function stripComments(text) {
  let out = "";
  let state = "code";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (state === "code") {
      if (c === "'") { state = "sq"; out += c; }
      else if (c === '"') { state = "dq"; out += c; }
      else if (c === "`") { state = "tpl"; out += c; }
      else if (c === "/" && n === "/") { state = "line"; out += " "; i++; }
      else if (c === "/" && n === "*") { state = "block"; out += " "; i++; }
      else out += c;
    } else if (state === "sq" || state === "dq" || state === "tpl") {
      const end = state === "sq" ? "'" : state === "dq" ? '"' : "`";
      out += c;
      if (c === "\\") { if (n !== undefined) { out += n; i++; } }
      else if (c === end) state = "code";
    } else if (state === "line") {
      if (c === "\n") { state = "code"; out += "\n"; }
      else out += " ";
    } else if (state === "block") {
      if (c === "*" && n === "/") { state = "code"; out += " "; i++; }
      else out += c === "\n" ? "\n" : " ";
    }
  }
  return out;
}
const root = process.argv[2] || path.join(process.argv[1], "platforms/codex/plugin");
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
  const text = stripComments(fs.readFileSync(file, "utf8"));
  for (const match of text.matchAll(/\brequire\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/gu)) {
    const found = resolve(path.resolve(path.dirname(file), match[1]));
    if (!found) missing.push(path.relative(root, file) + " -> " + match[1]);
    else visit(found);
  }
}
// Roots: the mirrored exam entry point and every mirrored foreman file or test.
// A second argument is an arbitrary root: scan every js file under it.
const roots = [];
if (process.argv[2]) {
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (/\.(js|cjs)$/u.test(name)) roots.push(full);
    }
  };
  walk(root);
} else {
  roots.push(path.join(root, "scripts/engine-qualify.js"));
  for (const dir of ["evals", "scripts"]) {
    for (const name of fs.readdirSync(path.join(root, dir))) {
      if (/^foreman-.*\.js$/u.test(name)) roots.push(path.join(root, dir, name));
    }
  }
}
for (const file of roots) {
  if (!fs.existsSync(file)) missing.push("root missing: " + path.relative(root, file));
  else visit(file);
}
console.log("scanned " + seen.size + " mirror files from " + roots.length + " roots");
for (const entry of missing) console.log("UNRESOLVED " + entry);
process.exit(missing.length ? 1 : 0);
END
OUT="$(node -e "$SCANNER" "$REPO_ROOT" 2>&1)"
RC=$?
assert_exit_code "$RC" "0" "every relative require in the codex mirror resolves inside the mirror"
assert_contains "$OUT" "scanned" "the closure scan ran"

LOAD="$(cd "$REPO_ROOT/platforms/codex/plugin" && node -e 'require("./scripts/engine-qualify.js"); console.log("mirror engine-qualify loaded")' 2>&1)"
assert_contains "$LOAD" "mirror engine-qualify loaded" "the mirrored engine-qualify.js loads"

# Negative controls: the same scanner, pointed at a fixture root (second argument).
FIX_REAL="$(mktemp -d)"
FIX_COMMENT="$(mktemp -d)"
cat > "$FIX_REAL/real-missing.js" <<'EOF'
'use strict';
require("./no-such-relative.js");
EOF
cat > "$FIX_COMMENT/comments-only.js" <<'EOF'
'use strict';
const url = "http://example.com/not-a-comment";
// require("./missing-in-line-comment.js")
/*
 require("./missing-in-block-comment.js")
*/
const fs = require("fs");
EOF
REAL_OUT="$(node -e "$SCANNER" "$REPO_ROOT" "$FIX_REAL" 2>&1)"
REAL_RC=$?
assert_exit_code "$REAL_RC" "1" "a real require of a missing relative file is UNRESOLVED"
assert_contains "$REAL_OUT" "UNRESOLVED" "the missing relative require is reported"

COMMENT_OUT="$(node -e "$SCANNER" "$REPO_ROOT" "$FIX_COMMENT" 2>&1)"
COMMENT_RC=$?
assert_exit_code "$COMMENT_RC" "0" "require text only inside comments is not a require"
assert_not_contains "$COMMENT_OUT" "UNRESOLVED" "commented require of a missing file is not reported"
rm -rf "$FIX_REAL" "$FIX_COMMENT"

finalize_test
