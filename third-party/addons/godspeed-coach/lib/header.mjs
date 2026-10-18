// Area, habit and talk files share one plain shape a person can read and edit: a header of
// "KEY: value" lines, a blank line, then "## " sections. This module reads and rewrites it without
// disturbing anything it was not asked to change.
const KEY_LINE = /^([A-Z][A-Z -]*[A-Z]):[ \t]?(.*)$/;

export function parseDoc(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const head = {}; const lists = {}; const sections = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim() || l.startsWith("## ")) break;
    const m = l.match(KEY_LINE);
    if (!m) continue;
    const [, k, v] = m;
    if (!(k in head)) head[k] = v.trim();
    (lists[k] ||= []).push(v.trim());
  }
  const body = lines.slice(i).join("\n");
  let cur = null;
  for (const l of lines.slice(i)) {
    if (l.startsWith("## ")) { cur = l.slice(3).trim(); sections[cur] = ""; continue; }
    if (cur !== null) sections[cur] += (sections[cur] ? "\n" : "") + l;
  }
  for (const k of Object.keys(sections)) sections[k] = sections[k].trim();
  return { head, lists, body, sections };
}

function headerEnd(lines) {
  const i = lines.findIndex((l) => !l.trim() || l.startsWith("## "));
  return i === -1 ? lines.length : i;
}

export function setHead(text, key, value) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const end = headerEnd(lines);
  const at = lines.slice(0, end).findIndex((l) => l.startsWith(key + ":"));
  const line = `${key}: ${value}`.trimEnd();
  if (at !== -1) lines[at] = line;
  else lines.splice(end, 0, line);
  return lines.join("\n");
}

// Adds one line at the end of a "## title" section, creating the section at the end of the file
// when it is missing.
export function appendToSection(text, title, line) {
  const lines = String(text || "").replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${title}`);
  if (start === -1) return lines.join("\n") + `\n\n## ${title}\n${line}\n`;
  let end = lines.findIndex((l, j) => j > start && l.startsWith("## "));
  if (end === -1) end = lines.length;
  let last = end;
  while (last - 1 > start && !lines[last - 1].trim()) last--;
  lines.splice(last, 0, line);
  return lines.join("\n") + "\n";
}

export function formatDoc(head, sections) {
  const h = Object.entries(head).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => `${k}: ${x}`) : [`${k}: ${v ?? ""}`.trimEnd()]));
  const s = Object.entries(sections).map(([t, c]) => `## ${t}\n${c ? c + "\n" : ""}`);
  return h.join("\n") + "\n\n" + s.join("\n");
}
