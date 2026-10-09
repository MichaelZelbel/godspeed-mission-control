import fs from 'node:fs';
import path from 'node:path';
import {atomic} from './records/store.mjs';
import {fieldList, fieldSlug} from './fields.mjs';
import {worldFiles} from './world-facts.mjs';

// The notebook ends what is no longer true, on its own schedule, for every
// install (8 October 2026). Until then two jobs in Michael's own engine did it
// for his notebook only (scripts/world_fields.py, D-298, and
// scripts/world_relationships.py, D-297); a buyer's notebook kept every old
// value open beside the new one. These are those two jobs, case for case:
//
// 1. One current value where there is only one. For every subject and every
//    one-at-a-time kind of fact (core/fields.mjs) it gathers the open values in
//    world/claims/ and in the notebook's own claims, whatever name or source
//    they carry. The newest dated value stays; every older open value that
//    differs ends on that date. Nothing undated decides. Two different values
//    dated the same newest day both stay, for a person to decide (the notebook
//    shows them as two answers); what is older than both still ends.
// 2. A relationship that ended is ended everywhere it is recorded. For every
//    person the owner is related to it gathers the world claims about the two,
//    the notebook's links between them and the person's card. When the newest
//    dated of them says the relationship ended (ex-, former, ehemalig,
//    früher), every older open one ends that day and the card takes the newest
//    word; when the newest says it goes on (again), an older open "ex" ends
//    instead. Words that agree (wife beside spouse) stay side by side. Nothing
//    undated decides, and a day that says both is left to a person.
//
// Both only ever end what is open, so a second run changes nothing: where
// Michael's engine also runs them, whichever runs second finds nothing to do.

const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const key = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
// A date counts when it is a day; anything else is undated and decides nothing.
const dayOf = v => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? '')); return m ? m[1] : null; };
const FORMER = /\b(ex|former|past|previous|ehemalig\w*|fr(?:ue|ü)her\w*)\b/i;
export const former = word => FORMER.test(String(word ?? ''));
const REL_ATTR = /^relationship(?:-(?:to-(.+)|description|status))?$/;

// Adds or replaces the one line `valid_to: <day>` in a world file's front
// matter, after `valid_from`; nothing else in the file moves.
export function setValidTo(file, day) {
  const text = fs.readFileSync(file, 'utf8'), nl = text.includes('\r\n') ? '\r\n' : '\n', at = text.indexOf(nl + '---');
  const head = at < 0 ? text : text.slice(0, at), rest = at < 0 ? '' : text.slice(at);
  const lines = head.split(nl).filter(l => !l.startsWith('valid_to:')), after = lines.findIndex(l => l.startsWith('valid_from:'));
  lines.splice(after >= 0 ? after + 1 : lines.length, 0, 'valid_to: ' + day);
  atomic(file, lines.join(nl) + rest);
}

// Who is who: Mission Control's entity files, the notebook's people (a person
// merged into another is that other), by id and by name.
function people(store, query) {
  const world = path.join(store.root, 'world');
  const entities = new Map(worldFiles(path.join(world, 'entities')).map(f => {
    const e = f.fields, slug = e.slug || f.name.replace(/\.md$/, '');
    return [slug, {name: e.name || slug, aliases: Array.isArray(e.aliases) ? e.aliases : [], menerio_id: e.menerio_id || null, self: String(e.self ?? '').toLowerCase() === 'true'}];
  }));
  const contacts = query.rows('contacts').filter(c => !c.removed_at), byId = new Map();
  for (const c of contacts) for (const id of [c.id, ...(Array.isArray(c.former_ids) ? c.former_ids : [])]) if (!byId.has(id) || id === c.id) byId.set(id, c);
  const follow = c => { for (let hops = 0; hops < 6; hops++) { if (!c || !c.merged_into || c.merged_into === 'self') return c; c = byId.get(c.merged_into); } return c; };
  const byName = new Map();
  for (const c of contacts) if (!c.merged_into) for (const n of [c.name, ...(Array.isArray(c.aliases) ? c.aliases : [])]) if (typeof n === 'string' && n.trim()) byName.set(key(n), new Map([...(byName.get(key(n)) || []), [c.id, c]]));
  // The person a world slug names: by the id the import kept, else the one
  // person (and only one) with its name or a nickname.
  const contactFor = slug => {
    const e = entities.get(slug) || {name: String(slug).replace(/-/g, ' '), aliases: [], menerio_id: null};
    const c = e.menerio_id ? follow(byId.get(e.menerio_id)) : null;
    if (c) return c;
    const found = new Map();
    for (const n of [e.name, ...e.aliases]) for (const [id, x] of byName.get(key(n)) || []) found.set(id, x);
    return found.size === 1 ? [...found.values()][0] : null;
  };
  return {entities, byId, follow, contactFor};
}

