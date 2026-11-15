// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DuplicateHints } from "./DuplicateHints";

// Contacts as the notebook's files can hold them: no name, a null name, aliases that are not text.
const nameless: any = { id: "review-0001", aliases: [] };
const broken: any = [
  { id: "n1", name: null, aliases: [null, 7, ""] },
  { id: "n2", name: 5, aliases: undefined },
  { id: "n3", name: "  ", aliases: null },
];

describe("duplicate hints with contacts that have no usable name", () => {
  afterEach(cleanup);
  it("opens a named person next to nameless contacts and still finds the real twin", () => {
    const ada = { id: "a1", name: "Ada Example", aliases: ["Countess"] };
    const twin = { id: "a2", name: "ada example", aliases: [] };
    render(<DuplicateHints person={ada} allPeople={[ada, nameless, ...broken, twin]} />);
    expect(screen.getByText("ada example")).toBeInTheDocument();
    expect(screen.queryByText("Unnamed person")).toBeNull();
  });
  it("opens a nameless person without an error and suggests nobody", () => {
    const { container } = render(<DuplicateHints person={nameless} allPeople={[nameless, ...broken, { id: "x", name: "Ada", aliases: [] }]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
