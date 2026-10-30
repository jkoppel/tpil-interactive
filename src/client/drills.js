// Franklin drills: rewrite a book example from short hints, then compare with the original.
//
// Franklin rewrote essays from his hints after a delay of some days, then compared and corrected.
// A drill is the same for one example: while it is open, the book's code on the page is blurred
// ("the book is closed"); the reader writes the code in a live editor, compares it with the book's,
// and grades the attempt. Grades schedule the next review, Leitner-style, so that drills come back
// after growing delays, in the drill deck.

import { LeanEditor } from "./editor.js";

const DAY = 24 * 60 * 60 * 1000;
/** Delay before the next review, by box. Box 0 is a drill that was just missed. */
const INTERVALS = [10 * 60 * 1000, DAY, 3 * DAY, 7 * DAY, 21 * DAY, 60 * DAY];
export const GRADES = [
  { id: "missed", label: "Missed", title: "Couldn't rebuild it: start over" },
  { id: "partly", label: "Partly", title: "Got there with peeks or several mistakes" },
  { id: "recalled", label: "Recalled", title: "Rebuilt it, at most small slips" },
];

// --- Schedule ---

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/** The review record of a drill: { box, due, history } or null if never attempted. */
export function record(id) {
  return load(`tpil:drill:${id}`, null);
}

function grade(id, g) {
  const r = record(id) ?? { box: 0, history: [] };
  if (g === "recalled") r.box = Math.min(r.box + 1, INTERVALS.length - 1);
  else if (g === "partly") r.box = Math.max(1, Math.min(r.box, 1));
  else r.box = 0;
  r.due = Date.now() + INTERVALS[r.box];
  r.history.push({ t: Date.now(), grade: g });
  save(`tpil:drill:${id}`, r);
  return r;
}

/** Ids of attempted drills whose next review is due. */
export function dueIds() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key.startsWith("tpil:drill:")) continue;
      if (JSON.parse(localStorage.getItem(key)).due <= Date.now()) out.push(key.slice("tpil:drill:".length));
    }
  } catch {}
  return out;
}

export function markVisited(page) {
  save(`tpil:visited:${page}`, load(`tpil:visited:${page}`, Date.now()));
}

export function visited(page) {
  return load(`tpil:visited:${page}`, null);
}

export function describeSchedule(r) {
  if (!r) return "New";
  const ms = r.due - Date.now();
  if (ms <= 0) return "Due now";
  if (ms < DAY) return `Due in ${Math.max(1, Math.round(ms / 3600000))} h`;
  return `Due in ${Math.round(ms / DAY)} d`;
}

// --- Comparison ---

/**
 * Lines with comments removed and spacing within a line normalised; blank lines dropped.
 * Indentation is kept: it is part of Lean's syntax.
 */
function normalize(code) {
  return code
    .replace(/\/-[\s\S]*?-\//g, "")
    .split("\n")
    .map((l) => l.replace(/--.*$/, "").replace(/(\S)\s+/g, "$1 ").trimEnd())
    .filter((l) => l.trim());
}

/** A line diff (longest common subsequence): [{ kind: "same" | "book" | "yours", text }]. */
export function lineDiff(book, yours) {
  const a = normalize(book);
  const b = normalize(yours);
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (j < m && (i === n || lcs[i][j + 1] >= lcs[i + 1][j])) {
      out.push({ kind: "yours", text: b[j++] });
    } else {
      out.push({ kind: "book", text: a[i++] });
    }
  }
  return out;
}

// --- "Closing the book" ---

let openDrills = 0;

function closeBook() {
  openDrills++;
  document.body.classList.add("tpil-book-closed");
}

function openBook() {
  openDrills = Math.max(0, openDrills - 1);
  if (!openDrills) document.body.classList.remove("tpil-book-closed");
}

