// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import PeopleMultiSelect from "./PeopleMultiSelect";

const people = [
  { id: "ada", name: "Ada", relationship: "friend" },
  { id: "grace", name: "Grace", relationship: "colleague" },
];

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(cleanup);

describe("PeopleMultiSelect", () => {
  it.each([320, 1280])("keeps its menu above the dialog and usable at %ipx", async (width) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    const onChange = vi.fn();
    render(<PeopleMultiSelect people={people} value={[]} onChange={onChange} />);

    fireEvent.click(screen.getByRole("combobox"));
    const menu = await screen.findByRole("dialog");
    expect(menu).toHaveClass("z-[60]", "max-w-[calc(100vw-2rem)]");

    fireEvent.click(screen.getByText("Ada"));
    expect(onChange).toHaveBeenCalledWith(["ada"]);

    fireEvent.change(screen.getByPlaceholderText("Search people…"), { target: { value: "Grace" } });
    fireEvent.keyDown(screen.getByPlaceholderText("Search people…"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByPlaceholderText("Search people…"), { key: "Enter" });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(["grace"]));
  });
});
