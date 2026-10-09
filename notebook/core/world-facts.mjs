import fs from 'node:fs';
import path from 'node:path';
import {visibleRows} from './visibility.mjs';
import {fieldList} from './fields.mjs';

// Facts the notebook holds outside its own claims, as facts: the links between
// people (contact_relationships) and Mission Control's own world files, one
// small file per claim in world/claims/ (world/README.md). Until 8 October 2026
// the notebook's search, its fact lookup and the owner's profile read neither:
// "Xihui, relationship: wife" was a world file and "you -> Xihui: spouse" a
// link, and asked for his wife's name the chat was handed the four contacts
// whose cards said "partner" (old online girlfriends) and asked him back.

const norm = s => String(s ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
const live = rows => rows.filter(r => !r.removed_at && !r.deleted_at);
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const humanize = attribute => { const t = String(attribute || '').replace(/[-_]+/g, ' ').trim(); return t ? t[0].toUpperCase() + t.slice(1) : t; };

// world/ files are YAML front matter of plain `key: value` lines, a list as
// `[a, b]`, then a free text (world/README.md). Nothing else is read from them.
function scalar(value) {
  const v = value.trim();
  if (/^".*"$/.test(v)) { try { return JSON.parse(v); } catch { return v.slice(1, -1); } }
  if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
  return v === 'null' || v === '~' ? '' : v;
}
export function frontMatter(text) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/.exec(String(text));
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(line);
    if (!kv) continue;
    const raw = kv[2].trim();
    fields[kv[1]] = /^\[.*\]$/.test(raw) ? raw.slice(1, -1).split(',').map(scalar).filter(Boolean) : scalar(raw);
  }
  return {fields, body: (m[2] || '').trim()};
}

// The files are read again only when one of them changed: the folder listing
// and each file's time and size are the signature.
const cache = new Map();
function readFolder(dir) {
  let names; try { names = fs.readdirSync(dir).filter(n => n.endsWith('.md')).sort(); } catch { return []; }
  const stats = names.map(n => { try { const s = fs.statSync(path.join(dir, n)); return n + ':' + s.mtimeMs + ':' + s.size; } catch { return n; } });
  const signature = stats.join('|'), held = cache.get(dir);
  if (held?.signature === signature) return held.files;
  const files = [];
  for (const name of names) { let text; try { text = fs.readFileSync(path.join(dir, name), 'utf8'); } catch { continue; } const parsed = frontMatter(text); if (parsed) files.push({name, ...parsed}); }
  cache.set(dir, {signature, files});
  return files;
}

// Who a world file's subject is, in the notebook's own terms. An entity file
// names its person's notebook id (menerio_id: the import kept Menerio's ids) and
// nicknames; a person merged into another is that other person; one whose card
// is hidden from assistants hides every fact about them.
function resolver(query) {
  const all = query.rows('contacts'), visible = new Set(visibleRows(query, 'contacts').map(c => c.id));
  const byId = new Map(); for (const c of all) for (const id of [c.id, ...(c.former_ids || [])]) byId.set(id, c);
  const follow = c => { for (let hops = 0; c?.merged_into && c.merged_into !== 'self' && hops < 6; hops++) c = byId.get(c.merged_into) || c; return c; };
  const byName = new Map();
  for (const c of all) if (!c.merged_into) for (const n of [c.name, ...(Array.isArray(c.aliases) ? c.aliases : [])]) if (typeof n === 'string' && n.trim()) byName.set(norm(n), [...(byName.get(norm(n)) || []), c]);
  const things = live(visibleRows(query, 'entities')), thingByName = new Map(things.map(e => [norm(e.name), e]));
  const entityFiles = new Map(readFolder(path.join(query.store.root, 'world', 'entities')).map(f => [f.fields.slug || f.name.replace(/\.md$/, ''), f.fields]));
  const cached = new Map();
  return slug => {
    if (cached.has(slug)) return cached.get(slug);
    const e = entityFiles.get(slug) || {name: String(slug).replace(/-/g, ' ')}, names = [e.name, ...(Array.isArray(e.aliases) ? e.aliases : [])].filter(Boolean).map(norm);
    let result;
    if (e.self === 'true' || e.self === true) result = {subject_type: 'self', subject_id: null, subject_name: e.name || null};
    else {
      let c = e.menerio_id ? follow(byId.get(e.menerio_id)) : null;
      // Several cards with the name are one person kept twice more often than
      // two people: the oldest visible one stands for them.
      if (!c) { const found = [...new Set(names.flatMap(n => byName.get(n) || []))].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''))); c = follow(found.find(x => visible.has(x.id)) || found[0]); }
      if (c) result = visible.has(c.id) ? {subject_type: 'contact', subject_id: c.id, subject_name: c.name} : null;
      else if (names.some(n => (byName.get(n) || []).some(x => !visible.has(x.id)))) result = null;
      else { const thing = names.map(n => thingByName.get(n)).find(Boolean); result = thing ? {subject_type: 'entity', subject_id: thing.id, subject_name: thing.name} : {subject_type: 'entity', subject_id: null, subject_name: e.name || slug}; }
    }
    cached.set(slug, result);
    return result;
  };
}

