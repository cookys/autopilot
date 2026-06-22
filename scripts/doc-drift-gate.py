#!/usr/bin/env python3
"""Generic deterministic doc-drift gate (Layer 1 baseline) for autopilot:doc-sync.

This is the PORTABLE, project-agnostic baseline: two universal zero-variance checks
that work in any repo with no config — internal markdown link resolution + code-fence
balance. It is the reliable half of doc-sync (see skills/doc-sync/SKILL.md "Two
layers"): a green run means those classes are genuinely clean, so it is gate-able in
CI / pre-merge — unlike the non-deterministic LLM sweep.

Projects EXTEND this with project-specific checks (version-sync, CLI-surface-vs-docs,
roadmap-consistency, …) as the LLM sweep discovers mechanizable drift classes. See
codeforge's scripts/check-doc-drift.py for a 5-check reference implementation.

Usage:
  doc-drift-gate.py [ROOT ...]      # roots to scan (default: cwd)
  --exclude SUBSTR                  # skip paths containing SUBSTR (repeatable;
                                    # defaults: .git, target, node_modules, _archive)
Exit 0 = all green, 1 = a check failed (details printed).
"""
import os
import re
import sys

# Excludes generated/mirror trees: .opencode/agent-bodies and agents/_bodies are
# stripped copies of agents/*.md (their relative links are correct at the SOURCE
# depth, not the mirror's — check the source, not the generated copy).
DEFAULT_EXCLUDES = [".git", "target", "node_modules", "_archive", ".venv",
                    ".opencode", "_bodies"]


def _md_files(roots, excludes):
    out = []
    for root in roots:
        for dirpath, dirs, files in os.walk(root):
            if any(x in dirpath for x in excludes):
                dirs[:] = [d for d in dirs if not any(x in os.path.join(dirpath, d) for x in excludes)]
                continue
            for fn in files:
                if fn.endswith(".md"):
                    out.append(os.path.join(dirpath, fn))
    return sorted(set(out))


# Only validate links that unambiguously point to a repo file — zero false
# positives is the whole point of a gate. We therefore SKIP:
#   - external / anchor / mailto links
#   - template placeholders (contain < > { } | )
#   - GitHub-relative conventions that don't resolve on the filesystem
#     (../commit/<sha>, /issues/, /pull/, /commits/, /releases/, /blob/, /tree/)
#   - extensionless, non-directory targets (can't tell a typo from a convention)
_FILE_EXT = re.compile(r"\.[A-Za-z0-9]{1,8}$")
_GH_REL = re.compile(r"(^|/)(commit|commits|issues|pull|releases|blob|tree|compare|wiki)(/|$)")


def check_links(files):
    bad = []
    for md in files:
        base = os.path.dirname(md)
        with open(md, encoding="utf-8") as f:
            txt = f.read()
        for m in re.finditer(r"\]\(([^)]+)\)", txt):
            link = m.group(1)
            if link.startswith(("http://", "https://", "#", "mailto:")):
                continue
            if any(c in link for c in "<>{}|"):       # template placeholder
                continue
            path = link.split("#")[0]
            if not path or _GH_REL.search(path):
                continue
            # only judge links that clearly target a file (has extension) or a dir
            if not (path.endswith("/") or _FILE_EXT.search(path)):
                continue
            if not os.path.exists(os.path.normpath(os.path.join(base, path))):
                bad.append(f"{os.path.relpath(md)}: {link}")
    return ("links", not bad, bad)


def check_fences(files):
    bad = []
    for md in files:
        with open(md, encoding="utf-8") as f:
            n = sum(1 for line in f if line.lstrip().startswith("```"))
        if n % 2:
            bad.append(f"{os.path.relpath(md)}: {n} fence lines (odd → unbalanced)")
    return ("fences", not bad, bad)


def main(argv):
    roots, excludes = [], list(DEFAULT_EXCLUDES)
    i = 0
    while i < len(argv):
        if argv[i] == "--exclude":
            excludes.append(argv[i + 1]); i += 2
        else:
            roots.append(argv[i]); i += 1
    if not roots:
        roots = ["."]

    files = _md_files(roots, excludes)
    print(f"doc-drift gate (baseline: links + fences) — {len(files)} md files\n" + "=" * 40)
    failed = 0
    for name, ok, details in (check_links(files), check_fences(files)):
        print(f"[{'PASS' if ok else 'FAIL'}] {name}")
        for d in details:
            print(f"       - {d}")
        failed += 0 if ok else 1
    print("=" * 40)
    if failed:
        print(f"{failed} check(s) FAILED")
        return 1
    print("baseline doc-drift checks green")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
