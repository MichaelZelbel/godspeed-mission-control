// A headache is never stored as one record. It is computed from the entries that name it: the
// start, any later detail, the pills taken, the end. That keeps every entry append-only and
// still answers "what is open", "how long did it last" and "what did I take".

const SIDES = {
  left: "left", links: "left", l: "left",
  right: "right", rechts: "right", r: "right",
  both: "both", beidseitig: "both", "both sides": "both", beide: "both",
  front: "front", forehead: "front", stirn: "front",
  back: "back", "back of head": "back", hinterkopf: "back",
  neck: "neck", nacken: "neck",
  temples: "temples", schlaefen: "temples", schläfen: "temples",
  eye: "eye", auge: "eye", top: "top", scheitel: "top",
  whole: "whole", "whole head": "whole", ganzer: "whole", "ganzer kopf": "whole",
};
const QUALITIES = {
  pounding: "pounding", throbbing: "pounding", pulsing: "pounding", pulsating: "pounding", pochend: "pounding", pulsierend: "pounding", hammering: "pounding", haemmernd: "pounding", hämmernd: "pounding",
  stinging: "stabbing", stabbing: "stabbing", sharp: "stabbing", stechend: "stabbing",
  pressing: "pressing", pressure: "pressing", tight: "pressing", tightening: "pressing", band: "pressing", drueckend: "pressing", drückend: "pressing", dumpf: "dull", dull: "dull",
  burning: "burning", brennend: "burning",
};

// Open vocabulary with a few common words mapped, so "links" and "left" count as one side in a
// pattern. Anything else is kept as the person said it, in lower case.
export const normSide = (v) => (v ? SIDES[String(v).trim().toLowerCase()] || String(v).trim().toLowerCase() : v);
export const normQuality = (v) => (v ? QUALITIES[String(v).trim().toLowerCase()] || String(v).trim().toLowerCase() : v);

export function parsePain(v) {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 10) throw new Error(`Pain is a number from 0 to 10, not "${v}".`);
  return Math.round(n * 10) / 10;
}

// "Thomapyrin Intensiv: 2 tablets" -> { med, dose }
export function parseMed(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  const i = s.indexOf(":");
  return i > 0 ? { med: s.slice(0, i).trim(), dose: s.slice(i + 1).trim() } : { med: s, dose: "" };
}

export function episodesFrom(entries) {
  const byId = new Map();
  const loose = [];
  // Starts first: one command can save a start, its pill and its end in the same second, and
  // the follow-ups must never be read before the headache they belong to exists.
  for (const e of entries) {
    if (e.kind === "start" && e.episode && !byId.has(e.episode)) {
      byId.set(e.episode, { id: e.episode, start: e.start, end: null, cancelled: false, pains: [], side: null, quality: null, symptoms: [], triggers: [], meds: [], words: [] });
    }
  }
  const rank = { start: 0, set: 1, med: 2, end: 3, cancel: 4 };
  const ordered = [...entries].sort((a, b) => a.at.localeCompare(b.at) || (rank[a.kind] ?? 5) - (rank[b.kind] ?? 5));
  for (const e of ordered) {
    if (e.kind === "med" && !e.episode) { loose.push({ med: e.med, dose: e.dose || "", taken: e.taken || e.at }); continue; }
    const ep = e.episode && byId.get(e.episode);
    if (!ep) continue;
    if (e.kind === "cancel") { ep.cancelled = true; continue; }
    if (e.kind === "start" && e.start) ep.start = e.start;
    if (e.kind === "end") { ep.end = e.end || e.at; ep.end_pain = e.pain; }
    if (e.kind === "set" && e.start) ep.start = e.start;
    if (e.kind === "set" && e.end) ep.end = e.end;
    if (e.kind !== "end" && e.pain !== undefined && !Number.isNaN(e.pain)) ep.pains.push({ at: e.at, pain: e.pain });
    if (e.side) ep.side = e.side;
    if (e.quality) ep.quality = e.quality;
    for (const x of e.symptoms || []) if (!ep.symptoms.includes(x)) ep.symptoms.push(x);
    for (const x of e.triggers || []) if (!ep.triggers.includes(x)) ep.triggers.push(x);
    if (e.kind === "med") ep.meds.push({ med: e.med, dose: e.dose || "", taken: e.taken || e.at });
    if (e.words) ep.words.push(e.words);
  }
  const eps = [...byId.values()].filter((ep) => !ep.cancelled).map((ep) => ({
    ...ep,
    open: !ep.end,
    pain_max: ep.pains.length ? Math.max(...ep.pains.map((p) => p.pain)) : null,
    pain_first: ep.pains.length ? ep.pains[0].pain : null,
    minutes: ep.end ? Math.round((Date.parse(ep.end) - Date.parse(ep.start)) / 60000) : null,
  }));
  eps.sort((a, b) => a.start.localeCompare(b.start));
  return { episodes: eps, loose };
}

export const openEpisodes = (entries) => episodesFrom(entries).episodes.filter((e) => e.open);

// Which episode a follow-up means: the one named, else the newest open one. A pill or a detail
// said without naming anything belongs to the headache that is going on now.
export function resolveEpisode(entries, ref, { includeClosed = false } = {}) {
  const { episodes } = episodesFrom(entries);
  if (ref) return episodes.find((e) => e.id === ref) || null;
  const open = episodes.filter((e) => e.open);
  if (open.length) return open[open.length - 1];
  return includeClosed ? episodes[episodes.length - 1] || null : null;
}

export function newEpisodeId(localDate, hm, entries) {
  const base = `h-${localDate.replaceAll("-", "")}-${hm.replace(":", "")}`;
  const taken = new Set(entries.map((e) => e.episode).filter(Boolean));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}
