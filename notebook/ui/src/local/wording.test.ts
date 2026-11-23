// Wrong words in an English notebook (#1016): German text, a "localhost" address that is not the
// one in use, a hint for a template that is not offered, and a link to a page that does not exist.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" ? [] : files(p);
    return /\.(tsx?|jsx?)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}

describe("wording", () => {
  it("has no German words in user-facing strings", () => {
    const german = /\b(Bitte|Keine|Kein|Wähle|Verbinde|Öffne|Öffnen|Notiz|Eintrag|wird|nicht|und|der|die|das|konnte|Fehler|zurückgegeben|abgelehnt|Beschreibung|auswählen|senden|Entitäts)\b/;
    const hits: string[] = [];
    for (const f of files(SRC)) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        for (const m of line.matchAll(/(["'`])((?:\\.|(?!\1).)*?[A-Za-zäöüÄÖÜß ]{6,}(?:\\.|(?!\1).)*?)\1/g)) {
          if (m[2] === "Orthopäde Termin") continue; // deliberate German example in MeaningSearch
          if (/[äöüß]/i.test(m[2]) || german.test(m[2])) hits.push(`${f.slice(SRC.length + 1)}:${i + 1}: ${m[2].slice(0, 60)}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });
  it("Send to app is offered only when an app is connected, and points nowhere else", () => {
    const s = read("components/notes/ForwardToAppDialog.tsx");
    expect(s).toContain("Send to app");
    expect(s).not.toMatch(/Settings → Apps/);
    expect(s).not.toContain("Connect AI");
    expect(s).not.toContain("No apps are connected");
    const e = read("components/notes/NoteEditor.tsx");
    expect(e).toMatch(/connectedApps\.length > 0 && \(\s*<DropdownMenuItem onClick=\{\(\) => setShowForwardDialog\(true\)\}>/);
  });
  it("collection dialogs preview the address in use", () => {
    for (const f of ["pages/Collections.tsx", "pages/CollectionTemplates.tsx"]) {
      expect(read(f)).not.toContain("{BRAND.domain}/collections/");
      expect(read(f)).toContain("{BRAND.url}/collections/");
    }
  });
  it("Groups' empty sentence matches what the page offers", () => {
    const s = read("pages/Groups.tsx");
    expect(s).toContain("Choose a template");
    expect(s).not.toContain("Start with a template to organize");
  });
  it("no link goes to a route App.tsx does not have", () => {
    expect(read("components/moderation/ModerationBlockDialog.tsx")).not.toContain("/community-guidelines");
    expect(read("App.tsx")).not.toContain('path="/community-guidelines"');
  });
});
