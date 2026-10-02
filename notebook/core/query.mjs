import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { slug } from './records/store.mjs';

const inventory = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../docs/full-version/source-inventory.json', import.meta.url)), 'utf8'));
export const tables = new Set(inventory.dependencies.flatMap(d => d.tables).filter(t => t !== 'note-attachments'));
for (const table of ['goals', 'jobs', 'job_receipts', 'settings', 'permissions', 'decisions', 'habits', 'journal', 'deadlines', 'comments', 'note_conversations', 'import_mappings']) tables.add(table);
const views = new Set(['world_entities', 'world_events', 'world_claims', 'profile_facts', 'v_ai_allowance_current']);
const defaults = {
  contacts: { notes: null, app_mappings: {}, merged_into: null, is_favorite: false, is_sensitive: false, last_viewed_at: null },
  entities: { description: null, entity_type: 'other', ai_visibility: 'visible', is_sensitive: false },
  collections: { field_schema: [], visibility: 'personal', icon: null, description: null, agent_instructions: null, settings: {} },
  collection_items: { data: {}, is_favorite: false, folder_id: null, last_viewed_at: null },
  profile_categories: { contact_id: null, sort_order: 0, visibility_scope: 'personal', icon: 'User' },
  claims: { subject_type: 'self', subject_id: null, valid_to: null, valid_from: null, confidence: 'confirmed', cardinality: 'one', source_type: 'manual', origin: 'manual' },
  fact_slots: { subject_type: 'self', subject_id: null, contact_id: null, category_slug: null, show_to_agent: true, is_pinned: false, cardinality: 'one' },
  review_queue: { status: 'pending_review', payload: {}, is_sensitive: false, applied_at: null, blocked_at: null, snoozed_until: null, reviewed_at: null, source_note_id: null },
  moments: { description: null, happened_end: null, person_id: null, category: null, status: 'confirmed', ai_visibility: 'visible', participants: [], metadata: {} },
  contact_relationships: { status: 'confirmed', confidence: 'confirmed', valid_to: null, metadata: {} },
  profiles: { display_name: 'Owner', timezone: 'UTC', preferences: {} },
};
const links = { contact_id: 'contacts', person_id: 'contacts', note_id: 'notes', source_note_id: 'notes', linked_note_id: 'notes',
  collection_id: 'collections', folder_id: 'collection_item_folders', moment_id: 'moments', entity_id: 'entities',
  from_contact_id: 'contacts', to_contact_id: 'contacts', parent_folder_id: 'collection_item_folders', claim_id: 'claims', slot_id: 'fact_slots', category_id: 'profile_categories', group_id: 'contact_groups' };
