import { randomUUID } from 'node:crypto';
export const kinds = ['goal-decision', 'goal-work', 'coaching', 'deadline-reminder', 'profiling', 'review', 'morning-brief', 'audit', 'memory-review', 'watch'];
export class Scheduler {
  constructor(store, { device = store.device, executor = null } = {}) { this.store = store; this.device = device; this.executor = executor; this.running = false; }
  configure({ owner = this.device, timezone = 'UTC', goal, delivery = 'notebook', permissions = [] }) {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
    const existing = this.store.get('settings', 'installation');
    if (existing) return { configured: true, preserved: true };
    if (!goal?.trim()) throw new Error('Name one goal to start');
    const at = new Date().toISOString();
    return this.store.withLock(() => {
      const records = [this.store.prepare('settings', { id: 'installation', owner, timezone, delivery, permissions }),
        this.store.prepare('profiles', { id: 'owner', display_name: 'Owner', timezone }),
        this.store.prepare('goals', { title: goal, status: 'active', areas: ['health','work-money','relationships'], progress: [] }),
        this.store.prepare('jobs', { id: 'goal-decision', kind: 'goal-decision', owner, paused: false, next_run: at, interval_ms: 86400000, state: 'pending' }),
        this.store.prepare('jobs', { id: 'goal-work', kind: 'goal-work', owner, paused: false, next_run: at, interval_ms: 86400000, state: 'pending' }),
        this.store.prepare('jobs', { id: 'deadline-reminder', kind: 'deadline-reminder', owner, paused: false, next_run: at, interval_ms: 3600000, state: 'pending' }),
        ...[['coaching',604800000],['profiling',86400000],['review',604800000]].map(([kind,interval_ms])=>this.store.prepare('jobs',{id:kind,kind,owner,paused:false,next_run:new Date(Date.parse(at)+interval_ms).toISOString(),interval_ms,state:'pending'}))];
      this.store.commit(records); return { configured: true, firstWorkPending: true };
    });
  }
  transfer(owner) {
    const setting = this.store.get('settings','installation'); if(!setting)throw new Error('Complete setup first');
    return this.store.withLock(()=>this.store.commit([this.store.prepare('settings',{owner},setting),...this.store.list('jobs').map(j=>this.store.prepare('jobs',{owner},j))]));
  }
  async tick(now = Date.now()) {
    if (this.running) return [];
    this.running = true; const results = [];
    try {
      const settings = this.store.get('settings','installation');
      if (!settings || settings.owner !== this.device) return [];
      for (const job of this.store.list('jobs')) {
        if (job.owner !== this.device || job.paused || Date.parse(job.next_run) > now || job.state === 'awaiting_approval') continue;
        const receiptId = job.id + '-' + String(Date.parse(job.next_run));
        const previous = this.store.get('job_receipts', receiptId);
        if (previous) {
          // Never replay an uncertain side effect. An interrupted attempt stays visible.
          this.store.save('jobs',{id:job.id,state:previous.state==='verified'?'pending':'needs_review',paused:previous.state!=='verified',next_run:new Date(now+(job.interval_ms||86400000)).toISOString()}); continue;
        }
        if (job.outward && !settings.permissions.includes(job.permission)) {
          this.store.save('jobs',{id:job.id,state:'awaiting_approval'});results.push({id:job.id,state:'awaiting_approval'});continue;
        }
        const receipt=this.store.save('job_receipts',{id:receiptId,job_id:job.id,kind:job.kind,state:'attempted',started_at:new Date(now).toISOString(),attempt_id:randomUUID()});
        try {
          if (!this.executor) throw new Error('No assistant runtime configured');
          const result=await this.executor(job,{settings,store:this.store});
          if(!result?.verified)throw new Error('The executor returned no verified result');
          this.store.save('job_receipts',{id:receipt.id,state:'verified',result,finished_at:new Date().toISOString()});
          this.store.save('jobs',{id:job.id,state:'pending',last_outcome:'verified',last_run:new Date(now).toISOString(),next_run:new Date(now+(job.interval_ms||86400000)).toISOString()});
          results.push({id:job.id,state:'verified'});
        } catch(e) {
          this.store.save('job_receipts',{id:receipt.id,state:'failed',error:e.message,finished_at:new Date().toISOString()});
          this.store.save('jobs',{id:job.id,state:'failed',last_outcome:e.message,last_run:new Date(now).toISOString(),next_run:new Date(now+Math.min(job.interval_ms||86400000,3600000)).toISOString()});results.push({id:job.id,state:'failed',error:e.message});
        }
      }
      return results;
    } finally { this.running=false; }
  }
}
