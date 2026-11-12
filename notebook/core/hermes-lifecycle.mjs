// Hermes changes its source, runs its cron work, and answers chats through one
// runtime. An assistant update rewrites Hermes, so it starts only when nothing
// else is held and, while it runs, nothing else starts. The routine tick and a
// manual routine run both drive Hermes' cron, so they exclude each other. A chat
// is refused only by an update. Until 11 November 2026 (issue #439) any lease
// refused it, so a chat during a routine tick was told the assistant was updating.
// An automatic Godspeed update (core/automatic-update.mjs, 12 November 2026, #458)
// restarts everything, so it holds a lease with the same rule as an assistant update.
// A lease may say when it is over (`over`, #483): it ends as soon as anything asks the lifecycle,
// not when its holder next looks. Until 12 November 2026 the automatic update's lease waited for
// the next minute's tick, so a chat in the minute after a failed update was refused.
const ROUTINES=['routine tick','routine run'],UPDATES=['assistant update','godspeed update'];
export class HermesLifecycle{
 constructor(){this.active=new Set();}
 acquire(kind,{over}={}){
  const held=this.kinds();
  if(this.updating||(UPDATES.includes(kind)&&held.size)||(ROUTINES.includes(kind)&&ROUTINES.some(routine=>held.has(routine))))return null;
  const lease={kind,over};this.active.add(lease);
  return ()=>{this.active.delete(lease);};
 }
 // A lease whose `over` says it has ended is let go here; one whose `over` cannot tell is kept.
 settle(){for(const lease of this.active){let ended=false;try{ended=!!lease.over?.();}catch{}if(ended)this.active.delete(lease);}}
 kinds(){this.settle();return new Set([...this.active].map(lease=>lease.kind));}
 get busy(){this.settle();return this.active.size>0;}
 get updating(){const held=this.kinds();return UPDATES.some(update=>held.has(update));}
 // The lease that refuses the most: what a refused routine run records as its owner.
 get reason(){const held=this.kinds();return [...UPDATES,...ROUTINES,'chat reply'].find(kind=>held.has(kind))||null;}
}
