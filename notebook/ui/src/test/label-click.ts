import { fireEvent } from "@testing-library/react";

// Clicks a label the way a browser does. jsdom sends the click on to the
// label's control but, unlike a browser, does not move focus there, so this
// does that step: when the click's default action was not prevented, the
// control the label names gets the focus. A label whose click handler prevents
// the default must move focus itself, as it has to in a browser.
export function clickLabel(label: HTMLElement) {
  (document.activeElement as HTMLElement | null)?.blur();
  const notPrevented = fireEvent.click(label);
  const control = (label as HTMLLabelElement).control as HTMLElement | null;
  if (notPrevented && control) control.focus();
}
