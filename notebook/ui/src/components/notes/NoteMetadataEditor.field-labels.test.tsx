// @vitest-environment jsdom
// The note's metadata fields each show a visible label tied to the field (#1051): clicking the
// label puts the cursor there, and the field's name is the label's text, not a placeholder.
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NoteMetadataEditor } from "./NoteMetadataEditor";
import { clickLabel } from "@/test/label-click";

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
afterEach(cleanup);

it.each(["Add topic", "Add person"])("%s is a labelled field, focused by clicking its label", (name) => {
  localStorage.clear();
  render(<NoteMetadataEditor noteId="n1" metadata={{ type: "idea", topics: ["x"] }} onUpdate={vi.fn()} />);
  fireEvent.click(screen.getByText("Note Metadata"));
  const label = screen.getAllByText(name).find((el) => el.tagName === "LABEL")!;
  expect(label).toBeVisible();
  const box = screen.getByLabelText(name, { exact: true });
  expect(box.tagName).toBe("INPUT");
  clickLabel(label);
  expect(document.activeElement).toBe(box);
});
