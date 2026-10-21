#!/usr/bin/env bash
# Print the owner reply for the first open owner card, or nothing when there is none.
# An ask_user_question card is the mechanism dialog (the pane does not answer it); the
# owner card is the first other card that has a question and an id. Wire bytes match
# mods/live/model.ts DECIDE_REPLY_HEAD / decideLine (｜ U+FF5C, → U+2192, … when cut).
set -u
. "$(cd "$(dirname "$0")/../../lib" && pwd)/dcard-markers.sh"
dcard_decision_files | dcard_cards_json | node -e '
  const fs = require("fs");
  const HEAD = "[待決回覆]";
  const BAR = "｜";
  const ARROW = "\u2192";
  const NOTE = "不要改動 origin 的 main。請把工作推到 origin 上名為 feature/slugify 的新分支。";
  const flat = (s) => String(s).replace(/\s+/g, " ").trim();
  const wire = (s) => flat(s).replace(/｜/g, "|");
  const excerpt = (q) => { const cs = [...flat(q)]; return cs.length <= 30 ? cs.join("") : cs.slice(0, 30).join("") + "…"; };
  const labelOf = (o) => typeof o === "string" ? o : (o && typeof o.label === "string" ? o.label : "");
  const banned = /force|rewrite|強推|改寫/i;
  let card = null;
  for (const line of fs.readFileSync(0, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let c; try { c = JSON.parse(line); } catch { continue; }
    if (c.origin === "ask_user_question") continue;
    if (typeof c.question !== "string" || !c.question.trim()) continue;
    if (typeof c.id !== "string" || !c.id) continue;
    card = c; break;
  }
  if (!card) process.exit(0);
  const opts = Array.isArray(card.options) ? card.options.map(labelOf).map((s) => s.trim()).filter(Boolean) : [];
  if (!opts.length) process.exit(0);
  const pick = opts.find((l) => !banned.test(l)) || opts[0];
  const answer = wire(pick) + BAR + "補充：" + wire(NOTE);
  const text = HEAD + "\n" + card.id + BAR + wire(excerpt(card.question)) + " " + ARROW + " " + answer + "\n";
  const git = require("child_process").execFileSync("git", ["rev-parse", "--git-dir"], { encoding: "utf8" }).trim();
  fs.writeFileSync(require("path").resolve(git, "onoff-dcard-id"), card.id + "\n");
  process.stdout.write(text);
'
