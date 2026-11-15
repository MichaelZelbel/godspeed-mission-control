import {visibleRows} from './visibility.mjs';
import {relatedNotes, keyTerms} from './related.mjs';

// The note graph: what the Note Graph screen and a note's Local graph draw.
// Worked out when asked, from the notes themselves: the [[links]] written in
// them, the notes most like each one (related.mjs, as a note's Connections
// panel shows them) and the people they name. Nothing is stored and nothing
// runs in the background; the browser lays it out while the screen is open.
//
// Menerio stored its edges, and 92% of them only said that two notes named
// the same person (98,759 of its owner's 107,530 on 8 October 2026), which
// drew one tangle. Here a person is one node, and each note naming them
// points to it.

// The note types the graph screens colour and filter by; any other is drawn as a plain note.
const NODE_TYPES = new Set(['observation', 'idea', 'task', 'meeting_note', 'decision', 'person_note', 'project', 'reference', 'daily_note', 'note']);
const LINK = /\[\[([^[\]\n]{1,200})\]\]/g;
const key = value => String(value || '').trim().toLowerCase();
const slugKey = value => key(value).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const newest = (a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''));

// What a note's [[links]] name: "Title", "Title|shown words" and
// "Title#heading" all name Title. Brackets around code (a workflow's JSON
// holds [[{"node": ...}]]) are not links.
export function linkTargets(content) {
  const out = new Set();
  for (const match of String(content || '').matchAll(LINK)) {
    const target = match[1].split('|')[0].split('#')[0].trim();
    if (target && !/[{}"<>]/.test(target)) out.add(target);
  }
  return [...out];
}

// The notes a graph may show: untrashed, without the files mirrored from a
// mission control unless asked, and without the ones hidden from the
// assistant unless asked (the owner's own screen may show them).
function notePool(query, {hidden, godspeed}) {
  return (hidden ? query.rows('notes') : visibleRows(query, 'notes')).filter(n => !n.is_trashed && (godspeed || n.source_app !== 'godspeed'));
}

// The people notes name, by name or alias as a whole word, never the owner.
// A name two people share names neither of them.
function peopleFinder(query, {hidden}) {
  const self = new Set(query.rows('user_self_aliases').filter(a => a.is_active !== false).map(a => key(a.alias)));
  const people = (hidden ? query.rows('contacts') : visibleRows(query, 'contacts')).filter(p => !p.merged_into && !p.removed_at);
  const byId = new Map(people.map(p => [p.id, p])), byName = new Map(), shared = new Set();
  for (const person of people) for (const name of [person.name, ...(person.aliases || [])]) {
    const k = key(name);
    if (typeof name !== 'string' || k.length < 3 || self.has(k)) continue;
    if (byName.has(k) && byName.get(k).id !== person.id) shared.add(k); else byName.set(k, person);
  }
  for (const k of shared) byName.delete(k);
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  const pattern = names.length ? new RegExp('(?<![\\p{L}\\p{N}])(?:' + names.map(escape).join('|') + ')(?![\\p{L}\\p{N}])', 'gu') : null;
  return {
    byId, byName,
    named(note) {
      const found = new Set((note.metadata?.matched_people || []).map(m => m?.contact_id).filter(id => byId.has(id)));
      if (pattern) for (const match of key(note.title + '\n' + String(note.content || '').replace(LINK, ' ')).matchAll(pattern)) found.add(byName.get(match[0]).id);
      return [...found];
    },
  };
}

// Every [[link]] between the pool's notes (and from a note to a person it
// links by name), plus the links the note editor stored for links it
// resolved by id. A link to a note outside the pool, or to nothing, is left out.
function linkGraph(query, notes, people) {
  const byTitle = new Map(), bySlug = new Map(), ids = new Set(notes.map(n => n.id));
  for (const note of [...notes].sort(newest)) {
    const title = key(note.title);
    if (title && !byTitle.has(title)) byTitle.set(title, note.id);
    const slug = slugKey(note.title);
    if (slug && !bySlug.has(slug)) bySlug.set(slug, note.id);
  }
  const resolve = target => byTitle.get(key(target)) || bySlug.get(slugKey(target)) || (people.byName.has(key(target)) ? 'contact:' + people.byName.get(key(target)).id : null);
  const edges = new Map(), adjacent = new Map();
  const add = (from, to) => {
    if (!to || from === to || edges.has(from + '>' + to)) return;
    edges.set(from + '>' + to, {id: 'link:' + from + ':' + to, source: from, target: to, type: 'manual_link', strength: 1, metadata: {}});
    for (const [a, b] of [[from, to], [to, from]]) { if (!adjacent.has(a)) adjacent.set(a, new Set()); adjacent.get(a).add(b); }
  };
  for (const note of notes) for (const target of linkTargets(note.content)) add(note.id, resolve(target));
  for (const row of query.rows('note_connections')) if (row.connection_type === 'manual_link' && ids.has(row.source_note_id) && ids.has(row.target_note_id)) add(row.source_note_id, row.target_note_id);
  return {edges: [...edges.values()], adjacent};
}

const noteNode = n => ({id: n.id, title: n.title || 'Untitled', type: NODE_TYPES.has(n.metadata?.type) ? n.metadata.type : 'note', topics: Array.isArray(n.metadata?.topics) ? n.metadata.topics : [], tags: n.tags || [], created_at: n.created_at});
const personNode = p => ({id: 'contact:' + p.id, title: p.name, type: 'person_note', topics: [], tags: [], created_at: p.created_at});

// The drawn notes most like each one, among themselves: the key terms they
// share (related.mjs keyTerms), each weighted by how rare it is among them,
// at least two shared. Asking the search index once per note, as a note's
// Connections panel does, took 20 ms a note: four seconds for 200 notes on
// the real notebook (8 October 2026). This takes milliseconds.
export function similarAmong(notes, perNote = 5) {
  const terms = new Map(notes.map(n => [n.id, new Set(keyTerms(n, 20))])), holders = new Map(), common = Math.max(3, notes.length * 0.2);
  for (const [id, set] of terms) for (const t of set) { if (!holders.has(t)) holders.set(t, []); holders.get(t).push(id); }
  const found = new Map();
  for (const [id, set] of terms) {
    const score = new Map(), shared = new Map();
    for (const t of set) {
      const with_ = holders.get(t);
      if (with_.length > common) continue;
      const weight = Math.log(notes.length / with_.length) + 0.5;
      for (const other of with_) if (other !== id) { score.set(other, (score.get(other) || 0) + weight); shared.set(other, (shared.get(other) || 0) + 1); }
    }
    const ranked = [...score].filter(([other]) => shared.get(other) >= 2).sort((a, b) => b[1] - a[1]).slice(0, perNote), best = ranked[0]?.[1] || 1;
    found.set(id, ranked.map(([other, s]) => ({id: other, similarity: Math.max(0.05, Math.min(1, s / best))})));
  }
  return found;
}

// Edges between the chosen nodes: links, then the closest related notes that
// are not linked already, then a note to each person it names. A person is
// drawn when a note links them, when the centre note names them, or when at
// least two of the drawn notes do; one name in one note would only add clutter.
function assemble(chosen, people, links, related, {center = null} = {}) {
  const shown = new Map(chosen.map(n => [n.id, n])), edges = links.edges.filter(e => shown.has(e.source) && (shown.has(e.target) || e.target.startsWith('contact:')));
  const paired = new Set(edges.map(e => [e.source, e.target].sort().join('|')));
  for (const note of chosen) for (const other of related.get(note.id) || []) {
    const pair = [note.id, other.id].sort().join('|');
    if (!shown.has(other.id) || paired.has(pair)) continue;
    paired.add(pair);
    edges.push({id: 'related:' + pair, source: note.id, target: other.id, type: 'semantic', strength: other.similarity, metadata: {similarity: other.similarity}});
  }
  const mentions = new Map();
  for (const note of chosen) for (const id of people.named(note)) { if (!mentions.has(id)) mentions.set(id, []); mentions.get(id).push(note.id); }
  const linkedPeople = new Set(edges.filter(e => e.target.startsWith('contact:')).map(e => e.target.slice(8)));
  for (const [id, noteIds] of mentions) {
    if (noteIds.length < 2 && !linkedPeople.has(id) && !(center && noteIds.includes(center))) continue;
    for (const noteId of noteIds) if (!paired.has(noteId + '|contact:' + id)) {
      paired.add(noteId + '|contact:' + id);
      edges.push({id: 'mentions:' + noteId + ':' + id, source: noteId, target: 'contact:' + id, type: 'mentions_person', strength: 0.6, metadata: {via_person_id: id, via_person_name: people.byId.get(id)?.name || ''}});
    }
  }
  const personIds = new Set(edges.filter(e => e.target.startsWith('contact:')).map(e => e.target.slice(8)));
  return {nodes: [...chosen.map(noteNode), ...[...personIds].map(id => people.byId.get(id)).filter(Boolean).map(personNode)], edges};
}

export function graphData(query, input = {}, {index} = {}) {
  // One consistent reading of the notebook for the whole answer.
  return query.withSnapshot(() => build(query, input, index));
}

function build(query, input, index) {
  const godspeed = input.include_godspeed === true;
  // A note's own Local graph is the owner's screen: a note hidden from the
  // assistant still shows its neighbourhood.
  const center = input.note_id ? query.rows('notes').find(n => n.id === input.note_id && !n.is_trashed) : null;
  if (input.note_id && !center) throw new Error('This note is not available for the graph');
  const hidden = input.include_hidden === true || (center && !visibleRows(query, 'notes').some(n => n.id === center.id));
  const notes = notePool(query, {hidden, godspeed: godspeed || center?.source_app === 'godspeed'});
  const pool = new Map(notes.map(n => [n.id, n])), people = peopleFinder(query, {hidden}), links = linkGraph(query, notes, people);
  if (!center) {
    // The whole graph: the most linked notes first, then the newest, up to the limit.
    const limit = Math.max(1, Math.min(1000, Number(input.limit) || 200)), degree = new Map(notes.map(n => [n.id, [...(links.adjacent.get(n.id) || [])].filter(id => pool.has(id) || id.startsWith('contact:')).length]));
    const chosen = [...notes].sort((a, b) => degree.get(b.id) - degree.get(a.id) || newest(a, b)).slice(0, limit);
    return assemble(chosen, people, links, similarAmong(chosen, chosen.length > 300 ? 3 : 5));
  }
  // One note's neighbourhood: what it links and what links it, and its
  // closest notes in the whole notebook (the search index, as its Connections
  // panel shows them); a second step does the same for up to 15 of those.
  const hops = Math.max(1, Math.min(2, Number(input.hops) || 2)), cap = 60, chosen = new Map([[center.id, center]]), closest = new Map();
  let frontier = [center];
  for (let hop = 0; hop < hops && chosen.size < cap; hop++) {
    const next = [];
    for (const note of frontier.slice(0, hop ? 15 : 1)) {
      const around = [...(links.adjacent.get(note.id) || [])].filter(id => pool.has(id)).map(id => pool.get(id));
      const near = relatedNotes(query, note, {index, limit: hop ? 3 : 6, pool});
      closest.set(note.id, near);
      for (const other of [...around, ...near.map(r => pool.get(r.id))]) {
        if (!other || chosen.has(other.id) || chosen.size >= cap) continue;
        chosen.set(other.id, other); next.push(other);
      }
    }
    frontier = next;
  }
  const notesShown = [...chosen.values()], among = similarAmong(notesShown, 3);
  return assemble(notesShown, people, links, new Map(notesShown.map(n => [n.id, closest.get(n.id) || among.get(n.id) || []])), {center: center.id});
}
