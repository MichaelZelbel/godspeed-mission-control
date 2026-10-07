// What is already on record. Before the journal asks about a task (the check-in, the evening
// list, the side question an assistant relays), it looks at what the person's own systems
// already show, so nobody is asked whether they finished something the record says they did.
// Each open task gets one of four answers:
//
//   closed      the record plainly shows it finished: it is closed with the proof, and nobody asks
//   unsure      the record shows something related but not plainly this: neither closed nor asked
//   unreadable  the record could not be read: not asked this time, looked at again next time
//   none        nothing on record: asked as before, and the question says what was looked at
//
// Two kinds of record:
//
// - Posts, from the program the settings name in evidence.script (one JSON line per post that
//   went out; see README.md). A post closes a task only when all of this holds: the task names
//   that platform (in its title or what done means) and no other platform, no other open task
//   names that platform, and it is the one post on that platform since the task started.
//   Anything short of that is "unsure".
// - Mentions: commit subjects in mission control and world/events/ since the task started. Words
//   are never proof. Measured on a real week (16 tasks, 841 commits, 26 events), the two word
//   matches it found were a different Substack post and an obligation next to the task, not the
//   task. So a mention can only make the journal hold its question, never close a task.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { localParts, minutesBetween } from "./clock.mjs";
import { openTasks, RECENT_MINUTES } from "./tasks.mjs";
import { T } from "./text.mjs";

// Platforms a task can name, by names that cannot mean anything else. "X" and "Threads" are
// ordinary words, so a task says "Twitter" for X, and Threads is not recognised at all: a task
// the journal cannot tell apart is asked about, never closed by a guess.
export const PLATFORMS = {
  substack: { name: "Substack", words: ["substack"] },
  linkedin: { name: "LinkedIn", words: ["linkedin"] },
  instagram: { name: "Instagram", words: ["instagram"] },
  facebook: { name: "Facebook", words: ["facebook"] },
  tiktok: { name: "TikTok", words: ["tiktok"] },
  youtube: { name: "YouTube", words: ["youtube"] },
  bluesky: { name: "Bluesky", words: ["bluesky", "bsky"] },
  pinterest: { name: "Pinterest", words: ["pinterest"] },
  snapchat: { name: "Snapchat", words: ["snapchat"] },
  x: { name: "X", words: ["twitter"] },
  mastodon: { name: "Mastodon", words: ["mastodon"] },
  reddit: { name: "Reddit", words: ["reddit"] },
};

const flat = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

export function platformsNamed(task) {
  const w = flat([task.title, ...(task.done_means || [])].join(" ")).split(/[^a-z0-9]+/).filter(Boolean);
  // "Linked In", "Tik Tok", "You Tube": a dictated name often arrives as two words.
  const seen = new Set([...w, ...w.slice(1).map((x, i) => w[i] + x)]);
  return Object.keys(PLATFORMS).filter((id) => PLATFORMS[id].words.some((word) => seen.has(word)));
}

// A post's platform as the record program names it: "instagram_reels" is Instagram, "twitter" is X.
export function normalPlatform(p) {
  const id = flat(p).replace(/_(reels|shorts|stories|story)$/, "");
  return id === "twitter" ? "x" : id;
}

// ---- Mentions: the word rule, and only ever toward "unsure" -------------------------------------

// Words that carry no subject: every task and every commit is full of them.
const COMMON = new Set((
  "about after again also back been before being both check could date days does done down each " +
  "every first from have here into just last like made make many more most much must need needs next " +
  "once only other over said same should since some still such take than that them then there these " +
  "they this those through under until very want week what when where which while will with within " +
  "would your yours today tomorrow yesterday please thanks thank okay good work working " +
  "aber alle auch dann dass dein deine denn diese doch eine einen einem einer etwas fertig gestern " +
  "heute habe haben hier immer jetzt kann mache machen mein meine mehr morgen muss nach nicht noch " +
  "oder schon sein sehr sind soll uber unter viel weil wenn werden wieder will wird zum zur"
).split(/\s+/));

// Words that count toward a match but can never be its anchor: they describe how half of all
// tasks are done (a post, a video, a call, a text), so sharing one says nothing about which task.
const GENERIC = new Set((
  "post posts video videos text texts call email mail page link letter write draft send sent " +
  "schedule scheduled publish published update project beitrag artikel brief schreiben"
).split(/\s+/));

function tokens(s) {
  const out = [];
  for (const g of flat(s).match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) || []) {
    const parts = g.split("-");
    if (parts.length > 1) out.push({ w: parts.join(""), anchor: true });
    for (const p of parts) out.push({ w: p, anchor: parts.length === 1 });
  }
  return out.filter((t) => t.w.length >= 4 && !COMMON.has(t.w) && !/^\d+$/.test(t.w));
}
const words = (s) => tokens(s).map((t) => t.w);

