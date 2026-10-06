import {visibleRows} from './visibility.mjs';
import {queryWords} from './index/search.mjs';

// Related notes, the people a note names and its actions: what the note's
// Connections panel, its Suggested Links and the dashboard's daily connection
// show. Read-only: nothing here files a review item. Until 6 October 2026
// "Find connections" on one note compared every person with every note of the
// notebook and filed a "Link X to Y" review item for each name it found, one
// save at a time; on the real notebook that held the server for minutes and
// filed more than a thousand items, and the panel could not read the answer.
const STOP = new Set(('the and for with that this from have has had was were are you your our their they them then than into about over under after before when what which while where there here been being also only just more most some such very will would could should can not but all any each other one two '
  + 'der die das und oder mit von für auf aus bei ist sind war waren wird werden ein eine einer eines einem einen nicht auch noch nur sich sie ihr ihre wir uns mein meine dein deine sein seine hat haben hatte dass wenn dann als wie was wer wo zum zur über unter nach vor durch schon sehr mehr').split(' '));
const plain = text => String(text || '').replace(/<[^>]+>/g, ' ').replace(/!?\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, ' $1 ').replace(/[#*_`>~\[\]()]/g, ' ');

// The words that say what a note is about: its title's words and its most
// frequent longer words, without the common ones.
export function keyTerms(note, limit = 12) {
  const counts = new Map(), add = (word, weight) => { const w = word.toLowerCase(); if (w.length < 4 || STOP.has(w) || /^\d+$/.test(w)) return; counts.set(w, (counts.get(w) || 0) + weight); };
  for (const word of queryWords(plain(note.title))) add(word, 3);
  for (const word of [...plain(note.content).matchAll(/[\p{L}\p{N}]+/gu)].slice(0, 20000).map(m => m[0])) add(word, 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([word]) => word);
}

// Notes most like this one. With the search index: its key terms, any of
// them, ranked by BM25. Without one (a bare test fixture): shared key terms.
export function relatedNotes(query, note, {index, limit = 6} = {}) {
  const terms = keyTerms(note);
  if (!terms.length) return [];
  const notes = new Map(visibleRows(query, 'notes').filter(n => !n.is_trashed && n.id !== note.id).map(n => [n.id, n]));
  let ranked = [];
  if (index?.searchAny) ranked = index.searchAny(terms, {types: ['notes'], limit: limit * 4}).filter(r => notes.has(r.id)).map(r => ({note: notes.get(r.id), score: -r.rank, snippet: r.snippet}));
  else {
    const mine = new Set(terms);
    ranked = [...notes.values()].map(n => ({note: n, score: keyTerms(n, 30).filter(t => mine.has(t)).length})).filter(r => r.score > 0).sort((a, b) => b.score - a.score);
  }
  const best = ranked[0]?.score || 1;
  return ranked.slice(0, limit).map(({note: n, score, snippet}) => ({id: n.id, title: n.title, similarity: Math.max(0.05, Math.min(1, score / best)), metadata: n.metadata || null, created_at: n.created_at, ...(snippet ? {snippet} : {})}));
}

// People a note names, by name or alias as a whole word, never the owner.
export function namedPeople(query, note) {
  const text = ' ' + plain(note.title + ' ' + note.content).toLowerCase() + ' ';
  const self = new Set(query.rows('user_self_aliases').filter(a => a.is_active !== false).map(a => String(a.alias || '').toLowerCase()));
  const matched = new Set((note.metadata?.matched_people || []).map(m => m.contact_id).filter(Boolean));
  const found = [];
  for (const person of visibleRows(query, 'contacts')) {
    if (person.merged_into || person.removed_at) continue;
    const names = [person.name, ...(person.aliases || [])].filter(n => typeof n === 'string' && n.trim().length >= 3 && !self.has(n.trim().toLowerCase()));
    const hit = matched.has(person.id) || names.some(name => new RegExp('(^|[^\\p{L}\\p{N}])' + name.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\p{L}\\p{N}])', 'u').test(text));
    if (hit) found.push({id: person.id, name: person.name, relationship: person.relationship || null});
  }
  return found.slice(0, 12);
}

export function noteConnections(query, note, {index} = {}) {
  const actions = query.rows('action_items').filter(a => (a.source_note_id === note.id || a.note_id === note.id) && a.status !== 'dismissed');
  return {connections: relatedNotes(query, note, {index}), related_contacts: namedPeople(query, note), related_actions: actions.slice(0, 10).map(a => ({id: a.id, content: a.content || a.title || '', status: a.status || 'open'})), insight: null};
}

// Notes worth a [[link]] from this one: related, and not linked yet.
export function linkSuggestions(query, note, {index} = {}) {
  const content = String(note.content || ''), linked = new Set(query.rows('note_connections').filter(c => c.source_note_id === note.id).map(c => c.target_note_id));
  const dismissed = new Set(query.rows('dismissed_suggestions').filter(d => d.note_id === note.id || d.source_note_id === note.id).map(d => d.target_note_id || d.suggested_note_id));
  const terms = new Set(keyTerms(note));
  return relatedNotes(query, note, {index, limit: 8})
    .filter(r => !linked.has(r.id) && !dismissed.has(r.id) && !content.includes(r.id) && !content.includes('[[' + r.title))
    .map(r => {const other = visibleRows(query, 'notes').find(n => n.id === r.id), shared = keyTerms(other || {}, 30).filter(t => terms.has(t)).slice(0, 4);
      return {note_id: r.id, note_title: r.title, reason: shared.length ? 'Both are about ' + shared.join(', ') : 'Similar words', suggested_context: r.snippet ? r.snippet.replace(/[[\]]/g, '') : '', similarity: r.similarity};})
    .slice(0, 6);
}
