// The talk of the page that shows who the assistant is (lib/brain-page.ts) with the notebook
// server (notebook/core/identity-shelf.mjs). Every change goes to /api/identity/*, which writes the
// file, keeps the earlier version and answers with what the file holds afterwards.

export type RuleGroup = "must" | "never" | "how";
export type RuleFields = { slug?: string; title: string; line: string; group: RuleGroup; always: boolean; where?: string; story: string };
export type SkillFields = { name?: string; description: string; steps: string };
export type PageFields = { text: string; kept_details?: boolean };
// kept_under: the owner's own rules program keeps AGENTS.md under this many characters.
export type ManualSize = { exists?: boolean; chars: number; limit: number; warn: number; kept_under?: number | null; warning?: string };
// What the assistant's program reads first (Hermes' SOUL.md): "who it is" and the extra
// instructions together (ours), or a text its owner wrote (own), shown with "Bring it here".
export type SoulSize = { chars: number; limit: number; warn: number };
export type SoulInfo = SoulSize & { kind: "no-assistant" | "missing" | "empty" | "hermes" | "ours" | "own" | "unknown"; text?: string | null; linked?: boolean };
export type Place = { key: string; label: string };
// about: the rule's description, for one without its one sentence; stated: its file names its kind.
export type RuleTile = Omit<RuleFields, "story"> & { target: string; slug: string; n: number; where: string; place?: Place; about?: string; stated?: boolean; review_waiting?: boolean };
export type Overview = {
  // kept-elsewhere: the list is kept by a program of the owner's (rules_program), and this page
  // would not write it as it stands, so rules are not changed here (identity-shelf.mjs, gather).
  manual: ManualSize & { review_waiting?: boolean; rules_list: "ok" | "out-of-step" | "kept-elsewhere" | "no-place" | "no-manual" | "problem" | "unavailable"; rules_program?: string | null };
  who: { state: "ok" | "no-markers" | "no-manual"; text?: string; hash?: string; proposal?: string };
  extra: { state: "ok" | "missing" | "unavailable"; text: string; hash?: string; review_waiting?: boolean; reason?: string };
  soul: SoulInfo;
  // In the order the page lists them: the rules read before every job numbered as AGENTS.md
  // numbers them, then the rest by where they are read (place), numbered on.
  rules: RuleTile[];
  profile: { n: number; target: string; name: string; title: string; preview: string; review_waiting?: boolean }[];
  skills: { n: number; target: string; name: string; title: string; description: string; origin: "shipped" | "changed" | "own"; review_waiting?: boolean }[];
};
// What else the assistant can look up in the notebook, as its own tools count it.
export type NotebookTotals = { notes: number; people: number; facts: number; events: number; things: number; collections: number };
export type Item = {
  target: string; kind: "who" | "extra" | "rule" | "profile" | "skill"; file: string; label: string; state: string; hash?: string;
  text?: string; proposal?: string; fields?: RuleFields | SkillFields | PageFields; manual?: ManualSize; soul?: SoulSize;
  origin?: "shipped" | "changed" | "own"; review_waiting?: boolean;
};
export type Version = { id: string; at: string; current: boolean; removed: boolean; by: string; message: string | null; text?: string | null; fields?: RuleFields | SkillFields | PageFields | null; unrecorded?: boolean };
export type Instruction = { id: string; instruction: string; applies_to: string; is_active: boolean; removed: boolean; hash: string; updated_at: string | null };
export type InstructionVersion = { id: string; at: string; current: boolean; instruction: string; applies_to: string; is_active: boolean; removed: boolean };
export type SaveResult = { saved: boolean; unchanged?: boolean; message?: string; target?: string; manual?: ManualSize; soul?: { kind: string; written: boolean }; recorded?: { where: string | null; commit: string | null; note?: string }; now?: { text?: string; hash?: string; fields?: unknown; removed?: boolean } };

export class IdentityError extends Error { code?: string; constructor(message: string, code?: string) { super(message); this.code = code; } }

