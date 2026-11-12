import fs from 'node:fs';
import path from 'node:path';
import {atomic} from './records/store.mjs';
import {queueNotice} from './notices.mjs';
import {compareVersions,installedVersion,settledStatus,underWay,updateRunning,updatesItself,updateWay} from './update.mjs';

// UPDATE AUTOMATICALLY (12 November 2026, #458). In Settings, About the person chooses Update myself
// (the default, also for an installation that never chose) or Update automatically. Automatic checks
// once a day, at the time they chose in their time zone (04:00 unless they chose another), and runs
// the same update as the Update now button: the only way it installs is the `start` it is given,
// which the notebook makes startUpdate (core/update.mjs). It never starts while a chat reply or a
// routine runs, and holds the lifecycle's `godspeed update` lease while the update runs, so none
// starts while it does (core/hermes-lifecycle.mjs): until the notebook stops for the new version,
// or the update's status says it ended. On Windows that includes the setup, which runs on after
// the update's command has handed it over. A change in Settings counts from the next day. A pause
// lasts through a date, or until the person turns it back on.
//
// It is offered only where the notebook can update the installation itself (handover, windows) and
// knows when a chat or routine runs (the original runtime's lifecycle). A Docker server is updated on
// the server, and Settings says so in one line.
//
// Afterwards it says once, where the routines' results go (core/notices.mjs) and on the bell, which
// version it installed and what changed, or that it could not update and tries again the next day.
// The notebook that started a successful update has stopped by then, so the next one says it.
//
// The choice is this machine's own, in .godspeed/automatic-update.json: a paired computer and its
// Docker server update differently.
export const AUTOMATIC_FILE='automatic-update.json';
export const DEFAULT_TIME='04:00';
const TIME=/^([01]\d|2[0-3]):[0-5]\d$/,DAY=/^\d{4}-\d{2}-\d{2}$/;
const validDay=value=>typeof value==='string'&&DAY.test(value)&&!Number.isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().startsWith(value);
const plainObject=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const refuse=(message,status=400)=>Object.assign(Error(message),{status});
// The first sentence of what went wrong, without this machine's folders: the rest of an update's
// message says what the notice says anyway, that the version you have keeps running.
const reasonOf=message=>String(message||'').split('\n')[0].split(/(?<=\.)\s/)[0].replace(/[A-Za-z]:[\\/][^\s'"]*|(?<![\w.])\/(?:home|opt|root|var|tmp|Users|srv|data|mnt|private)\/[^\s'"]*/g,'[folder]').trim().replace(/\.$/,'').slice(0,300)||'It stopped before it was finished';

export function readAutomatic(store){
  let saved={};try{saved=JSON.parse(fs.readFileSync(path.join(store.state,AUTOMATIC_FILE),'utf8'));}catch{}
  if(!plainObject(saved))saved={};
  const paused=plainObject(saved.paused)&&(saved.paused.until===null||validDay(saved.paused.until))?{until:saved.paused.until}:null;
  return {
    choice:saved.choice==='automatic'?'automatic':'myself',
    time:TIME.test(saved.time)?saved.time:DEFAULT_TIME,
    paused,
    changed_day:validDay(saved.changed_day)?saved.changed_day:null,
    last:plainObject(saved.last)?saved.last:null,
  };
}

const OFFERED_NOT={
  server:'On a Docker server Godspeed is updated on the server itself (sudo godspeed-update), so it cannot update itself automatically.',
  terminal:'This installation is updated from a terminal. After one update with godspeed-update it can update itself automatically.',
  none:'No installer put this copy of Godspeed here, so it cannot update itself.',
};

export class AutomaticUpdate{
  constructor({store,lifecycle=null,start,way=()=>updateWay({root:store.root}),now=()=>new Date(),timezone=()=>store.get('settings','installation')?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'}){
    Object.assign(this,{store,lifecycle,start,way,now,timezone});
    this.lease=null;this.running=false;
  }
  file(){return path.join(this.store.state,AUTOMATIC_FILE);}
  write(state){atomic(this.file(),JSON.stringify(state,null,2)+'\n');}
  // A Settings change saved while an update was being started is kept: the choice is read again.
  record(last){this.write({...readAutomatic(this.store),last});}
  offer(){
    const way=this.way();
    if(!updatesItself(way))return {offered:false,reason:OFFERED_NOT[way]||OFFERED_NOT.none};
    if(!this.lifecycle)return {offered:false,reason:OFFERED_NOT.none};
    return {offered:true,reason:null};
  }
  // Today and the time of day in the installation's time zone: {day:'2026-11-12', hhmm:'04:00'}.
  clock(){
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:this.timezone(),year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(this.now()).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
    return {day:`${parts.year}-${parts.month}-${parts.day}`,hhmm:`${parts.hour}:${parts.minute}`};
  }
  // A pause through a date that has passed is over.
  pausedOn(state,day){return !!state.paused&&(state.paused.until===null||day<=state.paused.until);}
  overview(){
    const state=readAutomatic(this.store),{day}=this.clock(),last=state.last;
    return {
      ...this.offer(),choice:state.choice,time:state.time,
      paused:state.choice==='automatic'&&this.pausedOn(state,day)?state.paused:null,
      last:last?{day:last.day,result:last.result,to:last.to||null,message:last.message||null}:null,
    };
  }
  save(input){
    if(!plainObject(input))throw refuse('Choose Update myself or Update automatically.');
    const state=readAutomatic(this.store);
    const choice=input.choice===undefined?state.choice:input.choice;
    if(!['automatic','myself'].includes(choice))throw refuse('Choose Update myself or Update automatically.');
    const time=input.time===undefined?state.time:input.time;
    if(typeof time!=='string'||!TIME.test(time))throw refuse('Choose a time of day such as 04:00.');
    const paused=input.paused===undefined?state.paused:input.paused;
    if(paused!==null&&!(plainObject(paused)&&(paused.until===null||validDay(paused.until))))throw refuse('Choose a date to pause until, or pause until you turn it back on.');
    if(choice==='automatic'){const offer=this.offer();if(!offer.offered)throw refuse(offer.reason,409);}
    this.write({...state,choice,time,paused:choice==='automatic'&&paused?{until:paused.until}:null,changed_day:this.clock().day});
    return this.overview();
  }
  // What a started update came to, said once. Until the update has ended, nothing.
  report(){
    const state=readAutomatic(this.store),last=state.last;
    if(last?.result!=='started'||last.told)return;
    const installed=installedVersion({root:this.store.root}),status=settledStatus(this.store.root,installed,this.now);
    if(status?.state==='updated'&&last.to&&compareVersions(installed,last.to)>=0)return this.tell({...last,result:'updated',message:null});
    if(status?.state==='failed'||status?.state==='updated')return this.tell({...last,result:'failed',message:status.message});
  }
  // Told once it was said somewhere; a started update that could be said nowhere is tried again.
  tell(last){
    const at=this.now().toISOString(),said=[];
    const say=action=>{try{action();said.push(true);}catch{}};
    if(last.result==='updated'){
      const text='Godspeed Mission Control updated itself to '+last.to+'.'+(last.notes?' What changed: '+last.notes:'');
      say(()=>queueNotice(this.store,{id:'godspeed-updated-'+last.to,text,about:'the automatic update'}));
      say(()=>{
        this.store.save('notifications',{id:'godspeed-update',status:'pending',title:'Godspeed updated itself',body:text,link:'/dashboard/settings#about',updated_at:at});
        if(this.store.get('notifications','godspeed-update-failed')?.status==='pending')this.store.save('notifications',{id:'godspeed-update-failed',status:'resolved',resolved_at:at});
      });
    }else{
      const text='Godspeed Mission Control could not update itself'+(last.to?' to '+last.to:'')+'. '+reasonOf(last.message)+'. The version you have'+(last.from?', '+last.from+',':'')+' keeps running. It tries again tomorrow at '+readAutomatic(this.store).time+'.';
      say(()=>queueNotice(this.store,{id:'godspeed-update-failed-'+last.day,text,about:'the automatic update'}));
      say(()=>this.store.save('notifications',{id:'godspeed-update-failed',status:'pending',title:'Godspeed could not update itself',body:text,link:'/dashboard/settings#about',failed_at:at}));
    }
    this.record({...last,told:said.length>0});
  }
  // The lease is held while the update's command runs, and after it while its status says the update
  // is still going (the Windows setup), until that status counts as stopped (core/update.mjs).
  updateUnderWay(){
    const root=this.store.root;
    return updateRunning(root,this.now)||underWay(settledStatus(root,installedVersion({root}),this.now));
  }
  async tick(){
    if(this.running)return null;
    this.running=true;
    try{
      if(this.lease&&!this.updateUnderWay()){this.lease();this.lease=null;}
      this.report();
      const state=readAutomatic(this.store),{day,hhmm}=this.clock();
      if(state.choice!=='automatic'||!this.offer().offered||this.pausedOn(state,day)||state.changed_day===day||hhmm<state.time||state.last?.day===day)return null;
      const lease=this.lifecycle.acquire('godspeed update');
      if(!lease)return null;
      const last={day,at:this.now().toISOString(),from:installedVersion({root:this.store.root})};
      // Today's attempt is kept before the update starts: if it cannot be, nothing starts.
      try{this.record({...last,result:'checking'});}catch(error){lease();throw error;}
      let answer;
      try{answer=await this.start();}catch(error){answer={code:500,error:error?.message};}
      if(answer?.code===202){
        this.lease=lease;
        this.record({...last,result:'started',to:answer.status?.to||null,notes:answer.status?.notes||null});
        return 'started';
      }
      lease();
      if(answer?.code===200){this.record({...last,result:'current'});return 'current';}
      if(answer?.code===409){this.record({...last,result:'skipped',message:answer.error||null});return 'skipped';}
      this.tell({...last,result:'failed',message:answer?.error});
      return 'failed';
    }catch(error){console.error('The automatic update could not run: '+(error?.message||error));return null;}
    finally{this.running=false;}
  }
}
