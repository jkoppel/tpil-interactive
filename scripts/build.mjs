// Builds dist/: the vendored book pages, patched to load the interactive layer.
//
// For each chapter page, this
// - tags every rendered example with its index and embeds its full Lean source (with the hidden
//   setup and teardown the book elides), so the client can run it;
// - marks the examples in "Exercises" sections;
// - inserts scratch editors for exercises stated in prose (data/exercise-starters.json);
// - wraps the passages listed in data/collapse/<page>.json in collapsed <details> elements;
// - adds a panel of Franklin drills (data/drills/) at the end of each section that has some,
//   and writes the drill deck page, drills/index.html.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as cheerio from "cheerio";
import * as esbuild from "esbuild";
import { blockText, contentBlocks } from "./blocks.mjs";
import { CHAPTERS } from "./chapters.mjs";
import { FEATURES } from "./syntax-features.mjs";
import { chapterExamples } from "./verso-source.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const SITE = `${ROOT}vendor/site`;
const DIST = `${ROOT}dist`;
const STARTERS = JSON.parse(readFileSync(`${ROOT}data/exercise-starters.json`, "utf8"));
const DRILLS = JSON.parse(readFileSync(`${ROOT}data/drills/selection.json`, "utf8"));

rmSync(DIST, { recursive: true, force: true });
cpSync(SITE, DIST, { recursive: true });

await esbuild.build({
  entryPoints: { tpil: `${ROOT}src/client/main.js` },
  bundle: true,
  format: "esm",
  minify: true,
  sourcemap: true,
  outdir: `${DIST}/-tpil`,
  logLevel: "warning",
});
cpSync(`${ROOT}src/client/tpil.css`, `${DIST}/-tpil/tpil.css`);

function embedData($, data) {
  const payload = JSON.stringify(data).replace(/</g, "\\u003c");
  $("body").append(`<script type="application/json" id="tpil-data">${payload}</script>`);
}

/** Inserts the interactive layer's assets and drops third-party analytics. */
function patchHead($) {
  $('script[src*="plausible.io"]').remove();
  $(".split-toc.book table").append('<tr><td class="num"></td><td><a href="drills/">Franklin drill deck</a></td></tr>');
  $("head").append('<link rel="stylesheet" href="-tpil/tpil.css">');
  $("head").append('<script type="module" src="-tpil/tpil.js"></script>');
}

function wrapFamiliar($, page, blocks) {
  const file = `${ROOT}data/collapse/${page}.json`;
  if (!existsSync(file)) return 0;
  const { collapse } = JSON.parse(readFileSync(file, "utf8"));
  for (const { start, end, summary, startsWith } of collapse) {
    const from = Number(start.slice(1));
    const to = Number(end.slice(1));
    const run = blocks.slice(from, to + 1);
    // Block ids are positional; the fingerprint catches a re-fetched page whose blocks moved.
    if (!blockText($, run[0]).replace(/\s+/g, " ").startsWith(startsWith)) {
      throw new Error(`${page}: block ${start} no longer starts with "${startsWith}"`);
    }
    const parent = run[0].parent;
    const siblings = $(parent).children().not("script").toArray();
    const first = siblings.indexOf(run[0]);
    if (run.some((b, i) => b.parent !== parent || siblings[first + i] !== b)) {
      throw new Error(`${page}: collapse range ${start}-${end} is not a run of siblings`);
    }
    const paras = run.filter((b) => !$(b).is("div.example, div.proof-state-view")).length;
    const code = run.length - paras;
    const what = [paras && `${paras} paragraph${paras > 1 ? "s" : ""}`, code && `${code} example${code > 1 ? "s" : ""}`]
      .filter(Boolean).join(", ");
    const details = $('<details class="tpil-familiar"></details>');
    details.append(
      $("<summary></summary>")
        .append('<span class="tpil-familiar-label">Familiar</span>')
        .append($("<span></span>").text(summary))
        .append(`<span class="tpil-familiar-count"> · ${what}</span>`),
    );
    $(run[0]).before(details);
    // Each example's copy-button script follows it; keep it with the example.
    for (const b of run) {
      const next = $(b).next("script");
      details.append(b);
      if (next.length && $(b).is("div.example")) details.append(next);
    }
  }
  return collapse.length;
}

/**
 * The drills of a chapter, with their hints. Setup the book shows but that is not worth rewriting
 * (leading `set_option` lines, and a stray dash line meant as a split) is given, not drilled.
 */
