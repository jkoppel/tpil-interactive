// Page integration: turns the book's examples into live editors, makes exercises editable with
// a solved/unsolved badge, and controls the collapsed "familiar" passages.

import { renderDeck } from "./deck.js";
import { drillCard, dueIds, markVisited } from "./drills.js";
import { LeanEditor } from "./editor.js";
import { LeanSession } from "./lsp.js";

const data = JSON.parse(document.getElementById("tpil-data").textContent);
const session = new LeanSession(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/lsp`);
const FAMILIAR_PREF = "tpil:familiar-open";

function button(label, title, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "tpil-button";
  b.textContent = label;
  b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

function describeStatus({ state, errors, sorries, error }, exercise) {
  if (state === "failed") return { text: error, cls: "bad" };
  if (state === "idle") return { text: exercise ? "Click in the editor to start checking" : "", cls: "" };
  if (state === "running") return { text: "Checking…", cls: "running" };
  if (errors) return { text: `${errors} error${errors > 1 ? "s" : ""}`, cls: "bad" };
  if (exercise && sorries) return { text: `${sorries} sorry remaining`, cls: "todo" };
  if (exercise) return { text: "✓ Solved", cls: "good" };
  return { text: sorries ? "✓ Checked (uses sorry)" : "✓ Checked", cls: "good" };
}

/**
 * Makes a live editor for `spec` ({ pre, mid, post }) next to `anchor`. When `replaces` is set,
 * the editor can be swapped with that element (the book's static rendering).
 */
function mountEditor({ anchor, spec, key, exercise, replaces }) {
  const wrap = document.createElement("div");
  wrap.className = `tpil-live${exercise ? " tpil-exercise" : ""}`;
  const bar = document.createElement("div");
  bar.className = "tpil-toolbar";
  const status = document.createElement("span");
  status.className = "tpil-status";
  const body = document.createElement("div");
  wrap.append(bar, body);
  anchor.after(wrap);

  const editor = new LeanEditor({
    host: body,
    session,
    uri: `file:///tpil/${data.page}/${key}.lean`,
    pre: spec.pre,
    initial: spec.mid,
    post: spec.post,
    storageKey: `tpil:code:${data.page}:${key}`,
    onStatus: (s) => {
      const { text, cls } = describeStatus(s, exercise);
      status.textContent = text;
      status.className = `tpil-status ${cls}`;
    },
  });

  if (exercise) {
    const tag = document.createElement("span");
    tag.className = "tpil-tag";
    tag.textContent = "Exercise";
    bar.append(tag);
  }
  bar.append(status);
  const spacer = document.createElement("span");
  spacer.className = "tpil-spacer";
  bar.append(spacer);
  if (spec.pre || spec.post) {
    const hidden = document.createElement("details");
    hidden.className = "tpil-context";
    const summary = document.createElement("summary");
    summary.textContent = "Hidden setup";
    const pre = document.createElement("pre");
    pre.textContent = [spec.pre && `${spec.pre}\n`, "-- (your code)", spec.post && `\n${spec.post}`]
      .filter(Boolean).join("\n");
    hidden.append(summary, pre);
    body.prepend(hidden);
  }
  if (replaces) {
    bar.append(button("Book view", "Show the book's rendering of this example", () => {
      wrap.hidden = true;
      replaces.hidden = false;
    }));
  }
  bar.append(button("Reset", "Restore the original code", () => editor.reset()));
  bar.append(button("Playground ↗", "Open this code in live.lean-lang.org", () => {
    window.open(`https://live.lean-lang.org/#code=${encodeURIComponent(editor.fileText)}`, "_blank");
  }));
  return { wrap, editor };
}

