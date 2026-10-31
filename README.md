# Theorem Proving in Lean 4, interactive edition

An interactive version of [Theorem Proving in Lean 4](https://lean-lang.org/theorem_proving_in_lean4/),
tuned for a reader who already knows dependent type theory and Rocq.

- **Runnable examples.** Every Lean example has a **▶ Run** button that swaps the book's rendering for
  a live editor checked by a real Lean server. You get messages under the lines that produce them,
  the tactic state or expected type at the cursor, and type/doc hovers. `\to`, `\a`, `\<>` and
  the other abbreviations work as in VS Code. **Book view** swaps back. Edits persist per example
  in `localStorage`, and **Reset** discards them.
- **Interactive exercises.** Examples in the *Exercises* sections are editors from the start, with
  a badge showing errors, `N sorry remaining`, or `✓ Solved`. Exercises stated only in prose get a
  scratch editor with a starter (`data/exercise-starters.json`).
- **Familiar passages collapsed.** Paragraphs a Rocq user already knows are folded behind a
  one-line summary (`data/collapse/*.json`). The book's text is otherwise unchanged. The pill in
  the bottom-right corner expands or collapses all of them.
- **Franklin drills for the syntax.** This follows [The Benjamin Franklin Method of Reading
  Programming Books](http://www.pathsensitive.com/2018/01/the-benjamin-franklin-method-of-reading.html).
  The book has 91 drills, each one a short example to rewrite from Franklin-style hints. Each
  hint gives the sense of a step without its syntax. A panel at the end of each section lists that
  section's drills. Starting one blurs the book's code ("closing the book"), and you write your
  version in a live editor. **Compare with the book** opens the book and shows a diff against the
  original. The diff updates as you keep editing, and **Hide comparison** closes the book again
  without leaving the drill. When you're done, you grade yourself. Grades schedule the drill's next review (10 min, then 1, 3, 7, 21 and 60
  days), and the **Franklin drill deck** (`drills/`, linked from the table of contents) collects
  what is due. That delay is where the method gets its effect.

  The drills are chosen, not hand-picked. `scripts/syntax-features.mjs` lists about a hundred
  pieces of Lean syntax that the book's examples use. `scripts/select-drills.mjs` solves a
  weighted set cover over short examples, so that each feature is drilled twice where the book
  allows it. The first drill for a feature comes in the chapter that introduces it. The hints are
  in `data/drills/<page>.json`, and `data/drills/excluded.json` lists examples rejected as poor
  drills.

## Running

Requires Node and elan. The Lean version is pinned to the one the book was built with
(`lean-toolchain`, v4.33.0); elan installs it on first use.

```sh
npm install
npm run fetch   # mirror the rendered book and its Verso sources into vendor/
npm run build   # write dist/
npm start       # http://localhost:8742/
```

`npm run check` compiles every extracted example, and every drill's reference answer, with Lean
and reports any that fail unexpectedly.

After changing `scripts/syntax-features.mjs` or the exclusions, re-run
`node scripts/select-drills.mjs`. The build fails if a selected drill has no hints yet.

## How it works

- `scripts/mirror.py` mirrors the official rendered site. The text, highlighting and hovers are
  the book's own.
- `scripts/verso-source.mjs` reads the book's Verso sources. Each `lean` block is elaborated as a
  standalone file, with optional hidden setup and teardown split off by a `----` line. The script
  recovers each example's full file and strips the comments that only drive rendering (expected
  messages, proof-state anchors). `scripts/build.mjs` matches them, in order, to the rendered
  examples, embeds them in the page, and wraps the familiar passages.
- `server/server.mjs` serves `dist/` and bridges each tab to its own `lean --server` over a
  WebSocket. Every example is a separate virtual file, and at most 6 are open per tab. The server
  binds to localhost and rejects cross-origin WebSockets, because `#eval` can run arbitrary IO.
- `src/client/` is the browser side: CodeMirror 6, a minimal Lean LSP client (diagnostics,
  `$/lean/plainGoal`, `$/lean/plainTermGoal`, hover), and abbreviation input.

Collapse ranges refer to positional block ids (`b17`). Each range carries a `startsWith`
fingerprint, so the build fails, rather than folding the wrong paragraphs, if a re-fetched site
has moved. To regenerate the numbered text the annotations were made from, run
`node scripts/dump-blocks.mjs OUT_DIR`.

## Attribution

*Theorem Proving in Lean 4* is by Jeremy Avigad, Leonardo de Moura, Soonho Kong, Sebastian Ullrich
and contributors, and is licensed under the Apache License 2.0
([source](https://github.com/leanprover/theorem_proving_in_lean4)). This repository does not
include the book: `npm run fetch` downloads it. The starters in `data/exercise-starters.json` adapt
exercise statements from the book. The Unicode abbreviation table comes from
[vscode-lean4](https://github.com/leanprover/vscode-lean4) (Apache 2.0) and is also downloaded at
fetch time.
