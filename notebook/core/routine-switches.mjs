import fs from 'node:fs';
import path from 'node:path';
import {starterBorn} from './starter-workspace.mjs';
import {STARTING_ROUTINES} from './starting-routines.mjs';
import {readNotebookRoutines,SWITCHABLE_NOTEBOOK_ROUTINES} from './notebook-routines.mjs';

// THE ROUTINES OF A MISSION CONTROL NOT MADE FROM THE STARTER ARE SWITCHES (4 November 2026, #225). Godspeed
// calls such a mission control adopted: its owner has jobs of their own that may already do what Godspeed's
// routines do, so none runs until its switch is on in Settings > Routines. One settings record per routine
// (routine-switch-<key>) so the switch syncs like other settings and two machines switching different
// routines never collide. Only Settings writes them (setRoutineSwitch): an update, the install and the
// scheduler only read them, so a routine switched on is never switched off by one.
// A function, since this file is loaded in the middle of starting-routines.mjs's own imports (through query.mjs).
export const switchable=()=>[
 ...STARTING_ROUTINES.map(({key,name,what,needs})=>({key,name,what,needs})),
 ...SWITCHABLE_NOTEBOOK_ROUTINES.map(({key,name,what})=>({key,name,what})),
];
export const ADOPTED_NOTE='Godspeed did not make this mission control from its starter (it was adopted), so its own jobs may already do what these routines do. Each stays off until you switch it on.';
export const switchId=key=>'routine-switch-'+key;
export const switchedOn=(store,key)=>store.get('settings',switchId(key))?.on===true;
export async function setRoutineSwitch(store,{key,on}){
 if(!switchable().some(r=>r.key===key))throw Error('Choose one of the routines listed');
 if(typeof on!=='boolean')throw Error('Choose whether to switch it on or off');
 if(starterBorn(store.root))throw Error('These switches are for a mission control Godspeed did not make from its starter.');
 return store.saveAsync('settings',{id:switchId(key),routine:key,on,switched_at:new Date().toISOString()});
}
// What Settings shows: null where there are no switches (a starter-born mission control), else the note and
// each routine with its state: off, waiting (on; made at the next routine check), needs (its recipe is
// missing) or on. `jobs` is Hermes' list of jobs.
export function routineSwitches(store,{jobs}){
 if(starterBorn(store.root))return null;
 const mine=readNotebookRoutines(store).jobs;
 return {note:ADOPTED_NOTE,routines:switchable().map(({key,name,what,needs})=>{
  const on=switchedOn(store,key),entry=mine.find(j=>j.key===key),running=!!entry&&!entry.switched_off&&jobs.some(j=>j.id===entry.id);
  const recipe=!needs||fs.existsSync(path.join(store.root,'skills',needs,'SKILL.md'));
  return {key,name,what,on,state:!on?'off':running?'on':recipe?'waiting':'needs',...(!recipe&&on?{needs}:{})};
 })};
}
