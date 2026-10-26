// Text typed in a note that the notebook has not confirmed yet (#29).
//
// On 23 October 2026 a note's text was lost for good: the notebook restarted
// for about 80 seconds, the person opened another note, and the one save sent
// on leaving the first note failed. The editor had already forgotten the text,
// so a toast was all that was left of it.
//
// Every change to a note's text or title is now kept here, and on this device
// (localStorage), before it is sent, and it stays until the notebook has
// confirmed that exact text. A save that fails is sent again after growing
// pauses, also after the note's editor is gone, and at once when the browser is
// back online or the notebook answers another request. Text kept by an earlier
// visit (a closed or reloaded tab) is sent again too, stamped with the version
// of the note it was typed on (record-writes.mjs, pin): a note changed
// elsewhere in the meantime then goes the way every overlapping save goes
// (lib/note-save.mjs), and both versions are kept.
//
// Browser storage can be missing or full; then the text is kept in memory
// only, for as long as the page is open.

export type NoteText = { content?: string; title?: string };
export type UnsavedStatus = "saved" | "pending" | "retrying";

/** What one send did: the text it carried, the note's new version, or that the note no longer exists. */
export interface SendOutcome {
  sent: NoteText;
  version?: string | null;
  gone?: boolean;
}

/** How the keeper reaches the notebook and the screen; given by the app (hooks/useUnsavedNotes.ts). */
export interface NoteTextSender {
  /** Sends the note's unsaved text, read again at each try; resolves when saved, throws when not. */
  send: (noteId: string, unsaved: () => NoteText | null) => Promise<SendOutcome>;
  /** The version of the note this page holds, and its text. */
  versionOf?: (noteId: string) => { hash: string; snapshot?: unknown } | null;
  /** Makes the next save of the note carry an older version (text from an earlier visit). */
  pin?: (noteId: string, version: string, baseline: NoteText) => void;
  /** A save failed while no editor shows the note. */
  waiting?: (noteId: string) => void;
  /** Text that had been waiting is saved, and no editor shows the note. */
  caughtUp?: (noteId: string) => void;
  /** The note was deleted, so its unsaved text has nowhere to go. */
  gone?: (noteId: string) => void;
}

interface Draft extends NoteText {
  /** The version of the note this text was typed on. */
  base?: string;
  /** That version's own text, for a notebook whose history no longer holds it. */
  baseline?: NoteText;
  at: number;
}

type Listener = (noteId: string, confirmed?: NoteText) => void;

const PREFIX = "godspeed:unsaved-note:";
/** Pauses before each further try; the last one repeats until the notebook answers. */
export const RETRY_PAUSES = [1_000, 2_000, 4_000, 8_000, 15_000];
const KEYS = ["content", "title"] as const;

export function textOf(source: unknown): NoteText | null {
  if (!source || typeof source !== "object") return null;
  const value = source as Record<string, unknown>;
  const out: NoteText = {};
  if (typeof value.content === "string") out.content = value.content;
  if (typeof value.title === "string") out.title = value.title;
  return out.content === undefined && out.title === undefined ? null : out;
}

/** Saved Markdown and typed Markdown may differ in line endings and a final newline only. */
export function sameNoteContent(a: string | null | undefined, b: string | null | undefined): boolean {
  const plain = (value: string | null | undefined) => (value ?? "").replace(/\r\n/g, "\n").trimEnd();
  return plain(a) === plain(b);
}
const same = (key: (typeof KEYS)[number], a: string, b: string) => (key === "content" ? sameNoteContent(a, b) : a === b);

// A failure the notebook itself answered (a refusal) is not cured by the
// notebook answering something else; one it never heard is.
const answeredBy = (error: unknown) => {
  const e = error as { code?: unknown; context?: unknown } | null;
  return !!(e && (e.code || e.context));
};

