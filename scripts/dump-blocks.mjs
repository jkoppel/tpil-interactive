// Writes a numbered plain-text view of each chapter for annotators: `node dump-blocks.mjs OUT_DIR`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as cheerio from "cheerio";
import { CHAPTERS } from "./chapters.mjs";
import { blockText, contentBlocks } from "./blocks.mjs";
import { chapterExamples } from "./verso-source.mjs";

const here = new URL("..", import.meta.url).pathname;
const out = process.argv[2];
mkdirSync(out, { recursive: true });
for (const ch of CHAPTERS) {
  const $ = cheerio.load(readFileSync(`${here}vendor/site/${ch.page}/index.html`, "utf8"), { sourceCodeLocationInfo: false });
  const examples = chapterExamples(`${here}vendor/tpil-src/TPiL/${ch.source}`);
  const exampleIndex = new Map($("div.example").toArray().map((e, i) => [e, i]));
  const lines = [];
  const blocks = contentBlocks($);
  const ids = new Map(blocks.map((b, i) => [b, `b${i}`]));
  // Walk the page in order, printing headings where they occur.
  const walk = (node) => {
    for (const child of $(node).children().toArray()) {
      if (/^h[1-6]$/.test(child.tagName)) lines.push(`\n## ${$(child).text().replace("🔗", "").trim()}\n`);
      else if (ids.has(child)) {
        const id = ids.get(child);
        if (exampleIndex.has(child)) {
          const ex = examples[exampleIndex.get(child)];
          lines.push(`[${id}] CODE EXAMPLE:\n${ex.mid.replace(/^/gm, "    ")}\n`);
        } else if ($(child).hasClass("proof-state-view")) {
          lines.push(`[${id}] PROOF STATE DISPLAY:\n${blockText($, child).replace(/^/gm, "    ")}\n`);
        } else {
          lines.push(`[${id}] ${child.tagName.toUpperCase()}:\n${blockText($, child)}\n`);
        }
      } else if (child.tagName === "section" || child.tagName === "div") walk(child);
    }
  };
  walk($("main").get(0));
  writeFileSync(`${out}/${ch.page}.txt`, lines.join("\n"));
  console.log(ch.page, blocks.length, "blocks");
}
