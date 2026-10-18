import {visibleRows} from './visibility.mjs';
import {keyTerms} from './related.mjs';

// What a group's briefing, member suggestions and next step are given: the
// group, its members as people, their open topics and recent interactions, and
// the notes that name them, within a budget. Until 6 October 2026 these sent
// every person and the whole text of every note (about 40 MB for the real
// notebook), which no model accepts: the briefing failed with "HTTP 400".
// Everything here is read as the assistant may see it (visibility.mjs).
const BUDGET = 90000;
const cut = (text, n) => {const s = String(text || ''); return s.length > n ? s.slice(0, n) + '…' : s;};
const person = p => ({id: p.id, name: p.name, aliases: p.aliases || [], relationship: p.relationship || null, company: p.company || null, role: p.role || p.job_title || null, about: cut(p.notes, 300)});
const mentions = (note, people) => {const text = (note.title + ' ' + note.content).toLowerCase(); return people.filter(p => [p.name, ...(p.aliases || [])].some(n => typeof n === 'string' && n.trim().length >= 3 && text.includes(n.toLowerCase())));};

export function groupContext(query, group, {membership = null, periodDays = 30, forSuggestions = false, index = null} = {}) {
  const people = visibleRows(query, 'contacts').filter(p => !p.merged_into), byId = new Map(people.map(p => [p.id, p]));
  const members = query.rows('contact_group_memberships').filter(m => m.group_id === group.id && byId.has(m.contact_id));
  const focus = membership ? members.filter(m => m.id === membership.id) : members, focusIds = new Set(focus.map(m => m.contact_id));
  const since = new Date(Date.now() - periodDays * 86400000).toISOString();
  const context = {
    group: {id: group.id, name: group.name, type: group.group_type || group.type || null, description: cut(group.description, 2000), purpose: cut(group.purpose, 1000), stages: group.stages || [], success_criteria: group.success_criteria || []},
    members: members.map(m => ({membership_id: m.id, contact_id: m.contact_id, name: byId.get(m.contact_id)?.name, status: m.status, position: m.position, reason: cut(m.notes || m.reason, 300), last_movement_at: m.last_movement_at || null})),
    people: focus.map(m => person(byId.get(m.contact_id))),
    topics: visibleRows(query, 'contact_topics').filter(t => focusIds.has(t.contact_id) && !t.archived_at && t.status !== 'completed').slice(0, 200).map(t => ({contact_id: t.contact_id, title: t.title, priority: t.priority, last_discussed_at: t.last_discussed_at})),
    interactions: visibleRows(query, 'contact_interactions').filter(i => focusIds.has(i.contact_id) && String(i.occurred_at || i.created_at || '') >= since).slice(-200).map(i => ({contact_id: i.contact_id, at: i.occurred_at || i.created_at, kind: i.interaction_type || i.type || null, summary: cut(i.summary || i.notes || i.content, 400)})),
    notes: []
  };
  let used = JSON.stringify(context).length;
  const notes = visibleRows(query, 'notes').filter(n => !n.is_trashed).sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  const focusPeople = focus.map(m => byId.get(m.contact_id));
  for (const note of notes) {
    const named = mentions(note, focusPeople);
    if (!named.length) continue;
    const entry = {id: note.id, title: note.title, updated_at: note.updated_at, people: named.map(p => p.id), text: cut(note.content, 1500)};
    const size = JSON.stringify(entry).length; if (used + size > BUDGET) break;
    context.notes.push(entry); used += size;
  }
  if (forSuggestions) {
    // Candidates: people not yet in the group, the closest to what it is about first.
    const terms = new Set(keyTerms({title: group.name, content: [group.description, group.purpose].join(' ')}, 20));
    const score = p => keyTerms({title: p.name, content: [p.notes, p.company, p.role, p.relationship].join(' ')}, 30).filter(t => terms.has(t)).length;
    context.candidates = [];
    for (const p of people.filter(p => !members.some(m => m.contact_id === p.id)).map(p => ({p, s: score(p)})).sort((a, b) => b.s - a.s).map(x => x.p)) {
      const entry = person(p), size = JSON.stringify(entry).length; if (used + size > BUDGET) break;
      context.candidates.push(entry); used += size;
    }
  }
  return context;
}