export function createUnsavedNotes({
  storage = () => window.localStorage,
  setTimer = (run: () => void, ms: number) => setTimeout(run, ms),
  clearTimer = (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer),
  now = () => Date.now(),
}: {
  storage?: () => Storage | null | undefined;
  setTimer?: (run: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout> | undefined) => void;
  now?: () => number;
} = {}) {
  const drafts = new Map<string, Draft>();
  const failures = new Map<string, { count: number; answered: boolean }>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const sending = new Map<string, Promise<boolean>>();
  const holds = new Map<string, number>();
  const listeners = new Set<Listener>();
  // Kept by an earlier visit, and not yet pinned to the version it was typed on.
  const earlier = new Set<string>();
  let sender: NoteTextSender | null = null;
  let loaded = false;
  let listening = false;
  let closed = false;
  let lastNudge = 0;

  const local = (): Storage | null => {
    try { return storage() ?? null; } catch { return null; }
  };
  const persist = (id: string) => {
    const store = local();
    if (!store) return;
    const draft = drafts.get(id);
    try {
      if (!draft || !textOf(draft)) { store.removeItem(PREFIX + id); return; }
      try { store.setItem(PREFIX + id, JSON.stringify(draft)); }
      catch {
        // Storage full: the text matters more than the copy of the version it was typed on.
        const { baseline: _baseline, ...lean } = draft;
        store.setItem(PREFIX + id, JSON.stringify(lean));
      }
    } catch { /* kept in memory only */ }
  };
  const parse = (raw: string | null): Draft | null => {
    try {
      const value = raw ? JSON.parse(raw) : null;
      const text = textOf(value);
      if (!text) return null;
      return { ...text, base: typeof value.base === "string" ? value.base : undefined, baseline: textOf(value.baseline) ?? undefined, at: Number(value.at) || 0 };
    } catch { return null; }
  };
  const load = () => {
    if (loaded) return;
    loaded = true;
    const store = local();
    if (!store) return;
    try {
      const keys: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (key?.startsWith(PREFIX)) keys.push(key);
      }
      for (const key of keys) {
        const id = key.slice(PREFIX.length), draft = parse(store.getItem(key));
        if (!draft || drafts.has(id)) continue;
        drafts.set(id, draft);
        earlier.add(id);
      }
    } catch { /* nothing readable */ }
  };
  const notify = (id: string, confirmed?: NoteText) => {
    for (const listener of [...listeners]) {
      try { listener(id, confirmed); } catch { /* one screen's trouble is not the keeper's */ }
    }
  };
  const has = (id: string) => !!textOf(drafts.get(id));
  const held = (id: string) => (holds.get(id) || 0) > 0;
  const stopTimer = (id: string) => {
    const timer = timers.get(id);
    if (timer !== undefined) clearTimer(timer);
    timers.delete(id);
  };
  const drop = (id: string) => {
    drafts.delete(id);
    failures.delete(id);
    earlier.delete(id);
    stopTimer(id);
    persist(id);
  };
  const schedule = (id: string, ms: number) => {
    if (closed) return;
    stopTimer(id);
    timers.set(id, setTimer(() => { timers.delete(id); void attempt(id); }, ms));
  };

  /** Keeps typed text (and the version it is typed on) before it is sent. */
  function keep(id: string, change: NoteText) {
    load();
    const text = textOf(change);
    if (!id || !text) return;
    const draft: Draft = { ...drafts.get(id), ...text, at: now() };
    // Text from an earlier visit keeps the version it was typed on until start() pins it.
    const version = earlier.has(id) ? null : sender?.versionOf?.(id);
    if (version?.hash) {
      draft.base = version.hash;
      draft.baseline = textOf(version.snapshot) ?? undefined;
    }
    drafts.set(id, draft);
    persist(id);
    notify(id);
  }

  /**
   * The notebook holds this text now. Only fields equal to what is kept are
   * let go; newer text typed meanwhile stays. `version` is given for a save
   * this page just made, and is what the rest is typed on from now on.
   */
  function confirm(id: string, saved: NoteText, version?: string | null) {
    const draft = drafts.get(id);
    if (!draft) return;
    const confirmed: NoteText = {};
    for (const key of KEYS) {
      const value = saved?.[key];
      if (typeof value === "string" && typeof draft[key] === "string" && same(key, draft[key]!, value)) {
        delete draft[key];
        confirmed[key] = value;
      }
    }
    const saving = version !== undefined;
    const wasWaiting = saving && failures.has(id);
    if (saving) { failures.delete(id); stopTimer(id); }
    if (!has(id)) {
      drop(id);
      if (wasWaiting && !held(id)) sender?.caughtUp?.(id);
    } else {
      if (version) {
        draft.base = version;
        draft.baseline = { ...draft.baseline, ...textOf(saved) };
      }
      persist(id);
      // The notebook answers again. Typed meanwhile: an open editor sends it
      // itself. Text that had failed, or that no editor shows, goes now.
      if (saving && (wasWaiting || !held(id)) && !sending.has(id)) schedule(id, 0);
    }
    notify(id, confirmed.content !== undefined || confirmed.title !== undefined ? confirmed : undefined);
  }

  /** Lets go of kept text on purpose (the note was deleted, merged, or the change taken back). */
  function discard(id: string, keys: readonly ("content" | "title")[] = KEYS) {
    const draft = drafts.get(id);
    if (!draft) return;
    for (const key of keys) delete draft[key];
    if (!has(id)) drop(id);
    else persist(id);
    notify(id);
  }

  /** A save of the note's kept text failed: it is tried again, sooner first. */
  function failed(id: string, error?: unknown) {
    if (closed || !has(id)) return;
    const before = failures.get(id);
    const count = (before?.count || 0) + 1;
    failures.set(id, { count, answered: answeredBy(error) });
    if (!sending.has(id)) schedule(id, RETRY_PAUSES[Math.min(count, RETRY_PAUSES.length) - 1]);
    if (!before && !held(id)) sender?.waiting?.(id);
    notify(id);
  }

  function attempt(id: string): Promise<boolean> {
    if (closed) return Promise.resolve(false);
    const running = sending.get(id);
    if (running) return running;
    if (!has(id)) return Promise.resolve(true);
    // Nobody to send it yet: start() sends it.
    if (!sender) return Promise.resolve(false);
    const send = sender.send;
    stopTimer(id);
    const run = (async () => {
      try {
        const outcome = await send(id, () => textOf(drafts.get(id)));
        if (closed) return false;
        sending.delete(id);
        if (outcome?.gone) {
          const had = has(id);
          drop(id);
          notify(id);
          if (had) sender?.gone?.(id);
          return true;
        }
        confirm(id, outcome?.sent ?? {}, outcome?.version ?? null);
        return true;
      } catch (error) {
        sending.delete(id);
        failed(id, error);
        return false;
      } finally {
        sending.delete(id);
      }
    })();
    sending.set(id, run);
    return run;
  }

  /** Sends the note's kept text now (leaving the note, hiding the tab); true once it is saved. */
  function flush(id: string): Promise<boolean> {
    load();
    return attempt(id);
  }

  /** Tries the waiting saves at once: the browser is online again, or the notebook answered. */
  function nudge({ onlyUnheard = false }: { onlyUnheard?: boolean } = {}) {
    if (closed || failures.size === 0) return;
    const at = now();
    if (at - lastNudge < 1_000) return;
    lastNudge = at;
    for (const [id, failure] of failures) {
      if (sending.has(id) || (onlyUnheard && failure.answered)) continue;
      void attempt(id);
    }
  }

  const onOnline = () => nudge();
  const onFocus = () => nudge();
  const onLeave = (event: BeforeUnloadEvent) => {
    if (!hasUnsaved()) return;
    // The browser's own "Leave site?" question; its words are the browser's.
    event.preventDefault();
    event.returnValue = "";
    return "";
  };
  const onStorage = (event: StorageEvent) => {
    if (!event.key?.startsWith(PREFIX)) return;
    // Another tab of the same notebook saved or changed it.
    const id = event.key.slice(PREFIX.length), draft = parse(event.newValue);
    if (draft) drafts.set(id, draft);
    else { drafts.delete(id); failures.delete(id); earlier.delete(id); stopTimer(id); }
    notify(id);
  };

  /**
   * Connects the keeper to the notebook. Text kept by an earlier visit is
   * pinned to the version it was typed on and sent.
   */
  function start(next: NoteTextSender) {
    closed = false;
    sender = next;
    load();
    for (const id of earlier) {
      const draft = drafts.get(id);
      if (draft?.base) next.pin?.(id, draft.base, draft.baseline ?? {});
    }
    earlier.clear();
    if (!listening && typeof window !== "undefined") {
      listening = true;
      window.addEventListener("online", onOnline);
      window.addEventListener("focus", onFocus);
      window.addEventListener("beforeunload", onLeave);
      window.addEventListener("storage", onStorage);
    }
    for (const id of drafts.keys()) {
      if (!held(id) && !sending.has(id) && !timers.has(id)) schedule(id, 0);
    }
  }

  /** The page is going away for good (tests use it as a closed tab). Kept text stays in storage. */
  function shutdown() {
    closed = true;
    for (const id of [...timers.keys()]) stopTimer(id);
    if (listening && typeof window !== "undefined") {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("beforeunload", onLeave);
      window.removeEventListener("storage", onStorage);
    }
    listening = false;
    sender = null;
  }

  /** An editor shows the note: it sends what is typed itself, the keeper only what failed. */
  function hold(id: string) {
    holds.set(id, (holds.get(id) || 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (holds.get(id) || 1) - 1;
      if (left > 0) holds.set(id, left);
      else holds.delete(id);
    };
  }

  function get(id: string): NoteText | null {
    load();
    return textOf(drafts.get(id));
  }

  function status(id: string): UnsavedStatus {
    load();
    if (!has(id)) return "saved";
    return failures.has(id) ? "retrying" : "pending";
  }

  function hasUnsaved() {
    load();
    for (const id of drafts.keys()) if (has(id)) return true;
    return false;
  }

  function subscribe(listener: Listener) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  return { keep, confirm, discard, failed, flush, nudge, start, shutdown, hold, get, status, hasUnsaved, subscribe, isHeld: held };
}

export type UnsavedNotes = ReturnType<typeof createUnsavedNotes>;

/** The page's one keeper: it outlives every editor. */
export const unsavedNotes = createUnsavedNotes();

/** Called for every answer from the notebook (integrations/supabase/client.ts). */
export function noticeServerAnswer() {
  unsavedNotes.nudge({ onlyUnheard: true });
}
