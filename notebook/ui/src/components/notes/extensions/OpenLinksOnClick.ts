import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { BRAND } from "@/lib/brand";
import { openExternalUrl } from "@/lib/safe-url";

/**
 * Opens the links in a note when they are clicked (issue #26).
 *
 * A note opens ready for typing, and inside an editable editor the browser follows no link by
 * itself: until 23 October 2026 a click, a Ctrl+click or a middle click on a web link in a note
 * did nothing, because the editor turns TipTap's own link opening off (`openOnClick: false`) and
 * nothing else opened one. Now, as in Notion and Obsidian:
 *
 * - a click, Ctrl/Cmd+click or middle click on a web link opens it in a new tab;
 * - a link to the notebook's own address (this host, or one of `BRAND.internalHosts`) opens
 *   inside the app in the same tab, unless Ctrl/Cmd or the middle button asks for a new tab;
 * - an address that would run code (`javascript:`, `data:` and the rest) never opens, since
 *   connected apps and the AI write notes too (`safeExternalUrl` decides);
 * - Shift+click, a drag (selecting text), `[[links]]` and an attachment not yet found
 *   (`href="#"`) are left to the editor.
 *
 * In a note that cannot be edited the browser would open the link by itself; the click is
 * handled here all the same and its default prevented, so a link opens exactly once.
 */

/** Paths the notebook server answers itself (attachments and other files, sign-in, MCP), not pages of the app. */
const SERVER_PATH = /^\/(api|mcp|login|health)(\/|$)/;

/** The followable link an event happened on, or null. `[[links]]` are not followable links. */
function linkOf(event: Event): HTMLAnchorElement | null {
  const target = event.target as Element | null;
  if (!target || typeof target.closest !== "function") return null;
  if (target.closest(".wikilink-node, .wiki-link")) return null;
  const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
  const href = anchor?.getAttribute("href")?.trim() ?? "";
  // "#..." is a jump mark, or an attachment whose file was not found yet.
  if (!href || href.startsWith("#")) return null;
  return anchor;
}

/** A page of this app: an http(s) address on the notebook's own host that the app itself shows. */
function isAppPage(url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const ownHost = url.host === window.location.host || BRAND.internalHosts.includes(url.host);
  return ownHost && !SERVER_PATH.test(url.pathname);
}

/**
 * Handles a click (`click` or `auxclick`) on a link in an editor. Returns true when the event was
 * a link click it dealt with (its default is then prevented), false when it is left to others.
 * Without `onNavigate`, a page of the app is opened with an ordinary page load.
 */
export function openLinkOnClick(event: MouseEvent, onNavigate?: (path: string) => void): boolean {
  if (event.defaultPrevented) return false;
  const middle = event.button === 1;
  if (event.button !== 0 && !middle) return false;
  // Shift+click extends the selection; Alt+click is the browser's own.
  if (event.shiftKey || event.altKey) return false;
  const anchor = linkOf(event);
  if (!anchor) return false;
  const newTab = middle || event.ctrlKey || event.metaKey;
  event.preventDefault();
  // The second click of a double click: the first one opened the link already.
  if (!middle && event.detail > 1) return true;
  let url: URL;
  try {
    url = new URL(anchor.getAttribute("href")!.trim(), window.location.href);
  } catch {
    return true;
  }
  if (!newTab && isAppPage(url)) {
    const path = url.pathname + url.search + url.hash;
    if (onNavigate) onNavigate(path);
    else window.location.assign(path);
    return true;
  }
  // Every new tab goes through the one check for unsafe addresses.
  openExternalUrl(url.href);
  return true;
}

export interface OpenLinksOnClickOptions {
  /** Opens a page of the app in the same tab, normally the router's navigate. */
  onNavigate?: (path: string) => void;
}

export const OpenLinksOnClick = Extension.create<OpenLinksOnClickOptions>({
  name: "openLinksOnClick",

  addOptions() {
    return { onNavigate: undefined };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    // Where the last left press went down. A click that ends more than a few pixels from it was
    // a drag (selecting or moving text), as ProseMirror itself counts one, and opens nothing.
    // Chrome reports a click after such a drag inside a link, also when it selected nothing.
    let pressedAt: { x: number; y: number } | null = null;
    const open = (_view: unknown, event: MouseEvent) => {
      const from = event.type === "click" ? pressedAt : null;
      if (event.type === "click") pressedAt = null;
      if (from && Math.max(Math.abs(event.clientX - from.x), Math.abs(event.clientY - from.y)) > 4) {
        // Nor does the browser open it, in a note that cannot be edited.
        if (linkOf(event)) event.preventDefault();
        return false;
      }
      return openLinkOnClick(event, options.onNavigate);
    };
    // A press that asks for a new tab only opens the link: a middle press neither starts the
    // browser's scrolling mode nor pastes the selection into the note (Linux), and a Ctrl/Cmd
    // press does not make the editor select the whole paragraph. The click that follows opens it.
    const press = (_view: unknown, event: MouseEvent) => {
      if (event.type === "mousedown" && event.button === 0) pressedAt = { x: event.clientX, y: event.clientY };
      const newTab = event.button === 1 || (event.button === 0 && (event.ctrlKey || event.metaKey));
      if (newTab && !event.shiftKey && !event.altKey && linkOf(event)) event.preventDefault();
      return false;
    };
    return [
      new Plugin({
        key: new PluginKey("openLinksOnClick"),
        props: {
          handleDOMEvents: { click: open, auxclick: open, mousedown: press, mouseup: press },
        },
      }),
    ];
  },
});