// At least half the title's words and never fewer than two, one of them an anchor: a word that is
// not generic and is in no other open task's title. A one-word title is never matched.
function mentionsFor(t, open, mentions, tz) {
  const terms = [...new Set(words(t.title))];
  const need = Math.max(2, Math.ceil(terms.length / 2));
  if (terms.length < need) return [];
  const theirs = new Set(open.filter((x) => x.id !== t.id).flatMap((x) => words(x.title)));
  const whole = new Set(tokens(t.title).filter((x) => x.anchor).map((x) => x.w));
  const startDay = localParts(new Date(t.started), tz).date;
  return mentions
    .filter((m) => (m.at ? Date.parse(m.at) > Date.parse(t.started) : m.date >= startDay))
    .filter((m) => {
      const seen = new Set(words(m.text));
      const found = terms.filter((w) => seen.has(w));
      return found.length >= need && found.some((w) => whole.has(w) && !GENERIC.has(w) && !theirs.has(w));
    });
}

// ---- Judging --------------------------------------------------------------------------------------

// open: every open task (so "no other open task names it" sees all of them); record: what
// readRecord returned; only: the ids to judge (default all).
export function judge(open, record, tz, only = null) {
  const named = new Map(open.map((t) => [t.id, platformsNamed(t)]));
  const verdicts = new Map();
  for (const t of open) {
    if (only && !only.includes(t.id)) continue;
    const platforms = named.get(t.id);
    const v = { kind: "none", platforms, checked: false };
    if (platforms.length && record.posts) {
      if (!record.posts.ok) { verdicts.set(t.id, { ...v, kind: "unreadable", error: record.posts.error }); continue; }
      const posts = record.posts.list.filter((p) => platforms.includes(p.platform) &&
        Date.parse(p.at) > Date.parse(t.started) && !(t.rejected || []).includes(p.id));
      const shared = open.some((x) => x.id !== t.id && named.get(x.id).some((p) => platforms.includes(p)));
      if (posts.length === 1 && platforms.length === 1 && !shared) { verdicts.set(t.id, { ...v, kind: "closed", post: posts[0] }); continue; }
      if (posts.length) { verdicts.set(t.id, { ...v, kind: "unsure", posts }); continue; }
      v.checked = true;
    }
    const m = mentionsFor(t, open, record.mentions || [], tz);
    verdicts.set(t.id, m.length ? { ...v, kind: "unsure", mentions: m } : v);
  }
  return verdicts;
}

// ---- Reading the record ---------------------------------------------------------------------------

function commitsSince(mcDir, since, timeoutMs) {
  if (!fs.existsSync(path.join(mcDir, ".git"))) return [];
  // Half the budget at most: the prompt block has 5 seconds in the Hermes plugin, and the record
  // program needs the rest.
  const r = spawnSync("git", ["-C", mcDir, "log", `--since=${since}`, "--no-merges", "--format=%cI%x09%s"],
    { encoding: "utf8", timeout: Math.min(timeoutMs / 2, 3000), windowsHide: true });
  if (r.status !== 0 || !r.stdout) return [];
  return r.stdout.split(/\r?\n/).filter(Boolean).map((l) => {
    const i = l.indexOf("\t");
    return { at: l.slice(0, i), text: l.slice(i + 1), source: "commit" };
  }).filter((m) => !isNaN(Date.parse(m.at)) && !/^journal:/i.test(m.text) && !/godspeed-journal/i.test(m.text));
}

// An event that says something started is the opposite of proof that it finished.
const STARTED = /(^|-)(start|started|starts|starting|began|begins|beginning|begun|begonnen)(-|$)/;

function eventsSince(mcDir, day) {
  const dir = path.join(mcDir, "world", "events");
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const n of names) {
    const m = n.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
    if (!m || m[1] < day || STARTED.test(m[2])) continue;
    let body = "";
    try { body = fs.readFileSync(path.join(dir, n), "utf8").replace(/^---[\s\S]*?\n---/, "").slice(0, 2000); } catch { /* unreadable, name only */ }
    out.push({ date: m[1], text: `${m[2].replace(/-/g, " ")} ${body}`, source: "event" });
  }
  return out;
}

