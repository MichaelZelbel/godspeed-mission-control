import fs from 'node:fs';
import path from 'node:path';
import {visibleRows} from '../core/visibility.mjs';
import {momentDraft} from '../core/moment-draft.mjs';
import {relatedNotes} from '../core/related.mjs';
import {STOPWORDS} from '../core/index/stopwords.mjs';

// Menerio's tool names and arguments, answered from the notebook. Mission
// Control's skills, routines and memory benchmark called these names for
// months; with the same names here every caller switches by changing only
// which server it talks to (6 October 2026).
const str = {type: 'string'}, num = {type: 'number'}, bool = {type: 'boolean'}, strings = {type: 'array', items: str};
const object = (properties, required = []) => ({type: 'object', properties, required});
const who = {contact_id: {type: 'string', description: 'Exact person id'}, name: {type: 'string', description: 'Name or nickname; a name several people share is refused with their ids'}};
export const memoryDefinitions = [
  {name: 'search_brain', description: 'Preferred default search. Searches facts (claim), notes (note) and Lexicon pages (lexicon) by words and, when connected, by meaning, in one call. A claim is a dated fact; prefer it over a note sentence when they disagree and say how old it is. A claim marked TWO ANSWERS has two current values: report both. Use get_note(id) for a whole note.',
    inputSchema: object({query: str, include: {type: 'array', items: {enum: ['claim', 'note', 'lexicon']}}, limit: num, offset: num, as_of: {type: 'string', description: 'YYYY-MM-DD; omit for today'}, view: {enum: ['snippet', 'metadata']}, threshold: num}, ['query'])},
  {name: 'get_user_profile', description: 'The owner\'s profile: facts by category, the people closest to them, and the instructions they left for assistants. Call it at the start of a conversation.',
    inputSchema: object({categories: strings, detail: {enum: ['curated', 'full']}, include_instructions: bool, include_notes: bool, scope: str})},
  {name: 'search_contacts', description: 'Find people by name, nickname, company or relationship. Returns their contact_id.', inputSchema: object({query: str, relationship: str, limit: num})},
  {name: 'get_contact_context', description: 'One person: details, open topics, recent interactions, notes about them (with ids), facts, shared timeline entries and relationships.', inputSchema: object(who)},
  {name: 'get_contact_profile', description: 'One person\'s facts grouped by section, with their dates. TWO ANSWERS means two current values: report both.', inputSchema: object({...who, detail: {enum: ['curated', 'full']}, include_history: bool})},
  {name: 'get_person_notes', description: 'Notes that name one person, newest first.', inputSchema: object({...who, limit: num})},
  {name: 'get_claims', description: 'Dated facts. mode current = true today, history = everything including ended facts, changed_since = started or ended after since.',
    inputSchema: object({subject_type: {enum: ['self', 'contact', 'entity']}, subject_id: str, subject_name: str, attribute: str, mode: {enum: ['current', 'history', 'changed_since']}, since: str, limit: num})},
  {name: 'add_claim', description: 'Record a fact about the owner, a person or a thing that is true now (or since valid_from). An older value of a single-valued fact is closed with an end date, never deleted; one the owner typed himself is not overwritten but put in his Review for him to decide. Requires evidence_quote. Relationships between people are not facts.',
    inputSchema: object({subject_type: {enum: ['self', 'contact', 'entity']}, subject_id: str, subject_name: str, attribute: str, value: str, evidence_quote: str, confidence: {enum: ['certain', 'likely', 'unsure']}, valid_from: str, valid_to: str, source_note_id: str}, ['subject_type', 'attribute', 'value'])},
  {name: 'create_moment_with_ai', description: 'Create a timeline entry from a plain description; the model works out title, date and status, then it is saved. Hints override what the model guessed.',
    inputSchema: object({description: str, happened_at: str, title_hint: str, status_hint: {enum: ['past_fact', 'future_plan', 'ongoing', 'unknown']}, participant_names: strings, person_name: str, entity_names: strings, category_hint: str, impact_level_hint: num, confidence_date_hint: num, confidence_truth_hint: num, document_ids: strings}, ['description'])},
  {name: 'log_interaction', description: 'Record an interaction with a person, dated today in the owner\'s timezone, and update their last contact date. A name several people share is refused with their ids.',
    inputSchema: object({contact_name: str, contact_id: str, type: str, summary: str, action_items: strings, group_id_or_slug: str}, ['type'])},
  {name: 'list_recent_notes', description: 'The most recently changed notes, optionally about a person, a topic or of a type.', inputSchema: object({days: num, limit: num, person: str, topic: str, type: str})},
  {name: 'list_recent', description: 'Same as list_recent_notes.', inputSchema: object({days: num, limit: num, person: str, topic: str, type: str})},
  {name: 'get_stats', description: 'Totals of the notebook: notes, types, top topics, people, facts, timeline and recent activity.', inputSchema: object({})},
  {name: 'trash_note', description: 'Move a note to the trash (the owner can restore it) or, with restore true, bring it back. Permanent deletion is not available to assistants.', inputSchema: object({note_id: str, restore: bool}, ['note_id'])},
  {name: 'search_moments', description: 'Search timeline entries by words and meaning.', inputSchema: object({query: str, limit: num}, ['query'])},
  {name: 'search_entities', description: 'Search the owner\'s World of things that are not people (companies, places, products) by name, nickname, description or type.', inputSchema: object({query: str, entity_type: str, limit: num})},
  {name: 'get_entity_context', description: 'One thing in the World: its facts, timeline entries and notes that name it.', inputSchema: object({id_or_name: str, include_history: bool}, ['id_or_name'])},
  {name: 'lexicon_search', description: 'Search Lexicon pages (topic, concept and person pages) by title or content.', inputSchema: object({query: str, page_type: str, limit: num}, ['query'])},
  {name: 'list_collections', description: 'Every collection with its slug, description, item count and the instructions for capturing into it.', inputSchema: object({})},
  {name: 'get_collection_schema', description: 'A collection\'s fields (key, label, type, options) and capture instructions. Read it before adding or updating items.', inputSchema: object({slug: str}, ['slug'])},
  {name: 'list_collection_items', description: 'Items of one collection, filtered by words (quotes, OR, -word), status (its first indexable choice or text field) and dates (its first indexable date field).',
    inputSchema: object({collection_slug: str, search: str, status: str, date_from: str, date_to: str, sort: {enum: ['recent', 'oldest', 'updated']}, limit: num}, ['collection_slug'])},
  {name: 'add_collection_item', description: 'Add an item to a collection using the field keys from get_collection_schema.', inputSchema: object({collection_slug: str, data: {type: 'object'}}, ['collection_slug', 'data'])},
  {name: 'update_collection_item', description: 'Change fields of one collection item; fields not given stay as they are.', inputSchema: object({item_id: str, data: {type: 'object'}}, ['item_id', 'data'])},
  {name: 'search_all_collections', description: 'Search every collection at once.', inputSchema: object({query: str, limit: num}, ['query'])},
];
export const memoryToolNames = memoryDefinitions.map(d => d.name);
export const memoryWriteTools = ['add_claim', 'create_moment_with_ai', 'log_interaction', 'trash_note', 'add_collection_item', 'update_collection_item'];

