import { randomUUID } from 'node:crypto';
import {procedureKinds} from './kinds.mjs';
import {nextCalendarRun} from './calendar.mjs';
import {hash} from '../records/store.mjs';
export const kinds = ['goal-decision', 'goal-work', 'habit-check', 'coaching', 'deadline-reminder', 'profiling', 'review', 'morning-brief', 'audit', 'memory-review', 'watch',...procedureKinds];
export class Scheduler {
  constructor(store, { device = store.device, executor = null } = {}) { this.store = store; this.device = device; this.executor = executor; this.running = false; }
  configure({ owner = this.device, timezone, goal, delivery = 'notebook', permissions = [] }) {
    const requestedTimezone=timezone;
    const existing = this.store.get('settings', 'installation');
    if (!goal?.trim()&&!existing) throw new Error('Name one goal to start');
    const firstGoal=existing&&!this.store.list('goals').length&&goal?.trim();
    if(existing){owner=existing.owner;timezone=firstGoal&&requestedTimezone?requestedTimezone:existing.timezone;delivery=existing.delivery;permissions=existing.permissions||[];}
    timezone||=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';new Intl.DateTimeFormat('en', { timeZone: timezone });
    const at = new Date().toISOString();
    return this.store.withLock(() => {
      const records = [(!existing||firstGoal&&requestedTimezone)&&this.store.prepare('settings', { id: 'installation', owner, timezone, delivery, permissions },existing),
        !this.store.get('profiles','owner')&&this.store.prepare('profiles', { id: 'owner', display_name: 'Owner', timezone }),
        goal?.trim()&&!this.store.list('goals').some(g=>g.title===goal.trim())&&this.store.prepare('goals', { title: goal.trim(), own_words:goal.trim(), status: 'adopted', areas: ['health','work-money','relationships'], progress: [] }),
        this.store.prepare('jobs', { id: 'goal-decision', kind: 'goal-decision', owner, paused: false, next_run: at, interval_ms: 86400000, state: 'pending' }),
        this.store.prepare('jobs', { id: 'goal-work', kind: 'goal-work', owner, paused: false, next_run: at, interval_ms: 86400000, state: 'pending' }),
        this.store.prepare('jobs', { id: 'deadline-reminder', kind: 'deadline-reminder', owner, paused: false, next_run: at, interval_ms: 3600000, state: 'pending' }),
        ...[['coaching',604800000],['profiling',86400000],['review',604800000]].map(([kind,interval_ms])=>this.store.prepare('jobs',{id:kind,kind,owner,paused:false,next_run:new Date(Date.parse(at)+interval_ms).toISOString(),interval_ms,state:'pending'}))];
      const missing=records.filter(Boolean).filter(r=>!this.store.get(r.type,r.id)||r.type==='settings'&&firstGoal&&requestedTimezone);
      this.store.commit(missing); return { configured: true, preserved:!!existing, firstWorkPending: true };
    });
  }
  transfer(owner) {
    const setting = this.store.get('settings','installation'); if(!setting)throw new Error('Complete setup first');
    return this.store.withLock(()=>this.store.commit([this.store.prepare('settings',{owner},setting),...this.store.list('jobs').map(j=>this.store.prepare('jobs',{owner},j))]));
  }
  async tick(now = Date.now()) {
    if (this.running) return [];
    this.running = true; this.onProgress?.();const results = [];
    try {
      let settings = this.store.get('settings','installation');
      if (!settings || settings.owner !== this.device) return [];
      // A decision may finish after the worker's daily slot. Ready authorized
      // work gets the next tick; pauses and uncertain attempts remain intact.
      const worker=this.store.get('jobs','goal-work');
      if(worker&&!worker.paused&&worker.state==='pending'&&worker.owner===this.device&&Date.parse(worker.next_run)>now){
        const ready=this.store.list('work_items').some(w=>(w.state==='pending'||w.state==='failed'&&w.kind==='draft'&&w.attempts<(w.max_attempts||3)&&Date.parse(w.retry_after)<=now)&&((w.kind==='draft'&&w.allowed_action==='save-draft')||(w.kind==='local-note'&&w.allowed_action==='write-local-note'))&&['adopted','active'].includes(this.store.get('goals',w.goal_id)?.status)&&this.store.get('decisions',w.decision_id)?.state==='selected'&&(w.dependencies||[]).every(id=>this.store.get('work_items',id)?.state==='verified'));
        if(ready){await this.store.waitForWriter();this.store.withLock(()=>{const current=this.store.get('jobs',worker.id);if(current?._hash===worker._hash)this.store.commit([this.store.prepare('jobs',{next_run:new Date(now).toISOString()},current)]);});}
      }
      for (const snapshot of this.store.list('jobs')) {
        settings=this.store.get('settings','installation');
        if(!settings||settings.owner!==this.device)break;
        const job=this.store.get('jobs',snapshot.id);if(!job)continue;
        if (job.owner !== this.device || job.paused || Date.parse(job.next_run) > now || job.state === 'awaiting_approval') continue;
        const receiptId = job.id + '-' + String(Date.parse(job.next_run));
        const previous = this.store.get('job_receipts', receiptId);
        if (previous) {
          // Never replay an uncertain side effect. An interrupted attempt stays visible.
          if(previous.state==='attempted'&&previous.pid&&Date.parse(previous.started_at)>Date.now()-600000){try{process.kill(previous.pid,0);continue;}catch{}}
          this.store.save('jobs',{id:job.id,state:previous.state==='verified'?'pending':'needs_review',paused:previous.state!=='verified',next_run:nextCalendarRun(job,settings.timezone,now)}); continue;
        }
        const approval=job.approval_id?this.store.get('approvals',job.approval_id):null;
        if (job.outward && (!approval||approval.status!=='approved'||approval.payload_hash!==hash(job.payload)||approval.job_id!==job.id)) {
          this.store.save('jobs',{id:job.id,state:'awaiting_approval'});results.push({id:job.id,state:'awaiting_approval'});continue;
        }
        const receipt=this.store.withLock(()=>{
          const current=this.store.get('jobs',job.id),owner=this.store.get('settings','installation');
          if(!current||owner?.owner!==this.device||current.owner!==this.device||current.paused||current._hash!==job._hash||this.store.get('job_receipts',receiptId))return null;
          const permission=current.approval_id?this.store.get('approvals',current.approval_id):null;
          if(current.outward&&(!permission||permission.status!=='approved'||permission.payload_hash!==hash(current.payload)||permission.job_id!==current.id))return null;
          const r=this.store.prepare('job_receipts',{id:receiptId,job_id:job.id,kind:job.kind,state:'attempted',pid:process.pid,started_at:new Date(now).toISOString(),attempt_id:randomUUID()});this.store.commit([r]);return r;
        });
        if(!receipt)continue;this.onProgress?.();
        try {
          if (!this.executor) throw new Error('No assistant runtime configured');
          const result=await this.executor(job,{settings,store:this.store});
          if(!result?.verified)throw new Error('The executor returned no verified result');
          if(settings.delivery==='telegram'&&!result.silent){if(!this.deliver)throw new Error('Configure the candidate Telegram connector before choosing chat delivery');await this.deliver(receipt.id,result);}
          this.store.save('job_receipts',{id:receipt.id,state:'verified',result,finished_at:new Date().toISOString()});
          this.store.withLock(()=>{const current=this.store.get('jobs',job.id);if(current) this.store.commit([this.store.prepare('jobs',{state:'pending',last_outcome:'verified',last_run:new Date(now).toISOString(),retry_count:0,...(current._hash===job._hash?{next_run:nextCalendarRun(current,settings.timezone,now)}:{})},current)]);});
          results.push({id:job.id,state:'verified'});
        } catch(e) {
          this.store.save('job_receipts',{id:receipt.id,state:'failed',error:e.message,finished_at:new Date().toISOString()});
          const retry=(job.retry_count||0)+1,needsReview=e.code==='OUTWARD_UNCERTAIN'||retry>=(job.max_retries||3);
          this.store.withLock(()=>{const current=this.store.get('jobs',job.id);if(current)this.store.commit([this.store.prepare('jobs',{state:needsReview?'needs_review':'failed',paused:needsReview||current.paused,retry_count:retry,last_outcome:e.message,last_run:new Date(now).toISOString(),...(current._hash===job._hash?{next_run:new Date(now+Math.min(60000*2**retry,3600000)).toISOString()}:{})},current)]);});results.push({id:job.id,state:'failed',error:e.message});
        }
      }
      return results;
    } finally { this.running=false;this.onProgress?.(); }
  }
}
