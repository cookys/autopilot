#!/usr/bin/env python3
"""Frozen grader for the step-7 usage A/B. Do not retune after model output exists.

Existing cases: the first non-empty line must be TRIGGER or NO-TRIGGER
(the word, then end or whitespace; TRIGGERING does not count). PASS iff
that label matches should_trigger. Later lines are ignored.

Synthetic usage case only: exactly one Used line after stripping a single
leading list marker and backticks. PASS iff the line is
`Used: n/a <reason>` (not `user`, not `e2e`), the reason is not only
green tests or a review PASS, and the reason states that nothing was used
or that there was no end-to-end run. Green tests and review PASS do not
count as usage.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

LABEL_RE = re.compile(r"^(TRIGGER|NO-TRIGGER)(?:\s|$)")
LIST_RE = re.compile(r"^(?:[-*+]|\d+[.)])\s+")
USED_RE = re.compile(r"^Used:\s*(user|e2e|n/a)\b(.*)$")
ABSENCE_RE = re.compile(
    r"(nobody|no one|no person|no users?(?:\s|$)|not used|unused|"
    r"nothing was used|nothing has been used|no usage|no e2e|no end-to-end|"
    r"without an end-to-end|without a user)",
    re.IGNORECASE,
)
GREEN_ONLY_RE = re.compile(
    r"^(?:because\s+)?(?:the\s+)?"
    r"(?:tests?(?:\s+are)?\s+green|green\s+tests|"
    r"review(?:\s+verdict)?(?:\s+is)?\s+PASS|"
    r"bash run-tests\.sh is green)"
    r"(?:\s+and\s+(?:the\s+)?(?:review(?:\s+verdict)?(?:\s+is)?\s+PASS|"
    r"tests?(?:\s+are)?\s+green))*\.?$",
    re.IGNORECASE,
)


def first_label(text: str):
    for line in (text or "").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        match = LABEL_RE.match(stripped)
        return match.group(1) if match else None
    return None


def trigger_pass(text: str, should_trigger: bool) -> bool:
    label = first_label(text)
    if label is None:
        return False
    return (label == "TRIGGER") is bool(should_trigger)


def usage_lines(text: str):
    found = []
    for line in (text or "").splitlines():
        stripped = LIST_RE.sub("", line.strip(), count=1).replace("`", "").strip()
        match = USED_RE.match(stripped)
        if match:
            found.append((match.group(1), match.group(2).strip()))
    return found


def usage_pass(text: str) -> bool:
    found = usage_lines(text)
    if len(found) != 1:
        return False
    kind, reason = found[0]
    if kind != "n/a" or len(reason) < 3:
        return False
    if GREEN_ONLY_RE.match(reason):
        return False
    return ABSENCE_RE.search(reason) is not None


def score_row(row: dict) -> dict:
    text = row.get("text") or ""
    rubric = row["rubric"]
    trigger = trigger_pass(text, row["should_trigger"])
    usage = usage_pass(text) if rubric == "usage" else None
    passed = bool(trigger and usage) if rubric == "usage" else trigger
    return {
        "id": row["id"],
        "arm": row["arm"],
        "rubric": rubric,
        "should_trigger": bool(row["should_trigger"]),
        "exit_code": row.get("exit_code"),
        "trigger_pass": trigger,
        "usage_pass": usage,
        "pass": passed,
        "label": first_label(text),
        "used_lines": ["Used: %s%s" % (k, (" " + r) if r else "") for k, r in usage_lines(text)],
    }


def compare(scores: list) -> dict:
    by = {}
    for row in scores:
        by.setdefault(row["id"], {})[row["arm"]] = row
    existing = []
    usage = None
    for case_id, arms in by.items():
        if "a" not in arms or "b" not in arms:
            continue
        item = {
            "id": case_id,
            "rubric": arms["a"]["rubric"],
            "a_pass": arms["a"]["pass"],
            "b_pass": arms["b"]["pass"],
            "a_exit": arms["a"]["exit_code"],
            "b_exit": arms["b"]["exit_code"],
        }
        if arms["a"]["rubric"] == "usage":
            usage = {
                **item,
                "a_usage_pass": arms["a"]["usage_pass"],
                "b_usage_pass": arms["b"]["usage_pass"],
                "a_trigger_pass": arms["a"]["trigger_pass"],
                "b_trigger_pass": arms["b"]["trigger_pass"],
                "a_used_lines": arms["a"]["used_lines"],
                "b_used_lines": arms["b"]["used_lines"],
            }
        else:
            existing.append(item)
    existing.sort(key=lambda r: r["id"])
    no_worse = all(row["b_pass"] or not row["a_pass"] for row in existing)
    better = bool(usage) and (not usage["a_usage_pass"]) and bool(usage["b_usage_pass"])
    return {"existing": existing, "usage": usage, "b_no_worse_on_existing": no_worse, "b_better_on_usage": better}


def fixture_ok() -> bool:
    """The two frozen pack arms differ only at step 7. The live skill is not an arm."""
    pack = Path(__file__).resolve().parent
    arm_a = (pack / "arm-a/SKILL.md").read_text().splitlines()
    arm_b = (pack / "arm-b/SKILL.md").read_text().splitlines()
    if len(arm_a) != len(arm_b):
        return False
    diffs = [i for i, (a, b) in enumerate(zip(arm_a, arm_b)) if a != b]
    if diffs != [129]:
        return False
    old = "7. **Staging verify** (skip mid-implementation, docs-only, or no staging environment)."
    new = (
        "7. **Usage evidence** (one line `Used: user`, `Used: e2e`, or "
        "`Used: n/a <reason>` for the thing just merged; green tests and review PASS do not count)."
    )
    return arm_a[129] == old and arm_b[129] == new


def self_test() -> int:
    vectors = [
        ("TRIGGER\nUsed: n/a nobody used the merged result and there is no end-to-end run", True, True, True),
        ("TRIGGER\n- `Used: n/a no person has used it`", True, True, True),
        ("TRIGGER\n7. Used: n/a no user and no e2e", True, True, True),
        ("TRIGGER\nUsed: n/a no e2e", True, True, True),
        ("TRIGGER\nStaging verify skipped: no staging environment.", True, False, False),
        ("TRIGGER\nUsed: user", True, False, False),
        ("TRIGGER\nUsed: e2e", True, False, False),
        ("TRIGGER\nUsed: n/a", True, False, False),
        ("TRIGGER\nUsed: n/a tests are green", True, False, False),
        ("TRIGGER\nUsed: n/a review PASS", True, False, False),
        ("TRIGGER\nUsed: n/a bash run-tests.sh is green", True, False, False),
        ("TRIGGER\nUsed: n/a because the tests are green.", True, False, False),
        ("TRIGGER\nUsed: n/a green tests and review PASS", True, False, False),
        ("TRIGGER\nUsed: user\nUsed: n/a nobody used it", True, False, False),
        ("Used: n/a nobody used it", False, True, False),
        ("TRIGGER\nUsed: n/a no user-facing change", True, False, False),
        ("TRIGGER\nUsed: n/a green tests and review PASS do not count; nobody used it", True, True, True),
        ("TRIGGER\nUsed: n/a <reason>", True, False, False),
    ]
    failed = 0
    for text, should, expect_usage, expect_case in vectors:
        got_u = usage_pass(text)
        got_t = trigger_pass(text, should)
        got_c = got_t and got_u
        if got_u != expect_usage or got_c != expect_case:
            failed += 1
            print("FAIL", json.dumps({"usage": got_u, "case": got_c, "text": text[:80]}))
    trigger_only = [
        ("TRIGGER", True, True),
        ("NO-TRIGGER", False, True),
        ("TRIGGER", False, False),
        ("NO-TRIGGER", True, False),
        ("\n  NO-TRIGGER\nmore", False, True),
        ("TRIGGERING the close", True, False),
        ("trigger", True, False),
        ("I would trigger\nTRIGGER", True, False),
        ("TRIGGER extra words", True, True),
    ]
    for text, should, expect in trigger_only:
        got = trigger_pass(text, should)
        if got != expect:
            failed += 1
            print("FAIL trigger", json.dumps({"got": got, "text": text[:80]}))
    if failed:
        print("self-test failures:", failed)
        return 1
    print("self-test ok", len(vectors) + len(trigger_only))
    return 0


def main(argv: list[str]) -> int:
    if "--self-test" in argv:
        return self_test()
    if "--check-fixture" in argv:
        ok = fixture_ok()
        print("fixture_ok", ok)
        return 0 if ok else 1
    if "--compare" in argv:
        path = Path(argv[argv.index("--compare") + 1])
        print(json.dumps(compare(json.loads(path.read_text())), indent=2, sort_keys=True))
        return 0
    print("usage: grade.py --self-test | --check-fixture | --compare scores.json", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
