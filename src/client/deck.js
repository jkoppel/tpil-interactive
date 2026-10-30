// The drill deck: every Franklin drill in the book, arranged by when it should next be done.
//
// Drills come back after growing delays; the deck is where the delayed rewriting happens, away
// from the chapter that the example came from.

import { drillCard, record, visited } from "./drills.js";

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function renderDeck(host, drills, chapters, session) {
  const render = () => {
    const now = Date.now();
    const due = [];
    const fresh = [];
    const later = [];
    for (const d of drills) {
      const r = record(d.id);
      if (!r) fresh.push(d);
      else if (r.due <= now) due.push(d);
      else later.push(d);
    }
    later.sort((a, b) => record(a.id).due - record(b.id).due);
    const recalled = drills.filter((d) => (record(d.id)?.box ?? 0) >= 2).length;

    const summary = el("p", "tpil-deck-summary");
    summary.textContent = `${drills.length} drills · ${due.length} due · ${drills.length - fresh.length} attempted · `
      + `${recalled} recalled twice in a row`;
    const mastery = featureMastery(drills);

    const sections = [
      section("Due now", "Drills whose delay has run out. Rewrite each one from its hints.", due, true),
      newSection(fresh, chapters),
      section("Scheduled", "Each successful recall lengthens the delay: 1, 3, 7, 21, then 60 days.", later, true),
    ];
    host.replaceChildren(summary, mastery, ...sections.filter(Boolean));
  };

  function section(title, blurb, list, showWhere) {
    if (!list.length) return null;
    const s = el("section", "tpil-deck-section");
    s.append(el("h2", "", `${title} (${list.length})`), el("p", "tpil-deck-blurb", blurb));
    for (const d of list) s.append(drillCard(d, session, { showWhere, closesBook: false, onGraded: render }));
    return s;
  }

  function newSection(list, chapters) {
    if (!list.length) return null;
    const s = el("section", "tpil-deck-section");
    s.append(el("h2", "", `Not yet attempted (${list.length})`),
      el("p", "tpil-deck-blurb", "Grouped by chapter. Franklin waited some days between reading and "
        + "rewriting; chapters you read a while ago are the best place to start."));
    for (const ch of chapters) {
      const mine = list.filter((d) => d.page === ch.page);
      if (!mine.length) continue;
      const v = visited(ch.page);
      const group = el("details", "tpil-deck-chapter");
      const sum = el("summary", "", `${ch.title} — ${mine.length} drill${mine.length > 1 ? "s" : ""}`);
      if (v) sum.append(el("span", "tpil-drill-where", ` · first opened ${ago(v)}`));
      group.append(sum);
      group.open = Boolean(v) && Date.now() - v > 60 * 60 * 1000;
      for (const d of mine) group.append(drillCard(d, session, { showWhere: false, closesBook: false, onGraded: render }));
      s.append(group);
    }
    return s;
  }

  render();
}

function ago(t) {
  const h = (Date.now() - t) / 3600000;
  if (h < 1) return "just now";
  if (h < 24) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** Which syntax features have a drill graded "Recalled" at least once, out of all those drilled. */
function featureMastery(drills) {
  const all = new Map();
  for (const d of drills) {
    const ok = (record(d.id)?.history ?? []).some((h) => h.grade === "recalled");
    for (const f of d.features) all.set(f, (all.get(f) ?? false) || ok);
  }
  const box = el("details", "tpil-deck-mastery");
  const done = [...all.values()].filter(Boolean).length;
  box.append(el("summary", "", `Syntax recalled: ${done} of ${all.size} features`));
  const list = el("div", "tpil-feature-list");
  for (const [f, ok] of [...all.entries()].sort((a, b) => Number(b[1]) - Number(a[1]))) {
    list.append(el("span", `tpil-feature ${ok ? "ok" : ""}`, f));
  }
  box.append(list);
  return box;
}
