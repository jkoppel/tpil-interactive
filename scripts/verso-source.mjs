// Extracts the runnable Lean examples from the book's Verso sources.
//
// Every `lean` code block in the book is elaborated as a standalone file, so each one is runnable
// on its own. A line of four or more dashes splits off a hidden prefix or suffix. `savedAnchor`
// blocks show one anchored fragment of a file saved earlier by a `save` block.

import { readFileSync } from "node:fs";

const FENCE = /^(\s*)(`{3,})\s*(.*)$/;
const DIRECTIVE_OPEN = /^(:{3,})\s*([A-Za-z]+)/;
const SPLIT_LINE = /^\s*-{4,}\s*$/;
const ANCHOR_LINE = /^\s*--\s*ANCHOR(_END)?:/;
const PROOF_STATE_LINE = /^\s*--.*PROOF_STATE:/;
const MESSAGE_START = /^\s*--\s*message(\((info|error|warning)\))?:/;
const TRAILING_MESSAGE = /\s+--\s*message(\((info|error|warning)\))?:.*$/;

/** Directives whose contents never reach the rendered page. */
const DROPPED_DIRECTIVES = new Set(["comment", "TODO"]);

function parseLeanArgs(info) {
  const rest = info.slice("lean".length);
  const opt = (name) => {
    const m = rest.match(new RegExp(`\\(\\s*${name}\\s*:=\\s*("[^"]*"|\\S+?)\\s*\\)`));
    return m ? m[1].replace(/^"|"$/g, "") : undefined;
  };
  return {
    show: opt("show") !== "false",
    check: opt("check") !== "false",
    expectErrors: /(^|\s)\+error\b/.test(rest),
  };
}

/** Lists the code blocks of one chapter in document order, skipping dropped directives. */
function codeBlocks(text) {
  const lines = text.split("\n");
  const blocks = [];
  const dropStack = []; // colon counts of the dropped directives we are inside
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dir = line.match(DIRECTIVE_OPEN);
    if (dir && DROPPED_DIRECTIVES.has(dir[2])) {
      dropStack.push(dir[1].length);
      continue;
    }
    if (dropStack.length && new RegExp(`^:{${dropStack.at(-1)}}\\s*$`).test(line)) {
      dropStack.pop();
      continue;
    }
    const fence = line.match(FENCE);
    if (!fence) continue;
    const [, indent, ticks, info] = fence;
    const close = new RegExp(`^\\s*\`{${ticks.length}}\\s*$`);
    const body = [];
    let j = i + 1;
    for (; j < lines.length && !close.test(lines[j]); j++) {
      body.push(lines[j].startsWith(indent) ? lines[j].slice(indent.length) : lines[j].trimStart());
    }
    if (!dropStack.length) blocks.push({ info: info.trim(), code: body.join("\n"), line: i + 1 });
    i = j;
  }
  return blocks;
}

/** Removes the comments that only drive the book's rendering: anchors, proof states, messages. */
export function stripRenderingComments(code) {
  const out = [];
  const lines = code.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ANCHOR_LINE.test(line) || PROOF_STATE_LINE.test(line)) continue;
    if (MESSAGE_START.test(line)) {
      // A message that spans several lines continues as comment lines at the same indentation.
      const indent = line.match(/^\s*/)[0];
      while (i + 1 < lines.length && lines[i + 1].startsWith(indent + "--")
        && !MESSAGE_START.test(lines[i + 1])) i++;
      continue;
    }
    out.push(line.replace(TRAILING_MESSAGE, ""));
  }
  return out.join("\n");
}

function trimBlankLines(s) {
  return s.replace(/^\s*\n/, "").replace(/\n\s*$/, "").replace(/^(\s*\n)+/, "");
}

/**
 * Splits a `lean` block into its hidden prefix, visible middle, and hidden suffix. Verso takes the
 * first split line as the end of the prefix, and a later one as the start of the suffix.
 */
function splitLean(code) {
  const lines = code.split("\n");
  const splits = lines.flatMap((l, i) => (SPLIT_LINE.test(l) ? [i] : []));
  if (!splits.length) return { pre: "", mid: code, post: "" };
  const first = splits[0];
  const last = splits.length > 1 ? splits.at(-1) : lines.length;
  return {
    pre: lines.slice(0, first).join("\n"),
    mid: lines.slice(first + 1, last).join("\n"),
    post: lines.slice(last + 1).join("\n"),
  };
}

/** Splits a saved file around the named anchor. */
function splitAnchor(saved, name) {
  const lines = saved.split("\n");
  const start = lines.findIndex((l) => new RegExp(`--\\s*ANCHOR:\\s*${name}\\s*$`).test(l));
  const end = lines.findIndex((l) => new RegExp(`--\\s*ANCHOR_END:\\s*${name}\\s*$`).test(l));
  if (start < 0 || end < 0) throw new Error(`anchor ${name} not found`);
  return {
    pre: lines.slice(0, start).join("\n"),
    mid: lines.slice(start + 1, end).join("\n"),
    post: lines.slice(end + 1).join("\n"),
  };
}

/**
 * The examples a chapter displays, in the order they appear on the rendered page.
 * Each has `pre`, `mid`, and `post` Lean text with rendering comments removed.
 */
export function chapterExamples(path) {
  const saved = new Map();
  const examples = [];
  for (const { info, code, line } of codeBlocks(readFileSync(path, "utf8"))) {
    const kind = info.split(/[\s(]/)[0];
    let parts;
    let args = { check: true, expectErrors: false };
    if (kind === "save") {
      saved.set(info.split(/\s+/)[1], code);
      continue;
    } else if (kind === "savedAnchor") {
      const name = info.split(/\s+/)[1];
      const file = [...saved.values()].find((c) => new RegExp(`ANCHOR:\\s*${name}\\s*$`, "m").test(c));
      if (!file) throw new Error(`${path}:${line}: no saved file has anchor ${name}`);
      parts = splitAnchor(file, name);
    } else if (kind === "signature") {
      // A signature display: shown as an example, but not a runnable file.
      examples.push({ source: `${path.split("/").at(-1)}:${line}`, runnable: false, mid: code });
      continue;
    } else if (kind === "lean") {
      args = parseLeanArgs(info);
      if (!args.show) continue;
      parts = splitLean(code);
    } else continue;
    examples.push({
      source: `${path.split("/").at(-1)}:${line}`,
      runnable: true,
      check: args.check,
      expectErrors: args.expectErrors,
      pre: stripRenderingComments(parts.pre),
      mid: trimBlankLines(stripRenderingComments(parts.mid)),
      post: stripRenderingComments(parts.post),
    });
  }
  return examples;
}
