#!/usr/bin/env python3
import sys

DATA = [
    {"user": "alice", "action": "login"},
    {"user": "bob", "action": "view"}
]

def cmd_run():
    print("user\taction")
    for row in DATA:
        print(f"{row['user']}\t{row['action']}")

def main():
    if len(sys.argv) > 1 and sys.argv[1] == "run":
        cmd_run()
    else:
        print("Usage: cli.py run")

if __name__ == "__main__":
    main()
