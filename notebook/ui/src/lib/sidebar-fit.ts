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

  const fit = () => {
    if (fitting) return;
    fitting = true;
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
    window.removeEventListener("resize", fit);
    resized?.disconnect();
    changed?.disconnect();
    list.style.flex = "";
    list.style.height = "";
    more.style.display = "none";
  };
}
