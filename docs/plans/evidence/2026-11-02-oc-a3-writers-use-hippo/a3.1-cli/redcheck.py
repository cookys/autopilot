#!/usr/bin/env python3
"""Red-check driver for hooks/tests/project-record.test.sh (A3.1 steps 2 and 4).

Each mutation is applied to a TEMP COPY of scripts/ and hooks/ (never to this checkout); the suite runs against it through
AP_PLUGIN_ROOT, the transcript shows the named assertion failing, then the unmutated copy runs green. Usage:
  python3 redcheck.py <repo> <out-dir> [name ...]
"""
import os, re, shutil, subprocess, sys, tempfile

repo, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
only = set(sys.argv[3:])
SUITE = os.path.join(repo, 'hooks/tests/project-record.test.sh')

def sub(path, old, new, count=1):
    def f(root):
        p = os.path.join(root, path)
        s = open(p).read()
        assert old in s, f'mutation anchor missing in {path}: {old!r}'
        open(p, 'w').write(s.replace(old, new, count))
    return f

def seq(*fs):
    return lambda root: [f(root) for f in fs]

PR = 'scripts/project-record.js'
MUT = {
 'no-fallback': ('hippo failure falls back to record-files.js (spool, exit-5, refusal paths)', seq(
    sub(PR, "if (state === 'spool') return spoolIt(g, repo, cmd, plan, key, det.reason, state);",
            "if (state === 'spool') { handler.files(repo, p); return 0; }"),
    sub(PR, "if (!res.ok && res.spool) return spoolIt(g, repo, cmd, plan, key, res.reason, state);",
            "if (!res.ok && res.spool) { handler.files(repo, p); return 0; }"),
    sub(PR, "if (!res.ok) {\n    const e = res.error;", "if (!res.ok) {\n    handler.files(repo, p);\n    const e = res.error;"))),
 'parity-bullet-order': ('plan builder swaps the Problem and Impact bullets', sub(PR, "['Since', 'Report', 'Reply', 'Problem', 'Impact',", "['Since', 'Report', 'Reply', 'Impact', 'Problem',")),
 'parity-tag-spelling': ('plan builder spells the origin tag orig:', sub(PR, "[`origin:${fl.Origin.toLowerCase()}`]", "[`orig:${fl.Origin.toLowerCase()}`]")),
 'fault-after-create': ('lib/hippo.js: remove fault(after-create)', sub('scripts/lib/hippo.js', "if (creates === 1) fault('after-create');", "")),
 'fault-after-first-link': ('lib/hippo.js: remove fault(after-first-link)', sub('scripts/lib/hippo.js', "if (links === 1) fault('after-first-link');", "")),
 'fault-after-first-child': ('lib/hippo.js: remove fault(after-first-child)', sub('scripts/lib/hippo.js', "if (creates === 2) fault('after-first-child');", "")),
 'fault-before-spool-remove': ('lib/hippo.js: remove fault(before-spool-remove)', sub('scripts/lib/hippo.js', "fault('before-spool-remove');", "")),
 'session-start-spool-line': ('session-start.js: the spool line is never printed', sub('hooks/session-start.js', "if (n > 0) {\n        const line = `record store:", "if (false) {\n        const line = `record store:")),
 'resolver-record-store': ('resolve-project-paths.sh: record_store always files', sub('scripts/resolve-project-paths.sh', "printf '%s' \"${s:-files}\"", "printf '%s' files")),
 'detect-record-store': ('project-detect.js: record_store always files', sub('scripts/project-detect.js', "return require('./lib/hippo.js').detect(targetDir).state;", "return 'files';")),
 'validation-skipped': ('project-record.js: hippo mode skips validation', sub(PR, "const v = handler.validate ? handler.validate(repo, p, state) : null;", "const v = null;")),
 'unknown-flag': ('project-record.js: unknown flags are ignored', sub(PR, "if (!kind) throw usage(COUNTER_RE", "if (!kind) { i++; continue; } if (!kind) throw usage(COUNTER_RE")),
 'plugin-dir': ('lib/hippo.js: detect no longer refuses the plugin dir', sub('scripts/lib/hippo.js', "if (root === fs.realpathSync(PLUGIN_ROOT)) throw", "if (false) throw")),
 'child-key': ('project-record.js: all handoff children share one key', sub(PR, "key: `${key}.${n}` });", "key: `${key}.1` });")),
 'peer-closable': ('project-record.js: backlog close skips the peer-reply check', sub(PR, "rules.assertPeerClosable({", "(() => {})({")),
 'ledger-key': ('project-record.js: decision key ignores the ledger row', sub(PR, "return p.ledgerRow ? crypto", "return false ? crypto")),
}

