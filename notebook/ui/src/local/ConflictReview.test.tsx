// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ConflictReview } from "./ConflictReview";
import "@testing-library/jest-dom/vitest";

// A version that is missing is a removal: the record or file was deleted on
// one side. The server takes that choice (conflicts.mjs: a record becomes a
// tombstone, a copy of a page is left out), but this screen disabled the
// button of a missing version, so a removal could never be chosen here and
// such a review waited for ever (7 October 2026).
describe("ConflictReview", () => {
  afterEach(cleanup);
  it("lets a removal be chosen", () => {
    const resolve = vi.fn(async () => {});
    render(<ConflictReview resolve={resolve} conflicts={[{ id: "c1", kind: "git", path: "notebook/Plan 1.md", current: null, current_hash: null, local: null, remote: "---\nid: plan\n---\nA copy" }]} />);
    const keep = screen.getByRole("button", { name: "Keep it removed" });
    expect(keep).not.toBeDisabled();
    fireEvent.click(keep);
    expect(resolve).toHaveBeenCalledWith({ id: "c1", choice: "local", expected_hash: null });
  });
  it("still offers a version that exists", () => {
    render(<ConflictReview resolve={async () => {}} conflicts={[{ id: "c2", kind: "git", path: "notebook/Plan.md", current: "now", current_hash: "h", local: "mine", remote: "theirs" }]} />);
    expect(screen.getAllByRole("button", { name: "Keep this version" })).toHaveLength(2);
  });
});
