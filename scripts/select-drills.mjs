// Chooses the Franklin drills: a small set of short examples that together practise every syntax
// feature in syntax-features.mjs at least twice, the first time in the chapter that introduces it.
//
// Writes data/drills/selection.json and prints a coverage report. Hints for the chosen drills are
// written separately, in data/drills/<page>.json.
//
// Usage: node scripts/select-drills.mjs

import { readFileSync, writeFileSync } from "node:fs";
import * as cheerio from "cheerio";
import { CHAPTERS } from "./chapters.mjs";
import { FEATURES, featuresOf } from "./syntax-features.mjs";
import { chapterExamples } from "./verso-source.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const REPETITIONS = 2;
/** Examples that make poor drills, with the reason (found by the people writing hints). */
const EXCLUDED = JSON.parse(readFileSync(`${ROOT}data/drills/excluded.json`, "utf8"));
const MAX_LINES = 18;

/** Every runnable example in reading order, with what a drill needs to know about it. */
function allExamples() {
  const out = [];
  CHAPTERS.forEach((ch, chapter) => {
    const $ = cheerio.load(readFileSync(`${ROOT}vendor/site/${ch.page}/index.html`, "utf8"));
    const divs = $("div.example").toArray();
    chapterExamples(`${ROOT}vendor/tpil-src/TPiL/${ch.source}`).forEach((e, index) => {
      const section = $(divs[index]).closest("section").children("h1, h2, h3").first().text().replace("🔗", "").trim();
      const lines = e.mid.split("\n").filter((l) => l.trim()).length;
      out.push({
        page: ch.page, chapter, index, section, lines,
        candidate: e.runnable && e.check && !e.expectErrors && !/\bExercises\b/.test(section)
          && !/\bsorry\b/.test(e.mid) && lines >= 2 && lines <= MAX_LINES
          && !EXCLUDED.some((x) => x.page === ch.page && x.index === index),
        features: e.runnable ? featuresOf(e.mid) : [],
      });
    });
  });
  return out;
}

const examples = allExamples();
const candidates = examples.filter((e) => e.candidate);
const introChapter = {};
for (const e of examples) for (const f of e.features) introChapter[f] ??= e.chapter;

const need = {};
for (const f of Object.keys(FEATURES)) {
  const available = candidates.filter((e) => e.features.includes(f)).length;
  need[f] = Math.min(REPETITIONS, available);
}
const chosen = new Set();

/** Greedily picks from `pool` until no feature in `wanted` is still needed. */
function cover(pool, wanted) {
  for (;;) {
    let best = null;
    let bestScore = 0;
    for (const e of pool) {
      if (chosen.has(e)) continue;
      const gain = e.features.filter((f) => wanted(f) && need[f] > 0).length;
      const score = gain / (4 + e.lines);
      if (score > bestScore) [best, bestScore] = [e, score];
    }
    if (!best) return;
    chosen.add(best);
    for (const f of best.features) need[f] = Math.max(0, need[f] - 1);
  }
}

// First practice: in the chapter where the feature first appears, if it has a candidate there.
CHAPTERS.forEach((_, c) => {
  const pool = candidates.filter((e) => e.chapter === c);
  const firstNeed = { ...need };
  cover(pool, (f) => introChapter[f] === c && need[f] === firstNeed[f] && need[f] === REPETITIONS);
});
// Repetition: anywhere from the introducing chapter on.
cover(candidates, () => true);

const selection = examples.filter((e) => chosen.has(e))
  .map(({ page, index, section, lines, features }) => ({ page, index, section, lines, features }));
writeFileSync(`${ROOT}data/drills/selection.json`, JSON.stringify(selection, null, 1) + "\n");

const count = {};
for (const e of selection) for (const f of e.features) count[f] = (count[f] ?? 0) + 1;
const byPage = {};
for (const e of selection) byPage[e.page] = (byPage[e.page] ?? 0) + 1;
console.log(`${selection.length} drills, ${selection.reduce((n, e) => n + e.lines, 0)} lines in all`);
console.log(byPage);
const thin = Object.keys(FEATURES).filter((f) => (count[f] ?? 0) < REPETITIONS)
  .map((f) => `${f}: ${count[f] ?? 0} (examples using it: ${examples.filter((e) => e.features.includes(f)).length})`);
console.log(`Features drilled fewer than ${REPETITIONS} times:\n  ${thin.join("\n  ")}`);