function runScript(mcDir, script, since, platforms, timeoutMs, mentions) {
  const file = path.isAbsolute(script) ? script : path.join(mcDir, script);
  if (!fs.existsSync(file)) return { ok: false, error: `${script} is not there` };
  const viaNode = /\.[cm]?js$/i.test(file);
  const r = spawnSync(viaNode ? process.execPath : file, viaNode ? [file] : [], {
    cwd: mcDir, encoding: "utf8", timeout: timeoutMs, windowsHide: true,
    env: { ...process.env, GODSPEED_JOURNAL_SINCE: since, GODSPEED_JOURNAL_PLATFORMS: platforms.join(",") },
  });
  if (r.error || r.status !== 0) {
    const why = r.error ? (r.error.code === "ETIMEDOUT" ? `no answer within ${timeoutMs / 1000}s` : r.error.message) : (r.stderr || "").trim().split(/\r?\n/).pop() || `exit ${r.status}`;
    return { ok: false, error: why };
  }
  const list = [];
  for (const line of (r.stdout || "").split(/\r?\n/)) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || typeof o !== "object") continue;
    if (o.kind === "post" && o.platform && o.at && !isNaN(Date.parse(o.at))) {
      list.push({ platform: normalPlatform(o.platform), at: o.at, url: String(o.url || ""), title: String(o.title || ""), id: String(o.id || o.url || o.at) });
    } else if (o.kind === "mention" && o.text && (o.at || o.date)) {
      mentions.push({ at: o.at, date: o.date, text: String(o.text), source: String(o.source || "script") });
    }
  }
  return { ok: true, list };
}

// since: from when mentions are read (the oldest task looked at). postsSince: from when posts are
// asked for, the oldest task that names a platform; a task that names none must not stretch it,
// because a copy of the record kept for a machine covers exactly what recordNeeds asked for.
export function readRecord(mcDir, s, { since, postsSince = since, platforms = [], timeoutMs = 20000 } = {}) {
  const record = { posts: null, mentions: [...commitsSince(mcDir, since, timeoutMs), ...eventsSince(mcDir, localParts(new Date(since), s.timezone).date)] };
  if (platforms.length && s.evidence && s.evidence.script) record.posts = runScript(mcDir, s.evidence.script, postsSince, platforms, timeoutMs, record.mentions);
  return record;
}

// ---- The one step every caller runs --------------------------------------------------------------

export function closingEntry(t, post, s) {
  const name = (PLATFORMS[post.platform] || { name: post.platform }).name;
  const p = localParts(new Date(post.at), s.timezone);
  return {
    kind: "done", task: t.id, source: "evidence", evidence: post.url, evidence_id: post.id, evidence_at: new Date(post.at).toISOString(),
    words: T(s).onRecord(name, `${p.date} ${p.hm}`, post.title, post.url),
  };
}

// Reads the record for the open tasks still worth asking about and says what it shows for each,
// with the entries that close the ones it plainly shows finished. `only` narrows it to the tasks
// about to be asked (the side question looks at one task, on the person's prompt, so it must be
// quick). Nothing is read when no task is open.
export function checkRecord(mcDir, s, entries, now, { only = null, timeoutMs = 20000 } = {}) {
  const all = openTasks(entries);
  const look = all.filter((t) => minutesBetween(new Date(t.started), now) <= RECENT_MINUTES && (!only || only.includes(t.id)));
  if (!look.length) return { verdicts: new Map(), closes: [] };
  const since = look.map((t) => t.started).sort()[0];
  const naming = look.filter((t) => platformsNamed(t).length);
  const platforms = [...new Set(naming.flatMap(platformsNamed))];
  const postsSince = naming.length ? naming.map((t) => t.started).sort()[0] : since;
  const record = readRecord(mcDir, s, { since, postsSince, platforms, timeoutMs });
  const verdicts = judge(all, record, s.timezone, look.map((t) => t.id));
  const closes = look.filter((t) => verdicts.get(t.id).kind === "closed").map((t) => closingEntry(t, verdicts.get(t.id).post, s));
  return { verdicts, closes };
}

// What the record has to cover right now: the platforms open tasks name and since when. A job
// that keeps a copy of the record for a machine that cannot read it live asks this first, so it
// reads nothing while no task names a platform.
export function recordNeeds(entries, now) {
  const look = openTasks(entries).filter((t) => minutesBetween(new Date(t.started), now) <= RECENT_MINUTES && platformsNamed(t).length);
  if (!look.length) return null;
  return { since: look.map((t) => t.started).sort()[0], platforms: [...new Set(look.flatMap(platformsNamed))] };
}

// The words a question uses to say what was looked at: "Nothing has gone out on Substack since."
export function recordLine(v, strings) {
  if (!v || v.kind !== "none" || !v.checked || !v.platforms.length) return "";
  return strings.nothingOn(v.platforms.map((p) => PLATFORMS[p].name).join(strings.or));
}
