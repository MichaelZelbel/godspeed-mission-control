// Reads WhatsApp's own "Export chat" file (without media), in the browser, once. Nothing here
// writes the file anywhere; the caller keeps only what it reads in memory.

export interface ChatMessage { day: string; name: string; text: string }
export interface ChatMonth { month: string; messages: ChatMessage[] }

export const NOT_WHATSAPP = "This file is not a WhatsApp chat export, so export the chat from WhatsApp without media and choose that file.";

// iPhone "[DD.MM.YY, HH:MM:SS] Name: text" and Android "DD/MM/YYYY, HH:MM - Name: text", with
// either separator, 12- or 24-hour clocks and a leading direction mark.
const HEADER = /^[‎‏﻿]*\[?(\d{1,2})[./](\d{1,2})[./](\d{2,4}),?\s+(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?(?:\s*[AaPp]\.?\s?[Mm]\.?)?\]?\s*(?:-\s*)?(.*)$/;
const MEDIA_LINE = /^<.*(omitted|ausgeschlossen).*>$|^[‎‏]*(image|video|audio|sticker|gif|document|bild|dokument)\s(omitted|ausgeschlossen)$/i;
const pad = (n: number) => String(n).padStart(2, "0");
// A calendar day that exists (no 31 February), checked on plain numbers.
const isRealDay = (y: number, m: number, d: number) => {
  const t = new Date(y, m - 1, d);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d;
};

export function parseWhatsAppChat(text: string): ChatMessage[] {
  const raw: { a: number; b: number; year: number; name: string; text: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = HEADER.exec(line);
    if (m) {
      const said = /^([^:]+?):\s(.*)$/.exec(m[6]);
      // A line with no "Name:" is WhatsApp's own notice (encryption, joins); it ends the message before it.
      if (!said) { raw.push({ a: 0, b: 0, year: 0, name: "", text: "" }); continue; }
      const year = Number(m[3]);
      raw.push({ a: Number(m[1]), b: Number(m[2]), year: year < 100 ? 2000 + year : year, name: said[1].replace(/^[‎‏﻿~\s]+/, "").trim(), text: said[2] });
    } else if (raw.length && raw[raw.length - 1].name) raw[raw.length - 1].text += "\n" + line;
  }
  const dated = raw.filter((r) => r.name);
  // Day first unless the data shows the first number is a month.
  const monthFirst = dated.some((r) => r.b > 12) && !dated.some((r) => r.a > 12);
  const out: ChatMessage[] = [];
  for (const r of dated) {
    const [day, month] = monthFirst ? [r.b, r.a] : [r.a, r.b];
    const stamp = `${r.year}-${pad(month)}-${pad(day)}`;
    const text = r.text.trim();
    if (!text || MEDIA_LINE.test(text) || !isRealDay(r.year, month, day)) continue;
    out.push({ day: stamp, name: r.name, text });
  }
  return out;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(data as BodyInit).body!.pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// The chat text inside the .zip WhatsApp writes: the one .txt in it, preferring _chat.txt.
export async function readZipChat(bytes: Uint8Array): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error(NOT_WHATSAPP);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  const entries: { name: string; method: number; size: number; offset: number }[] = [];
  for (let i = 0; i < count && view.getUint32(at, true) === 0x02014b50; i++) {
    const nameLength = view.getUint16(at + 28, true), extra = view.getUint16(at + 30, true), comment = view.getUint16(at + 32, true);
    entries.push({ name: decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)), method: view.getUint16(at + 10, true), size: view.getUint32(at + 20, true), offset: view.getUint32(at + 42, true) });
    at += 46 + nameLength + extra + comment;
  }
  const texts = entries.filter((e) => e.name.toLowerCase().endsWith(".txt"));
  const entry = texts.find((e) => /(^|\/)_chat\.txt$/i.test(e.name)) || texts[0];
  if (!entry || (entry.method !== 0 && entry.method !== 8)) throw new Error(NOT_WHATSAPP);
  const nameLength = view.getUint16(entry.offset + 26, true), extra = view.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLength + extra;
  const packed = bytes.subarray(start, start + entry.size);
  return decoder.decode(entry.method === 0 ? packed : await inflate(packed));
}

const readBytes = (file: Blob) => new Promise<ArrayBuffer>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result as ArrayBuffer);
  reader.onerror = () => reject(new Error(NOT_WHATSAPP));
  reader.readAsArrayBuffer(file);
});

// The file's months, oldest first. A file that holds no WhatsApp messages is refused in one sentence.
export async function readChatFile(file: File): Promise<ChatMonth[]> {
  const bytes = new Uint8Array(await readBytes(file));
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const text = isZip ? await readZipChat(bytes) : new TextDecoder().decode(bytes);
  const messages = parseWhatsAppChat(text);
  if (messages.length < 2) throw new Error(NOT_WHATSAPP);
  const months = new Map<string, ChatMessage[]>();
  for (const message of messages) {
    const key = message.day.slice(0, 7);
    months.set(key, [...(months.get(key) || []), message]);
  }
  return [...months.keys()].sort().map((month) => ({ month, messages: months.get(month)! }));
}

// A month's lines in pieces the AI takes in one request.
export function monthRequests(month: ChatMonth, limit = 30000): string[][] {
  const pieces: string[][] = [[]];
  let size = 0;
  for (const m of month.messages) {
    const line = `${m.day} ${m.name}: ${m.text.replace(/\s+/g, " ").slice(0, 1000)}`;
    if (size + line.length > limit && pieces[pieces.length - 1].length) { pieces.push([]); size = 0; }
    pieces[pieces.length - 1].push(line);
    size += line.length;
  }
  return pieces;
}

export interface KnownMoment { title: string; day: string; people: string[] }
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const dayNumber = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

// A suggestion already on the timeline: the same day and the same people, or the same title within three days.
export function alreadyKnown(suggestion: KnownMoment, known: KnownMoment[]): boolean {
  const people = [...new Set(suggestion.people.map(norm))].sort().join("|");
  return known.some((k) => {
    const apart = Math.abs(dayNumber(k.day) - dayNumber(suggestion.day));
    if (apart === 0 && [...new Set(k.people.map(norm))].sort().join("|") === people) return true;
    return apart <= 3 && norm(k.title) === norm(suggestion.title);
  });
}
