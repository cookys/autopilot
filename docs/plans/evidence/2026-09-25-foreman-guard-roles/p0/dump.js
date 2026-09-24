#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const S = '/tmp/claude-1000/-home-cookys-projects-autopilot/ee9eb17b-41da-4ab1-9beb-06049b64c5bd/scratchpad/p0';

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  try {
    fs.appendFileSync(path.join(S, 'payloads.jsonl'), input.trim() + '\n');
    const p = JSON.parse(input);
    if (p.agent_id) {
      const derived = path.join(path.dirname(p.transcript_path), p.session_id, 'subagents', 'agent-' + p.agent_id + '.jsonl');
      let exists = false;
      let first_line_prefix = null;
      try {
        exists = fs.existsSync(derived);
        if (exists) {
          const content = fs.readFileSync(derived, 'utf8');
          const firstLine = content.split('\n')[0];
          if (firstLine) {
            const obj = JSON.parse(firstLine);
            const msg = obj && obj.message && obj.message.content;
            let text = '';
            if (typeof msg === 'string') text = msg;
            else if (Array.isArray(msg)) {
              const t = msg.find((b) => b && b.type === 'text');
              text = t ? t.text : JSON.stringify(msg);
            } else if (msg) {
              text = JSON.stringify(msg);
            }
            first_line_prefix = String(text).slice(0, 200);
          }
        }
      } catch (e) {
        first_line_prefix = 'ERROR: ' + e.message;
      }
      fs.appendFileSync(path.join(S, 'derived.jsonl'), JSON.stringify({
        agent_id: p.agent_id,
        derived,
        exists,
        first_line_prefix,
        transcript_path: p.transcript_path,
      }) + '\n');
    }
  } catch (e) {
    try {
      fs.appendFileSync(path.join(S, 'derived.jsonl'), JSON.stringify({ error: e.message, raw: input.slice(0, 500) }) + '\n');
    } catch (e2) {}
  }
  process.exit(0);
});
