// Runs the shipped suggestion cases (cases.json): each in a fresh notebook holding the case's facts,
// people and timeline, its note saved version by version and processed after each save as the
// automatic processing does, and the Review queue checked at the end against the case's `expect`.
// The answers come from `provider` (a live model, scripts/suggestion-cases.mjs) or from the answers
// recorded in the case (test/suggestion-cases.test.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store} from '../../core/records/store.mjs';
import {QueryService} from '../../core/query.mjs';
import {Domains} from '../../core/domains.mjs';
import {sameIndex} from '../../core/same-thing.mjs';

export const CASES_FILE = fileURLToPath(new URL('./cases.json', import.meta.url));
export const readCases = () => JSON.parse(fs.readFileSync(CASES_FILE, 'utf8'));
const WAITING = new Set(['pending', 'pending_review']);
const json = answer => typeof answer === 'string' ? JSON.parse(answer.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')) : answer;

// The notebook's records as a list the same-thing index reads (core/suggestion-filter.mjs knownRecords).
const recordsOf = query => ({claims: query.rows('claims'), moments: query.rows('moments'), participants: query.rows('moment_participants'), contacts: query.rows('contacts'),
  selfNames: query.rows('user_self_aliases').map(a => a.alias), relationships: query.rows('contact_relationships'), documents: query.rows('person_documents')});

// What the queue holds, measured: suggestions that repeat what the notebook held before the case's
// note was processed, suggestions that repeat another queued one, and counts by kind.
export function measure(queued, before) {
  const known = sameIndex(before), seen = sameIndex({}), out = {known: 0, repeats: 0, facts_about_owner: 0, moments: 0, people: 0, queued: queued.length, details: []};
  for (const r of queued) {
    const item = {...r, type: r.suggestion_type}, thing = known.read(item);
    if (known.known.find(thing)) { out.known++; out.details.push('repeats a record: ' + r.title); }
    else if (seen.match(item)) { out.repeats++; out.details.push('repeats a queued one: ' + r.title); }
    seen.remember(item);
    if (thing.kind === 'fact' && thing.subject === 'self') out.facts_about_owner++;
    if (r.suggestion_type === 'add_moment') out.moments++;
    if (r.suggestion_type === 'add_contact') out.people++;
  }
  return out;
}
export function judge(expect, got) {
  const failures = [];
  for (const [key, want] of Object.entries(expect || {})) {
    const have = got[key];
    if (typeof want === 'number' ? have !== want : want.max !== undefined && have > want.max || want.min !== undefined && have < want.min) failures.push(key + ' is ' + have + ', expected ' + JSON.stringify(want));
  }
  return failures;
}

export async function runCase(c, {owner, provider = null, answers = 'current', onAnswer = null, rewrite = null} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-case-'));
  try {
    const store = new Store(root), query = new QueryService(store), domains = new Domains(query);
    store.save('profiles', {id: 'owner', display_name: owner.name, timezone: 'UTC'});
    for (const alias of owner.aliases || []) store.save('user_self_aliases', {alias, is_active: true});
    const people = new Map();
    for (const p of c.people || []) people.set(p.name, store.save('contacts', {name: p.name, aliases: p.aliases || []}));
    // Many other facts first, as on a notebook in use: the earlier request showed the model only its first 80.
    for (let i = 0; i < (c.filler_facts || 0); i++) domains.writeFact({label: 'Fictional fact ' + (i + 1), attribute: 'fictional_fact_' + (i + 1), value: 'Value ' + (i + 1)});
    for (const f of c.facts || []) domains.writeFact({...(f.about ? {contact_id: people.get(f.about).id} : {}), label: f.label, attribute: f.attribute, value: f.value});
    for (const m of c.moments || []) store.save('moments', {title: m.title, happened_at: m.happened_at, status: 'past_fact'});
    const before = recordsOf(query), recorded = c.answers?.[answers] || c.answers?.earlier || [], errors = [];
    let note = null;
    for (const [n, version] of c.versions.entries()) {
      note = note ? store.save('notes', {id: note.id, title: version.title, content: version.content}) : store.save('notes', {title: version.title, content: version.content, folder_path: version.folder || ''});
      domains.provider = async input => {
        if (input.kind !== 'process-note') throw new Error('Unexpected model call ' + input.kind);
        if (!provider) { if (!recorded[n]) throw new Error('No recorded answer for version ' + (n + 1)); return recorded[n]; }
        const answer = await provider(rewrite ? rewrite(input, query) : input);
        onAnswer?.(n, json(answer));
        return answer;
      };
      try { await domains.invoke('process-note', {note_id: note.id, reason: 'automatic'}); }
      catch (error) { errors.push('version ' + (n + 1) + ': ' + error.message); }
    }
    const queued = query.rows('review_queue').filter(r => WAITING.has(r.status || 'pending_review'));
    const got = measure(queued, before), failures = [...errors, ...judge(c.expect, got)];
    return {id: c.id, passed: !failures.length, failures, got, queued: queued.map(r => r.suggestion_type + ': ' + r.title)};
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
}
