// The Identity page's talk with the notebook server (notebook/core/identity-shelf.mjs). Every
// change goes to /api/identity/*, which writes the file, keeps the earlier version and answers
// with what the file holds afterwards.

export type RuleGroup = "must" | "never" | "how";
export type RuleFields = { slug?: string; title: string; line: string; group: RuleGroup; always: boolean; story: string };
export type SkillFields = { name?: string; description: string; steps: string };
export type PageFields = { text: string; kept_details?: boolean };
export type ManualSize = { exists?: boolean; chars: number; limit: number; warn: number; warning?: string };
export type SoulInfo = { kind: "no-assistant" | "missing" | "empty" | "hermes" | "ours" | "own" | "unknown"; text?: string };
export type Overview = {
  // kept-elsewhere: the list is kept by a program of the owner's (rules_program), and this page
  // would not write it as it stands, so rules are not changed here (identity-shelf.mjs, gather).
  manual: ManualSize & { review_waiting?: boolean; rules_list: "ok" | "out-of-step" | "kept-elsewhere" | "no-place" | "no-manual" | "problem" | "unavailable"; rules_program?: string | null };
  who: { state: "ok" | "no-markers" | "no-manual"; text?: string; hash?: string; proposal?: string };
  soul: SoulInfo;
  rules: (Omit<RuleFields, "story"> & { target: string; slug: string; review_waiting?: boolean })[];
  profile: { target: string; name: string; title: string; preview: string; review_waiting?: boolean }[];
  skills: { target: string; name: string; description: string; origin: "shipped" | "changed" | "own"; review_waiting?: boolean }[];
};
export type Item = {
  target: string; kind: "who" | "rule" | "profile" | "skill"; file: string; label: string; state: string; hash?: string;
  text?: string; proposal?: string; fields?: RuleFields | SkillFields | PageFields; manual?: ManualSize; soul?: SoulInfo;
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
  useWhoForAssistant: () => call<{ written: boolean; kind: string }>("/assistant-identity", {}),
  instructions: () => call<{ data: Instruction[] }>("/instructions").then((r) => r.data),
  instructionHistory: (id: string) => call<{ data: InstructionVersion[] }>("/instruction-history?id=" + encodeURIComponent(id)).then((r) => r.data),
  saveInstruction: (instruction: Partial<Instruction> & { removed?: boolean }, expected_hash?: string) => call<SaveResult>("/instruction", { instruction, expected_hash }),
  restoreInstruction: (id: string, version: string, expected_hash?: string) => call<SaveResult>("/instruction-restore", { id, version, expected_hash }),
};

// ---- What the page shows while someone types --------------------------------------------------
export const chars = (text: string | undefined | null) => [...String(text ?? "")].length;
// The manual's size if `before` became `after` in it.
export function manualAfter(size: ManualSize | undefined, before: string, after: string): number | null {
  if (!size) return null;
  return size.chars - chars(before) + chars(after);
}
export type SizeState = "fine" | "near" | "over";
export function sizeState(total: number | null, size: ManualSize | undefined): SizeState {
  if (total === null || !size) return "fine";
  if (total >= size.limit) return "over";
  if (total >= size.warn) return "near";
  return "fine";
}
export function sizeLine(total: number | null, size: ManualSize | undefined): string | null {
  if (total === null || !size) return null;
  const n = total.toLocaleString("en"), limit = size.limit.toLocaleString("en");
  if (total >= size.limit) return `This would make your manual ${n} characters long. Your assistant's program reads only ${limit}, and drops the middle of a longer one. Make it shorter first.`;
  if (total >= size.warn) return `Your manual would be ${n} of ${limit} characters. Is it short enough for you to read all of it?`;
  return `Your manual: ${n} of ${limit} characters. Short enough for you to read all of it.`;
}
// The line a rule adds to the manual's list ("12. <sentence> `[slug]`").
export const ruleListLine = (line: string, slug: string) => `00. ${line} \`[${slug}]\`\n`;

export const GROUPS: { value: RuleGroup; title: string; short: string }[] = [
  { value: "must", title: "It must", short: "Something it must do" },
  { value: "never", title: "It must never", short: "Something it must never do" },
  { value: "how", title: "How things work here", short: "How things work here" },
];
export const ORIGIN_WORDS: Record<string, string> = {
  shipped: "Kept up to date by updates. Change it, and updates keep your version.",
  changed: "Changed by you. Updates keep your version and offer theirs for you to look at first.",
  own: "Your own recipe.",
};
// A paragraph the file wraps at a fixed width reads as one paragraph on the page; blank lines stay.
export const reflow = (text?: string | null) => String(text ?? "").split(/\n{2,}/).map((p) => p.replace(/\s*\n\s*/g, " ")).join("\n\n");
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
