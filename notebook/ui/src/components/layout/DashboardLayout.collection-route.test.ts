import { describe, expect, it } from "vitest";
import { isCollectionPage, isCollectionItemPage } from "./collection-route";

describe("collection page route classification", () => {
  it("keeps the phone-height exception on collection pages only", () => {
    expect(isCollectionPage("/collections/reading-list")).toBe(true);
    expect(isCollectionPage("/collections/reading-list/")).toBe(true);
    expect(isCollectionPage("/collections/reading-list/book-42")).toBe(false);
    expect(isCollectionPage("/collections/reading-list/schema")).toBe(false);
    expect(isCollectionPage("/collections/templates")).toBe(false);
  });
});

describe("isCollectionItemPage", () => {
  it("matches an open item only", () => {
    expect(isCollectionItemPage("/collections/reading-list/book-42")).toBe(true);
    expect(isCollectionItemPage("/collections/reading-list/schema")).toBe(false);
    expect(isCollectionItemPage("/collections/reading-list")).toBe(false);
    expect(isCollectionItemPage("/collections/templates/x")).toBe(false);
  });
});
