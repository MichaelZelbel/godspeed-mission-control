// Checks that a form's visible labels name its fields (#732, #742): every
// <label> in the form names a control, each field is found by its plain name
// (the label text a person reads, or the name it is given when it has no
// visible label), no two names find the same control, and clicking a visible
// label focuses its control without opening a picker.
import { fireEvent, screen, within } from "@testing-library/react";
import { expect } from "vitest";

export type ExpectedField = {
  /** The field's name, exactly: the visible label text, without a star or a live value. */
  name: string;
  /** How to recognise the control the name must find. */
  is: (el: HTMLElement) => boolean;
};

export const isTextbox = (el: HTMLElement) =>
  (el.tagName === "INPUT" && !["checkbox", "radio", "number", "date", "time", "range"].includes((el as HTMLInputElement).type)) || el.tagName === "TEXTAREA";
export const isInputOfType = (type: string) => (el: HTMLElement) => el.tagName === "INPUT" && (el as HTMLInputElement).type === type;
export const isListButton = (el: HTMLElement) => el.tagName === "BUTTON" && el.getAttribute("role") === "combobox";
export const isButton = (el: HTMLElement) => el.tagName === "BUTTON";
export const isSwitch = (el: HTMLElement) => el.getAttribute("role") === "switch";
export const isSlider = (el: HTMLElement) => el.getAttribute("role") === "slider";
export const isNativeSelect = (el: HTMLElement) => el.tagName === "SELECT";

/** The control a label names: its own (for/id or wrapped), or the element that points back at it with aria-labelledby. */
export function controlOf(label: HTMLLabelElement, scope: HTMLElement): HTMLElement | null {
  if (label.control) return label.control as HTMLElement;
  if (!label.id) return null;
  return Array.from(scope.querySelectorAll<HTMLElement>("[aria-labelledby]"))
    .find((el) => el.getAttribute("aria-labelledby")!.split(/\s+/).includes(label.id)) ?? null;
}

export function expectFieldsNamed(form: HTMLElement, fields: ExpectedField[]) {
  const labels = Array.from(form.querySelectorAll("label"));
  for (const label of labels) expect(controlOf(label, form), `label "${label.textContent}" names no control`).not.toBeNull();

  const seen = new Set<HTMLElement>();
  for (const field of fields) {
    const found = within(form).queryAllByLabelText(field.name, { exact: true });
    expect(found, `"${field.name}" finds exactly one control`).toHaveLength(1);
    const control = found[0];
    expect(field.is(control), `"${field.name}" finds ${control.outerHTML.slice(0, 160)}`).toBe(true);
    expect(seen.has(control), `"${field.name}" finds a control another name finds`).toBe(false);
    seen.add(control);

    const label = labels.find((l) => controlOf(l, form) === control);
    if (!label) continue; // Named without a visible label; there is nothing to click.
    if ((control as HTMLInputElement).disabled) continue; // Nothing focuses a disabled field.
    (document.activeElement as HTMLElement | null)?.blur();
    const notCancelled = fireEvent.click(label);
    // A browser focuses a label's own control when the click goes through; jsdom
    // only forwards the click. A label that cancels the click must focus it itself.
    if (notCancelled && label.control === control) control.focus();
    expect(document.activeElement, `clicking "${field.name}" focuses its control`).toBe(control);
    expect(screen.queryByRole("listbox"), `clicking "${field.name}" opens no list`).toBeNull();
    expect(document.querySelector("[data-radix-popper-content-wrapper]"), `clicking "${field.name}" opens no picker`).toBeNull();
  }
}
