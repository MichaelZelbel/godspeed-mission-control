// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import LinkExt from "@tiptap/extension-link";
import { BRAND } from "@/lib/brand";
import { OpenLinksOnClick, openLinkOnClick } from "./OpenLinksOnClick";

// Issue #26: a note opens ready for typing, and inside an editable editor the browser follows no
// link by itself, so a click on a web link in a note did nothing. These clicks go to an editor set
// up the way NoteEditor sets up a note: Link with openOnClick off, plus OpenLinksOnClick.
// jsdom's own address is http://localhost:3000, so that is "the notebook's own address" here.
let editor: Editor | null = null;
let navigate: ReturnType<typeof vi.fn>;
let open: ReturnType<typeof vi.fn>;

function mount(html: string, editable = true) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({
    element,
    editable,
    extensions: [
      StarterKit.configure({ link: false }),
      LinkExt.configure({ openOnClick: false }),
      OpenLinksOnClick.configure({ onNavigate: (path: string) => navigate(path) }),
    ],
    content: html,
  });
  return editor;
}

function press(target: Element, init: MouseEventInit & { type?: string } = {}) {
  const { type = "click", ...rest } = init;
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, detail: 1, ...rest });
  target.dispatchEvent(event);
  return event;
}

const link = (text: string) => {
  const found = [...document.querySelectorAll("a")].find((a) => a.textContent === text);
  if (!found) throw new Error("no link " + text);
  return found;
};

beforeEach(() => {
  navigate = vi.fn();
  open = vi.fn(() => null);
  vi.stubGlobal("open", open);
  // jsdom has no elementFromPoint; ProseMirror asks for it on every press.
  Object.assign(document, { elementFromPoint: () => null });
});

