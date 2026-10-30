// Compiles every extracted example with Lean and reports the ones that fail unexpectedly.
// An example the book marks `+error` or `(check := false)` may fail; others must not.
// Also compiles each drill's reference answer with its given setup, as built into dist/.
// Usage: node scripts/check-examples.mjs [page-substring]
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHAPTERS } from "./chapters.mjs";
import { chapterExamples } from "./verso-source.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "tpil-check-"));
const jobs = [];
for (const ch of CHAPTERS) {
  if (process.argv[2] && !ch.page.includes(process.argv[2])) continue;
  chapterExamples(`${ROOT}vendor/tpil-src/TPiL/${ch.source}`).forEach((e, i) => {
    if (!e.runnable) return;
    const text = [e.pre, e.mid, e.post].filter(Boolean).join("\n");
    const file = join(dir, `${ch.page}-${i}.lean`);
    writeFileSync(file, text);
    jobs.push({ page: ch.page, i, e, file });
  });
}
const deck = `${ROOT}dist/drills/index.html`;
if (existsSync(deck) && !process.argv[2]) {
  const json = readFileSync(deck, "utf8").match(/<script type="application\/json" id="tpil-data">([\s\S]*?)<\/script>/)[1];
  JSON.parse(json).drills.forEach((d, i) => {
    const file = join(dir, `drill-${i}.lean`);
    writeFileSync(file, [d.pre, d.mid, d.post].filter(Boolean).join("\n"));
    jobs.push({ page: "drill", i: d.id, e: { check: true, expectErrors: false, source: d.id }, file });
  });
}
const run = ({ file }) => new Promise((resolve) => {
  execFile("lean", [file], { cwd: ROOT, maxBuffer: 1 << 24 }, (err, stdout) => resolve({ ok: !err, out: stdout }));
});
let bad = 0;
const queue = [...jobs];
await Promise.all(Array.from({ length: 8 }, async () => {
  for (let job; (job = queue.shift());) {
    const { ok, out } = await run(job);
    if (!ok && !job.e.expectErrors && job.e.check) {
      bad++;
      console.log(`FAIL ${job.page} #${job.i} (${job.e.source})\n${out.split("\n").filter((l) => /error/.test(l)).slice(0, 3).join("\n")}\n`);
    }
  }
}));
console.log(`${jobs.length} examples and drills checked, ${bad} unexpected failures`);
