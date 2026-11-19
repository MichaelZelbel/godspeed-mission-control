// @vitest-environment jsdom
// My Profile's nickname box, its + button and the Filter fields box are named
// by what they are for, not only by placeholder or icon (#776). The names come
// from screen-reader-only labels tied to each box, so the page looks the same.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { createFakeSupabase } from "@/test/fake-supabase";
import { clickLabel } from "@/test/label-click";

const fake = vi.hoisted(() => ({ supabase: null as any }));
vi.mock("@/integrations/supabase/client", () => ({
  get supabase() {
    return fake.supabase;
  },
}));

import { SelfRecognitionSection } from "./SelfRecognitionSection";
import { ProfileFieldFilter } from "@/components/people/profile/ProfileFieldFilter";

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

afterEach(cleanup);

describe("My Profile's boxes", () => {
  it("names the nickname box \"Add a nickname\" by its label and the + button \"Add nickname\"", async () => {
    const db = createFakeSupabase((q) =>
      q.table === "profiles" ? { data: { display_name: "Fictional Ada", self_matching_enabled: true } } : undefined,
    );
    fake.supabase = { ...db.client, auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) } };
    wrap(<SelfRecognitionSection />);

    const box = await screen.findByLabelText("Add a nickname", { exact: true });
    expect(box.tagName).toBe("INPUT");
    expect(screen.getByRole("textbox", { name: "Add a nickname" })).toBe(box);
    const label = (box as HTMLInputElement).labels![0];
    expect(label).toHaveTextContent(/^Add a nickname$/);
    expect(label).toHaveClass("sr-only");
    clickLabel(label);
    expect(document.activeElement).toBe(box);

    // The name stays once something is typed and the placeholder is gone.
    fireEvent.change(box, { target: { value: "Addie" } });
    expect(screen.getByLabelText("Add a nickname", { exact: true })).toHaveValue("Addie");

    const add = screen.getByRole("button", { name: "Add nickname" });
    expect(add).toBeEnabled();
    fireEvent.click(add);
    await waitFor(() => expect(db.on("user_self_aliases", "insert")).toHaveLength(1));
    expect(db.on("user_self_aliases", "insert")[0].payload).toEqual({ user_id: "owner", alias: "Addie" });
  });

  it("names the filter box exactly \"Filter fields\" by its label, without the shortcut hint", () => {
    render(<ProfileFieldFilter value="" onChange={vi.fn()} />);

    const box = screen.getByLabelText("Filter fields", { exact: true });
    expect(box.tagName).toBe("INPUT");
    expect(screen.getByRole("textbox", { name: "Filter fields" })).toBe(box);
    expect(box).toHaveAttribute("placeholder", "Filter fields… ( / )");
    const label = (box as HTMLInputElement).labels![0];
    expect(label).toHaveTextContent(/^Filter fields$/);
    expect(label).toHaveClass("sr-only");
    clickLabel(label);
    expect(document.activeElement).toBe(box);
  });
});