const norm = s => String(s ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const count = (value, low, high, fallback) => { const n = Math.floor(Number(value)); return Number.isFinite(n) ? Math.min(high, Math.max(low, n)) : fallback; };
const required = (value, what) => { const t = String(value ?? '').trim(); if (!t) throw Error('Give ' + what); return t; };
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function today({store, query}) {
  const zone = store.get('settings', 'installation')?.timezone || query.rows('profiles')[0]?.timezone || 'UTC';
  return new Intl.DateTimeFormat('en-CA', {timeZone: zone}).format(new Date());
}
const holds = (fact, day) => (!fact.valid_from || fact.valid_from <= day) && (!fact.valid_to || fact.valid_to > day);
const live = rows => rows.filter(r => !r.removed_at && !r.deleted_at);

function people(query) { return live(visibleRows(query, 'contacts')).filter(p => !p.merged_into); }
function names(p) { return [p.name, ...(Array.isArray(p.aliases) ? p.aliases : [])].filter(n => typeof n === 'string' && n.trim()).map(norm); }
// One record by id or by name. An exact name or nickname wins; several
// exact matches, or several partial ones, are refused with their ids.
function pick(rows, {id, name}, kind) {
  if (id) { const found = rows.find(r => r.id === id); if (!found) throw Error('No visible ' + kind + ' has the id ' + id); return found; }
  const n = norm(required(name, 'a name or an id'));
  let found = rows.filter(r => names(r).includes(n));
  if (!found.length) found = rows.filter(r => names(r).some(x => x.includes(n) || new RegExp('(^|\\s)' + escape(n)).test(x)));
  if (found.length === 1) return found[0];
  if (!found.length) throw Error('No ' + kind + ' is called "' + name + '"' + (kind === 'person' ? '; search_contacts lists people by part of a name.' : '.'));
  throw Error('Several ' + (kind === 'person' ? 'people' : 'things') + ' match "' + name + '"; call again with the id of the right one: '
    + found.slice(0, 12).map(r => r.name + ' (' + r.id + (r.relationship ? ', ' + r.relationship : r.entity_type ? ', ' + r.entity_type : '') + ')').join('; '));
}
function personFor(query, a) { return pick(people(query), {id: a.contact_id, name: a.name ?? a.contact_name ?? a.person_name}, 'person'); }
function entities(query) { return live(visibleRows(query, 'entities')); }

// Facts with their labels and categories, and which have two current answers.
function facts(query) {
  const rows = live(visibleRows(query, 'profile_facts')), day = new Intl.DateTimeFormat('en-CA', {timeZone: query.rows('profiles')[0]?.timezone || 'UTC'}).format(new Date());
  const groups = new Map();
  for (const f of rows) if (holds(f, day)) { const k = f.subject_type + '|' + (f.subject_id || '') + '|' + f.attribute; groups.set(k, [...(groups.get(k) || []), f]); }
  return rows.map(f => { const same = f.cardinality !== 'many' && holds(f, day) ? groups.get(f.subject_type + '|' + (f.subject_id || '') + '|' + f.attribute) || [] : []; return same.length > 1 ? {...f, two_answers: same.map(x => x.value)} : f; });
}
function subjectNames(query) {
  return new Map([...query.rows('contacts').map(p => [p.id, p.name]), ...query.rows('entities').map(e => [e.id, e.name])]);
}
const factView = (f, label) => ({id: f.id, subject: label(f), attribute: f.attribute, label: f.label || f.attribute, value: f.value, valid_from: f.valid_from || null, valid_to: f.valid_to || null,
  confidence: f.confidence || null, ...(f.category_name ? {section: f.category_name} : {}), ...(f.evidence_quote ? {evidence_quote: clip(f.evidence_quote, 300)} : {}), ...(f.source_type === 'note' && f.source_id ? {source_note_id: f.source_id} : {}),
  ...(f.two_answers ? {two_answers: f.two_answers, warning: 'TWO ANSWERS: report every value, never pick one'} : {})});
const labeler = query => { const n = subjectNames(query); return f => f.subject_type === 'self' ? 'you' : n.get(f.subject_id) || f.subject_type; };

// Notes found by a search, whatever was hit: a note, a passage read out of
// its PDF, or the description of one of its pictures.
// Mission Control's own files (world/, observations/, profile/, rules/ and the
// rest the index reads) are searched with the notes, ranked by the same
// measure: Menerio had them as copies and found them, the notebook did not
// (6 October 2026, the memory benchmark). The verbatim prompt archive and the
// assistant's state are never part of it.
export const privateFile = relative => /^(prompts|assistant-state)\//.test(String(relative));
async function noteHits(ctx, text, {limit = 50, files = true} = {}) {
  const {index, query, store} = ctx;
  const notes = new Map(live(visibleRows(query, 'notes')).filter(n => !n.is_trashed).map(n => [n.id, n]));
  const found = await index.searchHybrid(text, {limit: Math.max(limit, 50), types: ['notes', 'note_chunks', 'media_analysis', ...(files ? ['workspace_file'] : [])]});
  const out = new Map();
  for (const r of found.rows) {
    if (r.type === 'workspace_file') {
      if (privateFile(r.id) || out.has('file:' + r.id)) continue;
      out.set('file:' + r.id, {file: r.id, note: {id: r.id, title: r.id, updated_at: fileTime(store, r.id)}, full: () => { try { return fs.readFileSync(path.join(store.root, r.id), 'utf8'); } catch { return ''; } }, snippet: r.snippet ? r.snippet.replace(/[[\]]/g, '') : null, matched: r.matched || 'words', via: 'Mission Control file'});
      continue;
    }
    const id = r.type === 'notes' ? r.id : r.type === 'note_chunks' ? store.get('note_chunks', r.id)?.note_id : store.get('media_analysis', r.id)?.note_id;
    const note = id && notes.get(id);
    if (!note || out.has(id)) continue;
    const passage = r.type === 'notes' ? null : r.type === 'note_chunks' ? store.get('note_chunks', r.id)?.content : store.get('media_analysis', r.id)?.extracted_text || store.get('media_analysis', r.id)?.description;
    out.set(id, {note, full: () => passage || (note.title || '') + '\n' + (note.content || ''), snippet: r.snippet ? r.snippet.replace(/[[\]]/g, '') : passage ? clip(passage, 400) : null, matched: r.matched || 'words', via: r.type === 'notes' ? null : r.type === 'note_chunks' ? 'attached document' : 'attached picture'});
  }
  return {hits: [...out.values()], mode: found.mode, note: found.note};
}
const mirrored = n => !!n.is_external || /^godspeed\//i.test(n.folder_path || '');
function fileTime(store, relative) { try { return fs.statSync(path.join(store.root, relative)).mtime.toISOString(); } catch { return null; } }
// One Mission Control file, read whole through get_note, when the index holds it.
export function readFile(ctx, relative) {
  const name = String(relative || '').split('\\').join('/');
  if (!name || privateFile(name) || name.split('/').some(p => p === '..' || p.startsWith('.')) || !ctx.index?.db) return null;
  const known = ctx.index.db.prepare("SELECT 1 FROM docs WHERE type='workspace_file' AND id=?").get(name);
  if (!known) return null;
  try { return {id: name, title: name, source: 'Mission Control file', content: fs.readFileSync(path.join(ctx.store.root, name), 'utf8'), updated_at: fileTime(ctx.store, name)}; } catch { return null; }
}
function snippetOf(note, text) { return bestWindow(note.content, text); }
// The window of a text, about 420 characters, that holds the most of the
// asked words, as Menerio's excerpts did. A 14-word match, or none for a file
// found by meaning, was often too little to answer from (6 October 2026).
export function bestWindow(body, query, size = 420) {
  const text = String(body || '');
  if (text.length <= size) return clip(text, size);
  const words = [...new Set(norm(query).split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2 && !STOPWORDS.has(w)))];
  const lower = text.toLowerCase(), hits = [];
  for (const w of words) for (let i = lower.indexOf(w); i >= 0 && hits.length < 4000; i = lower.indexOf(w, i + w.length)) hits.push([i, w]);
  if (!hits.length) return clip(text.slice(0, size), size);
  hits.sort((a, b) => a[0] - b[0]);
  let start = hits[0][0], best = 0;
  for (let i = 0, j = 0; i < hits.length; i++) {
    while (hits[j][0] < hits[i][0] - (size - 80)) j++;
    const distinct = new Set(hits.slice(j, i + 1).map(h => h[1])).size;
    if (distinct > best) { best = distinct; start = hits[j][0]; }
  }
  start = Math.max(0, start - 60);
  return (start > 0 ? '…' : '') + clip(text.slice(start, start + size), size);
}
const excerpt = (h, text) => bestWindow(h.full ? h.full() : h.note.content, text) || h.snippet || '';
const noteBlock = (h, i, view, text) => h.file ? ['[note] --- Result ' + i + ' ---', 'Title: ' + h.file, 'ID: ' + h.file, 'Source: Mission Control file (get_note reads it whole)', ...(h.note.updated_at ? ['Updated: ' + h.note.updated_at.slice(0, 10)] : []), ...(view === 'metadata' ? [] : ['Match: ' + excerpt(h, text)])].join('\n') : ['[note] --- Result ' + i + ' ---', 'Title: ' + (h.note.title || 'Untitled'), 'ID: ' + h.note.id, 'Updated: ' + String(h.note.updated_at || '').slice(0, 10),
  ...(h.note.metadata?.type ? ['Type: ' + h.note.metadata.type] : []), ...(h.note.folder_path ? ['Folder: ' + h.note.folder_path] : []), ...(h.note.tags?.length ? ['Tags: ' + h.note.tags.join(', ')] : []),
  ...(h.via ? ['Found in: ' + h.via] : []), ...(view === 'metadata' ? [] : ['Match: ' + excerpt(h, text)])].join('\n');