// The links between people, as facts: "you -> Xihui: spouse" reads as a fact
// about you whose value is "spouse: Xihui", with the person it points at.
export function linkFacts(query) {
  const names = new Map(query.rows('contacts').map(c => [c.id, c.name])), visible = new Set(visibleRows(query, 'contacts').map(c => c.id));
  const side = (type, id) => type === 'self' ? {subject_type: 'self', subject_id: null, name: 'you'} : visible.has(id) ? {subject_type: 'contact', subject_id: id, name: names.get(id)} : null;
  const out = [];
  for (const r of live(visibleRows(query, 'contact_relationships'))) {
    const from = side(r.source_type, r.source_id), to = side(r.target_type, r.target_id), word = r.custom_label || r.label || r.relationship_type;
    if (!from || !to || !word) continue;
    out.push({id: r.id, claim_id: r.id, subject_type: from.subject_type, subject_id: from.subject_id, attribute: 'relationship', label: 'Relationship', value: word + ': ' + to.name,
      relationship: word, object_type: to.subject_type, object_id: to.subject_id, object_name: to.name, cardinality: 'many', valid_from: isDay(r.valid_from) ? r.valid_from : null,
      valid_to: isDay(r.valid_to || r.ended_at) ? (r.valid_to || r.ended_at) : null, confidence: r.confidence || 'likely', source_type: 'contact_relationship', source_id: r.id});
  }
  return out;
}

// Mission Control's world claims, as facts. One the notebook already holds is
// left out: a copy of a Menerio claim the import brought over under the same
// id, or the same value for the same subject and attribute.
export function worldFacts(query, own = []) {
  const files = readFolder(path.join(query.store.root, 'world', 'claims'));
  if (!files.length) return [];
  const subject = resolver(query), ids = new Set(own.map(f => f.id).concat(query.rows('claims').map(c => c.id)));
  const key = (type, id, name, attribute, value) => [type, id || norm(name), norm(attribute).replace(/[\s_-]+/g, '-'), norm(value)].join('|');
  const held = new Set(own.map(f => key(f.subject_type, f.subject_id, f.subject_name, f.attribute, f.value)));
  const out = [];
  for (const {name, fields: f, body} of files) {
    if (!f.subject || !f.attribute || f.value === undefined || f.value === '') continue;
    if (f.menerio_id && ids.has(f.menerio_id)) continue;
    const who = subject(f.subject);
    if (!who) continue;
    // "relationship-to-xihui" names its other person in the attribute. One
    // that names a known person or thing other than the owner is about them;
    // "relationship-to-michael" (the owner, or a name nothing else has) is the
    // owner's.
    const toward = !f.object && /^relationship-to-(.+)$/.exec(String(f.attribute)), named = toward ? subject(toward[1]) : null;
    const other = f.object ? subject(f.object) : named?.subject_id && named.subject_type !== 'self' ? named : null;
    if (f.object && !other) continue;
    const value = other ? f.value + ': ' + (other.subject_type === 'self' ? 'you' : other.subject_name) : String(f.value);
    if (held.has(key(who.subject_type, who.subject_id, who.subject_name, f.attribute, value)) || held.has(key(who.subject_type, who.subject_id, who.subject_name, f.attribute, f.value))) continue;
    const relative = 'world/claims/' + name;
    out.push({id: relative, claim_id: relative, ...who, attribute: f.attribute, label: humanize(f.attribute), value,
      ...(other ? {relationship: String(f.value), object_type: other.subject_type, object_id: other.subject_id, object_name: other.subject_name} : {}),
      cardinality: f.cardinality || 'many', valid_from: isDay(f.valid_from) ? f.valid_from : null, valid_to: isDay(f.valid_to) ? f.valid_to : null,
      confidence: f.confidence || null, category_slug: f.category || null, evidence_quote: body ? body.slice(0, 600) : null, source_type: 'file', source_id: relative, origin: f.origin || null});
  }
  return out;
}

