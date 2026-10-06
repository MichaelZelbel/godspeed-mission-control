import {hash} from './records/store.mjs';
import {visibleRows} from './visibility.mjs';

// Automatic processing of new and changed notes, as Menerio did: a captured
// note gets its tags, type, topics, summary and people, and proposals (facts,
// moments, new people) go to the review queue. It runs on the one machine that
// runs the routines (settings/installation.owner), one note at a time, after a
// quiet period since the last edit, under a daily limit. Notes from before
// processing started (the 1,753 Menerio processed) are never touched.
// Until 6 October 2026 this was not ported: a note was processed only from the
// note's own menu, and the screens' sweep call failed silently.
export const PIPELINE = 'analysis';
const DEFAULTS = {enabled: true, daily_limit: 40, quiet_minutes: 2, min_chars: 30, retry_minutes: 30, max_attempts: 3};
export const contentFingerprint = note => hash([String(note.title || ''), String(note.content || '')]);
const jobId = noteId => 'analysis-' + hash(noteId).slice(0, 24);
const today = (timezone, at = new Date()) => new Intl.DateTimeFormat('en-CA', {timeZone: timezone || 'UTC'}).format(at);

export function processingSettings(store) {
  const saved = store.get('settings', 'processing');
  return {...DEFAULTS, ...(saved || {}), saved: !!saved};
}
export function jobFor(query, noteId) { return query.rows('note_ai_jobs').find(j => j.note_id === noteId && (j.pipeline || PIPELINE) === PIPELINE) || null; }

// Records what happened to a note's processing, for the note's status line
// and so the same text is never processed twice.
export function recordJob(store, query, note, patch) {
  const old = jobFor(query, note.id);
  return store.save('note_ai_jobs', {id: old?.id || jobId(note.id), note_id: note.id, pipeline: PIPELINE, user_id: 'owner', references: [{type: 'notes', id: note.id, uid: note.uid, field: 'note_id'}], ...patch});
}

export class NoteProcessing {
  constructor({store, query, domains, device}) { this.store = store; this.query = query; this.domains = domains; this.device = device; this.status = {state: 'idle', last_run: null, last_error: null, processed_today: 0}; }
  owner() { return this.store.get('settings', 'installation')?.owner || null; }
  // Notes waiting, oldest edit first; ready means past the quiet period.
  candidates(settings = processingSettings(this.store), now = Date.now()) {
    const quiet = now - settings.quiet_minutes * 60000, jobs = new Map(this.query.rows('note_ai_jobs').filter(j => (j.pipeline || PIPELINE) === PIPELINE).map(j => [j.note_id, j]));
    return visibleRows(this.query, 'notes').filter(n => !n.is_trashed && !n.removed_at && n.ai_visibility !== 'hidden' && String(n.updated_at || '') >= settings.since && String(n.content || '').trim().length + String(n.title || '').trim().length >= settings.min_chars)
      .map(n => ({note: n, job: jobs.get(n.id), fingerprint: contentFingerprint(n)}))
      .filter(({job, fingerprint}) => !job || job.fingerprint !== fingerprint && !(job.state === 'failed' && job.desired_fingerprint === fingerprint && (job.attempts || 0) >= settings.max_attempts))
      .filter(({job}) => !job?.next_eligible_at || Date.parse(job.next_eligible_at) <= now)
      .map(c => ({...c, ready: Date.parse(c.note.updated_at) <= quiet}))
      .sort((a, b) => String(a.note.updated_at).localeCompare(String(b.note.updated_at)));
  }
  // The screens' sweep: say what waits; nothing is paid for here.
  sweep() {
    const settings = processingSettings(this.store);
    if (!settings.since) return {queued: 0, waiting: 0, runner: this.owner(), note: 'Processing starts on the machine that runs the routines.'};
    const waiting = this.candidates(settings);
    return {queued: waiting.filter(c => c.ready).length, waiting: waiting.length, runner: this.owner(), daily_limit: settings.daily_limit};
  }
  async tick({now = Date.now()} = {}) {
    if (this.running) return null;
    if (this.owner() && this.owner() !== this.device) return {skipped: 'another machine runs the routines'};
    let settings = processingSettings(this.store);
    // The first run on the runner sets the start: what came before is Menerio's.
    if (!settings.saved) { await this.store.saveAsync('settings', {id: 'processing', ...DEFAULTS, since: new Date(now).toISOString()}); settings = processingSettings(this.store); }
    if (!settings.enabled) return {skipped: 'processing is switched off'};
    if (!this.domains.provider) { this.status = {...this.status, state: 'waiting for a model'}; return {skipped: 'no model connected'}; }
    const timezone = this.store.get('settings', 'installation')?.timezone, day = today(timezone, new Date(now));
    const doneToday = this.query.rows('note_ai_jobs').filter(j => j.automatic && j.day === day && ['completed', 'failed'].includes(j.state)).length;
    this.status.processed_today = doneToday;
    if (doneToday >= settings.daily_limit) { this.status.state = 'daily limit reached'; return {skipped: 'daily limit reached', limit: settings.daily_limit}; }
    const next = this.candidates(settings, now).find(c => c.ready);
    if (!next) { this.status.state = 'idle'; return {processed: 0}; }
    this.running = true;
    const {note, fingerprint, job} = next, attempts = job?.desired_fingerprint === fingerprint ? (job.attempts || 0) + 1 : 1;
    try {
      recordJob(this.store, this.query, note, {state: 'running', desired_fingerprint: fingerprint, attempts, automatic: true, day, execution_started_at: new Date(now).toISOString(), last_error: null});
      await this.domains.invoke('process-note', {note_id: note.id, reason: 'automatic'});
      recordJob(this.store, this.query, note, {state: 'completed', fingerprint, desired_fingerprint: fingerprint, attempts, automatic: true, day, last_error: null, next_eligible_at: null});
      this.status = {...this.status, state: 'idle', last_run: new Date().toISOString(), last_error: null, processed_today: doneToday + 1};
      return {processed: 1, note_id: note.id};
    } catch (error) {
      const later = new Date(now + settings.retry_minutes * 60000 * attempts).toISOString();
      try { recordJob(this.store, this.query, note, {state: attempts >= settings.max_attempts ? 'failed' : 'pending', desired_fingerprint: fingerprint, attempts, automatic: true, day, last_error: String(error.message).slice(0, 300), next_eligible_at: attempts >= settings.max_attempts ? null : later}); } catch {}
      this.status = {...this.status, state: 'idle', last_run: new Date().toISOString(), last_error: error.message};
      return {processed: 0, failed: note.id, error: error.message};
    } finally { this.running = false; }
  }
}