async function call<T>(route: string, body?: unknown): Promise<T> {
  const response = await fetch("/api/identity" + route, body === undefined ? { headers: { Accept: "application/json" } } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let data: any = null;
  try { data = await response.json(); } catch { /* the message below says it */ }
  if (!response.ok) throw new IdentityError(data?.error || "The notebook did not answer. Try again in a moment.", data?.code);
  return data as T;
}
const q = (target: string) => "?target=" + encodeURIComponent(target);
export const identity = {
  overview: () => call<Overview>(""),
  item: (target: string) => call<Item>("/item" + q(target)),
  history: (target: string) => call<{ data: Version[] }>("/history" + q(target)).then((r) => r.data),
  save: (target: string, change: { text?: string; fields?: unknown }, expected_hash?: string) => call<SaveResult>("/save", { target, ...change, expected_hash }),
  undo: (target: string, expected_hash?: string) => call<SaveResult>("/undo", { target, expected_hash }),
  restore: (target: string, version: string, expected_hash?: string) => call<SaveResult>("/restore", { target, version, expected_hash }),
  addRule: (fields: RuleFields) => call<SaveResult>("/rule", { fields }),
  removeRule: (target: string, expected_hash?: string) => call<SaveResult>("/remove", { target, expected_hash }),
  markWho: () => call<SaveResult>("/mark-who", {}),
  gatherRules: () => call<SaveResult>("/gather-rules", {}),
  bringSoulHere: () => call<SaveResult>("/bring-soul-here", {}),
  notebook: () => call<NotebookTotals>("/notebook"),
  instructions: () => call<{ data: Instruction[] }>("/instructions").then((r) => r.data),
  instructionHistory: (id: string) => call<{ data: InstructionVersion[] }>("/instruction-history?id=" + encodeURIComponent(id)).then((r) => r.data),
  saveInstruction: (instruction: Partial<Instruction> & { removed?: boolean }, expected_hash?: string) => call<SaveResult>("/instruction", { instruction, expected_hash }),
  restoreInstruction: (id: string, version: string, expected_hash?: string) => call<SaveResult>("/instruction-restore", { id, version, expected_hash }),
};

// The chat docked on the page (GlobalAIChatFAB pageContext): the button at its top left opens and
// closes it, and an answer that changed a part of the page tells the page to show it.
export const PAGE_CHAT = "identity";
export const TOGGLE_PAGE_CHAT = "godspeed:toggle-page-chat";
export const PAGE_CHAT_CHANGED = "godspeed:page-chat-changed";

// ---- What the page shows while someone types --------------------------------------------------
export const chars = (text: string | undefined | null) => [...String(text ?? "")].length;
// A file's size if `before` became `after` in it.
export function manualAfter(size: { chars: number } | undefined, before: string, after: string): number | null {
  if (!size) return null;
  return size.chars - chars(before) + chars(after);
}
export type SizeState = "fine" | "near" | "over";
type Size = { chars: number; limit: number; warn: number; kept_under?: number | null };
// The limit that holds: the owner's own rules program keeps AGENTS.md under its own, lower one.
export function limits(size: Size): { limit: number; warn: number } {
  return size.kept_under ? { limit: size.kept_under, warn: size.kept_under - 500 } : { limit: size.limit, warn: size.warn };
}
export function sizeState(total: number | null, size: Size | undefined): SizeState {
  if (total === null || !size) return "fine";
  const { limit, warn } = limits(size);
  if (total >= limit) return "over";
  if (total >= warn) return "near";
  return "fine";
}
// The note under an editor, only when a change makes a file near or over what it may hold: what
// it counts and why it matters. "manual" is AGENTS.md, "soul" is what the assistant's program
// reads first ("who it is" and the extra instructions together). Nothing while it is fine, and
// nothing for a change that makes it shorter.
export function sizeLine(total: number | null, size: Size | undefined, what: "manual" | "soul" = "manual"): string | null {
  if (total === null || !size || total <= size.chars) return null;
  const state = sizeState(total, size), { limit } = limits(size), n = total.toLocaleString("en"), max = limit.toLocaleString("en");
  if (state === "fine") return null;
  if (what === "soul") return state === "over"
    ? `Too long to save: "Who it is" and your extra instructions would be ${n} characters together. Your assistant's program reads them first in every chat and routine, and stops at ${max}. Shorten something first.`
    : `Close to the limit: "Who it is" and your extra instructions would be ${n} of ${max} characters together. Your assistant's program reads them first, and stops at ${max}.`;
  if (size.kept_under) return state === "over"
    ? `Too long to save: your assistant's main instructions (AGENTS.md) would be ${n} characters, and your own rules program keeps that file under ${max}. Shorten something first.`
    : `Close to the limit: your assistant's main instructions (AGENTS.md) would be ${n} characters, and your own rules program keeps that file under ${max}.`;
  return state === "over"
    ? `Too long to save: your assistant's main instructions (AGENTS.md) would be ${n} characters. Your assistant reads that file in full before every job, and its program stops at ${max} and skips the middle of anything longer. Shorten something first.`
    : `Close to the limit: your assistant's main instructions (AGENTS.md) would be ${n} of ${max} characters. Your assistant reads that file in full before every job, and its program stops at ${max}.`;
}
// The line a rule adds to the manual's list ("12. <sentence> `[slug]`").
export const ruleListLine = (line: string, slug: string) => `00. ${line} \`[${slug}]\`\n`;
// A rule's short name: a few words (identity-shelf.mjs NAME_LIMIT).
export const NAME_LIMIT = 60;

// The kind of a rule, as the small tag on its tile and the choice in its editor.
export const GROUPS: { value: RuleGroup; tag: string; short: string }[] = [
  { value: "must", tag: "Must", short: "Must: something it always does" },
  { value: "never", tag: "Never", short: "Never: something it must never do" },
  { value: "how", tag: "How it works", short: "How it works: how things work here" },
];
export const kindTag = (group: RuleGroup) => GROUPS.find((g) => g.value === group)?.tag ?? "How it works";
export const ORIGIN_WORDS: Record<string, string> = {
  shipped: "Kept up to date by updates. Change it, and updates keep your version.",
  changed: "Changed by you. Updates keep your version and offer theirs for you to look at first.",
  own: "Your own skill.",
};
export const ORIGIN_NOTE: Record<string, string> = { shipped: "Kept up to date by updates", changed: "Changed by you", own: "Your own" };
// The rules read only when their subject comes up, grouped by where they are read, in the
// server's order (identity-shelf.mjs placeOf).
export function places(rules: RuleTile[]): { key: string; label: string; rules: RuleTile[] }[] {
  const out: { key: string; label: string; rules: RuleTile[] }[] = [];
  for (const r of rules) {
    if (r.always) continue;
    const key = r.place?.key ?? "when-it-matters", last = out[out.length - 1];
    if (last?.key === key) last.rules.push(r); else out.push({ key, label: r.place?.label ?? "When its subject comes up", rules: [r] });
  }
  return out;
}
// A paragraph the file wraps at a fixed width reads as one paragraph on the page; blank lines stay.
export const reflow = (text?: string | null) => String(text ?? "").split(/\n{2,}/).map((p) => p.replace(/\s*\n\s*/g, " ")).join("\n\n");
// The paragraphs of a text: a blank line starts a new one, a single line break is a wrap.
export const paragraphs = (text?: string | null) => reflow(String(text ?? "").replace(/\r\n?/g, "\n").trim()).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
// When a version was made, in the reader's own words and clock.
export function whenLabel(at: string, now = new Date()): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "at an unknown time";
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return "today at " + time;
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "yesterday at " + time;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: date.getFullYear() === now.getFullYear() ? undefined : "numeric" }) + " at " + time;
}
// What a version says about the change, without the machinery.
export function versionLine(v: Version): string {
  if (v.unrecorded) return "Changed outside this page, not kept as a version yet";
  if (v.message?.startsWith("kept the version from before")) return "As it was before the next change";
  const what = v.message ? v.message.replace(/ \(asked in chat\)$/, "") : "Saved";
  return what.charAt(0).toUpperCase() + what.slice(1);
}
// The line under a version: what changed, and by whom. A version not kept yet already says so,
// and the server's "by" for it says the same again (15 October 2026: "..., not kept as a version
// yet, not kept as a version yet" on every part of a fresh installation).
export function versionWords(v: Version): string {
  return v.unrecorded || !v.by ? versionLine(v) : versionLine(v) + ", " + v.by;
}