// What a relationship word means, so "wife" finds "spouse" and "Ehefrau", and
// an old online girlfriend is not read as the current partner. English and
// German, as he writes both.
const KINDS = [
  ['spouse', /\b(wife|wives|husband|spouse|married|marriage|ehefrau|ehemann|gattin|gatte|ehepartner\w*|verheiratet|frau)\b/i],
  ['partner', /\b(partner|girl ?friend|boy ?friend|lover|fianc[eé]e?|freundin|liebhaber\w*|geliebte\w*|verlobte\w*|dating)\b/i],
  ['family', /\b(mother|mom|mum|father|dad|parents?|son|daughter|child|children|kids?|brother|sister|siblings?|step\w*|grand\w*|aunt|uncle|cousin|mutter|vater|eltern|sohn|tochter|kind|kinder|bruder|schwester|onkel|tante|cousine?|oma|opa)\b/i],
  ['friend', /\b(friends?|best friend|freund|freunde|kumpel)\b/i],
  ['work', /\b(manager|boss|colleague|coworker|employer|employee|client|customer|chef|kollege|kollegin|kunde)\b/i],
];
const FORMER = /\b(ex|former|past|previous|ehemalig\w*|früher\w*)\b/i;
export function relationshipKinds(text) { const t = String(text || ''); return KINDS.filter(([, pattern]) => pattern.test(t)).map(([kind]) => kind); }
export const formerRelationship = text => FORMER.test(String(text || ''));
const ANY = /\b(relationships?|beziehung\w*|related|verwandt\w*)\b/i;
export function relationshipsAsked(text) { return ANY.test(String(text || '')) ? KINDS.map(([kind]) => kind) : relationshipKinds(text); }
export const isRelationshipFact = f => /relationship|beziehung/i.test(String(f.attribute || '')) && !/preference|goal|status-of|history/i.test(String(f.attribute || ''));
export const closeness = word => { const kinds = relationshipKinds(word); return formerRelationship(word) ? 9 : kinds.includes('spouse') ? 0 : kinds.includes('partner') ? 1 : kinds.includes('family') ? 2 : kinds.includes('friend') ? 3 : 4; };

// A link from the owner says what the owner is to them: "you -> Brigitte: son"
// makes Brigitte his parent. Words that read the same both ways stay as they are.
const TOWARD_OWNER = [
  [/^(step-?)?(son|daughter|child|kid)$/i, m => (m[1] ? 'step-' : '') + 'parent'],
  [/^(step-?)?(mother|father|parent|mum|mom|dad)$/i, m => (m[1] ? 'step' : '') + 'child'],
  [/^grand(son|daughter|child)$/i, () => 'grandparent'],
  [/^grand(mother|father|parent|ma|pa)$/i, () => 'grandchild'],
  [/^(nephew|niece)$/i, () => 'aunt or uncle'],
  [/^(aunt|uncle)$/i, () => 'nephew or niece'],
  [/^(manager|boss)$/i, () => 'works for you'],
  [/^(employee|report)$/i, () => 'your manager'],
];
export function towardOwner(word) { const w = String(word || '').trim(); for (const [pattern, turn] of TOWARD_OWNER) { const m = pattern.exec(w); if (m) return turn(m); } return w; }