function chapterDrills(ch, examples, title) {
  const file = `${ROOT}data/drills/${ch.page}.json`;
  const hints = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).drills : [];
  return DRILLS.filter((d) => d.page === ch.page).map((d) => {
    const h = hints.find((x) => x.index === d.index);
    if (!h) throw new Error(`${ch.page}: drill for example ${d.index} has no hints`);
    const e = examples[d.index];
    const lines = e.mid.split("\n");
    let given = 0;
    while (given < lines.length && /^(set_option\b.*|-{3,}\s*|\s*)$/.test(lines[given])) given++;
    return {
      id: `${ch.page}#${d.index}`,
      page: ch.page,
      index: d.index,
      where: `${title} › ${d.section}`,
      title: h.title,
      hints: h.hints,
      features: d.features.map((f) => FEATURES[f].label),
      pre: [e.pre, ...lines.slice(0, given).filter((l) => !/^-{3,}\s*$/.test(l))].filter((l) => l.trim()).join("\n"),
      mid: lines.slice(given).join("\n"),
      post: e.post,
    };
  });
}

/** Puts a drill-panel placeholder at the end of each section's own text, before any subsections. */
function placeDrillPanels($, divs, drills) {
  const bySection = new Map();
  for (const d of drills) {
    const section = $(divs[d.index]).closest("section").get(0);
    if (!bySection.has(section)) bySection.set(section, []);
    bySection.get(section).push(d.id);
  }
  for (const [section, ids] of bySection) {
    const placeholder = $("<div></div>").attr("data-tpil-drills", JSON.stringify(ids));
    const sub = $(section).children("section").first();
    if (sub.length) sub.before(placeholder);
    else $(section).append(placeholder);
  }
}

function isExerciseSection($, el) {
  const heading = $(el).closest("section").children("h2, h3").first().text();
  return /\bExercises\b/.test(heading);
}

let total = { examples: 0, familiar: 0, scratch: 0 };
const allDrills = [];
const chapterList = [];
for (const ch of CHAPTERS) {
  const path = `${DIST}/${ch.page}/index.html`;
  const $ = cheerio.load(readFileSync(path, "utf8"));
  const examples = chapterExamples(`${ROOT}vendor/tpil-src/TPiL/${ch.source}`);
  const divs = $("div.example").toArray();
  if (divs.length !== examples.length) {
    throw new Error(`${ch.page}: ${divs.length} rendered examples but ${examples.length} in source`);
  }
  // Block ids refer to the unpatched page, so resolve them before changing anything.
  const blocks = contentBlocks($);
  const scratch = [];
  for (const s of STARTERS.filter((s) => s.page === ch.page)) {
    const block = blocks[Number(s.after.slice(1))];
    const index = scratch.push({ code: s.code }) - 1;
    const placeholder = `<div data-tpil-scratch="${index}"></div>`;
    // `item` places the editor at the end of that item (1-based) of a list block.
    if (s.item) $(block).children("li").eq(s.item - 1).append(placeholder);
    else $(block).after(placeholder);
  }
  divs.forEach((d, i) => {
    $(d).attr("data-tpil-example", String(i));
    examples[i].exercise = isExerciseSection($, d);
  });
  total.familiar += wrapFamiliar($, ch.page, blocks);
  const title = $("main h1").first().text().replace("🔗", "").trim();
  const drills = chapterDrills(ch, examples, title);
  placeDrillPanels($, divs, drills);
  allDrills.push(...drills);
  chapterList.push({ page: ch.page, title });
  total.examples += examples.filter((e) => e.runnable).length;
  total.scratch += scratch.length;
  embedData($, { page: ch.page, examples, scratch, drills });
  patchHead($);
  writeFileSync(path, $.html());
}

// The drill deck, in the book's page layout.
{
  const $ = cheerio.load(readFileSync(`${SITE}/Introduction/index.html`, "utf8"));
  $("title").text("Franklin drill deck");
  $(".split-toc:not(.book)").remove();
  $(".split-toc.book tr.current").removeClass("current");
  $("main .content-wrapper").html(`<section>
    <h1>Franklin drill deck</h1>
    <p>Franklin learned to write by taking short hints of each sentence of an essay, setting the
    essay aside for some days, rewriting it from the hints, and comparing his version with the
    original. These drills do the same for the book's Lean examples: each one asks you to rewrite an
    example from its hints, then shows you the differences from the book. Between them they practise
    every piece of Lean syntax that the book's examples use, most of it twice.</p>
    <div id="tpil-deck"></div>
  </section>`);
  embedData($, { page: "drills", examples: [], scratch: [], drills: allDrills, chapters: chapterList });
  patchHead($);
  mkdirSync(`${DIST}/drills`, { recursive: true });
  writeFileSync(`${DIST}/drills/index.html`, $.html());
}

// The front page and other non-chapter pages only get the stylesheet (no examples there).
const index = cheerio.load(readFileSync(`${DIST}/index.html`, "utf8"));
index('script[src*="plausible.io"]').remove();
index(".split-toc.book table").append('<tr><td class="num"></td><td><a href="drills/">Franklin drill deck</a></td></tr>');
writeFileSync(`${DIST}/index.html`, index.html());

console.log(`Built dist/: ${total.examples} runnable examples, ${total.familiar} familiar passages, `
  + `${total.scratch} scratch editors, ${allDrills.length} drills.`);
