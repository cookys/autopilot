// stub project watcher: writes $AUTOPILOT_LIVE_DIR/runs/<key>.json every 2s with {writer_pid, at}
const fs = require('fs'), path = require('path');
const live = process.env.AUTOPILOT_LIVE_DIR;
const key = process.argv[2] || 'spikeproj';
const dir = path.join(live, 'runs'); fs.mkdirSync(dir, { recursive: true });
const f = path.join(dir, key + '.json');
const tick = () => { const tmp = f + '.tmp.' + process.pid; fs.writeFileSync(tmp, JSON.stringify({ writer_pid: process.pid, at: new Date().toISOString() })); fs.renameSync(tmp, f); };
tick(); setInterval(tick, 2000);