// 1. One current value where there is only one (world_fields.py).
export function supersededValues(store, query) {
  const fields = fieldList(store.root), {entities, byId, follow, contactFor} = people(store, query);
  // A world subject is the owner when its entity file says self, a person when
  // its entity file leads to one, else only itself.
  const subjectOf = slug => { const e = entities.get(slug); if (e?.self) return 'self'; const c = e ? contactFor(slug) : null; return c ? 'contact:' + c.id : 'slug:' + slug; };
  const groups = new Map(), add = (k, r) => groups.set(k, [...(groups.get(k) || []), r]);
  const dir = path.join(store.root, 'world', 'claims');
  for (const f of worldFiles(dir)) {
    const m = f.fields;
    if (m.valid_to || m.object || !m.subject || m.value === undefined || m.value === '') continue;
    const name = fields.canonical(m.attribute);
    if (!fields.one(name)) continue;
    add(subjectOf(m.subject) + '|' + name, {kind: 'world', path: path.join(dir, f.name), value: String(m.value), day: dayOf(m.valid_from), label: 'world/claims/' + f.name});
  }
  for (const c of query.rows('claims')) {
    if (c.valid_to || c.removed_at || c.value === null || c.value === undefined || c.value === '') continue;
    const name = fields.canonical(c.attribute);
    if (!fields.one(name)) continue;
    const person = c.subject_type === 'contact' ? follow(byId.get(c.subject_id)) : null;
    const subject = c.subject_type === 'self' ? 'self' : c.subject_type === 'contact' ? 'contact:' + (person?.id || c.subject_id) : c.subject_type + ':' + c.subject_id;
    // A value filed without a start since 9 October 2026 (domains.mjs writeFact) keeps the day it was
    // recorded, and that day is what it was known to hold by: it decides as its start did before.
    // One with neither (Menerio's undated imports) still decides nothing.
    add(subject + '|' + name, {kind: 'claim', id: c.id, value: String(c.value), day: dayOf(c.valid_from) || dayOf(c.recorded_on), label: 'notebook fact ' + c.attribute});
  }
  const steps = [];
  for (const [group, recs] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    if (new Set(recs.map(r => norm(r.value))).size < 2) continue;
    const dated = recs.filter(r => r.day);
    if (!dated.length) continue;
    const top = dated.map(r => r.day).sort().at(-1), newest = dated.filter(r => r.day === top);
    // Two values the newest day both stay (a person decides between them); what is older ends.
    const tops = new Set(newest.map(r => norm(r.value)));
    for (const r of recs) if (!tops.has(norm(r.value)) && (r.day || '') < top) steps.push({group, record: r, day: top, newest: newest[0]});
  }
  return steps;
}

