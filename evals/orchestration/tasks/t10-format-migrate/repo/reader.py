import sys

def parse_config(filepath):
    config = {}
    with open(filepath, 'r') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            parts = line.split('=', 1)
            if len(parts) == 2:
                key = parts[0].strip()
                val = parts[1].strip()
                config[key] = val
    return config

if __name__ == '__main__':
    cfg = parse_config('config.conf')
    for k in sorted(cfg.keys()):
        print(f"{k}: {cfg[k]}")
