// Hermes changes its source, runs its cron work, and answers chats through one
// runtime. An assistant update rewrites Hermes, so it starts only when nothing
// else is held and, while it runs, nothing else starts. The routine tick and a
// manual routine run both drive Hermes' cron, so they exclude each other. A chat
// is refused only by an update. Until 11 November 2026 (issue #439) any lease
// refused it, so a chat during a routine tick was told the assistant was updating.
// An automatic Godspeed update (core/automatic-update.mjs, 12 November 2026, #458)
// restarts everything, so it holds a lease with the same rule as an assistant update.
const ROUTINES=['routine tick','routine run'],UPDATES=['assistant update','godspeed update'];
export class HermesLifecycle{
 constructor(){this.active=new Set();}
 acquire(kind){
  const held=this.kinds();
  if(UPDATES.some(update=>held.has(update))||(UPDATES.includes(kind)&&held.size)||(ROUTINES.includes(kind)&&ROUTINES.some(routine=>held.has(routine))))return null;
  const lease={kind};this.active.add(lease);
  return ()=>{this.active.delete(lease);};
 }
 kinds(){return new Set([...this.active].map(lease=>lease.kind));}
 get busy(){return this.active.size>0;}
 // The lease that refuses the most: what a refused routine run records as its owner.
 get reason(){const held=this.kinds();return [...UPDATES,...ROUTINES,'chat reply'].find(kind=>held.has(kind))||null;}
}
