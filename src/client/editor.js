// An editable, live-checked Lean example: a CodeMirror editor backed by one virtual Lean file.
//
// The file is `pre`, then the editor's text, then `post`; the hidden parts are the setup and
// teardown the book hides around its examples. Messages are shown below the line they end on, as
// in the book, and the goal at the cursor is shown below the editor.

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentUnit } from "@codemirror/language";
import { highlightSelectionMatches } from "@codemirror/search";
import { EditorState, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration, EditorView, WidgetType, drawSelection, hoverTooltip, keymap, lineNumbers,
} from "@codemirror/view";
import { leanHighlighting } from "./lean-mode.js";
import { unicodeInput } from "./unicode.js";

const SEVERITY = { 1: "error", 2: "warning", 3: "information", 4: "hint" };
const SORRY = /declaration uses [`']sorry[`']/;

const setDiagnostics = StateEffect.define();

class MessageWidget extends WidgetType {
  constructor(messages) {
    super();
    this.messages = messages;
  }
  eq(other) {
    return other.messages.length === this.messages.length
      && other.messages.every((m, i) => m.severity === this.messages[i].severity
        && m.message === this.messages[i].message);
  }
  toDOM() {
    const box = document.createElement("div");
    box.className = "tpil-messages";
    for (const m of this.messages) {
      const pre = document.createElement("pre");
      pre.className = `tpil-message ${m.severity}`;
      pre.textContent = m.message;
      box.append(pre);
    }
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

/** Underlines and per-line message boxes, mapped through edits until fresh diagnostics arrive. */
const diagnosticsField = StateField.define({
  create: () => Decoration.none,
  update(decos, tr) {
    decos = decos.map(tr.changes);
    for (const e of tr.effects) if (e.is(setDiagnostics)) decos = e.value;
    return decos;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function buildDecorations(doc, diags) {
  const marks = [];
  const byLine = new Map();
  for (const d of diags) {
    if (d.from < d.to && d.severity !== "information") {
      marks.push(Decoration.mark({ class: `tpil-underline ${d.severity}` }).range(d.from, d.to));
    }
    const line = doc.lineAt(d.end).number;
    if (!byLine.has(line)) byLine.set(line, []);
    byLine.get(line).push(d);
  }
  const widgets = [...byLine.entries()].map(([line, ms]) =>
    Decoration.widget({ widget: new MessageWidget(ms), block: true, side: 1 }).range(doc.line(line).to));
  const all = [...marks, ...widgets].sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
  const builder = new RangeSetBuilder();
  for (const r of all) builder.add(r.from, r.to, r.value);
  return builder.finish();
}

/** Renders the Markdown Lean returns for hovers: fenced Lean code, prose, and inline code. */
function renderMarkdown(md) {
  const out = document.createElement("div");
  out.className = "tpil-hover";
  md.split(/```(?:lean)?\n?([\s\S]*?)```/).forEach((part, i) => {
    if (i % 2 === 1) {
      const pre = document.createElement("pre");
      pre.textContent = part.trimEnd();
      out.append(pre);
    } else {
      for (const para of part.split(/\n\s*\n|\*\*\*/)) {
        if (!para.trim()) continue;
        const p = document.createElement("p");
        para.split(/`([^`]*)`/).forEach((s, j) => {
          if (j % 2 === 1) {
            const c = document.createElement("code");
            c.textContent = s;
            p.append(c);
          } else p.append(s);
        });
        out.append(p);
      }
    }
  });
  return out;
}

export class LeanEditor {
  /**
   * @param {object} o
   * @param {HTMLElement} o.host where the editor goes
   * @param {import("./lsp.js").LeanSession} o.session
   * @param {string} o.uri the virtual file's URI
   * @param {string} o.pre hidden code before the editor's text
   * @param {string} o.initial the original visible code
   * @param {string} o.post hidden code after the editor's text
   * @param {string} o.storageKey where edits are saved
   * @param {(s: object) => void} o.onStatus called with { state, errors, sorries }
   */
  constructor(o) {
    Object.assign(this, o);
    this.preText = o.pre ? o.pre + "\n" : "";
    this.postText = o.post ? "\n" + o.post : "";
    this.lineOffset = o.pre ? o.pre.split("\n").length : 0;
    this.sentVersion = 0;
    this.processing = false;
    this.diagnostics = [];
    this.render();
    this.report();
  }

  get text() {
    return this.view.state.doc.toString();
  }

  get fileText() {
    return this.preText + this.text + this.postText;
  }

  render() {
    this.root = document.createElement("div");
    this.root.className = "tpil-editor";
    const editorHost = document.createElement("div");
    editorHost.className = "tpil-cm";
    this.hiddenNote = document.createElement("div");
    this.hiddenNote.className = "tpil-hidden-errors";
    this.goalBox = document.createElement("div");
    this.goalBox.className = "tpil-goals";
    this.goalBox.hidden = true;
    this.root.append(editorHost, this.hiddenNote, this.goalBox);
    this.host.append(this.root);

    let saved = null;
    try {
      saved = localStorage.getItem(this.storageKey);
    } catch {}
    this.view = new EditorView({
      parent: editorHost,
      state: EditorState.create({
        doc: saved ?? this.initial,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          bracketMatching(),
          highlightSelectionMatches(),
          indentUnit.of("  "),
          EditorState.tabSize.of(2),
          unicodeInput,
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          leanHighlighting,
          diagnosticsField,
          hoverTooltip((view, pos) => this.hover(pos), { hoverTime: 400 }),
          EditorView.updateListener.of((u) => this.onUpdate(u)),
          EditorView.domEventHandlers({ focus: () => this.start() }),
        ],
      }),
    });
  }

  /** Starts checking the code with Lean, if it is not already being checked. */
  start() {
    if (this.started && this.session.isOpen(this.uri)) {
      this.session.touch(this.uri);
      return;
    }
    this.started = true;
    this.sync();
  }

  async sync() {
    try {
      const version = await this.session.sync(this.uri, this.fileText, this);
      if (version !== this.sentVersion) {
        this.sentVersion = version;
        this.processing = true;
      }
      this.report();
    } catch (e) {
      this.processing = false;
      this.report(e.message);
    }
  }

  onUpdate(u) {
    if (u.docChanged) {
      try {
        if (this.text === this.initial) localStorage.removeItem(this.storageKey);
        else localStorage.setItem(this.storageKey, this.text);
      } catch {}
      if (this.started) {
        clearTimeout(this.syncTimer);
        this.syncTimer = setTimeout(() => this.sync(), 250);
      }
    }
    if (u.docChanged || u.selectionSet) {
      clearTimeout(this.goalTimer);
      this.goalTimer = setTimeout(() => this.updateGoal(), 150);
    }
  }

  reset() {
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: this.initial } });
    this.start();
  }

  // --- Positions: the editor shows only the middle of the file. ---

  toOffset({ line, character }) {
    const doc = this.view.state.doc;
    const l = line - this.lineOffset + 1;
    if (l < 1) return 0;
    if (l > doc.lines) return doc.length;
    const info = doc.line(l);
    return Math.min(info.from + character, info.to);
  }

  inEditor({ line }) {
    const l = line - this.lineOffset;
    return l >= 0 && l < this.view.state.doc.lines;
  }

  toPosition(offset) {
    const line = this.view.state.doc.lineAt(offset);
    return { line: line.number - 1 + this.lineOffset, character: offset - line.from };
  }

  // --- Callbacks from the session ---

  onDiagnostics(diags, version) {
    if (version !== undefined && version !== this.sentVersion) return;
    const visible = [];
    const hidden = [];
    for (const d of diags) {
      const range = d.fullRange ?? d.range;
      const severity = SEVERITY[d.severity] ?? "information";
      const msg = { severity, message: d.message };
      if (this.inEditor(range.start) || this.inEditor(range.end)) {
        visible.push({
          ...msg,
          from: this.toOffset(d.range.start),
          to: this.toOffset(d.range.end),
          end: this.toOffset(range.end),
        });
      } else if (severity === "error") hidden.push(msg);
    }
    this.diagnostics = visible;
    this.view.dispatch({ effects: setDiagnostics.of(buildDecorations(this.view.state.doc, visible)) });
    this.hiddenNote.replaceChildren(...hidden.map((m) => {
      const pre = document.createElement("pre");
      pre.className = "tpil-message error";
      pre.textContent = `In the example's hidden setup: ${m.message}`;
      return pre;
    }));
    this.report();
  }

  onProgress(processing, version) {
    if (version !== undefined && version !== this.sentVersion) return;
    const wasProcessing = this.processing;
    this.processing = processing.length > 0;
    if (wasProcessing && !this.processing) this.updateGoal();
    this.report();
  }

  onDisconnect() {
    this.started = false;
    this.processing = false;
    this.report("Disconnected from the Lean server. Edit or click to reconnect.");
  }

  onEvicted() {
    this.started = false;
  }

  report(error) {
    const errors = this.diagnostics.filter((d) => d.severity === "error").length
      + this.hiddenNote.childElementCount;
    const sorries = this.diagnostics.filter((d) => SORRY.test(d.message)).length;
    let state;
    if (error) state = "failed";
    else if (!this.started) state = "idle";
    else if (this.processing) state = "running";
    else state = "done";
    this.onStatus?.({ state, errors, sorries, error });
  }

  // --- Goals and hovers ---

  async updateGoal() {
    if (!this.started || !this.session.isOpen(this.uri)) return;
    const position = this.toPosition(this.view.state.selection.main.head);
    const textDocument = { uri: this.uri };
    try {
      const goal = await this.session.request("$/lean/plainGoal", { textDocument, position });
      if (goal) {
        this.showGoals(goal.goals.length ? goal.goals : null, "Tactic state");
        return;
      }
      const term = await this.session.request("$/lean/plainTermGoal", { textDocument, position });
      if (term) {
        this.showGoals([term.goal], "Expected type");
        return;
      }
    } catch {}
    this.goalBox.hidden = true;
  }

  showGoals(goals, title) {
    const header = document.createElement("div");
    header.className = "tpil-goals-title";
    header.textContent = goals
      ? `${title}${goals.length > 1 ? ` · ${goals.length} goals` : ""}`
      : `${title} · no goals`;
    const items = (goals ?? []).map((g) => {
      const pre = document.createElement("pre");
      pre.className = "tpil-goal";
      pre.textContent = g;
      return pre;
    });
    if (!goals) {
      const done = document.createElement("div");
      done.className = "tpil-goal-done";
      done.textContent = "Goals accomplished";
      items.push(done);
    }
    this.goalBox.replaceChildren(header, ...items);
    this.goalBox.hidden = false;
  }

  async hover(pos) {
    if (!this.started || !this.session.isOpen(this.uri)) return null;
    const result = await this.session.request("textDocument/hover", {
      textDocument: { uri: this.uri },
      position: this.toPosition(pos),
    }).catch(() => null);
    const contents = result?.contents;
    const md = typeof contents === "string" ? contents : contents?.value;
    if (!md) return null;
    const from = result.range ? this.toOffset(result.range.start) : pos;
    const to = result.range ? this.toOffset(result.range.end) : pos;
    return { pos: from, end: to, above: true, create: () => ({ dom: renderMarkdown(md) }) };
  }
}
