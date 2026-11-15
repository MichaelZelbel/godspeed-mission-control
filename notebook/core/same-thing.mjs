import {fieldList} from './fields.mjs';
import {STOPWORDS} from './index/stopwords.mjs';

// WHEN TWO RECORDS ARE THE SAME THING, ONE RULE FOR EVERY KIND (23 October 2026).
//
// The notebook asked "is this already there?" in two places with two rules. Keeping a fact
// (writeFact) compared values in lower case under the fact's one name (fields.mjs), and only when the
// fact was written; proposing a suggestion compared a hash of the model's exact answer. So "+44 7700
// 900123" and "07700 900 123" were two phone numbers, "€ 120,50" and "120.50 €" two amounts, and a note
// processed again proposed the same things in other words. Now both ask this module:
//
// - A fact is the same when it is about the same person (or the owner), of the same kind (its one
//   name from fields.mjs; a kind the list does not name by its slug; an email or a phone number is of
//   that kind whatever it is called) and its value is the same once written one way: a phone number by
//   its last nine digits, an email in lower case, a date as YYYY-MM-DD, an amount by its number ("€
//   120,50", "120.50 €"), words without case, accents, punctuation or a company form at the end.
//   A suggestion is also the same when its value is equal under a related name (the names share a
//   word: "agreed retirement date" and "agreed pension start date") or is one that can only be this
//   one thing (an email, a long number, an amount with cents, a name of several words).
// - A timeline entry is the same when its day is the same and it comes from the same note, or its day
//   is at most one apart and its title is nearly the same, or it names one of the same people and
//   shares a word of the title. Keeping one links it to an existing entry only when every word of
//   the shorter title is in the other: two things of one day from one note may both be wanted.
// - A person is the same by name or nickname, written in any case and with or without accents, also
//   as nickname plus surname ("Bob Smith" for Robert Smith called Bob).
// - A relationship is the same between the same two people with the same meaning, in either
//   direction ("mother of" one way is "child of" the other).
//
// Every lookup goes through an index made once per run (sameIndex), by person and kind, by person and
// value, and by day, so a check costs the same with 200 facts or 20,000.

const fold = s => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').toLowerCase();
export const wordsOf = s => fold(s).split(/[^a-z0-9]+/).filter(Boolean);
// The company form at the end of a name says nothing about which company it is.
const LEGAL = new Set(['gmbh', 'mbh', 'ag', 'inc', 'ltd', 'llc', 'co', 'kg', 'se', 'plc', 'corp', 'sa', 'bv', 'ug']);
const CURRENCY = /€|\$|£|¥|\b(?:eur|euro|euros|usd|chf|gbp|dollars?)\b/gi;
const MONTHS = {jan: 1, january: 1, januar: 1, feb: 2, february: 2, februar: 2, mar: 3, march: 3, marz: 3, maerz: 3, apr: 4, april: 4, may: 5, mai: 5, jun: 6, june: 6, juni: 6,
  jul: 7, july: 7, juli: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, okt: 10, oktober: 10, nov: 11, november: 11, dec: 12, december: 12, dez: 12, dezember: 12};
// Words of a fact's name that say nothing about which fact it is.
const GENERIC = new Set(['date', 'number', 'value', 'info', 'information', 'type', 'name', 'current', 'new', 'detail', 'details', 'status', 'self', 'user', 'owner', 'fact', 'claim', 'add', 'about', 'personal', 'contact']);

