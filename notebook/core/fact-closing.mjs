import fs from 'node:fs';
import path from 'node:path';
import {atomic} from './records/store.mjs';
import {fieldList, fieldSlug} from './fields.mjs';

// The notebook ends what is no longer true, on its own schedule, for every
// install (8 October 2026). Until then two jobs in the original Mission Control engine did it
// for one notebook only (scripts/world_fields.py and
// scripts/world_relationships.py); a buyer's notebook kept every old
// value open beside the new one. These are those two jobs, case for case:
//
// Who is who: the notebook's people (a person merged into another is that
// other), by id.
function people(query) {
  const contacts = query.rows('contacts').filter(c => !c.removed_at), byId = new Map();
  for (const c of contacts) for (const id of [c.id, ...(Array.isArray(c.former_ids) ? c.former_ids : [])]) if (!byId.has(id) || id === c.id) byId.set(id, c);
  const follow = c => { for (let hops = 0; hops < 6; hops++) { if (!c || !c.merged_into || c.merged_into === 'self') return c; c = byId.get(c.merged_into); } return c; };
  return {byId, follow};
}

// 1. One current value where there is only one. For every subject and every
//    one-at-a-time kind of fact (core/fields.mjs) it gathers the open values in
//    the notebook's claims, whatever name or source they carry. The newest dated value stays; every older open value that
//    differs ends on that date. Nothing undated decides. Two different values
//    dated the same newest day both stay, for a person to decide (the notebook
//    shows them as two answers); what is older than both still ends.
// 2. A relationship that ended is ended everywhere it is recorded. For every
//    person the owner is related to it gathers the claims about the two,
//    the notebook's links between them and the person's card. When the newest
//    dated of them says the relationship ended (ex-, former, ehemalig,
//    früher), every older open one ends that day and the card takes the newest
//    word; when the newest says it goes on (again), an older open "ex" ends
//    instead. Words that agree (wife beside spouse) stay side by side. Nothing
//    undated decides, and a day that says both is left to a person.
//
// Both only ever end what is open, so a second run changes nothing: where
// that engine also runs them, whichever runs second finds nothing to do.

const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
// A date counts when it is a day; anything else is undated and decides nothing.
const dayOf = v => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? '')); return m ? m[1] : null; };
const FORMER = /\b(ex|former|past|previous|ehemalig\w*|fr(?:ue|ü)her\w*)\b/i;
export const former = word => FORMER.test(String(word ?? ''));
const REL_ATTR = /^relationship(?:-(?:to-(.+)|description|status))?$/;

// 1. One current value where there is only one (world_fields.py).
export function supersededValues(store, query) {
  const fields = fieldList(store.root), {byId, follow} = people(query);
  const groups = new Map(), add = (k, r) => groups.set(k, [...(groups.get(k) || []), r]);
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
  const {byId, follow} = people(query);
  // The owner is the subject type self; a claim that names the owner in words
  // ("relationship-to-owner") is read the same, by the profile's name or the
  // owner's other names (the engine fell back to "fictional-alex", which is one
  // install's owner).
  const display = String(query.rows('profiles')[0]?.display_name || '').trim();
  const ownerNames = new Set(['me', 'owner', display, display.split(/\s+/)[0], ...query.rows('user_self_aliases').map(a => a.alias)].map(fieldSlug).filter(Boolean));
  const pairs = new Map(), entry = (person, rec) => pairs.set(person, [...(pairs.get(person) || []), rec]);
  const who = (type, id) => { const c = type === 'contact' ? follow(byId.get(id)) : null; return type + ':' + (c?.id || id); };
  for (const c of query.rows('claims')) {
    const match = REL_ATTR.exec(String(c.attribute ?? ''));
    if (c.removed_at || !match || c.value === undefined || c.value === null || c.value === '') continue;
    const to = match[1];
    let person;
    if (c.subject_type === 'self' && c.object_type && c.object_type !== 'self') person = who(c.object_type, c.object_id);
    else if (c.subject_type !== 'self' && (!c.object_type || c.object_type === 'self') && (!to || ownerNames.has(fieldSlug(to)))) person = who(c.subject_type, c.subject_id);
    else continue;
    entry(person, {kind: 'claim', id: c.id, word: c.relationship || String(c.value).split(':')[0].trim(), day: dayOf(c.valid_from), open: !c.valid_to, label: 'notebook fact ' + c.attribute});
  }
  for (const l of query.rows('contact_relationships')) {
    if (l.removed_at) continue;
    const word = l.custom_label || l.label || l.relationship_type;
    const other = l.source_type === 'self' && l.target_type === 'contact' ? l.target_id : l.target_type === 'self' && l.source_type === 'contact' ? l.source_id : null;
    const c = other ? follow(byId.get(other)) : null;
    if (!c || !word) continue;
    entry('contact:' + c.id, {kind: 'link', id: l.id, word, day: dayOf(l.valid_from), open: !(l.valid_to || l.ended_at), label: 'notebook link'});
  }
  for (const [person, recs] of pairs) {
    const c = person.startsWith('contact:') ? byId.get(person.slice(8)) : null;
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

// Both, applied: a notebook record only while it is still what was read (open,
// unchanged), under the store's lock. Returns what it ended.
export async function closeFacts({store, query, dryRun = false} = {}) {
  const values = supersededValues(store, query), relationships = endedRelationships(store, query);
  const result = {values: values.map(s => ({subject: s.group.split('|')[0], kind: s.group.split('|').slice(1).join('|'), value: s.record.value, from: s.record.label, ends: s.day, newest: s.newest.value})),
    relationships: relationships.map(s => ({person: s.person, from: s.record.label, word: s.record.word, ...(s.action === 'end' ? {ends: s.day} : {card_becomes: s.word})}))};
  if (dryRun || (!values.length && !relationships.length)) return result;
  const write = () => {
    const records = [], open = (type, id) => { const r = store.get(type, id); return r && !r.removed_at ? r : null; };
    for (const s of values) {
      if (s.record.kind !== 'claim') continue;
      const claim = open('claims', s.record.id);
      if (!claim || claim.valid_to || norm(claim.value) !== norm(s.record.value)) continue;
      const evidence = {source_type: 'claim', source_id: s.newest.id, quote: null};
      records.push(store.prepare('claims', {valid_to: s.day, closure_evidence: evidence}, claim));
    }
    for (const s of relationships) {
      if (s.record.kind === 'claim') {
        const claim = open('claims', s.record.id);
        if (claim && !claim.valid_to) records.push(store.prepare('claims', {valid_to: s.day}, claim));
      } else if (s.record.kind === 'link') {
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
        ended_values: result.values.length, ended_relationships: result.relationships.length});
      // A run that works after failures clears the repair item they made.
      if (before.failures) await this.receipt({state: 'verified', started_at: started});
      return result;
    } finally { this.running = false; }
  }
  async receipt(fields) {
    try { await this.store.saveAsync('job_receipts', {id: 'daily-fact-closing-' + Date.parse(fields.started_at), job_id: 'daily-fact-closing', kind: 'fact-closing', ...fields, finished_at: new Date().toISOString()}, undefined, {timeoutMs: 30000}); } catch {}
  }
}
