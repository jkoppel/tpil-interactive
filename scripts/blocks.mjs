// Numbers the content blocks of a rendered chapter, so that annotations can refer to them.
//
// A content block is any non-heading child of a `section` in `main`. Ids are `b0`, `b1`, ... in
// document order, so they are stable as long as the vendored page is unchanged.

const SKIP = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "section", "script"]);

/** The content blocks of a page, in document order, as cheerio elements. */
export function contentBlocks($) {
  const blocks = [];
  const walk = (el) => {
    for (const child of $(el).children().toArray()) {
      if (el.tagName === "section" && !SKIP.has(child.tagName)) blocks.push(child);
      else if (child.tagName === "section" || child.tagName === "div") walk(child);
    }
  };
  walk($("main").get(0));
  return blocks;
}

/** The readable text of a block, without the hover popups embedded in highlighted code. */
export function blockText($, el) {
  const c = $(el).clone();
  c.find(".hover-container, .hover-info, .hidden, script").remove();
  return c.text().replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
