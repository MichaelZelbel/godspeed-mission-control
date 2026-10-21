import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';
import {addonCommand} from '../core/native-personal.mjs';
import {readEvents} from '../../third-party/addons/godspeed-charm/lib/record.mjs';
import {findTracker} from '../../third-party/addons/godspeed-charm/lib/notebook.mjs';

// The Charm Challenge card on the Trackers shelf (spec 2026-10-21, "Notebook card"): tracker-list gives
// the charm tracker its count, `charm` (the add-on's State) and `brief` (the add-on's own line), read
// from the tracker's rows on the person's local day. tracker-list only reads: it never settles a
// finish, and a record it cannot count still lists the tracker, with charm null.
const START='2026-10-21T08:00:00Z'; // 10:00 in Berlin, a Wednesday
function fixture({start=true}={}){
 process.env.GODSPEED_CHARM_NOW=START;
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-charm-list-'))),query=new QueryService(store),domains=new Domains(query);
 store.save('settings',{id:'installation',timezone:'Europe/Berlin'});
 if(start)addonCommand(store,{addon:'charm',args:['start']});
 return {store,query,domains};
}
test.after(()=>{delete process.env.GODSPEED_CHARM_NOW;});
const list=domains=>domains.invoke('personal-operation',{type:'tracker-list'});
const charmOf=result=>result.trackers.find(t=>t.specialist==='charm');

test('tracker-list gives the charm tracker its count and the brief line, on the local day',async()=>{
 const {store,domains}=fixture();
 process.env.GODSPEED_CHARM_NOW='2026-10-30T08:00:00Z';
 const charm=charmOf(await list(domains));
 assert.equal(charm.id,findTracker(store.root).id);
 assert.equal(charm.charm.daysToGo,12);
 assert.deepEqual({running:charm.charm.running,day:charm.charm.day,end:charm.charm.end,restarts:charm.charm.restarts,longestRun:charm.charm.longestRun},{running:true,day:10,end:'2026-11-11',restarts:0,longestRun:9});
 assert.equal(charm.brief,'Charm Challenge: day 10 of 21, 12 days to go.');
 assert.equal(charm.status,'active');
 // The day is Berlin's: 23:30 UTC on the 30th is already the 31st there.
 process.env.GODSPEED_CHARM_NOW='2026-10-30T23:30:00Z';
 assert.equal(charmOf(await list(domains)).charm.daysToGo,11);
});

test('on the finish day the brief is the finish line, and tracker-list writes no finish',async()=>{
 const {store,domains}=fixture();
 process.env.GODSPEED_CHARM_NOW='2026-11-11T08:00:00Z';
 const before=readEvents(store.root).length;
 const charm=charmOf(await list(domains));
 assert.equal(charm.brief,'Charm Challenge done: 21 days. Restarts on the way: 0.');
 assert.equal(charm.charm.needsFinish,true);assert.equal(charm.charm.daysToGo,0);
 assert.equal(readEvents(store.root).length,before,'nothing was written');
});

test('a running challenge stays active past 30 days; a stopped one has no brief',async()=>{
 const {domains}=fixture();
 // Nobody said anything for 40 days: no finish was settled, and the challenge is still running.
 process.env.GODSPEED_CHARM_NOW='2026-11-30T08:00:00Z';
 let charm=charmOf(await list(domains));
 assert.equal(charm.charm.running,true);assert.equal(charm.status,'active');
 const stopped=fixture();
 process.env.GODSPEED_CHARM_NOW='2026-10-25T08:00:00Z';
 addonCommand(stopped.store,{addon:'charm',args:['stop']});
 charm=charmOf(await list(stopped.domains));
 assert.deepEqual({running:charm.charm.running,daysToGo:charm.charm.daysToGo,brief:charm.brief},{running:false,daysToGo:null,brief:null});
});

test('a broken charm row or settings file does not break tracker-list: the tracker lists with charm null',async()=>{
 const {store,query,domains}=fixture();
 await domains.invoke('personal-operation',{type:'tracker-create',name:'Belly',unit:'cm'});
 process.env.GODSPEED_CHARM_NOW='2026-10-30T08:00:00Z';
 const tracker=findTracker(store.root);
 // A start whose day is not a day: the count cannot be worked out from it.
 query.execute({table:'collection_items',operation:'insert',values:{collection_id:tracker.id,data:{kind:'start',when:'2026-10-25T08:00:00Z',date:'not a day'}}});
 let result=await list(domains);
 assert.deepEqual(result.trackers.map(t=>t.name).sort(),['Belly','Charm Challenge']);
 let charm=charmOf(result);assert.equal(charm.charm,null);assert.equal(charm.brief,null);assert.equal(charm.id,tracker.id);
 // A settings file nobody can read: the same.
 const items=store.list('collection_items').filter(i=>i.collection_id===tracker.id&&i.data?.date==='not a day');
 for(const i of items)query.execute({table:'collection_items',operation:'delete',filters:[['eq','id',i.id]]});
 assert.equal(charmOf(await list(domains)).charm.daysToGo,12,'the count is back once the row is gone');
 fs.writeFileSync(path.join(store.root,'routines','charm','settings.json'),'{not json');
 result=await list(domains);charm=charmOf(result);
 assert.equal(charm.charm,null);assert.equal(charm.brief,null);assert.equal(result.trackers.length,2);
});

test('no challenge ever started: no charm tracker in the list',async()=>{
 const {domains}=fixture({start:false});
 assert.equal(charmOf(await list(domains)),undefined);
});
