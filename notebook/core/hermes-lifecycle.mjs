// Hermes changes its source, runs its cron work, and answers chats through one
// runtime. One process may own exactly one of those operations at a time.
export class HermesLifecycle{
 constructor(){this.active=null;}
 acquire(kind){
  if(this.active)return null;
  const lease={kind};this.active=lease;
  return ()=>{if(this.active===lease)this.active=null;};
 }
 get busy(){return !!this.active;}
 get reason(){return this.active?.kind||null;}
}
