#!/usr/bin/env node
'use strict';
// Usage: node scripts/tool-retry-stats.js --files <jsonl>... | --dir <directory>
// Only tool names and aggregate numbers leave this process; transcript text is never emitted.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const rules = [
  ['class_invalid', /class[_ -]invalid|invalid.{0,30}class/i],
  ['time_in_content', /time[_ -]in[_ -]content/i],
  ['plan_missing', /plan[_ -]missing|missing.{0,30}plan/i],
  ['send_as_dispatch', /send[_ -]as[_ -]dispatch/i],
  ['not_authorized_boundary', /not[_ -]authorized[_ -]boundary|not authorized.{0,30}boundary/i],
  ['missing_operator_step', /missing[_ -]operator[_ -]step/i],
  ['bad_param_name', /bad[_ -]param(?:eter)?[_ -]name|invalid.{0,20}param(?:eter)?[_ -]name/i],
  ['brief_missing_cost', /brief[_ -]missing[_ -]cost/i],
  ['brief_missing_model_reason', /brief[_ -]missing[_ -]model[_ -]reason/i],
  ['brief_missing_fleet_task', /brief[_ -]missing[_ -]fleet[_ -]task/i],
  ['used_required', /used[_ -]required/i],
  ['next_step_required', /next[_ -]step[_ -]required/i],
  ['until_misuse', /until[_ -]misuse/i],
  ['zsh_glob', /zsh[_ -]glob|no matches found/i],
  ['bare_ls', /bare[_ -]ls/i],
  ['timeout_prefix', /timeout[_ -]prefix/i],
];
function classify(text) {
  for (const [name, pattern] of rules) if (pattern.test(text)) return name;
  return /PreToolUse:.*hook error|\bblocked\b/i.test(text) ? 'other_hook' : 'other_error';
}
function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(item => typeof item?.text === 'string' ? item.text : '').join('\n');
  return '';
}
function empty() { return {calls:0, first_try_ok:0, chains:0, successAttempts:0, successes:0, by_class:Object.create(null)}; }
function finish(s) {
  return {calls:s.calls, first_try_ok:s.first_try_ok, first_try_rate:s.chains ? s.first_try_ok / s.chains : null,
    mean_attempts_to_success:s.successes ? s.successAttempts / s.successes : null, by_class:s.by_class};
}
async function readFile(file, totals) {
  const calls = [], pending = new Map();
  const input = readline.createInterface({input:fs.createReadStream(file), crlfDelay:Infinity});
  for await (const line of input) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    const content = row.message?.content;
    if (!Array.isArray(content)) continue;
    if (row.type === 'assistant') {
      for (const part of content) if (part.type === 'tool_use' && typeof part.name === 'string' && typeof part.id === 'string') {
        const call = {name:part.name, result:null}; calls.push(call); pending.set(part.id, call);
      }
    } else if (row.type === 'user') {
      for (const part of content) if (part.type === 'tool_result' && pending.has(part.tool_use_id)) {
        const call = pending.get(part.tool_use_id); pending.delete(part.tool_use_id);
        const text = textOf(part.content);
        const failed = part.is_error === true || /^(?:PreToolUse:.*hook error|InputValidationError|tool_use_error|invalid_arguments|blocked)\b/i.test(text.trim());
        call.result = failed ? classify(text) : 'success';
      }
    }
  }
  const active = new Map();
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    const s = totals.get(call.name) || empty(); totals.set(call.name, s); s.calls++;
    let chain = active.get(call.name);
    if (!chain || i - chain.last > 5) { chain = {attempts:0, last:i}; s.chains++; }
    chain.attempts++; chain.last = i;
    if (call.result === 'success') {
      if (chain.attempts === 1) s.first_try_ok++;
      s.successes++; s.successAttempts += chain.attempts; active.delete(call.name);
    } else if (call.result) {
      s.by_class[call.result] = (s.by_class[call.result] || 0) + 1; active.set(call.name, chain);
    } else active.delete(call.name);
  }
}
async function main() {
  const args = process.argv.slice(2);
  let files;
  if (args[0] === '--files' && args.length > 1 && args.slice(1).every(x => !x.startsWith('--'))) files = args.slice(1);
  else if (args[0] === '--dir' && args.length === 2) files = fs.readdirSync(args[1], {withFileTypes:true}).filter(x => x.isFile() && x.name.endsWith('.jsonl')).map(x => path.join(args[1], x.name));
  else throw new Error('usage');
  const totals = new Map();
  for (const file of files) await readFile(file, totals);
  const overall = empty(), tools = Object.create(null);
  for (const [name, s] of totals) {
    tools[name] = finish(s);
    for (const key of ['calls','first_try_ok','chains','successAttempts','successes']) overall[key] += s[key];
    for (const [key, value] of Object.entries(s.by_class)) overall.by_class[key] = (overall.by_class[key] || 0) + value;
  }
  process.stdout.write(JSON.stringify({tools, overall:finish(overall)}, null, 2) + '\n');
}
main().catch(() => { process.stderr.write('Unable to process input; check arguments and JSONL files.\n'); process.exitCode = 1; });
