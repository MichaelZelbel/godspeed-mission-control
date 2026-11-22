// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { LocalReplicaPanel } from "./LocalReplicaPanel";
import { getReplicaDiagnostics, type ReplicaDiagnostics } from "@/sync/local-replica";
import { WAIT } from "@/test/wait-limits";

// The panel only renders on the local-first path, so the tests turn the flag on.
vi.mock("@/lib/flags", () => ({ OFFLINE_CORE: true }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "owner" }, session: { user: { id: "owner" } } }),
}));
vi.mock("@/sync/sync-health", () => ({
  useSyncHealth: () => ({ state: "live", error: null, pendingUploads: 0 }),
}));
vi.mock("@/lib/toast", () => ({ showToast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/sync/local-replica", () => ({
  getReplicaDiagnostics: vi.fn(),
  repairLocalReplica: vi.fn(),
}));

const ok: ReplicaDiagnostics = {
  localTotal: 3,
  localFavorites: 1,
  serverTotal: 3,
  serverFavorites: 1,
  missingIds: [],
  connected: true,
  lastSyncedAt: "2026-11-11T10:00:00.000Z",
  pendingUploads: 0,
};

function panel() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocalReplicaPanel />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("LocalReplicaPanel", () => {
  it("says Checking while the diagnostics load, and never In sync before they answer", async () => {
    let resolve!: (value: ReplicaDiagnostics) => void;
    vi.mocked(getReplicaDiagnostics).mockImplementation(
      () => new Promise<ReplicaDiagnostics>((res) => { resolve = res; }),
    );
    panel();
    expect(await screen.findByText("Checking", undefined, WAIT)).toBeInTheDocument();
    expect(screen.queryByText("In sync")).not.toBeInTheDocument();
    resolve(ok);
    expect(await screen.findByText("In sync", undefined, WAIT)).toBeInTheDocument();
    expect(screen.queryByText("Checking")).not.toBeInTheDocument();
  });

  it("when the check fails, says the local copy could not be checked and offers to try again, never In sync", async () => {
    vi.mocked(getReplicaDiagnostics).mockRejectedValue(new Error("The local database is not readable."));
    panel();
    expect(await screen.findByText("The local copy could not be checked.", undefined, WAIT)).toBeInTheDocument();
    expect(screen.getByText(/The local database is not readable\./)).toBeInTheDocument();
    expect(screen.queryByText("In sync")).not.toBeInTheDocument();
    vi.mocked(getReplicaDiagnostics).mockRejectedValue(new Error("Still failing."));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(getReplicaDiagnostics).toHaveBeenCalledTimes(2), WAIT);
    expect(await screen.findByText(/Still failing\./, undefined, WAIT)).toBeInTheDocument();
    expect(screen.queryByText("In sync")).not.toBeInTheDocument();
  });

  it("says In sync only when the diagnostics answered and found no gap", async () => {
    vi.mocked(getReplicaDiagnostics).mockResolvedValue(ok);
    panel();
    expect(await screen.findByText("In sync", undefined, WAIT)).toBeInTheDocument();
  });

  it("says Gap detected when the diagnostics found a note missing on this device", async () => {
    vi.mocked(getReplicaDiagnostics).mockResolvedValue({ ...ok, localTotal: 2, serverTotal: 3, missingIds: ["note-9"] });
    panel();
    expect(await screen.findByText("Gap detected", undefined, WAIT)).toBeInTheDocument();
    expect(screen.getByText("note-9")).toBeInTheDocument();
    expect(screen.queryByText("In sync")).not.toBeInTheDocument();
  });
});
