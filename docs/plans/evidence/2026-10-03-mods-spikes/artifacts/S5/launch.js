// what `session-mode.js set` would do: detached, parent exits immediately
const { spawn } = require('child_process');
const LOCK = process.env.S5_LOCK, STUB = '/tmp/claude-1000/-home-cookys-projects-autopilot/74f6f85f-f806-4317-a6c7-5e4417df8093/scratchpad/spike-a/s5/stub-watcher.js';
const c = spawn('setsid', ['nohup', 'flock', '-n', LOCK, 'node', STUB, 'spikeproj'], { detached: true, stdio: 'ignore', env: process.env });
c.unref();
console.log('launched wrapper pid ' + c.pid);