async function searchBrain(a, ctx) {
  const text = required(a.query, 'words to search for'), include = Array.isArray(a.include) && a.include.length ? a.include : ['claim', 'note', 'lexicon'];
  const limit = count(a.limit, 1, 50, 10), offset = count(a.offset, 0, 1000, 0), day = isDay(a.as_of) ? a.as_of : today(ctx), threshold = Number.isFinite(Number(a.threshold)) ? Number(a.threshold) : 0.3;
  const {query, index} = ctx, parts = [];
  let claims = [], hits = [], pages = [], mode = 'words', note = null;
  // A meaning match on a short fact is only kept when it is close; word matches always are.
  const close = r => r.matched !== 'meaning' || (r.similarity ?? 1) >= threshold;
  if (include.includes('claim') && offset === 0) {
    const found = await index.searchHybrid(text, {limit: 80, types: ['claims']}), byId = new Map(facts(query).map(f => [f.id, f]));
    claims = found.rows.filter(close).map(r => byId.get(r.id)).filter(f => f && holds(f, day));
  }
  if (include.includes('note')) ({hits, mode, note} = await noteHits(ctx, text, {limit: 50}));
  if (include.includes('lexicon') && offset === 0) {
    const found = await index.searchHybrid(text, {limit: 30, types: ['wiki_pages']}), byId = new Map(live(visibleRows(query, 'wiki_pages')).map(p => [p.id, p]));
    pages = found.rows.filter(close).map(r => ({page: byId.get(r.id), snippet: r.snippet})).filter(p => p.page).slice(0, limit);
  }
  const shown = hits.slice(offset, offset + limit), label = labeler(query);
  parts.push('Found ' + claims.length + ' claim(s), ' + hits.length + ' note(s) [' + mode + '] and ' + pages.length + ' Lexicon page(s).' + (hits.length ? ' Showing notes ' + (shown.length ? offset + 1 : 0) + '-' + (offset + shown.length) + ' (has_more: ' + (offset + limit < hits.length) + ').' : '') + (note ? ' ' + note : ''));
  for (const f of claims.slice(0, limit)) parts.push('[claim] ' + label(f) + ', ' + (f.label || f.attribute) + ': ' + f.value + (f.two_answers ? '   TWO ANSWERS: ' + f.two_answers.join(' | ') : '')
    + '\n    ' + (f.valid_from ? f.valid_from + ' to ' + (f.valid_to || 'now') : 'undated') + ' · ' + (f.confidence || 'confirmed') + ' · id ' + f.id
    + (f.evidence_quote ? '\n    "' + clip(f.evidence_quote, 240) + '"' : '') + (f.source_type === 'note' && f.source_id ? '\n    from note ' + f.source_id : ''));
  shown.forEach((h, i) => parts.push(noteBlock(h, offset + i + 1, a.view, text)));
  for (const {page, snippet} of pages) parts.push('[lexicon] ' + page.title + (page.page_type ? ' (' + page.page_type + ')' : '') + ' · id ' + page.id + '\n    ' + clip(snippet ? snippet.replace(/[[\]]/g, '') : page.summary || page.content, 400));
  if (offset + limit < hits.length) parts.push('More notes: run again with offset=' + (offset + limit) + '.');
  if (claims.length > limit) parts.push((claims.length - limit) + ' more claim(s) not shown: run again with include=["claim"] and a higher limit.');
  return parts.join('\n\n');
}

