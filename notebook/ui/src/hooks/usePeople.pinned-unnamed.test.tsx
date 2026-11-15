// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePinnedPeople } from "./usePeople";

// Issue 266: a person saved without any name came back among the People tree's favorites and recent people.
const person = (id: string, name: unknown, aliases: unknown[] = []) => ({ id, name, aliases, is_favorite: true, last_viewed_at: "2026-11-01T10:00:00Z" });
const favorites = [person("nameless", null), person("blank", "  ", [null, " "]), person("ada", "Ada")];
const recent = [person("ada", "Ada"), person("review-0001", undefined), person("nick", "", ["Bee"])];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      let data = favorites;
      const chain: any = new Proxy({}, {
        get: (_t, prop) => {
          if (prop === "then") return (res: any) => Promise.resolve({ data, error: null }).then(res);
          if (prop === "limit") return () => { data = recent; return chain; };
          return () => chain;
        },
      });
      return chain;
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
afterEach(cleanup);

it("leaves out people with no name and no nickname, once each", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const hook = renderHook(() => usePinnedPeople(), { wrapper: ({ children }: any) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(hook.result.current.data.map((p) => p.id)).toEqual(["ada", "nick"]);
});