// Who the owner is related to, and how, strongest evidence first: a link
// between people or a dated fact says it; a contact card's own relationship
// word counts only for a person nothing else speaks about (a card keeps the
// word it was given when they met, and an ex is still "partner" there). The
// newest dated word decides whether it still holds: an undated "partner" and
// a "former girlfriend" from last week are a former girlfriend.
export function ownerRelationships(query, facts, day, cardCounts = word => relationshipKinds(word).length > 0) {
  return query.withSnapshot(() => {
    const holds = f => (!f.valid_from || f.valid_from <= day) && (!f.valid_to || f.valid_to > day);
    const people = new Map(visibleRows(query, 'contacts').filter(c => !c.merged_into && !c.removed_at).map(c => [c.id, c]));
    const entries = new Map();
    const add = (contactId, name, word, from, f = null) => {
      if (!word || !name) return;
      const k = contactId || 'name:' + norm(name), e = entries.get(k) || {name, contact_id: contactId || null, words: [], from: []};
      // A fact filed without a start counts from the day it was recorded, as in newestOnly.
      if (!e.words.some(w => norm(w.word) === norm(word))) e.words.push({word, day: f?.valid_from || f?.recorded_on || null, ended: !!f && !holds(f) || formerRelationship(word)});
      if (!e.from.includes(from)) e.from.push(from);
      entries.set(k, e);
    };
    for (const f of facts) {
      if (!isRelationshipFact(f) || (f.valid_from && f.valid_from > day)) continue;
      const word = f.relationship || String(f.value).split(':')[0].trim(), from = f.source_type === 'contact_relationship' ? 'link' : 'fact';
      if (f.subject_type === 'self' && f.object_type === 'contact') add(f.object_id, f.object_name, towardOwner(word), from, f);
      else if (f.subject_type === 'contact' && f.object_type === 'self') add(f.subject_id, people.get(f.subject_id)?.name, word, from, f);
      else if (f.subject_type === 'contact' && !f.object_type && people.has(f.subject_id)) add(f.subject_id, people.get(f.subject_id).name, String(f.value), from, f);
    }
    const spoken = new Set(entries.keys());
    for (const c of people.values()) if (!spoken.has(c.id) && c.relationship && cardCounts(String(c.relationship))) add(c.id, c.name, c.relationship, 'contact card');
    const settled = e => {
      const holding = e.words.filter(w => !w.ended), newestEnd = e.words.filter(w => w.ended && w.day).map(w => w.day).sort().at(-1) || '';
      const ended = !holding.length || !!newestEnd && holding.every(w => (w.day || '') < newestEnd);
      const words = ended ? e.words : [...holding, ...e.words.filter(w => w.ended)];
      const since = e.words.map(w => w.day).filter(Boolean).sort()[0];
      return {name: e.name, contact_id: e.contact_id, words, ended, since, from: e.from,
        rank: Math.min(...words.map(w => closeness(w.word))) + (e.from.length === 1 && e.from[0] === 'contact card' ? 0.5 : 0)};
    };
    const list = [...entries.values()].map(settled).sort((a, b) => a.rank - b.rank || String(a.name).localeCompare(String(b.name)));
    const view = e => ({name: e.name, relationship: e.words.map(w => w.word).join(', '), contact_id: e.contact_id, from: e.from.join(', '), ...(e.since ? {since: e.since} : {})});
    return {current: list.filter(e => !e.ended).map(view), former: list.filter(e => e.ended).map(view)};
  });
}

// One fixed name per kind of fact (D-298, 2026-10-08): the list the notebook ships, with a
// workspace's own world/fields.json read over it (core/fields.mjs). "Where he lives" had been
// written as `location`, `current-city` and `Current city`, each read as its own fact.
export {fieldList};
// The world files of one folder, as this module reads them (for core/fact-closing.mjs).
export const worldFiles = dir => readFolder(dir);

// The newest dated value of a one-at-a-time fact is its value: an older open value under any of
// its names and from any store is read as ended that day. What is stored is ended by the
// notebook's daily closing (core/fact-closing.mjs) and, on a mission control that has it, the
// engine's world_fields.py. Two values dated the same day stay, as two answers.
// A notebook value filed without a start keeps the day it was recorded (recorded_on), and that day
// stands for its start here, as in the daily closing.
export function newestOnly(rows, fields, day) {
  const holds = f => (!f.valid_from || f.valid_from <= day) && (!f.valid_to || f.valid_to > day);
  const since = f => f.valid_from || f.recorded_on || null;
  const key = f => (f.subject_type === 'self' ? 'self' : f.subject_type + '|' + (f.subject_id || norm(f.subject_name))) + '|' + fields.canonical(f.attribute);
  const groups = new Map();
  for (const f of rows) if (!f.object_type && fields.one(f.attribute) && holds(f)) groups.set(key(f), [...(groups.get(key(f)) || []), f]);
  const ends = new Map();
  for (const group of groups.values()) {
    if (new Set(group.map(f => norm(f.value))).size < 2) continue;
    const dated = group.filter(since);
    if (!dated.length) continue;
    const top = dated.map(since).sort().at(-1), newest = dated.filter(f => since(f) === top);
    // Two values the newest day both stay (two answers); what is older than both ends.
    const tops = new Set(newest.map(f => norm(f.value)));
    for (const f of group) if (!tops.has(norm(f.value)) && (since(f) || '') < top) ends.set(f, top);
  }
  return rows.map(f => ends.has(f) ? {...f, valid_to: ends.get(f), superseded: true} : fields.one(f.attribute) ? {...f, cardinality: 'one'} : f);
}
