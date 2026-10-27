import json, glob, os, shutil, sys
REG = os.path.expanduser('~/projects/llm-playground/benchmarks/qualification/cookys')
SP = '/tmp/claude-1000/-home-cookys-projects-llm-playground'
OUT = sys.argv[1]
SEATS = {'gpt-6.1-terra': 'terra'}
CROSS = ['engine', 'runner', 'role', 'status', 'date', 'corpus_version', 'prompt_config_hash']
emitted = glob.glob('/tmp/intake-qualify-*/*/emitted-*.json') \
    + glob.glob(SP + '/*/scratchpad/roles/out/*/scratch/*/emitted-*.json') \
    + glob.glob(os.path.expanduser('~/.autopilot/qualify-drivers/roles/out/*/scratch/*/emitted-*.json')) \
    + glob.glob(SP + '/*/scratchpad/terra-impl/*/emitted-*.json')
by_hash = {}
for p in emitted:
    e = json.load(open(p)); h = e['raw']['evidence']['evidence_hash']
    by_hash.setdefault(h, []).append(p)
rows = []
for f in sorted(glob.glob(REG + '/*__*.json')):
    parts = os.path.basename(f).split('__')
    if parts[1] not in SEATS: continue
    reg = json.load(open(f)); r = reg['raw']; h = r['evidence']['evidence_hash']
    srcs = by_hash.get(h, [])
    if len(srcs) != 1: sys.exit(f'{f}: {len(srcs)} sources for {h}: {srcs}')
    src = srcs[0]; sdir = os.path.dirname(src); role = r['role']
    e = json.load(open(src))
    if e['raw'] != r: sys.exit(f'{f}: emitted raw != registry raw')
    anchor = r['evidence_store']
    store = [json.loads(l) for l in open(os.path.join(sdir, 'store/qualification-evidence.jsonl')) if l.strip()]
    hit = [w for w in store if w.get('event_id') == anchor['event_id'] and w.get('producer') == anchor['producer'] and w.get('transcript_hash') == anchor['transcript_hash']]
    if len(hit) != 1: sys.exit(f'{f}: anchor not resolved in {sdir}/store')
    lane = f"{SEATS[parts[1]]}-{role}"
    d = os.path.join(OUT, lane); os.makedirs(os.path.join(d, 'raw'), exist_ok=True)
    json.dump(r, open(os.path.join(d, 'qualify-out.json'), 'w'), indent=2, ensure_ascii=False)
    shutil.copy(src, os.path.join(d, 'emitted-record.json'))
    with open(os.path.join(d, 'capability-evidence.jsonl'), 'w') as o: o.write(json.dumps(hit[0], ensure_ascii=False) + '\n')
    for extra in glob.glob(os.path.join(sdir, 'seat-*.json')) + glob.glob(os.path.join(sdir, 'final-*.json')):
        shutil.copy(extra, d)
    for rf in glob.glob(os.path.join(sdir, 'raw/*')):
        shutil.copy(rf, os.path.join(d, 'raw'))
    # self-check: bundle row matches registry on every recipe cross-check field
    b = json.load(open(os.path.join(d, 'qualify-out.json')))
    assert all(b[k] == r[k] for k in CROSS)
    q = r.get('quality') or {}
    rows.append(dict(lane=lane, engine=r['engine'], runner=r['runner'], effort=r.get('effort'), role=role,
                     status=r['status'], date=r['date'], corpus=r['corpus_version'], pass_=q.get('corpus_pass'),
                     fpc=q.get('false_pass_critical'), score=r['capability_score'], pch=r['prompt_config_hash'][:12],
                     harness=r['harness_version'], runner_version=r['runner_version'],
                     source=sdir.replace(os.path.expanduser('~'), '~')))
json.dump(rows, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=2, ensure_ascii=False)
for x in rows: print(x['lane'], x['status'], x['pass_'], x['fpc'], x['corpus'], x['source'][-60:])
print(len(rows), 'rows')