def scrub(text, tmp):
    text = text.replace(tmp, '<tmp>').replace(repo, '<repo>')
    text = re.sub(r'/tmp/(?:tmp\.|ap-)[A-Za-z0-9._-]+', '<tmp>', text)
    text = re.sub(r'/home/[A-Za-z0-9._-]+', '~', text)
    return text

def run_suite(root, tmpdir, suite=SUITE):
    env = dict(os.environ, TMPDIR=tmpdir, AP_PLUGIN_ROOT=root)
    r = subprocess.run(['bash', suite], capture_output=True, text=True, env=env, timeout=280)
    return r.returncode, (r.stdout + r.stderr)

def check(name):
    desc, mutate = MUT[name]
    root = tempfile.mkdtemp(prefix='ap-rc-', dir='/tmp')
    try:
        for d in ('scripts', 'hooks', '.claude-plugin', 'references', 'src'):
            shutil.copytree(os.path.join(repo, d), os.path.join(root, d), symlinks=True)
        mutate(root)
        tdir = tempfile.mkdtemp(prefix='ap-rt-', dir='/tmp')
        rc, txt = run_suite(root, tdir)
        res = f'# red-check {name}: {desc}\n# mutated copy under <tmp>, this checkout untouched\n# exit {rc}\n{scrub(txt, tdir)}'
        failed = [l for l in txt.splitlines() if l.startswith('FAIL')]
        # restore = run the unmutated copy
        root2 = tempfile.mkdtemp(prefix='ap-rc-', dir='/tmp')
        for d in ('scripts', 'hooks', '.claude-plugin', 'references', 'src'):
            shutil.copytree(os.path.join(repo, d), os.path.join(root2, d), symlinks=True)
        tdir2 = tempfile.mkdtemp(prefix='ap-rt-', dir='/tmp')
        rc2, txt2 = run_suite(root2, tdir2)
        res += f'\n# restored: exit {rc2}\n{scrub(txt2, tdir2)}'
        shutil.rmtree(root2, ignore_errors=True); shutil.rmtree(tdir2, ignore_errors=True)
        open(os.path.join(out, f'redcheck-{name}.txt'), 'w').write(res)
        shutil.rmtree(tdir, ignore_errors=True)
        return rc != 0 and rc2 == 0, failed
    finally:
        shutil.rmtree(root, ignore_errors=True)

def exit_trap():
    root = tempfile.mkdtemp(prefix='ap-rc-', dir='/tmp')
    mutant = os.path.join(repo, 'hooks/tests/zz-redcheck-exit-trap.test.sh')
    try:
        s = open(SUITE).read()
        s = s.replace('hs_exit_check\nfinalize_test', 'touch "$REPO_ROOT/zz-redcheck-touch"\nhs_exit_check\nfinalize_test')
        open(mutant, 'w').write(s)
        tdir = tempfile.mkdtemp(prefix='ap-rt-', dir='/tmp')
        rc, txt = run_suite(repo, tdir, mutant)
        leftover = os.path.exists(os.path.join(repo, 'zz-redcheck-touch'))
        if leftover: os.remove(os.path.join(repo, 'zz-redcheck-touch'))
        if os.path.exists(mutant): os.remove(mutant)
        res = ('# red-check exit-trap: the suite (a temp copy named hooks/tests/zz-redcheck-exit-trap.test.sh, removed afterwards) touches\n'
               '# a file in this checkout just before hs_exit_check; the exit trap must fire\n'
               f'# exit {rc}\n{scrub(txt, tdir)}\n# file removed afterwards, checkout restored\n')
        rc2, txt2 = run_suite(repo, tempfile.mkdtemp(prefix='ap-rt-', dir='/tmp'))
        res += f'# restored: exit {rc2}\n{scrub(txt2, tdir)}'
        open(os.path.join(out, 'redcheck-exit-trap.txt'), 'w').write(res)
        return rc != 0 and 'this checkout' in txt and rc2 == 0, ['(exit-trap)']
    finally:
        if os.path.exists(mutant): os.remove(mutant)
        shutil.rmtree(root, ignore_errors=True)

if __name__ == '__main__':
    os.makedirs(out, exist_ok=True)
    lines = []
    names = [n for n in MUT if not only or n in only]
    for n in names:
        ok, failed = check(n)
        lines.append(f'{"RED-THEN-GREEN" if ok else "NOT-RED"} {n}: {MUT[n][0]}\n    failing: ' + ('; '.join(f[:160] for f in failed[:6]) or '(none)'))
        print(lines[-1], flush=True)
    if not only or 'exit-trap' in only:
        ok, failed = exit_trap()
        lines.append(f'{"RED-THEN-GREEN" if ok else "NOT-RED"} exit-trap: suite touches a file in the checkout; the exit trap fires')
        print(lines[-1], flush=True)
    if not only:
        open(os.path.join(out, 'redcheck-summary.txt'), 'w').write('\n'.join(lines).replace(repo, '<repo>') + '\n')