const ymd = (y, m, d) => (+m >= 1 && +m <= 12 && +d >= 1 && +d <= 31) ? String(+y).padStart(4, '0') + '-' + String(+m).padStart(2, '0') + '-' + String(+d).padStart(2, '0') : null;
export function dateOf(text) {
  const t = fold(text).trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[t\s])/); if (m) return ymd(m[1], m[2], m[3]);
  m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/); if (m) return ymd(m[3], m[2], m[1]);
  m = t.match(/^(\d{1,2})\.?\s+([a-z]+)\.?,?\s+(\d{4})$/); if (m && MONTHS[m[2]]) return ymd(m[3], MONTHS[m[2]], m[1]);
  m = t.match(/^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/); if (m && MONTHS[m[1]]) return ymd(m[3], MONTHS[m[1]], m[2]);
  return null;
}
// One number, written the English or the German way ("1,234.50", "1.234,50", "120,50").
function numberOf(text) {
  const t = String(text).replace(CURRENCY, '').replace(/^\s*(?:~|ca\.?|approx\.?|about)\s*/i, '').trim();
  if (!/^[-+]?\d[\d.,'  ]*$/.test(t)) return undefined;
  let s = t.replace(/['  ]/g, '');
  const dot = s.lastIndexOf('.'), comma = s.lastIndexOf(',');
  if (dot >= 0 && comma >= 0) { const decimal = dot > comma ? '.' : ','; s = s.split(decimal === '.' ? ',' : '.').join('').replace(decimal, '.'); }
  else if (comma >= 0) { const parts = s.split(','); s = parts.length === 2 && parts[1].length !== 3 ? parts.join('.') : parts.join(''); }
  else if (dot >= 0) { const parts = s.split('.'); if (parts.length > 2 || parts[1].length === 3 && !/^[-+]?0$/.test(parts[0])) s = parts.join(''); }
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}
const words = raw => wordsOf(raw).filter((w, i, all) => !(LEGAL.has(w) && i === all.length - 1 && i > 0)).join(' ');

// A value written one way: {type, key}. type is email, phone, digits (a booking, policy or
// customer number), date, amount or text.
export function valueKey(value) {
  const raw = String(value ?? '').replace(/^mailto:/i, '').trim();
  const email = raw.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  if (email) return {type: 'email', key: 'email:' + email[0].toLowerCase()};
  const date = dateOf(raw);
  if (date) return {type: 'date', key: 'date:' + date};
  const runs = raw.match(/\+?\(?\d[\d\s().\/-]*\d/g) || [];
  if (runs.length === 1) {
    const run = runs[0].trim(), digits = run.replace(/\D/g, ''), letters = raw.replace(runs[0], '').replace(/[^\p{L}]/gu, '');
    const grouped = /^\d{1,3}(?:[.,' ]\d{3})+$/.test(run), cents = /[.,]\d{1,2}$/.test(run) || CURRENCY.test(raw);
    CURRENCY.lastIndex = 0;
    if (digits.length >= 7 && letters.length <= 12 && !grouped && !cents) {
      // A phone number is written with its country code or its leading zero; its last nine digits
      // name it either way. Any other run of digits is compared whole.
      if (/^(?:\+|00|0\d|\()/.test(run)) return {type: 'phone', key: 'tel:' + digits.replace(/^0+/, '').slice(-9)};
      return {type: 'digits', key: 'num:' + digits};
    }
  }
  const number = numberOf(raw);
  if (number !== undefined) return {type: 'amount', key: 'amount:' + number};
  return {type: 'text', key: 'text:' + words(raw)};
}
export const sameValue = (a, b) => { const x = valueKey(a); return x.key !== 'text:' && x.key === valueKey(b).key; };
// A value that can only be this one thing, so it is the same fact under any name.
function distinctive(value) {
  const v = valueKey(value);
  if (['email', 'phone'].includes(v.type) || v.type === 'digits' && v.key.length >= 11) return true;
  if (v.type === 'amount') { const n = Number(v.key.slice(7)), digits = String(Math.abs(n)).replace(/\D/g, ''); return digits.length >= 5 || digits.length >= 4 && !Number.isInteger(n); }
  return v.type === 'text' && v.key.split(' ').length >= 2 && v.key.length >= 15;
}
const stem = w => w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w;
const nameWords = (...names) => new Set(names.flatMap(n => wordsOf(n)).map(stem).filter(w => w.length >= 3 && !GENERIC.has(w) && !STOPWORDS.has(w)));

// The kind a fact is compared under.
export function factKind(attribute, label, value, fields = fieldList()) {
  const type = valueKey(value).type;
  if (type === 'email' || type === 'phone') return type;
  return fields.canonical(attribute || label || '') || 'fact';
}
// Who a fact or a suggestion is about: 'self', 'contact:<id>' or 'entity:<id>'. A person merged into
// another, or into the owner, is the one they were merged into.
export function subjectOf(p = {}, people = new Map()) {
  if (p.entity_id || p.subject_type === 'entity') return 'entity:' + (p.entity_id || p.subject_id || '');
  let id = p.contact_id || (['contact', 'person'].includes(p.subject_type) ? p.subject_id : null);
  for (let hops = 0; id && hops < 5; hops++) { const person = people.get(id); if (!person?.merged_into) break; if (person.merged_into === 'self') return 'self'; id = person.merged_into; }
  return id ? 'contact:' + id : 'self';
}

// Relationships: the meaning of a label in one word, as the review page's rule has it
// (ui/src/lib/relationship-canonical.ts): "mum" is mother, "colleague" co-worker.
const LABELS = Object.fromEntries(Object.entries({
  spouse: 'spouse married|married to|marriage|life partner|ehepartner|husband|wife|ehefrau|ehemann', partner: 'partner girlfriend|boyfriend|fiance|fiancee|romantic partner|romantic interest|love interest|companion|significant other|freundin|freund',
  parent: 'parent mother|mom|mum|mama|mutter|father|dad|papa|vater', child: 'child kid|kids|children|son|daughter', sibling: 'sibling brother|bruder|sister|schwester',
  grandparent: 'grandparent grandmother|grandma|granny|oma|grossmutter|grandfather|grandpa|opa|grossvater', grandchild: 'grandchild grandson|granddaughter|grandkid',
  pibling: 'pibling aunt|tante|uncle|onkel', nibling: 'nibling niece|nichte|nephew|neffe', stepparent: 'stepparent stepfather|step father|stepdad|stiefvater|stepmother|step mother|stepmom|stiefmutter|step parent',
  stepchild: 'stepchild stepson|step son|stiefsohn|stepdaughter|step daughter|stieftochter|step child', 'parent-in-law': 'parent-in-law father-in-law|father in law|schwiegervater|mother-in-law|mother in law|schwiegermutter|parent in law',
  'child-in-law': 'child-in-law son-in-law|son in law|daughter-in-law|daughter in law', 'sibling-in-law': 'sibling-in-law brother-in-law|brother in law|schwager|sister-in-law|sister in law',
  friend: 'friend friends|best friend|bestfriend|buddy|pal|acquaintance', 'co-worker': 'co-worker coworker|co worker|colleague|kollege|kollegin|team member|teammate|collaborator|work contact',
  manager: 'manager line manager|reporting manager|reports to|boss|supervisor|coordinator', report: 'report direct report|manages', neighbor: 'neighbor neighbour|nachbar', roommate: 'roommate flatmate',
}).flatMap(([canon, list]) => { const [, rest] = list.split(/ (.*)/s); return [[canon, canon], ...rest.split('|').map(l => [l, canon])]; }));
const SYMMETRIC = new Set(['spouse', 'partner', 'sibling', 'friend', 'co-worker', 'neighbor', 'roommate', 'sibling-in-law', 'cousin', 'relative']);
const INVERSE = {parent: 'child', child: 'parent', grandparent: 'grandchild', grandchild: 'grandparent', pibling: 'nibling', nibling: 'pibling', stepparent: 'stepchild', stepchild: 'stepparent',
  'parent-in-law': 'child-in-law', 'child-in-law': 'parent-in-law', manager: 'report', report: 'manager', employer: 'employee', employee: 'employer', mentor: 'mentee', mentee: 'mentor', teacher: 'student', student: 'teacher', client: 'provider', provider: 'client'};
export function relationLabel(label) {
  const key = fold(label).replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9\s-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (LABELS[key]) return LABELS[key];
  const last = key.split(' ').pop();
  return LABELS[last] && !/^(ex-|ex\s|former\s)/.test(key) ? LABELS[last] : key;
}
export function relationKey(p = {}) {
  const end = (type, id) => (type === 'self' || !id && type !== 'contact' ? 'self' : (type || 'contact') + ':' + id);
  const a = end(p.source_type, p.source_id), b = end(p.target_type, p.target_id), label = relationLabel(p.custom_label || p.label);
  if (SYMMETRIC.has(label)) return 'sym|' + label + '|' + [a, b].sort().join('|');
  return 'asym|' + [a + ':' + label, b + ':' + (INVERSE[label] || label)].sort().join('|');
}

export const personKey = name => wordsOf(String(name ?? '').replace(/\([^)]*\)/g, ' ')).join(' ');
const dayOf = value => { const m = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : null; };
const shiftDay = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const titleWords = title => new Set(wordsOf(title).filter(w => (w.length >= 3 || /\d/.test(w)) && !STOPWORDS.has(w)).map(stem));
// Nearly the same title: most words of the shorter one are in the other, or (strict) all of them.
function nearTitles(a, b, strict = false) {
  const x = titleWords(a), y = titleWords(b);
  if (!x.size || !y.size) return false;
  const shared = [...x].filter(w => y.has(w)).length, smaller = Math.min(x.size, y.size);
  if (strict) return shared === smaller;
  return smaller === 1 ? shared === 1 && Math.max(x.size, y.size) <= 2 : shared / smaller >= 0.6;
}
const sharesTitleWord = (a, b) => { const y = titleWords(b); return [...titleWords(a)].some(w => y.has(w)); };

// What a fact, a suggestion or a record is, in the form it is compared in.
export function readThing(item, {people = new Map(), fields = fieldList(), note = null} = {}) {
  const kind = item.type === 'review_queue' ? item.suggestion_type : item.type === 'claims' ? 'claim' : item.type || item.suggestion_type, p = kind === 'claim' ? item : item.payload || {};
  if (['claim', 'add_claim', 'add_profile_entry', 'unknown_profile_field', 'normalize_profile_entry'].includes(kind)) {
    const label = p.label || p.canonical_label || p.attribute || '', value = String(p.value ?? p.canonical_value ?? '').trim();
    return {kind: 'fact', subject: subjectOf(p, people), factKind: factKind(p.attribute, label, value, fields), words: nameWords(p.attribute, label), label, value, value_key: valueKey(value).key};
  }
  if (kind === 'add_moment' || kind === 'moment') {
    const ids = (p.participants || []).map(x => typeof x === 'string' ? x : x?.contact_id || x?.person_id).filter(Boolean);
    return {kind: 'moment', date: dayOf(p.happened_at), title: String(p.title || item.title || ''), note: p.source_note_id || item.source_note_id || note?.id || null, people: new Set(ids)};
  }
  if (kind === 'add_contact' || kind === 'contact') return {kind: 'person', names: [p.name, ...(p.aliases || [])].map(personKey).filter(Boolean)};
  if (kind === 'add_relationship' || kind === 'relationship') return {kind: 'relationship', key: relationKey(p)};
  if (kind === 'connect_note_person') return {kind: 'link', key: (p.note_id || note?.id || '') + '|' + (p.contact_id || '')};
  return {kind: 'other'};
}

// One list of things (the notebook's records, or the suggestions made so far) with its lookups.
class Shelf {
  constructor() { this.facts = new Map(); this.values = new Map(); this.kinds = new Map(); this.days = new Map(); this.people = new Map(); this.relations = new Map(); this.links = new Map(); }
  static push(map, key, value) { const list = map.get(key); if (list) list.push(value); else map.set(key, [value]); }
  add(thing) {
    if (thing.kind === 'fact' && thing.value) {
      this.facts.set(thing.subject + '|' + thing.factKind + '|' + thing.value_key, thing);
      Shelf.push(this.values, thing.subject + '|' + thing.value_key, thing);
      Shelf.push(this.kinds, thing.subject + '|' + thing.factKind, thing);
    } else if (thing.kind === 'moment' && thing.date) Shelf.push(this.days, thing.date, thing);
    else if (thing.kind === 'person') for (const n of thing.names) { this.people.set(n, thing); const parts = n.split(' '); if (parts.length >= 2) Shelf.push(this.surnames ||= new Map(), parts.at(-1), thing); }
    else if (thing.kind === 'relationship') this.relations.set(thing.key, thing);
    else if (thing.kind === 'link') this.links.set(thing.key, thing);
  }
  // {thing, how} for the same thing on this shelf, or null. how is 'same' (the rule above for the
  // notebook's own writes) or 'related' (the wider rule for suggestions).
  find(thing, {wide = true} = {}) {
    if (thing.kind === 'fact') {
      if (!thing.value || thing.value_key === 'text:') return null;
      const same = this.facts.get(thing.subject + '|' + thing.factKind + '|' + thing.value_key);
      if (same) return {thing: same, how: 'same'};
      if (!wide) return null;
      for (const k of this.values.get(thing.subject + '|' + thing.value_key) || []) if (distinctive(thing.value) || [...thing.words].some(w => k.words.has(w))) return {thing: k, how: 'related'};
      return null;
    }
    if (thing.kind === 'moment' && thing.date) {
      for (const d of [thing.date, shiftDay(thing.date, -1), shiftDay(thing.date, 1)]) for (const m of this.days.get(d) || []) {
        // Keeping one (not wide) links it only to an entry with nearly the same title: the owner may
        // keep two things of one day from one note on purpose.
        if (!wide) { if (nearTitles(m.title, thing.title, true)) return {thing: m, how: 'same'}; continue; }
        const sameDay = d === thing.date, sameNote = !!thing.note && m.note === thing.note, together = [...thing.people].some(id => m.people.has(id));
        if (sameDay && sameNote || nearTitles(m.title, thing.title) || together && sharesTitleWord(m.title, thing.title)) return {thing: m, how: 'same'};
      }
      return null;
    }
    if (thing.kind === 'person') {
      for (const n of thing.names) {
        if (this.people.has(n)) return {thing: this.people.get(n), how: 'same'};
        // Nickname and surname: "Bob Smith" for Robert Smith, called Bob.
        const parts = n.split(' ');
        if (parts.length >= 2) for (const person of this.surnames?.get(parts.at(-1)) || []) if (person.names.some(x => x === parts[0] || x.split(' ')[0] === parts[0])) return {thing: person, how: 'same'};
      }
      return null;
    }
    if (thing.kind === 'relationship') return this.relations.has(thing.key) ? {thing: this.relations.get(thing.key), how: 'same'} : null;
    if (thing.kind === 'link') return this.links.has(thing.key) ? {thing: this.links.get(thing.key), how: 'same'} : null;
    return null;
  }
}

const WITHDRAWN = 'withdrawn';
// The index of a notebook's records and suggestions (lists as knownRecords gives them), made once per
// run. `known` holds what the notebook has; `suggested` every suggestion ever made, in any status,
// except one withdrawn because its words left its note (review-sources.mjs), plus what this run adds.
export function sameIndex(records, {fields = fieldList(), note = null} = {}) {
  const people = new Map((records.contacts || []).map(c => [c.id, c])), known = new Shelf(), suggested = new Shelf();
  const read = (item, at = note) => readThing(item, {people, fields, note: at});
  for (const c of records.claims || []) if (!c.removed_at) known.add({...read({...c, type: 'claims'}), record: c});
  for (const m of records.moments || []) if (!m.removed_at) {
    const thing = read({type: 'moment', payload: m}, null);
    for (const x of records.participants || []) if (x.moment_id === m.id && !x.removed_at) thing.people.add(x.person_id || x.contact_id);
    known.add({...thing, record: m});
  }
  for (const c of records.contacts || []) if (!c.removed_at && !c.merged_into) known.add({...read({type: 'contact', payload: c}), record: c});
  if ((records.selfNames || []).length) known.add({kind: 'person', names: records.selfNames.map(personKey).filter(Boolean), record: {self: true}});
  for (const r of records.relationships || []) if (!r.removed_at) known.add({...read({type: 'relationship', payload: r}), record: r});
  for (const d of records.documents || []) if (!d.removed_at) known.add({kind: 'link', key: d.note_id + '|' + d.contact_id, record: d});
  for (const r of records.queue || []) if (!r.removed_at && r.status !== WITHDRAWN) suggested.add({...read(r, null), record: r});
  return {people, fields, known, suggested, read,
    // What a suggestion repeats: {reason, thing, how} or null.
    match(item) {
      const thing = read(item), mine = known.find(thing), earlier = !mine && suggested.find(thing);
      if (mine) return {reason: 'known_' + thing.kind, thing: mine.thing, how: mine.how};
      if (earlier) return {reason: 'already_suggested', thing: earlier.thing, how: earlier.how};
      return null;
    },
    remember(item, origin = 'this run') { suggested.add({...read(item), record: {origin}}); }};
}
