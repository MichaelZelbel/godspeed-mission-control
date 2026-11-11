// Hermes changes its source, runs its cron work, and answers chats through one
// runtime. An assistant update rewrites Hermes, so it starts only when nothing
// else is held and, while it runs, nothing else starts. The routine tick and a
// manual routine run both drive Hermes' cron, so they exclude each other. A chat
// is refused only by an update. Until 11 November 2026 (issue #439) any lease
// refused it, so a chat during a routine tick was told the assistant was updating.
const ROUTINES=['routine tick','routine run'];
export class HermesLifecycle{
 constructor(){this.active=new Set();}
 acquire(kind){
  const held=this.kinds();
  if(held.has('assistant update')||(kind==='assistant update'&&held.size)||(ROUTINES.includes(kind)&&ROUTINES.some(routine=>held.has(routine))))return null;
  const lease={kind};this.active.add(lease);
  return ()=>{this.active.delete(lease);};
 }
 kinds(){return new Set([...this.active].map(lease=>lease.kind));}
 get busy(){return this.active.size>0;}
 // The lease that refuses the most: what a refused routine run records as its owner.
 get reason(){const held=this.kinds();return ['assistant update',...ROUTINES,'chat reply'].find(kind=>held.has(kind))||null;}
}