function getValue(row, key) { return key.replaceAll('->>', '.').replaceAll('->', '.').split('.').reduce((v, k) => v?.[k], row); }
function contains(a, b) { return Array.isArray(b) ? b.every(v => (a || []).includes(v)) : b && typeof b === 'object' ? Object.entries(b).every(([k, v]) => contains(a?.[k], v)) : a === b; }
function condition(row, [op, key, value]) {
  const a = getValue(row, key);
  switch (op) {
    case 'eq': return a === value; case 'neq': return a !== value;
    case 'is': return value === null ? a == null : a === value;
    case 'in': return value.includes(a); case 'contains': return contains(a, value);
    case 'overlaps': return (a || []).some(x => value.includes(x));
    case 'gt': return a > value; case 'gte': return a >= value; case 'lt': return a < value; case 'lte': return a <= value;
    case 'like': case 'ilike': {
      const expression = String(value).split('').map(c => c === '%' ? '.*' : c === '_' ? '.' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
      return new RegExp('^' + expression + '$', op === 'ilike' ? 'i' : '').test(String(a ?? ''));
    }
    case 'not': return !condition(row, [value[0], key, value[1]]);
    case 'or': return String(value).split(/,(?![^()]*\))/).some(part => {
      const [field, operator, ...tail] = part.split('.'); let val = tail.join('.');
      if (val === 'null') val = null; else if (val === 'true' || val === 'false') val = val === 'true';
      return condition(row, [operator, field, val]);
    });
    default: throw new Error('Unsupported filter ' + op);
  }
}
export class QueryService {
  constructor(store) { this.store = store; }
  rows(table) {
    const list = type => this.store.list(type);
    if (table === 'world_entities') return [...list('contacts').map(r => ({ ...r, source_table: 'contact', kind: 'person', description: r.notes || null, ai_visibility: r.ai_visibility || 'visible' })), ...list('entities').map(r => ({ ...r, source_table: 'entity', kind: r.entity_type }))];
    if (table === 'world_events') return list('moments').map(r => ({ ...r, source_table: 'moment' }));
    if (table === 'world_claims') return list('claims').map(r => {
      const subject = r.subject_type === 'contact' ? this.store.get('contacts', r.subject_id) : r.subject_type === 'entity' ? this.store.get('entities', r.subject_id) : null;
      return { ...r, subject_name: subject?.name || 'Me', subject_kind: r.subject_type === 'contact' ? 'person' : subject?.entity_type || 'self' };
    });
    if (table === 'profile_facts') return list('claims').map(r => {
      const slot = list('fact_slots').find(s => s.subject_type === r.subject_type && s.subject_id === r.subject_id && s.attribute === r.attribute);
      const category = list('profile_categories').find(s => s.slug === slot?.category_slug && (s.contact_id || null) === (r.subject_type === 'contact' ? r.subject_id : null));
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: list('profiles')[0]?.timezone || 'UTC' }).format(new Date());
      return { ...r, claim_id: r.id, contact_id: r.subject_type === 'contact' ? r.subject_id : null, is_current: (!r.valid_to || r.valid_to > today) && (!r.valid_from || r.valid_from <= today),
        slot_id: slot?.id || null, label: slot?.label || r.attribute, category_slug: slot?.category_slug || null, category_name: category?.name || null,
        visibility_scope: category?.visibility_scope || 'personal', show_to_agent: slot?.show_to_agent ?? true, is_pinned: slot?.is_pinned ?? false, has_conflict: false };
    });
    if (table === 'v_ai_allowance_current') return [];
    return list(table).map(r => ({ ...(defaults[table] || {}), ...r }));
  }
  references(type, value) {
    const refs = [...(value.references || [])].filter(r => !r.field);
    for (const [key, target] of Object.entries(links)) if (value[key]) {
      const record = this.store.get(target, value[key]); refs.push({ type: target, id: value[key], ...(record ? { uid: record.uid } : {}), field: key });
    }
    if (value.subject_id && ['contact', 'entity'].includes(value.subject_type)) {
      const target = value.subject_type === 'contact' ? 'contacts' : 'entities', record = this.store.get(target, value.subject_id);
      refs.push({ type: target, id: value.subject_id, ...(record ? { uid: record.uid } : {}), field: 'subject_id' });
    }
    return [...new Map(refs.map(r => [(r.field || '') + '/' + r.type + '/' + r.id, r])).values()];
  }
  execute(request) {
    const { table, operation = 'select', values, filters = [], orders = [], selection = '*', options = {}, single = false, maybeSingle = false, expected = {} } = request;
    if (!tables.has(table)) throw new Error('Unknown record domain ' + table);
    let rows = this.rows(table).filter(row => filters.every(f => condition(row, f)));
    if (operation !== 'select') {
      if (views.has(table)) throw new Error('Derived views are read-only');
      rows = this.store.withLock(() => {
        const inputs = operation === 'insert' || operation === 'upsert' ? (Array.isArray(values) ? values : [values]) : rows;
        const changed = inputs.map(value => {
          const old = operation === 'insert' ? null : operation === 'upsert' ? (value.id ? this.store.get(table, value.id) : this.rows(table).find(r => options.onConflict && options.onConflict.split(',').every(k => r[k] === value[k]))) : this.store.get(table, value.id);
          if (operation === 'insert' && value.id && this.store.get(table, value.id)) throw new Error('Record already exists');
          if (old && expected[old.id] && expected[old.id] !== old._hash) { const error = new Error('Record changed; reload before saving'); error.code = 'CONFLICT'; throw error; }
          if (table === 'moments' && old && operation !== 'delete') throw new Error('Timeline events are append-only; add a correction');
          const payload = operation === 'delete' ? { removed_at: new Date().toISOString() } : operation === 'update' ? values : value;
          const record = this.store.prepare(table, { ...(defaults[table] || {}), ...old, ...payload }, old);
          if (table === 'collections' && !record.slug) record.slug = slug(record.name);
          record.references = this.references(table, record); return record;
        });
        this.store.commit(changed); return changed;
      });
    }
    const count = rows.length;
    if (orders.length) rows.sort((a, b) => { for (const [key, settings = {}] of orders) { const av = getValue(a, key), bv = getValue(b, key); if (av === bv) continue; const n = av == null ? (settings.nullsFirst ? -1 : 1) : bv == null ? (settings.nullsFirst ? 1 : -1) : av < bv ? -1 : 1; return settings.ascending === false ? -n : n; } return 0; });
    if (request.range) rows = rows.slice(request.range[0], request.range[1] + 1);
    if (request.limit !== undefined) rows = rows.slice(0, request.limit);
    // Preserve observed joined shapes without a second source of truth.
    rows = rows.map(r => {
      const result = { ...r, _hash: this.store.get(table, r.id)?._hash || r._hash };
      if (selection.includes('source_note:')) result.source_note = r.source_note_id ? this.store.get('notes', r.source_note_id) : null;
      if (selection.includes('notes(')) result.notes = r.note_id ? this.store.get('notes', r.note_id) : null;
      if (selection.includes('contacts(')) result.contacts = r.contact_id ? this.store.get('contacts', r.contact_id) : null;
      return result;
    });
    if (single && rows.length !== 1) throw new Error('Expected one record');
    if (maybeSingle && rows.length > 1) throw new Error('Ambiguous record query');
    return { data: options.head ? null : single || maybeSingle ? rows[0] || null : rows, count, error: null };
  }
  rpc(name, args = {}) {
    if (name === 'capture_note_with_lexicon') return this.store.save('notes', { ...args._note, user_id: 'owner' });
    if (name === 'search_contacts_page') {
      const query = String(args.search_text || '').toLowerCase(), all = this.rows('contacts').filter(r => !r.merged_into && r.id !== args.exclude_contact_id && [r.name, ...r.aliases].some(n => n.toLowerCase().includes(query))).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      const after = all.filter(r => !args.after_id || r.name > args.after_name || (r.name === args.after_name && r.id > args.after_id));
      const rows = after.slice(0, args.page_size || 50), last = rows.at(-1); return { rows, total: all.length, next: after.length > rows.length ? { name: last.name, id: last.id } : null };
    }
    if (name === 'notes_mentioning_people') return this.rows('notes').filter(r => (args.names || args.p_names || []).some(n => (r.content || '').toLowerCase().includes(n.toLowerCase())));
    throw new Error('Unimplemented RPC: ' + name);
  }
}
