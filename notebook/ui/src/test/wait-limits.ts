// The limit every library wait in a test passes (waitFor, findBy*, vi.waitFor, …), so a loaded
// machine does not fail a test at a library's 1 s default (#775, #789). default-waits.test.ts
// fails on a wait without one.
//
// Sized from measured run times: the 44 files with such waits, run together on a 12-CPU host at a
// load average of about 11, took at most 4.8 s for a single test (Identity's "moves a removed
// rule"; MediaLibrary.cards 4.1 s, ConnectTelegram 3.1 s), and a test bounds every wait in it.
// WAIT_MS is twice that, rounded up to whole 5 s.
export const WAIT_MS = 10_000;

export const WAIT = { timeout: WAIT_MS } as const;

/** vitest's per-test limit: a test has to outlast the waits in it, or WAIT_MS never takes effect. */
export const TEST_MS = 3 * WAIT_MS;
