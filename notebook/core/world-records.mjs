// THE TOOLS' WAY INTO THE WORLD'S CLAIMS (#90, second slice).
//
// tools/holds.js and tools/check-built-on.js are CommonJS programs that used to read and write
// world/claims/*.md. The claims are notebook records now (world-copy.mjs takes the old files in),
// and these are the few things those programs ask of them, so that no tool re-implements how a
// claim is found, named or written.
import fs from 'node:fs';
import path from 'node:path';
import { Store } from './records/store.mjs';
import { writable, dayOf } from './due-copy.mjs';
import { COPY_TYPE, oldFiles, subjectOfSlug } from './world-copy.mjs';
import { takeInOldWorld } from './world-retire.mjs';

const slugify = text => String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Another program writing this moment (the notebook, another tool) holds the lock the store takes
// when it opens; that is waited out for a few seconds, never reported as an unreadable notebook.
function openStore(root, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { return new Store(root); } catch (error) {
      if (error.code !== 'WRITER_BUSY' || Date.now() >= deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 + Math.floor(Math.random() * 25));
    }
  }
}

// The workspace's store, after the old files a version on another machine wrote have been taken in.
// Work left undone here is done by the next run, and is never the reason a tool fails. A store the
// caller hands in is the notebook's own, which takes them in when it starts.
export function openWorld(root, given = null) {
  if (given) return given;
  const own = openStore(root);
  const waiting = oldFiles(root).length || own.list(COPY_TYPE).some(r => r.file && fs.existsSync(path.join(root, ...r.file.split('/'))));
  if (writable(own) && waiting) { try { takeInOldWorld(own, { day: dayOf(own) }); } catch { /* the next run takes them in */ } }
  return own;
}

// A claim as the tools read it. `subject` is the slug the old file named; a claim the notebook
// wrote has the slug of its entity, or its own name made into one. `name` is what a person types
// to point at the claim (the old file's name).
export function claimRows(store) {
  const things = new Map(store.list('entities').map(e => [e.id, e])), people = new Map(store.list('contacts').map(c => [c.id, c]));
  const slugOf = c => c.subject_slug || (c.subject_type === 'self' ? 'me' : slugify(c.subject_type === 'entity' ? things.get(c.subject_id)?.slug || things.get(c.subject_id)?.name : people.get(c.subject_id)?.name));
  return store.list('claims').filter(c => !c.removed_at).map(c => ({
    id: c.id, uid: c.uid, name: c.source_id ? path.basename(String(c.source_id)).replace(/\.md$/, '') : c.id,
    subject: slugOf(c), attribute: String(c.attribute || ''), value: String(c.value ?? ''), valid_from: c.valid_from || '', valid_to: c.valid_to || '',
    origin: c.origin || '', stance: c.stance || '', steps: Array.isArray(c.steps) ? c.steps : [], until: c.until || '', untilName: c.until_name || '',
  }));
}

const locked = (store, work) => store.holding ? work() : store.withLock(work);

// A hold, written as a claim about the slug's entity (or person, or the owner).
export function writeHold(store, { subject, stance, words, steps, until, untilName, to, attribute, day }) {
  return locked(store, () => {
    const names = new Set(claimRows(store).map(c => c.name));
    let name = `${subject}--${attribute}--${day}`;
    for (let n = 2; names.has(name); n++) name = `${subject}--${attribute}--${day}-${n}`;
    const { subject: who, records } = subjectOfSlug(store, subject);
    const claim = store.prepare('claims', { subject_type: who.type, subject_id: who.id, subject_slug: subject, attribute, value: words, stance,
      ...(steps.length ? { steps } : {}), ...(until ? { until, until_name: untilName } : {}), valid_from: day, valid_to: to || null, confidence: 'certain', cardinality: 'many',
      evidence_quote: words, source_type: 'mc-holds', source_id: name, origin: 'mission control' });
    const slot = store.list('fact_slots').some(s => s.subject_type === who.type && s.subject_id === who.id && s.attribute === attribute) ? []
      : [store.prepare('fact_slots', { name: attribute, subject_type: who.type, subject_id: who.id, contact_id: who.type === 'contact' ? who.id : null, attribute,
        label: attribute, cardinality: 'many', show_to_agent: true, is_pinned: false })];
    store.commit([...records, claim, ...slot]);
    return { name, id: claim.id, uid: claim.uid };
  });
}

// A claim ended on `day`, with what the person said kept as its evidence. Returns what it found
// instead of throwing, so the tool can say it in its own words.
export function endClaim(store, ref, { day, words }) {
  return locked(store, () => {
    const found = claimRows(store).find(c => c.name === ref || c.id === ref || c.uid === ref);
    if (!found) return { missing: true };
    if (found.origin.toLowerCase() === 'menerio') return { found, menerio: true };
    if (found.valid_to && found.valid_to <= day) return { found, ended: found.valid_to };
    const claim = store.get('claims', found.id);
    store.commit([store.prepare('claims', { valid_to: day, closure_evidence: { source_type: 'mc-holds', source_id: found.name, quote: words } }, claim)]);
    return { found };
  });
}
