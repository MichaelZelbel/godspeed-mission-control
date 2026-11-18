/**
 * Keeps the sidebar's list from ending in the middle of an entry (#747).
 *
 * On a laptop screen the list is taller than the room between the logo and the footer, and the
 * entry at the edge was drawn half under Sign Out, with nothing saying that the list scrolls. This
 * makes the list's visible part end at the bottom of the last entry that fits whole, gives the room
 * left over to `more` (a "More below" sign that scrolls the list on), and hides that sign once the
 * list is scrolled to its end.
 *
 * Plain DOM with no imports, so the sidebar's layout test can run this same function in a real
 * browser. Returns a function that stops watching.
 */
export function watchSidebarFit(list: HTMLElement, more: HTMLElement): () => void {
  // The sign needs at least this much room; an entry that would leave it less is left below.
  const MORE_MIN = 28;
  let fitting = false;

  const showMore = () => {
    const overflows = list.scrollHeight > list.clientHeight + 1;
    const atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
    const shown = overflows && !atEnd;
    more.style.visibility = shown ? "visible" : "hidden";
    more.setAttribute("aria-hidden", shown ? "false" : "true");
    more.tabIndex = shown ? 0 : -1;
  };

  // A keyboard user tabbing down the list must see the entry that has focus: bring it wholly into
  // the list's visible part (the shortened one, not the room behind "More below").
  const reveal = () => {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || focused === list || !list.contains(focused)) return;
    const target = focused.closest<HTMLElement>('[data-sidebar="menu-item"]') ?? focused;
    const box = list.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    if (r.top < box.top) list.scrollTop -= Math.ceil(box.top - r.top);
    else if (r.bottom > box.top + list.clientHeight) list.scrollTop += Math.ceil(r.bottom - (box.top + list.clientHeight));
    showMore();
  };

  const fit = () => {
    if (fitting) return;
    fitting = true;
    // Measuring lets the list grow to its full room for a moment, which pulls its scroll position
    // back; put it back afterwards so a refit never moves what the reader (or focus) is looking at.
    const scrolled = list.scrollTop;
    try {
      // Measure the room the list has on its own.
      list.style.flex = "";
      list.style.height = "";
      more.style.display = "none";
      const room = list.clientHeight;
      if (room <= 0 || list.scrollHeight <= room + 1) {
        showMore();
        return;
      }
      const top = list.getBoundingClientRect().top - list.scrollTop;
      const bottoms = Array.from(list.querySelectorAll<HTMLElement>('[data-sidebar="menu-item"]'))
        .map((item) => Math.ceil(item.getBoundingClientRect().bottom - top))
        .filter((bottom) => bottom > 0 && bottom <= room - MORE_MIN);
      if (bottoms.length === 0) {
        showMore();
        return;
      }
      const end = Math.max(...bottoms);
      list.style.flex = "0 0 auto";
      list.style.height = `${end}px`;
      more.style.display = "";
      showMore();
    } finally {
      list.scrollTop = scrolled;
      reveal();
      fitting = false;
    }
  };

  const onClick = () => list.scrollBy({ top: Math.max(list.clientHeight - 40, 40), behavior: "smooth" });
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  };

  fit();
  list.addEventListener("scroll", showMore, { passive: true });
  more.addEventListener("click", onClick);
  more.addEventListener("keydown", onKey);
  list.addEventListener("focusin", reveal);
  window.addEventListener("resize", fit);
  // The sidebar's own height changes with the window; its entries change with the account (Admin).
  const resized = typeof ResizeObserver === "function" ? new ResizeObserver(() => fit()) : null;
  if (list.parentElement) resized?.observe(list.parentElement);
  const changed = typeof MutationObserver === "function" ? new MutationObserver(() => fit()) : null;
  changed?.observe(list, { childList: true, subtree: true });

  return () => {
    list.removeEventListener("scroll", showMore);
    more.removeEventListener("click", onClick);
    more.removeEventListener("keydown", onKey);
    list.removeEventListener("focusin", reveal);
    window.removeEventListener("resize", fit);
    resized?.disconnect();
    changed?.disconnect();
    list.style.flex = "";
    list.style.height = "";
    more.style.display = "none";
  };
}
