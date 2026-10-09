import {visibleRows} from '../core/visibility.mjs';
import {assistantRecordTables} from '../core/assistant-mutations.mjs';

// What an assistant calls a record type is the type save_record writes. On
// 9 October 2026 an assistant asked to make a collection called save_record with
// type "collection", was told "save_record cannot write collection records. Use
// the tool made for them", found no such tool and told the reader collections
// could not be made. The singular, a capital or a space names the same type.
const extra = {person: 'contacts', people: 'contacts', persons: 'contacts', thing: 'entities', things: 'entities', event: 'moments', events: 'moments', timeline: 'moments', review: 'review_queue', reviews: 'review_queue', suggestion: 'review_queue', suggestions: 'review_queue', review_suggestion: 'review_queue', folder: 'note_folders', folders: 'note_folders'};
const singular = table => table.endsWith('ies') ? table.slice(0, -3) + 'y' : table.endsWith('s') ? table.slice(0, -1) : null;
const names = new Map(Object.entries(extra));
for (const table of assistantRecordTables) { names.set(table, table); const one = singular(table); if (one && !names.has(one)) names.set(one, table); }
export function recordType(type) {
  const plain = String(type ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return names.get(plain) || plain;
}

// The same person saved twice was two pages ("Jo Okafor" and "Jo Okafor 2",
// 9 October 2026), and later facts went to whichever a search found first. A new
// person whose name, or a nickname, a visible page already carries (case and
// spacing aside) is that page, unless the caller says it is someone else.
const sameName = s => String(s ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, '');
export function existingPerson(query, value) {
  const name = sameName(value?.name);
  if (!name) return null;
  return visibleRows(query, 'contacts').find(p => !p.removed_at && !p.deleted_at && !p.merged_into && !p.is_trashed
    && [p.name, ...(Array.isArray(p.aliases) ? p.aliases : [])].some(n => typeof n === 'string' && sameName(n) === name)) || null;
}
export function samePersonAnswer(person) {
  return {...person, already_in_notebook: true,
    message: person.name + ' already has a page in the notebook, so no second page was made; this is that page. Add what is new to it: a fact with add_claim, other details with save_record with its id and _hash. Only if this is a different person with the same name, call save_record again with same_name_is_another_person: true.'};
}

// A new collection's columns, as an assistant names them from the person's words
// ("columns for the name, the dose, the time of day"), become its field_schema:
// each a key made from its label the way the notebook's own column editor makes
// one, text unless a known type is given, the first column the item's title.
const TYPES = new Set(['text', 'longtext', 'number', 'date', 'datetime', 'boolean', 'select', 'multiselect', 'currency', 'url', 'email', 'phone', 'link_note', 'link_person', 'link_collection_item']);
const TYPE_WORDS = {string: 'text', str: 'text', long_text: 'longtext', textarea: 'longtext', paragraph: 'longtext', int: 'number', integer: 'number', float: 'number', decimal: 'number', numeric: 'number', bool: 'boolean', checkbox: 'boolean', yes_no: 'boolean', choice: 'select', enum: 'select', status: 'select', choices: 'multiselect', tags: 'multiselect', money: 'currency', link: 'url', person: 'link_person', note: 'link_note'};
const keyOf = label => String(label ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'field';
export function collectionShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Give the collection as an object with a name and its columns');
  if (!String(value.name ?? '').trim()) throw Error('A new collection needs a name');
  const given = value.field_schema ?? value.fields ?? value.columns;
  const {fields: _fields, columns: _columns, ...rest} = value;
  if (given === undefined) return rest;
  if (!Array.isArray(given)) throw Error('Give the collection\'s columns as a list, such as field_schema: [{"label": "Name"}, {"label": "Dose"}]');
  const used = new Set();
  const schema = given.map(entry => {
    const field = typeof entry === 'string' ? {label: entry} : entry && typeof entry === 'object' ? {...entry} : {};
    const label = String(field.label ?? field.name ?? field.key ?? '').trim();
    if (!label) throw Error('Every column needs a label');
    let key = field.key ? String(field.key) : keyOf(label), n = 2;
    while (used.has(key)) key = (field.key ? String(field.key) : keyOf(label)) + '_' + n++;
    used.add(key);
    const raw = String(field.type ?? 'text').toLowerCase().trim().replace(/[\s-]+/g, '_'), type = TYPES.has(raw) ? raw : TYPE_WORDS[raw] || 'text';
    const options = Array.isArray(field.options) ? field.options.filter(o => typeof o === 'string' && o.trim()) : null;
    const {name: _name, ...kept} = field;
    return {...kept, key, label, type, ...(options ? {options} : {}), ...(field.primary === true ? {primary: true} : {})};
  });
  if (schema.length && !schema.some(f => f.primary)) schema[0].primary = true;
  for (const f of schema.filter(f => f.primary).slice(1)) delete f.primary;
  return {...rest, field_schema: schema};
}
