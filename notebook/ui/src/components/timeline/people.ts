import type { TimelineContact } from "./AddEventDialog";

export const UNNAMED_PERSON = "Unnamed person";

/** A person's name as the screen shows it; a record without one is "Unnamed person". */
export function personLabel(p: { name?: unknown }): string {
  return typeof p.name === "string" && p.name.trim() ? p.name : UNNAMED_PERSON;
}

/** A person's real names and nicknames, lower-cased; entries that are not text or are blank are left out. */
export function personNames(p: { name?: unknown; aliases?: unknown }): string[] {
  const aliases = Array.isArray(p.aliases) ? p.aliases : [];
  return [p.name, ...aliases]
    .filter((n): n is string => typeof n === "string" && n.trim() !== "")
    .map((n) => n.toLowerCase());
}

/** Contacts as loaded from the notebook, each with a name to show; ids are untouched. */
export function displayPeople(rows: TimelineContact[]): TimelineContact[] {
  return rows.map((p) => ({ ...p, name: personLabel(p) }));
}