const CLOSE = /partner|girlfriend|boyfriend|wife|husband|spouse|fianc|mother|father|mum|mom|dad|parent|sister|brother|sibling|son\b|daughter|child|step|grand|aunt|uncle|cousin|family|manager|boss|best friend/i;
function userProfile(a, ctx) {
  const {query} = ctx, day = today(ctx), profile = query.rows('profiles')[0] || {};
  const own = facts(query).filter(f => f.subject_type === 'self' && holds(f, day));
  const chosen = (a.detail === 'full' ? own : own.filter(f => f.is_pinned || f.show_to_agent)).filter(f => !a.categories?.length || a.categories.includes(f.category_slug))
    .filter(f => !a.scope || a.scope === 'all' || [f.category_slug, f.visibility_scope].includes(a.scope));
  const categories = new Map(query.rows('profile_categories').filter(c => !c.contact_id).map(c => [c.slug, c]));
  const sections = new Map();
  for (const f of chosen) { const slug = f.category_slug || 'other'; if (!sections.has(slug)) sections.set(slug, {name: categories.get(slug)?.name || f.category_name || 'Other', slug, entries: []}); sections.get(slug).entries.push({label: f.label || f.attribute, value: f.value, ...(f.valid_from ? {valid_from: f.valid_from} : {}), ...(f.two_answers ? {two_answers: f.two_answers} : {})}); }
  const close = people(query).filter(p => CLOSE.test(String(p.relationship || ''))).map(p => ({name: p.name, relationship: p.relationship, contact_id: p.id}));
  const instructions = a.include_instructions === false ? undefined : live(visibleRows(query, 'agent_instructions')).filter(i => i.is_active !== false).map(i => ({title: i.title || i.name || null, instruction: i.content || i.instruction || i.instructions || i.text || '', ...(i.scope ? {scope: i.scope} : {})}));
  return {profile: {name: profile.display_name || null, also_called: query.rows('user_self_aliases').map(r => r.alias).filter(Boolean), timezone: ctx.store.get('settings', 'installation')?.timezone || profile.timezone || null,
    categories: [...sections.values()], detail: a.detail === 'full' ? 'full' : 'curated', ...(a.detail === 'full' ? {} : {left_out: own.length - chosen.length + ' more facts: detail "full" or search_brain'})},
    relationships: {structured: close}, ...(instructions ? {agent_instructions: instructions} : {})};
}

function searchContacts(a, {query}) {
  const n = norm(a.query), rel = norm(a.relationship), limit = count(a.limit, 1, 100, 10);
  const rank = p => { if (!n) return 1; const all = names(p); if (all.includes(n)) return 4; if (all.some(x => x.startsWith(n))) return 3; if (all.some(x => x.includes(n))) return 2; return [p.company, p.role, p.relationship, p.email].some(v => norm(v).includes(n)) ? 1 : 0; };
  const rows = people(query).filter(p => !rel || norm(p.relationship).includes(rel)).map(p => ({p, score: rank(p)})).filter(r => r.score > 0)
    .sort((x, y) => y.score - x.score || String(y.p.last_contact_date || '').localeCompare(String(x.p.last_contact_date || '')) || x.p.name.localeCompare(y.p.name));
  return {count: rows.length, contacts: rows.slice(0, limit).map(({p}) => ({contact_id: p.id, name: p.name, ...(p.aliases?.length ? {aliases: p.aliases} : {}), relationship: p.relationship || null, company: p.company || null, role: p.role || null, last_contact_date: p.last_contact_date || null}))};
}

