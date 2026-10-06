import { randomUUID } from 'node:crypto';
import {procedureKinds} from './kinds.mjs';
import {nextCalendarRun} from './calendar.mjs';
import {hash} from '../records/store.mjs';
import {QueryService} from '../query.mjs';
import {readyWork} from '../goal-loop.mjs';
import {watchDue} from '../watch-commands.mjs';
import {beatWhile,HEARTBEAT_EVERY} from '../supervisor-health.mjs';
export const kinds = ['goal-decision', 'goal-work', 'habit-check', 'coaching', 'deadline-reminder', 'profiling', 'review', 'morning-brief', 'audit', 'memory-review', 'watch',...procedureKinds];
const restartableReads=new Set(['disk-check','health-summary','watch','domain-watch','portfolio','connection-check','audit','selftest','job-check']);
// Checks that usually find nothing: a run of one that says nothing leaves no receipt (finish below).
const quietReads=new Set([...restartableReads,'coach-tick','journal-tick','coach-cycle','deadline-reminder']);
// The longest a job is taken to be working: goal work makes up to five AI calls of five minutes.
export const JOB_LIMIT=45*60000;
const KEEP_MS=14*86400000,KEEP_HISTORY_MS=2*86400000,KEEP_LAST=3,PRUNE_EVERY=6*3600000,PRUNE_BATCH=500;
export class Scheduler {
  // only: the kinds this scheduler runs (beside Hermes, the record routines
  // Hermes has no job for); delivery: where its results go, overriding settings.
  constructor(store, { device = store.device, executor = null, query = null, only = null, delivery = null, beatEvery = HEARTBEAT_EVERY, jobLimit = JOB_LIMIT } = {}) { this.store = store; this.device = device; this.executor = executor; this.query = query || new QueryService(store); this.only = only ? new Set(only) : null; this.delivery = delivery; this.beatEvery = beatEvery; this.jobLimit = jobLimit; this.running = false; this.unfinished = new Map(); }
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
  // Which jobs this scheduler may start now. A job awaiting review is never
  // started: until 6 October 2026 one whose delivery was uncertain could be
  // unpaused by another route and its next run sent the message again.
  eligible(job,now){return (!this.only||this.only.has(job.kind))&&job.owner===this.device&&!job.paused&&!(Date.parse(job.next_run)>now)&&!['awaiting_approval','needs_review'].includes(job.state)&&!this.unfinished.has(job.id);}
  async tick(now = Date.now()) {
    if (this.running) return [];
    this.running = true; this.onProgress?.();const results = [];
    try {
      let settings = this.store.get('settings','installation');
      if (!settings || settings.owner !== this.device) return [];
      for(const finish of [...this.unfinished.values()])try{await finish();}catch{}
      try{await this.pullWorkForward(now);}catch{}
      for (const snapshot of this.store.list('jobs')) {
        // An inactive snapshot cannot authorize execution. A later activation
        // is picked up on the next tick; active work still rechecks current state.
        if(!this.eligible(snapshot,now))continue;
        settings=this.store.get('settings','installation');
        if(!settings||settings.owner!==this.device)break;
        // One job's trouble stays its own: until 6 October 2026 an invalid
        // schedule or a busy workspace while one job was being read ended the
        // tick for every job after it.
        try{const result=await this.run(snapshot.id,settings,now);if(result)results.push(result);}
        catch(error){results.push({id:snapshot.id,state:'not run',error:error.message});try{await this.remember(snapshot.id,error);}catch{}}
      }
      try{await this.prune(now);}catch{}
      return results;
    } finally { this.running=false;this.onProgress?.(); }
  }
  // A decision may finish after the worker's daily slot. Ready authorized
  // work gets the next tick; pauses and uncertain attempts remain intact.
  async pullWorkForward(now){
    const worker=this.store.get('jobs','goal-work');
    if(!worker||this.only&&!this.only.has('goal-work')||worker.paused||worker.state!=='pending'||worker.owner!==this.device||!(Date.parse(worker.next_run)>now))return;
    if(!readyWork(this.query,{now,goalId:worker.goal_id||null}))return;
    await this.store.withLockAsync(()=>{const current=this.store.get('jobs',worker.id);if(current?._hash===worker._hash)this.store.commit([this.store.prepare('jobs',{next_run:new Date(now).toISOString()},current)]);});
  }
  async run(id,settings,now){
    const job=this.store.get('jobs',id);if(!job||!this.eligible(job,now))return null;
    const receiptId = job.id + '-' + String(Date.parse(job.next_run));
    let previous = this.store.get('job_receipts', receiptId),recovery=null;
    if (previous) {
      // Never replay an uncertain side effect. An interrupted attempt stays visible.
      if(previous.state==='attempted'&&previous.pid&&Date.parse(previous.started_at)>Date.now()-600000){try{process.kill(previous.pid,0);return null;}catch{}}
      if(previous.state==='attempted'&&!job.outward&&restartableReads.has(job.kind)&&(previous.interruptions||[]).length<(job.max_retries||3))recovery=previous;
      else{await this.store.saveAsync('jobs',{id:job.id,state:previous.state==='verified'?'pending':'needs_review',paused:previous.state!=='verified',next_run:nextCalendarRun(job,settings.timezone,now)});return null;}
    }
    // A watch sweep with no topic due reads nothing and keeps no receipt; it
    // sleeps until the first topic is due (a day at most, so an edited topic
    // is found). Until 6 October 2026 one idle topic woke it every minute and
    // left some 4,400 files a day in the synced notebook.
    if(!recovery&&['watch','domain-watch'].includes(job.kind)&&!job.force_sources){
      const due=watchDue(this.query,job,now);
      if(due!==true){
        const at=new Date(Math.max(now+60000,Math.min(due??Infinity,now+86400000))).toISOString();
        await this.store.withLockAsync(()=>{const current=this.store.get('jobs',job.id);if(current?._hash===job._hash&&current.next_run!==at)this.store.commit([this.store.prepare('jobs',{next_run:at},current)]);});
        return null;
      }
    }
    const approval=job.approval_id?this.store.get('approvals',job.approval_id):null;
    if (job.outward && (!approval||approval.status!=='approved'||approval.payload_hash!==hash(job.payload)||approval.job_id!==job.id)) {
      await this.store.saveAsync('jobs',{id:job.id,state:'awaiting_approval'});return {id:job.id,state:'awaiting_approval'};
    }
    const receipt=await this.store.withLockAsync(()=>{
      const current=this.store.get('jobs',job.id),owner=this.store.get('settings','installation');
      const retained=this.store.get('job_receipts',receiptId);
      if(!current||owner?.owner!==this.device||current.owner!==this.device||current.paused||current.state==='needs_review'||current._hash!==job._hash||(recovery?retained?._hash!==recovery._hash:!!retained))return null;
      const permission=current.approval_id?this.store.get('approvals',current.approval_id):null;
      if(current.outward&&(!permission||permission.status!=='approved'||permission.payload_hash!==hash(current.payload)||permission.job_id!==current.id))return null;
      const r=this.store.prepare('job_receipts',{id:receiptId,job_id:job.id,kind:job.kind,state:'attempted',pid:process.pid,started_at:new Date(now).toISOString(),attempt_id:randomUUID(),...(recovery?{interruptions:[...(recovery.interruptions||[]),{attempt_id:recovery.attempt_id,started_at:recovery.started_at,recovered_at:new Date(now).toISOString(),reason:'Stopped read-only routine; no outward action is replayed'}]}:{})},recovery);
      const records=[r];if(recovery)records.push(this.store.prepare('work_items',{id:'routine-recovery-'+hash(receiptId),kind:'repair',job_id:job.id,failure_id:receiptId,state:'attempted',title:'Resume interrupted '+job.kind,allowed_action:'retry-read-only-routine',check:'The same scheduled read completes with a verified receipt'}));this.store.commit(records);return r;
    });
    if(!receipt)return null;this.onProgress?.();
    let result;
    try {
      if (!this.executor) throw new Error('No assistant runtime configured');
      // The work beats the heartbeat while it is inside its time limit.
      result=await beatWhile(this.executor(job,{settings,store:this.store}),()=>this.onProgress?.(),{limitMs:this.jobLimit,every:this.beatEvery});
      await this.store.waitForWriter();
      if(!result?.verified)throw new Error('The executor returned no verified result');
      if((this.delivery||settings.delivery)==='telegram'&&!result.silent){if(!this.deliver)throw new Error('Configure the candidate Telegram connector before choosing chat delivery');await this.deliver(receipt.id,result);}
    } catch(e) {
      const retry=(job.retry_count||0)+1,needsReview=e.code==='OUTWARD_UNCERTAIN'||retry>=(job.max_retries||3);
      try{
        await this.store.waitForWriter();
        await this.store.saveAsync('job_receipts',{id:receipt.id,state:'failed',error:e.message,finished_at:new Date().toISOString()});
        if(recovery)await this.store.saveAsync('work_items',{id:'routine-recovery-'+hash(receiptId),state:'needs_review',error:e.message});
        await this.store.withLockAsync(()=>{const current=this.store.get('jobs',job.id);if(current)this.store.commit([this.store.prepare('jobs',{state:needsReview?'needs_review':'failed',paused:needsReview||current.paused,retry_count:retry,last_outcome:e.message,last_run:new Date(now).toISOString(),...(current._hash===job._hash?{next_run:new Date(now+Math.min(60000*2**retry,3600000)).toISOString()}:{})},current)]);});
      }catch{}
      return {id:job.id,state:'failed',error:e.message};
    }
    // The work and its delivery succeeded; what follows is bookkeeping, kept
    // apart. Until 6 October 2026 it shared the work's try: a busy workspace
    // while writing the receipt turned a delivered run into "failed", and the
    // retry ran the routine and sent its message again. Bookkeeping that cannot
    // be written now is tried again on the next tick, and the job is not
    // started again meanwhile.
    const finish=()=>this.finish(job,receipt,receiptId,recovery,result,settings,now);
    try{await finish();}catch(error){this.unfinished.set(job.id,finish);return {id:job.id,state:'verified',finished:false,error:error.message};}
    return {id:job.id,state:'verified'};
  }
  async finish(job,receipt,receiptId,recovery,result,settings,now){
    // A read that found nothing to say leaves no receipt: the job's next run
    // records that it ran. After a failure the next success keeps its receipt,
    // the evidence a repair waits for.
    const quiet=quietReads.has(job.kind)&&!job.outward&&!recovery&&result.silent&&!result.record_id&&!(job.retry_count>0)&&(job.last_outcome===undefined||job.last_outcome==='verified');
    let next,invalid=null;
    await this.store.withLockAsync(()=>{
      const current=this.store.get('jobs',job.id),records=[],removeKeys=[];
      if(current&&current._hash===job._hash){try{next=nextCalendarRun(current,settings.timezone,now);}catch(error){invalid=error;}}
      if(quiet)removeKeys.push('job_receipts/'+receipt.id);
      else records.push(this.store.prepare('job_receipts',{state:'verified',result,finished_at:new Date().toISOString()},this.store.get('job_receipts',receipt.id)));
      if(recovery)records.push(this.store.prepare('work_items',{id:'routine-recovery-'+hash(receiptId),state:'verified',evidence:receipt.id},this.store.get('work_items','routine-recovery-'+hash(receiptId))));
      // A schedule that cannot name its next run is held for review rather
      // than run again from the same slot.
      if(current)records.push(this.store.prepare('jobs',{state:invalid?'needs_review':'pending',...(invalid?{paused:true}:{}),last_outcome:invalid?'Ran, but its schedule has no next run: '+invalid.message:'verified',last_run:new Date(now).toISOString(),retry_count:0,...(next?{next_run:next}:{})},current));
      this.store.commit(records,{removeKeys});
    });
    this.unfinished.delete(job.id);
  }
  // Why a job could not be started, on the job, once.
  async remember(id,error){
    const outcome='Not run: '+String(error.message).slice(0,300);
    await this.store.withLockAsync(()=>{const current=this.store.get('jobs',id);if(current&&current.last_outcome!==outcome)this.store.commit([this.store.prepare('jobs',{last_outcome:outcome},current)]);});
  }
  // Run receipts and the earlier versions of jobs and receipts are system
  // bookkeeping. Until 6 October 2026 nothing removed them, and every one was
  // synced through Git and held in memory. Kept: the receipts of the last two
  // weeks, the last three verified runs of each job and every failed or
  // interrupted one; the earlier versions, which nothing reads, for two days.
  async prune(now){
    if(!this.pruneAgain&&now-(this.prunedAt||0)<PRUNE_EVERY)return 0;
    this.prunedAt=now;
    const cutoff=now-KEEP_MS,keys=[],seen=new Map(),of=type=>typeof this.store.ofType==='function'?this.store.ofType(type):this.store.list(type);
    const runs=of('job_receipts').filter(r=>r.state==='verified'&&r.job_id&&r.id.startsWith(r.job_id+'-')&&/^\d+$/.test(r.id.slice(r.job_id.length+1))).sort((a,b)=>String(b.finished_at||b.updated_at).localeCompare(String(a.finished_at||a.updated_at)));
    for(const r of runs){const n=seen.get(r.job_id)||0;seen.set(r.job_id,n+1);if(n>=KEEP_LAST&&Date.parse(r.finished_at||r.updated_at)<cutoff)keys.push('job_receipts/'+r.id);}
    for(const h of of('record_history'))if(['jobs','job_receipts'].includes(h.source_type)&&Date.parse(h.recorded_at||h.updated_at)<now-KEEP_HISTORY_MS)keys.push('record_history/'+h.id);
    const batch=keys.slice(0,PRUNE_BATCH);this.pruneAgain=keys.length>batch.length;
    if(batch.length)await this.store.withLockAsync(()=>this.store.commit([],{removeKeys:batch}));
    return batch.length;
  }
}