// --- Drill cards ---

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label, title, onClick, cls = "") {
  const b = el("button", `tpil-button ${cls}`, label);
  b.type = "button";
  b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

/**
 * A card for one drill. `drill` has id, title, hints, features, pre, mid, post, chapter, section.
 * `onGraded` is called after the reader grades an attempt.
 */
export function drillCard(drill, session, { showWhere = false, closesBook = true, onGraded } = {}) {
  const card = el("div", "tpil-drill");
  const head = el("div", "tpil-drill-head");
  const title = el("span", "tpil-drill-title", drill.title);
  const sched = el("span", "tpil-drill-sched");
  const refreshSchedule = () => {
    const r = record(drill.id);
    sched.textContent = describeSchedule(r);
    sched.dataset.state = !r ? "new" : r.due <= Date.now() ? "due" : "later";
  };
  refreshSchedule();
  head.append(title);
  if (showWhere) head.append(el("span", "tpil-drill-where", drill.where));
  head.append(el("span", "tpil-spacer"), sched);
  const start = button("Start drill", "Close the book and rewrite this example from the hints", () => open());
  head.append(start);
  card.append(head);

  let body = null;
  let editor = null;
  let status = null;

  const open = () => {
    start.hidden = true;
    if (closesBook) closeBook();
    if (body) {
      body.hidden = false;
      editor.start();
      editor.view.focus();
      return;
    }
    body = el("div", "tpil-drill-body");
    const hints = el("ol", "tpil-drill-hints");
    for (const h of drill.hints) hints.append(renderHint(h));
    const editorBox = el("div", "tpil-drill-editor");
    const bar = el("div", "tpil-toolbar");
    const statusText = el("span", "tpil-status", "");
    bar.append(el("span", "tpil-tag", "Your version"), statusText, el("span", "tpil-spacer"));
    const editorHost = el("div");
    if (drill.pre || drill.post) {
      const given = el("details", "tpil-context");
      given.append(el("summary", "", "Given setup"),
        el("pre", "", [drill.pre, "-- (your code)", drill.post].filter(Boolean).join("\n")));
      editorHost.append(given);
    }
    editorBox.append(bar, editorHost);
    const result = el("div", "tpil-drill-result");
    const actions = el("div", "tpil-drill-actions");
    const compare = button("Compare with the book", "Open the book: show the original next to your version",
      () => showComparison(), "tpil-primary");
    const cancel = button("Put away", "Stop this drill without grading it", () => close());
    actions.append(compare, cancel);
    body.append(hints, editorBox, actions, result);
    card.append(body);

    editor = new LeanEditor({
      host: editorHost,
      session,
      uri: `file:///tpil/drill/${drill.id.replace("#", "-")}.lean`,
      pre: drill.pre,
      initial: "",
      post: drill.post,
      storageKey: `tpil:drill-attempt:${drill.id}`,
      onStatus: (s) => {
        status = s;
        statusText.textContent = describeAttempt(s);
        statusText.className = `tpil-status ${statusClass(s)}`;
      },
    });
    editor.start();
    editor.view.focus();

    function showComparison() {
      if (closesBook) openBook();
      compare.hidden = true;
      result.replaceChildren(comparison(drill, editor.text, status), gradeBar());
    }

    /** Puts the drill away, ungraded. The attempt so far is kept for next time. */
    function close() {
      if (closesBook && compare.hidden === false) openBook();
      result.replaceChildren();
      compare.hidden = false;
      body.hidden = true;
      start.hidden = false;
    }

    function gradeBar() {
      const g = el("div", "tpil-drill-grade");
      g.append(el("span", "", "How did it go?"));
      for (const { id, label, title: t } of GRADES) {
        g.append(button(label, t, () => {
          grade(drill.id, id);
          editor.reset();
          result.replaceChildren();
          compare.hidden = false;
          body.hidden = true;
          start.hidden = false;
          start.textContent = "Drill again";
          refreshSchedule();
          onGraded?.(drill, id);
        }, `tpil-grade-${id}`));
      }
      return g;
    }
  };

  return card;
}

/** Hints may mention names in backticks; show those as code. */
function renderHint(text) {
  const li = el("li");
  text.split(/`([^`]*)`/).forEach((s, i) => li.append(i % 2 ? el("code", "", s) : s));
  return li;
}

function describeAttempt(s) {
  if (!s || s.state === "idle") return "";
  if (s.state === "running") return "Checking…";
  if (s.state === "failed") return s.error;
  if (s.errors) return `${s.errors} error${s.errors > 1 ? "s" : ""}`;
  return "✓ Lean accepts it";
}

function statusClass(s) {
  if (!s || s.state === "idle") return "";
  if (s.state === "running") return "running";
  return s.errors || s.state === "failed" ? "bad" : "good";
}

function comparison(drill, yours, status) {
  const box = el("div", "tpil-drill-compare");
  const diff = lineDiff(drill.mid, yours);
  const identical = diff.every((d) => d.kind === "same");
  const accepted = status && status.state === "done" && !status.errors;
  const verdict = el("div", "tpil-drill-verdict");
  verdict.append(
    el("span", accepted ? "good" : "bad", accepted ? "Lean accepts your version." : "Lean does not accept your version yet."),
    " ",
    el("span", identical ? "good" : "", identical
      ? "It matches the book, ignoring comments and spacing."
      : "Differences from the book are marked below (− book only, + yours only)."),
  );
  const pre = el("pre", "tpil-diff");
  for (const d of diff) {
    const line = el("span", `tpil-diff-${d.kind}`, `${{ same: " ", book: "−", yours: "+" }[d.kind]} ${d.text}`);
    pre.append(line);
  }
  const syntax = el("div", "tpil-drill-syntax");
  syntax.append(el("span", "", "Syntax practised: "), drill.features.join(", "));
  box.append(verdict, pre, syntax);
  return box;
}
