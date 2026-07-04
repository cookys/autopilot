#!/usr/bin/env node
/**
 * scripts/check-escalation-coverage.js
 * Verification script for escalation-ledger coverage.
 */

const fs = require('fs');
const path = require('path');

function printUsage() {
  console.error("Usage: node scripts/check-escalation-coverage.js --project <name> [--signals <file>] [--gate] [--json]");
}

function attributeEvent(event) {
  const points = [
    "playbook_no_match",
    "adjudication_unvalidatable",
    "panel_irreversible_disagreement",
    "plan_revision_trip",
    "depth0_override"
  ];

  if (event.point && typeof event.point === 'string') {
    if (points.includes(event.point)) {
      return event.point;
    }
    return null; // UNATTRIBUTED if point is present but unknown
  }

  // No point field, check stage/decision/why_not_mechanical text
  const textFields = [event.stage, event.decision, event.why_not_mechanical];
  const text = textFields
    .filter(val => typeof val === 'string')
    .join(" ")
    .toLowerCase();

  for (const pt of points) {
    const ptSpace = pt.replace(/_/g, " ");
    const ptHyphen = pt.replace(/_/g, "-");
    if (text.includes(pt) || text.includes(ptSpace) || text.includes(ptHyphen)) {
      return pt;
    }
  }

  return null; // UNATTRIBUTED
}

function main() {
  const args = process.argv.slice(2);
  let project = null;
  let signalsFile = null;
  let gate = false;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project') {
      project = args[i + 1];
      i++;
    } else if (args[i] === '--signals') {
      signalsFile = args[i + 1];
      i++;
    } else if (args[i] === '--gate') {
      gate = true;
    } else if (args[i] === '--json') {
      json = true;
    }
  }

  if (!project) {
    printUsage();
    process.exit(2);
  }

  const baseDir = process.env.REPO_ROOT || '/tmp/hetero-feat-qc2-1b2-HJG8mr';
  let eventsPath = path.join(baseDir, 'docs/projects', project, 'tree/events.jsonl');
  if (!fs.existsSync(eventsPath)) {
    eventsPath = path.join(baseDir, 'docs/projects/_archive', project, 'tree/events.jsonl');
  }

  if (!fs.existsSync(eventsPath)) {
    console.error(`Error: Project events ledger not found for '${project}' at:`);
    console.error(`  - ${path.join(baseDir, 'docs/projects', project, 'tree/events.jsonl')}`);
    console.error(`  - ${path.join(baseDir, 'docs/projects/_archive', project, 'tree/events.jsonl')}`);
    process.exit(2);
  }

  let fileContent = '';
  try {
    fileContent = fs.readFileSync(eventsPath, 'utf8');
  } catch (err) {
    console.error(`Error reading events file: ${err.message}`);
    process.exit(2);
  }

  const lines = fileContent.split(/\r?\n/);
  let totalEventsCount = 0;
  let unattributedCount = 0;

  const eventCounts = {
    playbook_no_match: 0,
    adjudication_unvalidatable: 0,
    panel_irreversible_disagreement: 0,
    plan_revision_trip: 0,
    depth0_override: 0
  };

  const points = Object.keys(eventCounts);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    let eventObj;
    try {
      eventObj = JSON.parse(line);
    } catch (err) {
      console.error(`Warning: malformed events.jsonl line ${i + 1}: ${line}`);
      continue;
    }

    if (eventObj.type === 'escalation_opened') {
      totalEventsCount++;
      const matchedPoint = attributeEvent(eventObj);
      if (matchedPoint) {
        eventCounts[matchedPoint]++;
      } else {
        unattributedCount++;
      }
    }
  }

  let signals = null;
  const activeSignals = {
    playbook_no_match: 0,
    adjudication_unvalidatable: 0,
    panel_irreversible_disagreement: 0,
    plan_revision_trip: 0,
    depth0_override: 0
  };

  if (signalsFile) {
    const resolvedSignalsPath = path.isAbsolute(signalsFile) ? signalsFile : path.join(baseDir, signalsFile);
    if (fs.existsSync(resolvedSignalsPath)) {
      try {
        const signalsContent = fs.readFileSync(resolvedSignalsPath, 'utf8');
        signals = JSON.parse(signalsContent);
        for (const pt of points) {
          if (signals && typeof signals[pt] === 'number') {
            activeSignals[pt] = signals[pt];
          }
        }
      } catch (err) {
        console.error(`Warning: Failed to parse signals file: ${err.message}`);
        signals = null; // treat as no signals on parse failure
      }
    } else {
      console.error(`Warning: Signals file '${resolvedSignalsPath}' not found.`);
    }
  }

  const deficits = [];
  if (signals) {
    for (const pt of points) {
      const expected = activeSignals[pt];
      const actual = eventCounts[pt];
      if (expected > 0 && actual < expected) {
        deficits.push({
          point: pt,
          expected: expected,
          actual: actual,
          deficit: expected - actual
        });
      }
    }
  }

  if (json) {
    console.log(JSON.stringify({
      project: project,
      events: totalEventsCount,
      signals: signals ? activeSignals : null,
      deficits: deficits,
      unattributed: unattributedCount
    }, null, 2));
  } else {
    console.log(`Project: ${project}`);
    console.log(`Events ledger: ${eventsPath}`);
    console.log(`Total escalation_opened events: ${totalEventsCount}`);
    console.log(`Breakdown:`);
    for (const pt of points) {
      console.log(`  - ${pt}: ${eventCounts[pt]}`);
    }
    console.log(`  - unattributed: ${unattributedCount}`);

    if (signals) {
      console.log(`\nSignals (expected vs actual):`);
      for (const pt of points) {
        console.log(`  - ${pt}: expected ${activeSignals[pt]}, actual ${eventCounts[pt]}`);
      }

      if (deficits.length > 0) {
        console.warn(`\n[WARNING] Escalation coverage deficits detected:`);
        for (const d of deficits) {
          console.warn(`  - Point '${d.point}' has a deficit of ${d.deficit} (expected ${d.expected}, actual ${d.actual})`);
        }
        if (gate) {
          console.error(`\n[ERROR] Gate failure: coverage deficits found under --gate posture.`);
        } else {
          console.warn(`\n[INFO] Gate not enabled (warn-first). Exiting cleanly with warnings.`);
        }
      } else {
        console.log(`\nAll expected escalations accounted for. Clean check.`);
      }
    } else {
      console.log(`\nNo signals file provided. Running in informational mode.`);
    }
  }

  if (signals && deficits.length > 0 && gate) {
    process.exit(1);
  }

  process.exit(0);
}

if (require.main === module) {
  main();
}