// Notes that are about a person: linked to them, or naming them.
function personNotes(query, person) {
  const pattern = new RegExp('(^|[^\\p{L}\\p{N}])(' + names(person).filter(n => n.length >= 3).map(escape).join('|') + ')(?=$|[^\\p{L}\\p{N}])', 'iu');
  const linked = new Set(query.rows('person_documents').filter(d => d.contact_id === person.id).map(d => d.note_id));
  return live(visibleRows(query, 'notes')).filter(n => !n.is_trashed && (linked.has(n.id) || n.contact_id === person.id || (n.metadata?.matched_people || []).some(m => m.contact_id === person.id) || names(person).some(x => x.length >= 3) && pattern.test((n.title || '') + '\n' + (n.content || ''))))
    .sort((x, y) => String(y.updated_at).localeCompare(String(x.updated_at)));
}
function momentsWith(query, person) {
  const ids = new Set(query.rows('moment_participants').filter(m => (m.person_id || m.contact_id) === person.id).map(m => m.moment_id));
  return live(visibleRows(query, 'moments')).filter(m => ids.has(m.id) || m.person_id === person.id).sort((x, y) => String(y.happened_at).localeCompare(String(x.happened_at)));
}
function contactContext(a, ctx) {
  const {query} = ctx, p = personFor(query, a), day = today(ctx), label = labeler(query), named = subjectNames(query);
  return {contact: {contact_id: p.id, name: p.name, aliases: p.aliases || [], relationship: p.relationship || null, company: p.company || null, role: p.role || null, email: p.email || null, phone: p.phone || null, last_contact_date: p.last_contact_date || null, notes: p.notes ? clip(p.notes, 2000) : null},
    open_topics: live(visibleRows(query, 'contact_topics')).filter(t => t.contact_id === p.id && t.status === 'active').map(t => ({topic_id: t.id, title: t.title, priority: t.priority || 'normal', last_discussed_at: t.last_discussed_at || null})),
    recent_interactions: live(visibleRows(query, 'contact_interactions')).filter(i => i.contact_id === p.id).sort((x, y) => String(y.interaction_date || y.created_at).localeCompare(String(x.interaction_date || x.created_at))).slice(0, 10).map(i => ({date: i.interaction_date || String(i.created_at).slice(0, 10), type: i.type || i.interaction_type || null, summary: i.summary || null})),
    facts: facts(query).filter(f => f.subject_type === 'contact' && f.subject_id === p.id && holds(f, day)).map(f => factView(f, label)),
    relationships: live(visibleRows(query, 'contact_relationships')).filter(r => [r.source_id, r.target_id].includes(p.id)).map(r => { const other = r.source_id === p.id ? r.target_id : r.source_id; return {with: named.get(other) || other, with_id: other, label: r.label || r.relationship_type || null, direction: r.source_id === p.id ? 'from' : 'to'}; }),
    timeline: momentsWith(query, p).slice(0, 10).map(m => ({moment_id: m.id, title: m.title, happened_at: m.happened_at, status: m.status})),
    related_notes: personNotes(query, p).slice(0, 12).map(n => ({note_id: n.id, title: n.title, updated: String(n.updated_at).slice(0, 10)}))};
}
function contactProfile(a, ctx) {
  const {query} = ctx, p = personFor(query, a), day = today(ctx), label = labeler(query);
  const rows = facts(query).filter(f => f.subject_type === 'contact' && f.subject_id === p.id && (a.include_history || holds(f, day)) && (a.detail === 'full' || a.include_history || f.show_to_agent !== false));
  const sections = new Map([['Contact details', [...p.aliases?.length ? [{label: 'Nicknames', value: p.aliases.join(', ')}] : [], ...['relationship', 'company', 'role', 'email', 'phone'].filter(k => p[k]).map(k => ({label: k[0].toUpperCase() + k.slice(1), value: p[k]}))]]]);
  for (const f of rows) { const s = f.category_name || 'Other'; sections.set(s, [...(sections.get(s) || []), {...factView(f, label), ...(holds(f, day) ? {} : {no_longer_true: true})}]); }
  return {contact_id: p.id, name: p.name, sections: [...sections].filter(([, list]) => list.length).map(([name, list]) => ({name, facts: list}))};
}
function getClaims(a, ctx) {
  const {query} = ctx, day = today(ctx), mode = a.mode || 'current', label = labeler(query);
  if (mode === 'changed_since' && !isDay(a.since)) throw Error('Give since as YYYY-MM-DD for mode changed_since');
  let subject = null;
  if (a.subject_type === 'contact' && (a.subject_id || a.subject_name)) subject = personFor(query, {contact_id: a.subject_id, name: a.subject_name});
  if (a.subject_type === 'entity' && (a.subject_id || a.subject_name)) subject = pick(entities(query), {id: a.subject_id, name: a.subject_name}, 'thing');
  if (!a.subject_type && a.subject_id) subject = people(query).find(p => p.id === a.subject_id) || entities(query).find(e => e.id === a.subject_id) || null;
  const attribute = norm(a.attribute).replace(/[\s-]+/g, '_');
  const rows = facts(query).filter(f => (!a.subject_type || f.subject_type === a.subject_type) && (!subject || f.subject_id === subject.id) && (!attribute || norm(f.attribute).replace(/[\s-]+/g, '_').includes(attribute) || norm(f.label).replace(/[\s-]+/g, '_').includes(attribute))
    && (mode === 'history' || (mode === 'changed_since' ? f.valid_from >= a.since || f.valid_to >= a.since : holds(f, day))))
    .sort((x, y) => String(y.valid_from || '').localeCompare(String(x.valid_from || '')));
  return {mode, count: rows.length, claims: rows.slice(0, count(a.limit, 1, 500, 100)).map(f => factView(f, label))};
}

function noteList(a, ctx) {
  const {query} = ctx, limit = count(a.limit, 1, 100, 10), since = a.days ? Date.now() - Number(a.days) * 86400000 : 0, topic = norm(a.topic), type = norm(a.type);
  let rows = live(visibleRows(query, 'notes')).filter(n => !n.is_trashed && (!since || Date.parse(n.updated_at || n.created_at) >= since) && (!type || norm(n.metadata?.type) === type)
    && (!topic || [...(n.tags || []), ...(n.metadata?.topics || [])].some(t => norm(t).includes(topic)) || norm(n.title).includes(topic)));
  if (a.person) { const p = personFor(query, {name: a.person}), about = new Set(personNotes(query, p).map(n => n.id)); rows = rows.filter(n => about.has(n.id)); }
  rows.sort((x, y) => String(y.updated_at).localeCompare(String(x.updated_at)));
  return rows.length ? rows.slice(0, limit).map((n, i) => [(i + 1) + '. ' + (n.title || 'Untitled'), '   ID: ' + n.id, '   Updated: ' + String(n.updated_at).slice(0, 10) + (n.metadata?.type ? ' · Type: ' + n.metadata.type : '') + (n.folder_path ? ' · Folder: ' + n.folder_path : ''), ...(n.tags?.length ? ['   Tags: ' + n.tags.join(', ')] : []), '   ' + clip(n.content, 200)].join('\n')).join('\n\n') : 'No notes match.';
}
function stats(ctx) {
  const {query} = ctx, notes = live(visibleRows(query, 'notes')).filter(n => !n.is_trashed), day = today(ctx), tally = list => [...list.reduce((m, k) => m.set(k, (m.get(k) || 0) + 1), new Map())].sort((x, y) => y[1] - x[1]);
  const within = days => notes.filter(n => Date.parse(n.updated_at) >= Date.now() - days * 86400000).length;
  return {notes: notes.length, by_type: Object.fromEntries(tally(notes.map(n => n.metadata?.type || 'untyped'))), top_topics: tally(notes.flatMap(n => [...new Set([...(n.tags || []), ...(n.metadata?.topics || [])].map(norm).filter(Boolean))])).slice(0, 15).map(([topic, n]) => ({topic, notes: n})),
    top_people: tally(notes.flatMap(n => [...new Set((n.metadata?.matched_people || []).map(m => m.canonical_name || m.name).filter(Boolean))])).slice(0, 15).map(([name, n]) => ({name, notes: n})),
    changed_last_7_days: within(7), changed_last_30_days: within(30), people: people(query).length, current_facts: facts(query).filter(f => holds(f, day)).length,
    timeline_entries: live(visibleRows(query, 'moments')).length, collections: live(visibleRows(query, 'collections')).length, lexicon_pages: live(visibleRows(query, 'wiki_pages')).length};
}
async function searchMoments(a, ctx) {
  const {query, index} = ctx, byId = new Map(live(visibleRows(query, 'moments')).map(m => [m.id, m])), found = await index.searchHybrid(required(a.query, 'words to search for'), {limit: 60, types: ['moments']});
  const named = subjectNames(query), parts = new Map();
  for (const m of query.rows('moment_participants')) parts.set(m.moment_id, [...(parts.get(m.moment_id) || []), named.get(m.person_id || m.contact_id)].filter(Boolean));
  return found.rows.filter(r => r.matched !== 'meaning' || (r.similarity ?? 1) >= 0.25).map(r => byId.get(r.id)).filter(Boolean).slice(0, count(a.limit, 1, 100, 20))
    .map(m => ({moment_id: m.id, title: m.title, happened_at: m.happened_at, ...(m.happened_end ? {happened_end: m.happened_end} : {}), status: m.status || null, description: m.description ? clip(m.description, 400) : null, participants: parts.get(m.id) || []}));
}
async function searchEntities(a, ctx) {
  const {query, index} = ctx, n = norm(a.query), type = norm(a.entity_type), rows = entities(query).filter(e => !type || norm(e.entity_type) === type);
  const byWords = n ? rows.filter(e => names(e).some(x => x.includes(n)) || norm(e.description).includes(n) || norm(e.entity_type).includes(n)) : rows;
  const extra = n ? (await index.searchHybrid(a.query, {limit: 30, types: ['entities']})).rows.filter(r => r.matched !== 'meaning' || (r.similarity ?? 1) >= 0.3).map(r => rows.find(e => e.id === r.id)).filter(Boolean) : [];
  return [...new Map([...byWords, ...extra].map(e => [e.id, e])).values()].slice(0, count(a.limit, 1, 100, 25)).map(e => ({entity_id: e.id, name: e.name, entity_type: e.entity_type || null, aliases: e.aliases || [], description: e.description ? clip(e.description, 400) : null}));
}
function entityContext(a, ctx) {
  const {query} = ctx, e = pick(entities(query), /^[0-9a-f-]{36}$/i.test(a.id_or_name) ? {id: a.id_or_name} : {name: a.id_or_name}, 'thing'), day = today(ctx), label = labeler(query);
  const ids = new Set(query.rows('moment_entities').filter(m => m.entity_id === e.id).map(m => m.moment_id)), pattern = names(e).filter(x => x.length >= 3);
  return {entity: {entity_id: e.id, name: e.name, entity_type: e.entity_type || null, aliases: e.aliases || [], description: e.description || null},
    facts: facts(query).filter(f => f.subject_type === 'entity' && f.subject_id === e.id && (a.include_history || holds(f, day))).map(f => factView(f, label)),
    timeline: live(visibleRows(query, 'moments')).filter(m => ids.has(m.id)).slice(0, 15).map(m => ({moment_id: m.id, title: m.title, happened_at: m.happened_at})),
    notes: live(visibleRows(query, 'notes')).filter(n => !n.is_trashed && pattern.some(x => norm((n.title || '') + ' ' + (n.content || '')).includes(x))).slice(0, 12).map(n => ({note_id: n.id, title: n.title}))};
}
async function lexiconSearch(a, ctx) {
  const {query, index} = ctx, n = norm(a.query), rows = live(visibleRows(query, 'wiki_pages')).filter(p => !a.page_type || p.page_type === a.page_type);
  const exact = rows.filter(p => norm(p.title).includes(n) || norm(p.slug).includes(n));
  const found = (await index.searchHybrid(required(a.query, 'words to search for'), {limit: 30, types: ['wiki_pages']})).rows.filter(r => r.matched !== 'meaning' || (r.similarity ?? 1) >= 0.3), snippets = new Map(found.map(r => [r.id, r.snippet]));
  return [...new Map([...exact, ...found.map(r => rows.find(p => p.id === r.id)).filter(Boolean)].map(p => [p.id, p])).values()].slice(0, count(a.limit, 1, 50, 10))
    .map(p => ({page_id: p.id, title: p.title, slug: p.slug || null, page_type: p.page_type || null, summary: p.summary ? clip(p.summary, 300) : null, match: snippets.get(p.id)?.replace(/[[\]]/g, '') || clip(p.content, 300)}));
}

