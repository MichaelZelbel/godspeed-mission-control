import type { TimelineContact } from "./AddEventDialog";
import { personNames as sharedPersonNames } from "../../../../core/person-names.mjs";

export const UNNAMED_PERSON = "Unnamed person";

/** A person's name as the screen shows it; a record without one is "Unnamed person". */
export function personLabel(p: { name?: unknown }): string {
  return typeof p.name === "string" && p.name.trim() ? p.name : UNNAMED_PERSON;
}

export const personNames: (p: { name?: unknown; aliases?: unknown }) => string[] = sharedPersonNames;

/** Contacts as loaded from the notebook, each with a name to show; ids are untouched. */
export function displayPeople(rows: TimelineContact[]): TimelineContact[] {
  return rows.map((p) => ({ ...p, name: personLabel(p) }));
}