function setUpExample(div) {
  const index = Number(div.dataset.tpilExample);
  const spec = data.examples[index];
  if (!spec.runnable) return;
  const key = `ex${index}`;
  const exercise = spec.exercise;
  let live = null;
  const activate = (start) => {
    if (!live) live = mountEditor({ anchor: div, spec, key, exercise, replaces: exercise ? null : div });
    live.wrap.hidden = false;
    if (!exercise) div.hidden = true;
    if (start) {
      live.editor.start();
      live.editor.view.focus();
    }
  };
  let hasEdits = false;
  try {
    hasEdits = localStorage.getItem(`tpil:code:${data.page}:${key}`) !== null;
  } catch {}
  if (exercise) {
    div.hidden = true;
    activate(false);
    return;
  }
  const run = button("▶ Run", "Edit and run this example with Lean", () => activate(true));
  run.classList.add("tpil-run");
  div.classList.add("tpil-runnable");
  div.prepend(run);
  if (hasEdits) activate(false);
}

function setUpScratch(el) {
  const index = Number(el.dataset.tpilScratch);
  const spec = { pre: "", post: "", mid: data.scratch[index].code };
  mountEditor({ anchor: el, spec, key: `scratch${index}`, exercise: true });
}

function setUpFamiliar() {
  const all = [...document.querySelectorAll("details.tpil-familiar")];
  if (!all.length) return null;
  let open = false;
  try {
    open = localStorage.getItem(FAMILIAR_PREF) === "1";
  } catch {}
  const toggle = button("", "Expand or collapse every passage marked as familiar", () => {
    open = !open;
    try {
      localStorage.setItem(FAMILIAR_PREF, open ? "1" : "0");
    } catch {}
    apply();
  });
  const apply = () => {
    for (const d of all) d.open = open;
    toggle.textContent = open ? "Collapse familiar" : "Expand familiar";
  };
  apply();
  return toggle;
}

function setUpBar() {
  const bar = document.createElement("div");
  bar.className = "tpil-bar";
  const dot = document.createElement("span");
  dot.className = "tpil-dot";
  const label = document.createElement("span");
  label.className = "tpil-bar-label";
  bar.append(dot, label);
  session.onStatus((s) => {
    dot.dataset.state = s;
    label.textContent = {
      idle: "Lean: idle",
      connecting: "Lean: connecting…",
      ready: "Lean: ready",
      disconnected: "Lean: disconnected",
    }[s];
  });
  const due = dueIds().length;
  const deck = document.createElement("a");
  deck.className = "tpil-bar-link";
  deck.href = "drills/";
  deck.textContent = due ? `Drill deck · ${due} due` : "Drill deck";
  bar.append(deck);
  const familiar = setUpFamiliar();
  if (familiar) {
    const n = document.querySelectorAll("details.tpil-familiar").length;
    const count = document.createElement("span");
    count.className = "tpil-bar-label";
    count.textContent = `${n} familiar passage${n > 1 ? "s" : ""}`;
    bar.append(count, familiar);
  }
  document.body.append(bar);
}

/** The end-of-section panel of Franklin drills. */
function setUpDrillPanel(el) {
  const ids = JSON.parse(el.dataset.tpilDrills);
  const panel = document.createElement("div");
  panel.className = "tpil-drill-panel";
  const head = document.createElement("div");
  head.className = "tpil-drill-panel-head";
  head.textContent = "Franklin drills";
  const blurb = document.createElement("p");
  blurb.className = "tpil-drill-panel-blurb";
  blurb.append("Rewrite the examples above from short hints, with the book closed, then compare. "
    + "It works best after a delay: come back to them tomorrow from the ");
  const link = document.createElement("a");
  link.href = "drills/";
  link.textContent = "drill deck";
  blurb.append(link, ".");
  panel.append(head, blurb);
  for (const id of ids) panel.append(drillCard(data.drills.find((d) => d.id === id), session));
  el.replaceWith(panel);
}

setUpBar();
if (data.page === "drills") {
  renderDeck(document.getElementById("tpil-deck"), data.drills, data.chapters, session);
} else {
  markVisited(data.page);
  document.querySelectorAll("div.example[data-tpil-example]").forEach(setUpExample);
  document.querySelectorAll("[data-tpil-scratch]").forEach(setUpScratch);
  document.querySelectorAll("[data-tpil-drills]").forEach(setUpDrillPanel);
}
