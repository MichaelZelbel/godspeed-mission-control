// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { alreadyKnown, monthRequests, parseWhatsAppChat, readChatFile, NOT_WHATSAPP } from "./whatsapp-export";

const iphoneDe = "‎[03.02.25, 18:04:11] Mia Muster: Ich habe die Stelle in Lissabon bekommen!\n[03.02.25, 18:05:00] Ben Beispiel: Glückwunsch\nzweite Zeile\n‎[04.02.25, 09:00:00] Mia Muster: ‎Bild ausgeschlossen\n[05.03.25, 10:00:00] Nachrichten und Anrufe sind Ende-zu-Ende-verschlüsselt.\n[05.03.25, 10:01:00] Ben Beispiel: Umzug am Samstag";
const androidEn = "12/31/2024, 9:15 PM - Ben Beispiel: Happy new year\n1/2/2025, 7:05 AM - Mia Muster: We are moving in March\n1/3/2025, 7:05 AM - Messages are end-to-end encrypted.";
const androidDe = "31/01/2025, 21:15 - Ben Beispiel: Hallo\n01/02/2025, 07:05 - Mia Muster: Wir ziehen um";

// A minimal one-entry .zip, the way WhatsApp writes it.
function zip(name: string, body: string, deflate: boolean) {
  const raw = Buffer.from(body), data = deflate ? deflateRawSync(raw) : raw, n = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(deflate ? 8 : 0, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(deflate ? 8 : 0, 10); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(0, 42);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + n.length, 12); end.writeUInt32LE(30 + n.length + data.length, 16);
  return Buffer.concat([local, n, data, central, n, end]);
}

describe("WhatsApp export reading", () => {
  it("reads the iPhone format, German locale, skipping notices and media", () => {
    const m = parseWhatsAppChat(iphoneDe);
    expect(m.map((x) => x.day)).toEqual(["2025-02-03", "2025-02-03", "2025-03-05"]);
    expect(m[1].text).toBe("Glückwunsch\nzweite Zeile");
    expect(m[0].name).toBe("Mia Muster");
  });
  it("reads Android with a 12-hour clock and month first, and a 24-hour day first", () => {
    expect(parseWhatsAppChat(androidEn).map((x) => x.day)).toEqual(["2024-12-31", "2025-01-02"]);
    expect(parseWhatsAppChat(androidDe).map((x) => x.day)).toEqual(["2025-01-31", "2025-02-01"]);
  });
  it("reads a .zip and a .txt into months, and refuses other text", async () => {
    for (const deflate of [true, false]) {
      const file = new File([new Uint8Array(zip("WhatsApp Chat/_chat.txt", androidDe, deflate))], "chat.zip");
      expect((await readChatFile(file)).map((x) => x.month)).toEqual(["2025-01", "2025-02"]);
    }
    expect((await readChatFile(new File([iphoneDe], "_chat.txt"))).map((x) => x.month)).toEqual(["2025-02", "2025-03"]);
    await expect(readChatFile(new File(["Shopping list\nmilk\neggs"], "list.txt"))).rejects.toThrow(NOT_WHATSAPP);
  });
  it("splits a long month and finds suggestions already on the timeline", () => {
    const month = { month: "2025-02", messages: Array.from({ length: 40 }, (_, i) => ({ day: "2025-02-03", name: "Mia", text: "x".repeat(900 + i) })) };
    expect(monthRequests(month).length).toBeGreaterThan(1);
    const known = [{ title: "Move to Lisbon", day: "2025-02-03", people: ["Mia"] }];
    expect(alreadyKnown({ title: "Party", day: "2025-02-03", people: ["mia"] }, known)).toBe(true);
    expect(alreadyKnown({ title: "move to lisbon", day: "2025-02-06", people: ["Mia", "Ben"] }, known)).toBe(true);
    expect(alreadyKnown({ title: "move to lisbon", day: "2025-02-07", people: ["Mia"] }, known)).toBe(false);
    expect(alreadyKnown({ title: "Party", day: "2025-02-03", people: ["Mia", "Ben"] }, known)).toBe(false);
  });
});