// 2. A relationship that ended is ended everywhere (world_relationships.py).
export function endedRelationships(store, query) {
  const {entities, byId, follow, contactFor} = people(store, query);
  // The owner: the entity marked self. A world without one names the owner by
  // the profile's name or the owner's other names (the engine fell back to
  // "michael", which is one install's owner).
  let owners = new Set([...entities].filter(([, e]) => e.self).map(([slug]) => slug));
  if (!owners.size) {
    const display = String(query.rows('profiles')[0]?.display_name || '').trim();
    owners = new Set([display, display.split(/\s+/)[0], ...query.rows('user_self_aliases').map(a => a.alias)].map(fieldSlug).filter(n => n && n !== 'owner'));
  }
  const pairs = new Map(), entry = (person, rec) => pairs.set(person, [...(pairs.get(person) || []), rec]);
  const dir = path.join(store.root, 'world', 'claims');
  for (const f of worldFiles(dir)) {
    const m = f.fields, match = REL_ATTR.exec(String(m.attribute ?? ''));
    if (!match || m.value === undefined || m.value === '') continue;
    const subject = m.subject, object = m.object, to = match[1];
    let person;
    if (owners.has(subject) && object && !owners.has(object)) person = object;
    else if (subject && !owners.has(subject) && (!object || owners.has(object)) && (!to || owners.has(to))) person = subject;
    else continue;
    entry(person, {kind: 'world', path: path.join(dir, f.name), word: String(m.value), day: dayOf(m.valid_from), open: !m.valid_to, label: 'world/claims/' + f.name});
  }
  const slugOf = new Map();
  for (const slug of [...pairs.keys(), ...entities.keys()]) { const c = contactFor(slug); if (c && !owners.has(slug) && !slugOf.has(c.id)) slugOf.set(c.id, slug); }
  for (const l of query.rows('contact_relationships')) {
    if (l.removed_at) continue;
    const word = l.custom_label || l.label || l.relationship_type;
    const other = l.source_type === 'self' && l.target_type === 'contact' ? l.target_id : l.target_type === 'self' && l.source_type === 'contact' ? l.source_id : null;
    const c = other ? follow(byId.get(other)) : null;
    if (!c || !word) continue;
    entry(slugOf.get(c.id) || 'contact:' + c.id, {kind: 'link', id: l.id, word, day: dayOf(l.valid_from), open: !(l.valid_to || l.ended_at), label: 'notebook link'});
  }
  for (const [person, recs] of pairs) {
    const c = person.startsWith('contact:') ? byId.get(person.slice(8)) : contactFor(person);
    if (c?.relationship) recs.push({kind: 'card', id: c.id, word: String(c.relationship), day: null, open: true, label: 'card'});
  }
  const steps = [];
  for (const [person, recs] of [...pairs].sort(([a], [b]) => a.localeCompare(b))) {
    const dated = recs.filter(r => r.day && r.kind !== 'card');
    if (!dated.length) continue;
    const newest = dated.reduce((best, r) => r.day > best.day ? r : best);
    // The same day says both: leave it to a person.
    if (dated.some(r => r.day === newest.day && former(r.word) !== former(newest.word))) continue;
    const ended = former(newest.word);
    for (const r of recs) {
      if (r === newest || !r.open) continue;
      if (r.kind === 'card') { if (former(r.word) !== ended) steps.push({person, action: 'card', record: r, day: null, word: newest.word}); continue; }
      if ((r.day || '') >= newest.day) continue;
      if (former(r.word) !== ended) steps.push({person, action: 'end', record: r, day: newest.day, word: newest.word});
    }
  }
  return steps;
}

// Both, applied. A world file is changed in place; a notebook record only
// while it is still what was read (open, unchanged), under the store's lock.
// Returns what it ended, and the world files it changed.
export async function closeFacts({store, query, dryRun = false} = {}) {
  const values = supersededValues(store, query), relationships = endedRelationships(store, query);
  const result = {values: values.map(s => ({subject: s.group.split('|')[0], kind: s.group.split('|').slice(1).join('|'), value: s.record.value, from: s.record.label, ends: s.day, newest: s.newest.value})),
    relationships: relationships.map(s => ({person: s.person, from: s.record.label, word: s.record.word, ...(s.action === 'end' ? {ends: s.day} : {card_becomes: s.word})})), files: []};
  if (dryRun || (!values.length && !relationships.length)) return result;
  const files = new Set();
  for (const s of values) if (s.record.kind === 'world') { setValidTo(s.record.path, s.day); files.add(s.record.path); }
  for (const s of relationships) if (s.record.kind === 'world') { setValidTo(s.record.path, s.day); files.add(s.record.path); }
  const write = () => {
    const records = [], open = (type, id) => { const r = store.get(type, id); return r && !r.removed_at ? r : null; };
    for (const s of values) {
      if (s.record.kind !== 'claim') continue;
      const claim = open('claims', s.record.id);
      if (!claim || claim.valid_to || norm(claim.value) !== norm(s.record.value)) continue;
      const evidence = s.newest.kind === 'world' ? {source_type: 'file', source_id: s.newest.label, quote: null} : {source_type: 'claim', source_id: s.newest.id, quote: null};
      records.push(store.prepare('claims', {valid_to: s.day, closure_evidence: evidence}, claim));
    }
    for (const s of relationships) {
      if (s.record.kind === 'link') {
        const link = open('contact_relationships', s.record.id);
        if (link && !link.valid_to && !link.ended_at) records.push(store.prepare('contact_relationships', {valid_to: s.day}, link));
      } else if (s.record.kind === 'card') {
        const card = open('contacts', s.record.id);
        if (card && norm(card.relationship) === norm(s.record.word)) records.push(store.prepare('contacts', {relationship: s.word}, card));
      }
    }
    if (records.length) store.commit(records);
    return records.length;
  };
  result.records = store.withLockAsync ? await store.withLockAsync(write) : store.withLock(write);
  result.files = [...files].map(f => path.relative(store.root, f).split(path.sep).join('/'));
  return result;
}

