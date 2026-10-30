// Lean's backslash abbreviations: `\to` becomes `→`, `\a` becomes `α`, `\<>` becomes `⟨⟩`.
//
// As in the VS Code extension, an abbreviation is replaced as soon as no longer abbreviation can
// extend it, or when the next character typed cannot extend it (space and Tab force it).

import { EditorSelection } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import ABBREVIATIONS from "../../vendor/abbreviations.json";

const keys = Object.keys(ABBREVIATIONS);
const isPrefix = (s) => keys.some((k) => k.startsWith(s));
const hasLongerKey = (s) => keys.some((k) => k.length > s.length && k.startsWith(s));
const PENDING = /\\([^\s\\]*)$/;

/** The pending abbreviation that ends at `pos`, if any. */
function pendingAt(view, pos) {
  const line = view.state.doc.lineAt(pos);
  const m = view.state.sliceDoc(Math.max(line.from, pos - 40), pos).match(PENDING);
  return m ? { from: pos - m[0].length, abbr: m[1] } : null;
}

/** Replaces [from, to) with the expansion of `abbr`, followed by `suffix`. */
function expand(view, from, to, abbr, suffix) {
  const value = ABBREVIATIONS[abbr];
  const cursorAt = value.indexOf("$CURSOR");
  const symbol = value.replace("$CURSOR", "");
  const insert = symbol + suffix;
  const anchor = from + (cursorAt >= 0 ? cursorAt : insert.length);
  view.dispatch({
    changes: { from, to, insert },
    selection: EditorSelection.cursor(anchor),
    userEvent: "input.type",
  });
}

const inputHandler = EditorView.inputHandler.of((view, from, to, text) => {
  if (from !== to) return false;
  const pending = pendingAt(view, from);
  if (!pending) return false;
  const extended = pending.abbr + text;
  if (/\s/.test(text) || !isPrefix(extended)) {
    if (!ABBREVIATIONS[pending.abbr]) return false;
    expand(view, pending.from, to, pending.abbr, text === "\\" ? "\\" : text);
    return true;
  }
  if (ABBREVIATIONS[extended] && !hasLongerKey(extended)) {
    expand(view, pending.from, to, extended, "");
    return true;
  }
  return false;
});

const tabKey = keymap.of([{
  key: "Tab",
  run(view) {
    const pos = view.state.selection.main.head;
    const pending = pendingAt(view, pos);
    if (!pending || !ABBREVIATIONS[pending.abbr]) return false;
    expand(view, pending.from, pos, pending.abbr, "");
    return true;
  },
}]);

export const unicodeInput = [inputHandler, tabKey];
