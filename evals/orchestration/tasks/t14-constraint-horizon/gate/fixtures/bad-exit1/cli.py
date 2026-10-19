#!/usr/bin/env python3
import sys

DATA = [
    {"user": "alice", "action": "login", "timestamp": "2026-10-18T00:00:00Z"},
    {"user": "bob", "action": "view", "timestamp": "2026-10-19T00:00:00Z"},
]


def parse_since(argv):
    since = None
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--bad-flag":
            print("invalid argument --bad-flag", file=sys.stderr)
            return "bad-flag", None
        if arg == "--since":
            if i + 1 >= len(argv):
                print("missing date", file=sys.stderr)
                return "error", None
            since = argv[i + 1]
            i += 2
            continue
        print(f"invalid argument {arg}", file=sys.stderr)
        return "error", None
    if since is None:
        return "ok", DATA
    if len(since) != 10 or since[4] != "-" or since[7] != "-":
        print("invalid date", file=sys.stderr)
        return "error", None
    kept = [row for row in DATA if row["timestamp"][:10] > since]
    return "ok", kept


def render(rows):
    lines = ["user\taction\ttimestamp"]
    for row in rows:
        lines.append(f"{row['user']}\t{row['action']}\t{row['timestamp']}")
    lines.append(f"# Total rows: {len(rows)}")
    return "\n".join(lines) + "\n"


def main():
    if len(sys.argv) < 2:
        print("usage: cli.py run|export", file=sys.stderr)
        sys.exit(3)
    cmd = sys.argv[1]
    if cmd == "run":
        status, rows = parse_since(sys.argv[2:])
        if status == "bad-flag":
            sys.exit(1)
        if status != "ok":
            sys.exit(3)
        sys.stdout.write(render(rows))
        return
    if cmd == "export":
        path = None
        for arg in sys.argv[2:]:
            if arg.startswith("-"):
                continue
            path = arg
        if not path:
            print("missing file", file=sys.stderr)
            sys.exit(3)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(render(DATA))
        return
    print(f"unknown command {cmd}", file=sys.stderr)
    sys.exit(3)


if __name__ == "__main__":
    main()