// Once a day, on the machine that runs the routines, after 04:00 in the
// owner's timezone, and once more soon after a Menerio import (request()).
// What it did is in .godspeed/fact-closing-status.json; a run that fails is a
// failed job receipt, which the daily job check turns into a repair item, and
// is tried again after a wait that doubles from an hour to a day.
export class FactClosing {
  constructor({store, query, device = store.device, hour = 4}) { Object.assign(this, {store, query, device, hour}); this.requested = false; }
  statusFile() { return path.join(this.store.state, 'fact-closing-status.json'); }
  status() { try { return {failures: 0, last_day: null, last_error: null, retry_after: null, ...JSON.parse(fs.readFileSync(this.statusFile(), 'utf8'))}; } catch { return {failures: 0, last_day: null, last_error: null, retry_after: null}; } }
  note(status) { try { atomic(this.statusFile(), JSON.stringify(status, null, 2)); } catch {} }
  request() { this.requested = true; }
  due(now = Date.now()) {
    const settings = this.store.get('settings', 'installation');
    if (!settings || settings.owner !== this.device) return false;
    const status = this.status(), retry = Date.parse(status.retry_after);
    if (Number.isFinite(retry) && now < retry) return false;
    if (this.requested) return true;
    const zone = settings.timezone || 'UTC', day = new Intl.DateTimeFormat('en-CA', {timeZone: zone}).format(now);
    const hour = Number(new Intl.DateTimeFormat('en-GB', {timeZone: zone, hour: '2-digit', hourCycle: 'h23'}).format(now));
    return hour >= this.hour && status.last_day !== day;
  }
  async tick(now = Date.now()) {
    if (this.running || !this.due(now)) return null;
    this.running = true; this.requested = false;
    const started = new Date(now).toISOString(), before = this.status(), zone = this.store.get('settings', 'installation')?.timezone || 'UTC';
    try {
      let result;
      try { result = await closeFacts({store: this.store, query: this.query}); }
      catch (error) {
        const failures = (before.failures || 0) + 1;
        this.note({...before, failures, last_attempt: started, last_error: String(error.message || error), retry_after: new Date(now + Math.min(24, 2 ** (failures - 1)) * 3600000).toISOString()});
        await this.receipt({state: 'failed', error: String(error.message || error), started_at: started});
        throw error;
      }
      this.note({failures: 0, last_day: new Intl.DateTimeFormat('en-CA', {timeZone: zone}).format(now), last_attempt: started, last_success: new Date().toISOString(), last_error: null, retry_after: null,
        ended_values: result.values.length, ended_relationships: result.relationships.length, changed_files: result.files});
      // A run that works after failures clears the repair item they made.
      if (before.failures) await this.receipt({state: 'verified', started_at: started});
      return result;
    } finally { this.running = false; }
  }
  async receipt(fields) {
    try { await this.store.saveAsync('job_receipts', {id: 'daily-fact-closing-' + Date.parse(fields.started_at), job_id: 'daily-fact-closing', kind: 'fact-closing', ...fields, finished_at: new Date().toISOString()}, undefined, {timeoutMs: 30000}); } catch {}
  }
}
