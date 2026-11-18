#!/usr/bin/env bash
set -u
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/.claude-plugin" "$tmp/hooks" "$tmp/mods"
printf '%s\n' '{"name":"autopilot","version":"0.0.0","types":"./mods/live/types/index.d.ts"}' > "$tmp/.claude-plugin/plugin.json"
printf '%s\n' '{"modules":["../mods/live/register.ts"]}' > "$tmp/hooks/hooks.json"
python3 - "$tmp" "$@" <<'INNER'
import sys, shutil, os, subprocess
from pathlib import Path
root=Path(sys.argv[1]); selected=set(sys.argv[2:])
for name in ['live','viewer']:
    for p in Path('mods',name).rglob('*'):
        if not p.is_file() or 'evidence' in p.parts or p.name.endswith('.log'): continue
        if (p.name.endswith('.test.ts') or p.name.endswith('.test.js')) and str(p) not in selected: continue
        dest=root/p; dest.parent.mkdir(parents=True,exist_ok=True)
        base=os.environ.get('PANE_R3_BASE_REF')
        if base and name == 'live' and not p.name.endswith(('.test.ts','.test.js')):
            result=subprocess.run(['git','-C',str(Path.cwd()),'show',base+':'+str(p)],capture_output=True)
            if result.returncode != 0: raise RuntimeError(result.stderr.decode())
            dest.write_bytes(result.stdout)
        else: shutil.copyfile(p,dest)
INNER
. mods/lib/real-claude-env.sh
AUTOPILOT_MODS_REAL_CLAUDE=/home/team/.local/share/claude/versions/2.1.327 mods_run_plugin_test "$tmp"
