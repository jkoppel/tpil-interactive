// Syntax highlighting for Lean 4: keywords, commands, comments (nested), strings, and numbers.

import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

const KEYWORDS = new Set(`
  def theorem lemma example abbrev instance class structure inductive coinductive where with match
  fun λ let have show from by at calc do then else if namespace section end open variable
  variables universe import set_option attribute deriving extends mutual private protected
  noncomputable partial unsafe axiom opaque macro macro_rules syntax notation infix infixl infixr
  prefix postfix termination_by decreasing_by local scoped export in return for unless mut try
  catch finally rec nomatch nofun omit include hiding renaming suffices obtain this
`.trim().split(/\s+/));

const SORTS = new Set(["Prop", "Type", "Sort"]);

export const leanLanguage = StreamLanguage.define({
  name: "lean4",
  startState: () => ({ commentDepth: 0 }),
  token(stream, state) {
    if (state.commentDepth > 0) {
      while (!stream.eol()) {
        if (stream.match("/-")) state.commentDepth++;
        else if (stream.match("-/")) {
          state.commentDepth--;
          if (state.commentDepth === 0) break;
        } else stream.next();
      }
      return "comment";
    }
    if (stream.eatSpace()) return null;
    if (stream.match("--")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match("/-")) {
      state.commentDepth = 1;
      return "comment";
    }
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return "string";
    if (stream.match(/^'(?:[^'\\]|\\.)'/)) return "string";
    if (stream.match(/^#[A-Za-z_]+/)) return "keyword";
    if (stream.match(/^\d+(\.\d+)?/)) return "number";
    if (stream.match(/^[A-Za-z_Ͱ-Ͽἀ-῿℀-⅏][\w'!?Ͱ-Ͽἀ-῿₀-ₜ℀-⅏.]*/u)) {
      const word = stream.current();
      if (word === "sorry" || word === "admit") return "invalid";
      if (KEYWORDS.has(word)) return "keyword";
      if (SORTS.has(word)) return "typeName";
      return "variableName";
    }
    if (stream.match(/^(:=|=>|->|<-|←|→|↔|∀|∃|λ|Π|Σ|⟨|⟩|·|<;>)/)) return "operator";
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: "--", block: { open: "/-", close: "-/" } } },
});

const style = HighlightStyle.define([
  { tag: t.keyword, color: "#7c3aed", fontWeight: "500" },
  { tag: t.comment, color: "#6b7280", fontStyle: "italic" },
  { tag: t.string, color: "#047857" },
  { tag: t.number, color: "#b45309" },
  { tag: t.typeName, color: "#0e7490" },
  { tag: t.operator, color: "#9a3412" },
  { tag: t.invalid, color: "#dc2626", fontWeight: "600" },
]);

export const leanHighlighting = [leanLanguage, syntaxHighlighting(style)];