afterEach(() => {
  editor?.destroy();
  editor = null;
  document.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("a link in an editable note", () => {
  it("opens a web link in a new tab on a plain click", () => {
    mount('<p>See <a href="https://example.com/page">Example</a> for more.</p>');
    expect(editor!.view.dom.getAttribute("contenteditable")).toBe("true");
    const event = press(link("Example"));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("https://example.com/page", "_blank", "noopener,noreferrer");
    expect(event.defaultPrevented).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("opens it in a new tab on Ctrl+click, Cmd+click and a middle click too", () => {
    mount('<p><a href="https://example.com/page">Example</a></p>');
    // A Ctrl/Cmd press does not let the editor select the paragraph, and the click opens the link
    // even with text selected (in Chrome the editor had already selected the paragraph).
    expect(press(link("Example"), { type: "mousedown", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(press(link("Example"), { type: "mousedown", metaKey: true }).defaultPrevented).toBe(true);
    const text = link("Example").firstChild!;
    document.getSelection()!.setBaseAndExtent(text, 0, text, 7);
    press(link("Example"), { ctrlKey: true });
    press(link("Example"), { metaKey: true });
    // A middle press neither scrolls the page nor pastes into the note; the click opens the link.
    expect(press(link("Example"), { type: "mousedown", button: 1 }).defaultPrevented).toBe(true);
    press(link("Example"), { type: "auxclick", button: 1 });
    expect(open).toHaveBeenCalledTimes(3);
    for (const call of open.mock.calls) expect(call).toEqual(["https://example.com/page", "_blank", "noopener,noreferrer"]);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("never opens a link whose address would run code", () => {
    mount('<p><a href="javascript:alert(1)">Unsafe</a> and <a href="https://example.com/">Safe</a></p>');
    const unsafe = [...editor!.view.dom.querySelectorAll("a")].find((a) => a.textContent === "Unsafe");
    press(unsafe ?? editor!.view.dom.querySelector("p")!);
    expect(open).not.toHaveBeenCalled();
    // The same refusal for an anchor that reached the page by any other way.
    const area = document.createElement("div");
    area.setAttribute("contenteditable", "true");
    area.innerHTML = ['javascript:alert(1)', 'java\tscript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)']
      .map((href, i) => `<a href="${href.replace(/"/g, "&quot;").replace(/</g, "&lt;")}">bad ${i}</a>`)
      .join(" ");
    document.body.appendChild(area);
    const handled: boolean[] = [];
    area.addEventListener("click", (event) => handled.push(openLinkOnClick(event, navigate)));
    for (const anchor of area.querySelectorAll("a")) expect(press(anchor).defaultPrevented).toBe(true);
    expect(handled).toEqual([true, true, true, true, true]);
    expect(open).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("opens a link to the notebook's own address inside the app, in the same tab", () => {
    const otherHost = BRAND.internalHosts[0];
    mount(
      '<p><a href="http://localhost:3000/dashboard/notes/abc?view=1#part">Full</a> ' +
        '<a href="/dashboard/notes/def">Relative</a> ' +
        `<a href="https://${otherHost}/dashboard/goals">Brand</a></p>`,
    );
    press(link("Full"));
    press(link("Relative"));
    press(link("Brand"));
    expect(navigate.mock.calls).toEqual([["/dashboard/notes/abc?view=1#part"], ["/dashboard/notes/def"], ["/dashboard/goals"]]);
    expect(open).not.toHaveBeenCalled();
    // Ctrl+click and a middle click open the notebook's page in a new tab instead.
    press(link("Full"), { ctrlKey: true });
    press(link("Relative"), { type: "auxclick", button: 1 });
    expect(open.mock.calls).toEqual([
      ["http://localhost:3000/dashboard/notes/abc?view=1#part", "_blank", "noopener,noreferrer"],
      ["http://localhost:3000/dashboard/notes/def", "_blank", "noopener,noreferrer"],
    ]);
    expect(navigate).toHaveBeenCalledTimes(3);
  });

  it("opens an attachment as a file in a new tab, and an attachment not yet found does nothing", () => {
    mount('<p><a href="/api/media/file/plan.pdf">plan.pdf</a> <a href="#">later.docx</a></p>');
    press(link("plan.pdf"));
    expect(open).toHaveBeenCalledWith("http://localhost:3000/api/media/file/plan.pdf", "_blank", "noopener,noreferrer");
    const placeholder = press(link("later.docx"));
    expect(placeholder.defaultPrevented).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("leaves a Shift+click, a right click and a drag inside the link to the editor", () => {
    mount('<p><a href="https://example.com/page">Example link</a></p>');
    expect(press(link("Example link"), { shiftKey: true }).defaultPrevented).toBe(false);
    expect(press(link("Example link"), { type: "auxclick", button: 2 }).defaultPrevented).toBe(false);
    // A press and a release 50 pixels apart is a drag (selecting text), also when Chrome selected
    // nothing with it.
    press(link("Example link"), { type: "mousedown", clientX: 10, clientY: 5 });
    press(link("Example link"), { clientX: 60, clientY: 5 });
    expect(open).not.toHaveBeenCalled();
    // A press and a release in the same place is a click, also on link text that is selected.
    const text = link("Example link").firstChild!;
    document.getSelection()!.setBaseAndExtent(text, 0, text, 7);
    press(link("Example link"), { type: "mousedown", clientX: 10, clientY: 5 });
    press(link("Example link"), { clientX: 12, clientY: 6 });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("leaves [[links]] to their own handler", () => {
    const area = document.createElement("div");
    area.innerHTML = '<span class="wikilink-node" data-note-title="Garden">[[Garden]]</span><span class="wiki-link" data-slug="garden">Garden</span>';
    document.body.appendChild(area);
    const handled: boolean[] = [];
    area.addEventListener("click", (event) => handled.push(openLinkOnClick(event, navigate)));
    for (const span of area.querySelectorAll("span")) expect(press(span).defaultPrevented).toBe(false);
    expect(handled).toEqual([false, false]);
    expect(open).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("opens the link once for a double click", () => {
    mount('<p><a href="https://example.com/page">Example</a></p>');
    press(link("Example"), { detail: 1 });
    expect(press(link("Example"), { detail: 2 }).defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe("a link in a note that cannot be edited (in the trash, or from another app)", () => {
  it("opens exactly once: the editor opens it and the browser does not open it again", () => {
    mount('<p><a href="https://example.com/page">Example</a> <a href="/dashboard/notes/abc">Note</a></p>', false);
    expect(editor!.view.dom.getAttribute("contenteditable")).toBe("false");
    expect(press(link("Example")).defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(press(link("Note")).defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledWith("/dashboard/notes/abc");
    // A drag opens nothing, and the browser does not open it either.
    press(link("Example"), { type: "mousedown", clientX: 10, clientY: 5 });
    expect(press(link("Example"), { clientX: 60, clientY: 5 }).defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
  });
});
