// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { RichTextEditor } from "./RichTextEditor";

// The other editor in the notebook (issue #26): editable, it opens links the way a note does.
// Before, it left a web link to the browser, which follows none inside an editable editor.
beforeEach(() => {
  vi.stubGlobal("open", vi.fn(() => null));
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const click = (anchor: Element, init: MouseEventInit = {}) =>
  anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, detail: 1, ...init }));

describe("RichTextEditor", () => {
  it("opens a web link in a new tab and a notebook page in the app while editable", async () => {
    const navigate = vi.fn();
    const { container } = render(
      <RichTextEditor value="[Example](https://example.com/page) and [Goals](/dashboard/goals)" editable showToolbar={false} onInternalNavigate={navigate} />,
    );
    await waitFor(() => expect(container.querySelector('[contenteditable="true"] a')).not.toBeNull());
    const [external, internal] = [...container.querySelectorAll("a")];
    click(external);
    expect(window.open).toHaveBeenCalledWith("https://example.com/page", "_blank", "noopener,noreferrer");
    click(internal);
    expect(navigate).toHaveBeenCalledWith("/dashboard/goals");
    expect(window.open).toHaveBeenCalledTimes(1);
  });
});