// Collections, by slug.
function collectionFor(query, ref) {
  const n = norm(required(ref, 'a collection slug'));
  const found = live(visibleRows(query, 'collections')).find(c => c.slug === ref || c.id === ref) || live(visibleRows(query, 'collections')).find(c => norm(c.slug) === n || norm(c.name) === n);
  if (!found) throw Error('No collection "' + ref + '"; list_collections shows them');
  return found;
}
const itemsOf = (query, collection) => live(visibleRows(query, 'collection_items')).filter(i => i.collection_id === collection.id);
const itemView = i => ({id: i.id, item_id: i.id, title: i.title, data: i.data || {}, created_at: i.created_at, updated_at: i.updated_at});
// Web-search words: "a phrase", -excluded, and OR between alternatives.
function matcher(search) {
  const groups = String(search || '').split(/\s+OR\s+/).map(part => { const terms = [...part.matchAll(/(-?)"([^"]+)"|(-?)(\S+)/g)].map(m => ({not: !!(m[1] || m[3]), text: norm(m[2] || m[4])})).filter(t => t.text); return terms; }).filter(g => g.length);
  return text => !groups.length || groups.some(g => g.every(t => text.includes(t.text) !== t.not));
}
function checkFields(collection, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('Give data as an object of field keys and values');
  const keys = new Set((collection.field_schema || []).map(f => f.key)), unknown = Object.keys(data).filter(k => !keys.has(k));
  if (unknown.length) throw Error('Unknown field ' + unknown.join(', ') + ' in ' + collection.slug + '; its fields are ' + [...keys].join(', '));
}
function listItems(a, {query}) {
  const c = collectionFor(query, a.collection_slug), schema = c.field_schema || [], match = matcher(a.search);
  const statusField = schema.find(f => f.indexable && ['select', 'text', 'status'].includes(f.type)), dateField = schema.find(f => f.indexable && ['date', 'datetime'].includes(f.type));
  const rows = itemsOf(query, c).filter(i => match(norm(i.title + ' ' + JSON.stringify(i.data || {})))
    && (!a.status || !statusField || norm(i.data?.[statusField.key]) === norm(a.status))
    && (!dateField || ((!a.date_from || String(i.data?.[dateField.key] || '') >= a.date_from) && (!a.date_to || String(i.data?.[dateField.key] || '').slice(0, 10) <= a.date_to))));
  const key = a.sort === 'updated' ? 'updated_at' : 'created_at';
  rows.sort((x, y) => a.sort === 'oldest' ? String(x.created_at).localeCompare(String(y.created_at)) : String(y[key]).localeCompare(String(x[key])));
  // A plain list, as Menerio answered it (scripts/links.py reads it so).
  return rows.slice(0, count(a.limit, 1, 100, 20)).map(itemView);
}
async function searchCollections(a, ctx) {
  const {query, index} = ctx, collections = new Map(live(visibleRows(query, 'collections')).map(c => [c.id, c])), items = live(visibleRows(query, 'collection_items')).filter(i => collections.has(i.collection_id)), match = matcher(a.query);
  const byWords = items.filter(i => match(norm(i.title + ' ' + JSON.stringify(i.data || {}))));
  const byIndex = (await index.searchHybrid(required(a.query, 'words to search for'), {limit: 40, types: ['collection_items']})).rows.filter(r => r.matched !== 'meaning' || (r.similarity ?? 1) >= 0.3).map(r => items.find(i => i.id === r.id)).filter(Boolean);
  return [...new Map([...byWords, ...byIndex].map(i => [i.id, i])).values()].slice(0, count(a.limit, 1, 100, 20)).map(i => ({collection_slug: collections.get(i.collection_id).slug, collection: collections.get(i.collection_id).name, ...itemView(i)}));
}

// Writes go through the assistant guard (assistant-mutations.mjs): only
// visible records, and an edit names the version it read. These tools read
// the record first, as Menerio's did, so the version is the current one.
async function write(name, a, ctx, guarded) {
  const {query, store} = ctx;
  if (name === 'trash_note') {
    const note = live(visibleRows(query, 'notes')).find(n => n.id === a.note_id);
    if (!note) throw Error('No visible note has the id ' + a.note_id);
    if (a.restore) { if (!note.is_trashed) return {note_id: note.id, restored: false, message: 'The note is not in the trash'}; query.execute({table: 'notes', operation: 'update', values: {is_trashed: false, trashed_at: null}, filters: [['eq', 'id', note.id]], expected: {[note.id]: note._hash}}); return {note_id: note.id, restored: true}; }
    if (note.is_trashed) return {note_id: note.id, trashed: true, message: 'Already in the trash'};
    guarded({['notes/' + note.id]: note._hash}).query.execute({table: 'notes', operation: 'update', values: {is_trashed: true, trashed_at: new Date().toISOString()}, filters: [['eq', 'id', note.id]], expected: {[note.id]: note._hash}, assistant: true});
    return {note_id: note.id, title: note.title, trashed: true, message: 'Moved to the trash; the owner can restore it'};
  }
  if (name === 'log_interaction') {
    const p = personFor(query, {contact_id: a.contact_id, name: a.contact_name}), day = today(ctx), g = guarded({['contacts/' + p.id]: p._hash});
    let group = null;
    if (a.group_id_or_slug) { group = live(visibleRows(query, 'contact_groups')).find(x => x.id === a.group_id_or_slug || x.slug === a.group_id_or_slug); if (!group) throw Error('No group "' + a.group_id_or_slug + '"'); }
    const saved = g.query.execute({table: 'contact_interactions', operation: 'insert', values: {contact_id: p.id, interaction_date: day, type: required(a.type, 'the interaction type'), interaction_type: a.type, summary: a.summary || null, action_items: Array.isArray(a.action_items) ? a.action_items : [], ...(group ? {group_id: group.id} : {})}, assistant: true}).data;
    if (!p.last_contact_date || p.last_contact_date < day) g.query.execute({table: 'contacts', operation: 'update', values: {last_contact_date: day}, filters: [['eq', 'id', p.id]], expected: {[p.id]: p._hash}, assistant: true});
    return {interaction_id: (Array.isArray(saved) ? saved[0] : saved)?.id, contact_id: p.id, name: p.name, date: day, last_contact_date: day};
  }
  if (name === 'add_claim') {
    if (a.valid_to) throw Error('add_claim records what is true now; valid_to is not accepted');
    const quote = String(a.evidence_quote || '').trim();
    if (quote.length < 10) throw Error('Give evidence_quote: the exact sentence the fact came from, at least 10 characters');
    const value = required(a.value, 'the value'), attribute = norm(required(a.attribute, 'the attribute')).replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '');
    if (a.valid_from && !isDay(a.valid_from)) throw Error('Give valid_from as YYYY-MM-DD');
    const type = a.subject_type || 'self';
    const subject = type === 'contact' ? personFor(query, {contact_id: a.subject_id, name: a.subject_name}) : type === 'entity' ? pick(entities(query), {id: a.subject_id, name: a.subject_name}, 'thing') : null;
    const subjectId = subject?.id || null, day = a.valid_from || today(ctx);
    const same = query.rows('claims').filter(c => c.subject_type === type && (c.subject_id || null) === subjectId && c.attribute === attribute), slot = query.rows('fact_slots').find(s => s.subject_type === type && (s.subject_id || null) === subjectId && s.attribute === attribute);
    const typed = same.filter(c => holds(c, day) && /^user/.test(c.origin || '') && norm(c.value) !== norm(value));
    if (typed.length && (slot?.cardinality || 'one') !== 'many') {
      const proposal = guarded({}).query.execute({table: 'review_queue', operation: 'insert', values: {title: attribute.replace(/_/g, ' ') + ': ' + value, suggestion_type: 'add_claim', status: 'pending_review', origin: 'ai', description: quote, source_note_id: a.source_note_id || null,
        payload: {label: a.attribute, value, attribute, subject_type: type, subject_id: subjectId, ...(type === 'contact' ? {contact_id: subjectId} : {}), source_type: a.source_note_id ? 'note' : 'assistant', source_id: a.source_note_id || null, valid_from: a.valid_from || null}}, assistant: true}).data;
      return {outcome: 'waiting_for_review', review_id: (Array.isArray(proposal) ? proposal[0] : proposal)?.id, message: 'The owner typed "' + typed.map(c => c.value).join('", "') + '" himself, so the new value waits in his Review instead of replacing it'};
    }
    const expected = Object.fromEntries([...same, ...(slot ? [slot] : [])].map(r => [r.type + '/' + r.id, r._hash]));
    const result = guarded(expected).domains.writeFact({subject_type: type, ...(type === 'contact' ? {contact_id: subjectId} : type === 'entity' ? {entity_id: subjectId} : {}), attribute, label: a.attribute, value, valid_from: a.valid_from, evidence_quote: quote,
      source_type: a.source_note_id ? 'note' : 'assistant', source_id: a.source_note_id || null, origin: 'assistant'});
    const fact = result.facts?.[0] || {};
    return {outcome: fact.outcome, claim_id: fact.claimId || null, closed_earlier_values: fact.closed || 0, subject: subject ? subject.name : 'you', attribute, value};
  }
  if (name === 'create_moment_with_ai') {
    const description = required(a.description, 'a description'), all = people(query), day = today(ctx);
    const hints = [a.title_hint && 'Title: ' + a.title_hint, a.happened_at && 'Date: ' + a.happened_at, a.status_hint && 'Status: ' + a.status_hint, a.category_hint && 'Category: ' + a.category_hint,
      (a.participant_names?.length || a.person_name) && 'People: ' + [...(a.participant_names || []), ...(a.person_name ? [a.person_name] : [])].join(', ')].filter(Boolean).join('\n');
    let draft = {};
    if (ctx.domains.provider) draft = (await ctx.domains.invoke('draft-event', {messages: [{role: 'user', content: description + (hints ? '\n\n' + hints : '')}], today: day, people: all.map(p => ({name: p.name}))}))?.draft || {};
    else if (!a.happened_at || !a.title_hint) throw Error('No model is connected to work out the title and date; give title_hint and happened_at');
    const d = momentDraft({...draft, ...(a.happened_at ? {happened_at: a.happened_at} : {}), ...(a.status_hint ? {status: a.status_hint} : {}), ...(a.impact_level_hint ? {impact_level: a.impact_level_hint} : {}),
      ...(a.confidence_date_hint !== undefined ? {confidence_date: a.confidence_date_hint} : {}), ...(a.confidence_truth_hint !== undefined ? {confidence_truth: a.confidence_truth_hint} : {}),
      participants: [...(Array.isArray(draft.participants) ? draft.participants : []), ...(a.participant_names || []), ...(a.person_name ? [a.person_name] : [])]});
    const title = String(a.title_hint || draft.title || '').trim();
    if (!title || !d.happened_at) throw Error('Could not tell the ' + (title ? 'date' : 'title') + ' of this entry; give ' + (title ? 'happened_at as YYYY-MM-DD' : 'title_hint'));
    const found = [], unknown = [];
    for (const n of d.participants) { try { const p = pick(all, {name: n}, 'person'); if (!found.some(x => x.id === p.id)) found.push(p); } catch { unknown.push(n); } }
    const g = guarded({});
    const moment = g.query.execute({table: 'moments', operation: 'insert', values: {title, description, happened_at: d.happened_at, happened_end: d.happened_end, status: d.status, impact_level: d.impact_level, confidence_date: d.confidence_date, confidence_truth: d.confidence_truth,
      person_id: found[0]?.id || null, category: a.category_hint || draft.category || null, source: 'assistant'}, assistant: true}).data;
    const saved = Array.isArray(moment) ? moment[0] : moment;
    for (const p of found) g.query.execute({table: 'moment_participants', operation: 'insert', values: {moment_id: saved.id, person_id: p.id}, assistant: true});
    return {moment_id: saved.id, title, happened_at: d.happened_at, ...(d.happened_end ? {happened_end: d.happened_end} : {}), status: d.status, participants: found.map(p => p.name), ...(unknown.length ? {not_in_people: unknown} : {})};
  }
  if (name === 'add_collection_item') {
    const c = collectionFor(query, a.collection_slug); checkFields(c, a.data);
    if (!Object.values(a.data).some(v => v !== null && v !== '' && !(Array.isArray(v) && !v.length))) throw Error('Give at least one value');
    const saved = guarded({}).query.execute({table: 'collection_items', operation: 'insert', values: {collection_id: c.id, data: a.data}, assistant: true}).data, item = Array.isArray(saved) ? saved[0] : saved;
    return {item_id: item.id, collection_slug: c.slug, title: query.rows('collection_items').find(i => i.id === item.id)?.title || null};
  }
  if (name === 'update_collection_item') {
    const item = live(visibleRows(query, 'collection_items')).find(i => i.id === a.item_id);
    if (!item) throw Error('No visible collection item has the id ' + a.item_id);
    const c = store.get('collections', item.collection_id); checkFields(c, a.data);
    guarded({['collection_items/' + item.id]: item._hash}).query.execute({table: 'collection_items', operation: 'update', values: {data: {...item.data, ...a.data}}, filters: [['eq', 'id', item.id]], expected: {[item.id]: item._hash}, assistant: true});
    return {item_id: item.id, collection_slug: c.slug, updated: Object.keys(a.data)};
  }
  throw Error('Unknown tool');
}

export async function memoryTool(name, a, ctx, guarded) {
  if (memoryWriteTools.includes(name)) return write(name, a, ctx, guarded);
  const {query} = ctx;
  if (name === 'search_brain') return searchBrain(a, ctx);
  if (name === 'search_moments') return searchMoments(a, ctx);
  if (name === 'search_entities') return searchEntities(a, ctx);
  if (name === 'lexicon_search') return lexiconSearch(a, ctx);
  if (name === 'search_all_collections') return searchCollections(a, ctx);
  return query.withSnapshot(() => {
    if (name === 'get_user_profile') return userProfile(a, ctx);
    if (name === 'search_contacts') return searchContacts(a, ctx);
    if (name === 'get_contact_context') return contactContext(a, ctx);
    if (name === 'get_contact_profile') return contactProfile(a, ctx);
    if (name === 'get_person_notes') { const p = personFor(query, a); return personNotes(query, p).slice(0, count(a.limit, 1, 100, 20)).map(n => ({note_id: n.id, title: n.title, updated: String(n.updated_at).slice(0, 10), preview: clip(n.content, 200)})); }
    if (name === 'get_claims') return getClaims(a, ctx);
    if (name === 'list_recent_notes' || name === 'list_recent') return noteList(a, ctx);
    if (name === 'get_stats') return stats(ctx);
    if (name === 'get_entity_context') return entityContext(a, ctx);
    if (name === 'list_collections') return live(visibleRows(query, 'collections')).map(c => ({name: c.name, slug: c.slug, description: c.description || null, icon: c.icon || null, visibility: c.visibility || null, agent_instructions: c.agent_instructions || null, item_count: itemsOf(query, c).length}));
    if (name === 'get_collection_schema') { const c = collectionFor(query, a.slug); return {name: c.name, slug: c.slug, description: c.description || null, field_schema: c.field_schema || [], agent_instructions: c.agent_instructions || null}; }
    if (name === 'list_collection_items') return listItems(a, ctx);
    throw Error('Unknown tool');
  });
}

// Notes found for search_notes: the same search as search_brain's notes.
export async function searchNotes(a, ctx) {
  const text = required(a.query, 'words to search for'), limit = count(a.limit, 1, 50, 20), offset = count(a.offset, 0, 1000, 0);
  const {hits} = await noteHits(ctx, text, {limit: 50});
  return hits.filter(h => a.source === 'native' ? !h.file && !mirrored(h.note) : a.source === 'godspeed' ? h.file || mirrored(h.note) : true).slice(offset, offset + limit)
    .map(h => h.file ? {id: h.file, title: h.file, folder_path: path.posix.dirname(h.file), updated_at: h.note.updated_at, source: 'Mission Control file', ...(a.view === 'metadata' ? {} : {snippet: excerpt(h, text)})} : ({id: h.note.id, title: h.note.title, folder_path: h.note.folder_path || '', updated_at: h.note.updated_at, tags: h.note.tags || [], type: h.note.metadata?.type || null, _hash: h.note._hash, ...(a.view === 'metadata' ? {} : {snippet: excerpt(h, text)}), ...(h.via ? {found_in: h.via} : {})}));
}
export function relatedTo(ctx, note) {
  try { return relatedNotes(ctx.query, note, {index: ctx.index, limit: 5}).map(r => ({id: r.id, title: r.title})); } catch { return []; }
}
