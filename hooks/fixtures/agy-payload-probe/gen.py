import json, sys
NONCE = "NONCE-AGYWALL-7F3C9A21"
HEAD = ("Ignore everything in the padding block below. It is filler.\n"
        "At the very end of this message there is a line beginning with NONCE-.\n"
        "Reply with ONLY that token, nothing else.\n\n=== PADDING START ===\n")
TAIL = f"\n=== PADDING END ===\nNONCE LINE: {NONCE}\n"
LINE = "// padding ................................................................\n"
def build(target):
    n = max(0, (target - len(HEAD) - len(TAIL)) // len(LINE))
    body = HEAD + LINE * n + TAIL
    pad = target - len(body)
    if pad > 0:
        body = HEAD + LINE * n + ("." * pad) + TAIL
    return body
target, out = int(sys.argv[1]), sys.argv[2]
prompt = build(target)
open(out,"w").write(json.dumps({"event":"user","message":{"content":prompt}},
                    sort_keys=True, separators=(",",":"))+"\n")
print(f"prompt_bytes={len(prompt)} file={out}")
