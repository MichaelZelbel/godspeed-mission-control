// The in-page half of the page-wide layout check (src/layout-audit.test.ts): finds text that is cut
// off and text drawn under another element on the page as it is shown now. It is one expression that
// the test reads as text and runs with page.evaluate, so nothing in it may refer to anything outside
// the page. It returns [{rule, element}].
(() => {
  const found = [];
  // Hit-testing below must follow what is painted on top, not what takes clicks.
  const hitAll = document.createElement("style");
  hitAll.textContent = "*{pointer-events:auto!important}";
  document.head.appendChild(hitAll);

  const describe = (el) => {
    const text = el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.textContent || "";
    return `${el.getAttribute("role") || el.tagName.toLowerCase()} "${text.replace(/\s+/g, " ").trim().slice(0, 60)}"`;
  };
  // Text kept for screen readers only (Tailwind's sr-only: a 1 px box, clipped) is meant to be unseen.
  const screenReaderOnly = (el) => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const style = getComputedStyle(e);
      const box = e.getBoundingClientRect();
      if (style.position === "absolute" && box.width <= 1 && box.height <= 1
        && (style.clip === "rect(0px, 0px, 0px, 0px)" || style.overflow === "hidden")) return true;
    }
    return false;
  };
  const visible = (el) => {
    if (el.closest('[aria-hidden="true"],[inert]')) return false;
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true })) return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && !screenReaderOnly(el);
  };
  const textRects = (el) => {
    const rects = [];
    for (const node of el.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      rects.push(...[...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0));
    }
    return rects;
  };
  // What a line draws: its glyphs, each run of them measured on its own, so the whitespace around them
  // is not. Chrome counts a wrapped line's trailing space in the line's rect and may end it one layout
  // step (1/64 px) past the box (#746); that space draws nothing, and a glyph past the box by any amount
  // is still found.
  const glyphRects = (el) => {
    const rects = [];
    for (const node of el.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      for (const run of node.textContent.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, run.index);
        range.setEnd(node, run.index + run[0].length);
        rects.push(...[...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0));
      }
    }
    return rects;
  };

  const main = document.querySelector("main");
  const clips = (v) => v === "hidden" || v === "clip";
  const scrolls = (v) => v === "auto" || v === "scroll";
  // The boxes that cut what an element shows: its own box, every ancestor that hides its overflow, up
  // to the first scroller (text in a scroller is reached by scrolling), and, sideways, the page's main
  // area and the window.
  const cuttingBoxes = (el) => {
    const boxes = [{ box: el.getBoundingClientRect(), x: true, y: true }];
    let inScroller = false;
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const style = getComputedStyle(e);
      if (e === main) { boxes.push({ box: e.getBoundingClientRect(), x: true, y: false }); break; }
      if (scrolls(style.overflowX) || scrolls(style.overflowY)) { inScroller = true; break; }
      if (clips(style.overflowX) || clips(style.overflowY)) {
        boxes.push({ box: e.getBoundingClientRect(), x: clips(style.overflowX), y: clips(style.overflowY) });
      }
      if (style.position === "fixed") break;
    }
    if (!inScroller) boxes.push({ box: { left: 0, right: innerWidth }, x: true, y: false });
    return boxes;
  };
  // Sideways the text's own edges count. Up and down a line's middle counts: Chrome reports a line as
  // the font's whole height, which is taller than a leading-none line box, so its edges pass the box
  // with no part of a letter cut.
  const outside = (text, cut) => {
    const middle = (text.top + text.bottom) / 2;
    return (cut.x && (text.left < cut.box.left || text.right > cut.box.right))
      || (cut.y && (middle < cut.box.top || middle > cut.box.bottom));
  };

  const TEXT_INPUT = "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=color])";
  const inputClipped = (input) => {
    const shown = input.value || input.placeholder;
    if (!shown) return null;
    const style = getComputedStyle(input);
    const ruler = document.createElement("span");
    for (const key of ["fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "textTransform", "fontStretch", "wordSpacing"]) {
      ruler.style[key] = style[key];
    }
    Object.assign(ruler.style, { position: "absolute", whiteSpace: "pre", visibility: "hidden" });
    ruler.textContent = shown;
    document.body.appendChild(ruler);
    const need = ruler.getBoundingClientRect().width;
    ruler.remove();
    // Not input.clientWidth: on an input Chrome leaves the padding out of it.
    const room = input.getBoundingClientRect().width
      - ["borderLeftWidth", "borderRightWidth", "paddingLeft", "paddingRight"].reduce((sum, key) => sum + parseFloat(style[key]), 0);
    return need > room ? `${describe(input)}: its text needs ${need.toFixed(1)} px, the box has ${room.toFixed(1)}` : null;
  };

  const elements = [...document.body.querySelectorAll("*")]
    .filter((el) => el !== hitAll && !el.closest("svg") && !el.closest("[contenteditable=true]"));

  for (const el of elements) {
    if (el.matches(TEXT_INPUT)) {
      const clipped = visible(el) && inputClipped(el);
      if (clipped) found.push({ rule: "clipped", element: clipped });
      continue;
    }
    const rects = glyphRects(el);
    if (!rects.length || !visible(el)) continue;
    const boxes = cuttingBoxes(el);
    if (rects.some((text) => boxes.some((cut) => outside(text, cut)))) found.push({ rule: "clipped", element: describe(el) });
  }

  const paints = (el) => {
    if (el.matches("img,svg,canvas,video,input,textarea,select,button")) return true;
    const style = getComputedStyle(el);
    return !/^(rgba\(0, 0, 0, 0\)|transparent)$/.test(style.backgroundColor) || style.backgroundImage !== "none"
      || [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
  };
  for (const el of elements) {
    if (!textRects(el).length || !visible(el)) continue;
    // In the middle of its scroll areas, as far as they go: text a scroll moves under a sticky header is
    // not drawn under it, text no scroll can bring out is.
    el.scrollIntoView({ block: "center", inline: "center" });
    for (const text of textRects(el)) {
      const x = text.left + text.width / 2;
      const y = text.top + text.height / 2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
      let over = null;
      for (const hit of document.elementsFromPoint(x, y)) {
        if (hit === el || el.contains(hit) || hit.contains(el)) break;
        if (paints(hit)) { over = hit; break; }
      }
      if (over) { found.push({ rule: "under another element", element: `${describe(el)} under ${describe(over)}` }); break; }
    }
  }

  hitAll.remove();
  scrollTo(0, 0);
  for (const el of document.querySelectorAll("*")) {
    if (el.scrollTop || el.scrollLeft) { el.scrollTop = 0; el.scrollLeft = 0; }
  }
  return found;
})()
