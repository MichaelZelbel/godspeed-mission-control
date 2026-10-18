import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';import {procedure} from '../core/procedures.mjs';
test('watch saves its four answers, uses one sweeper, grades candidates and caps a retained queue',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-watch-command-'))),query=new QueryService(store),domains=new Domains(query),run=args=>domains.invoke('personal-operation',{type:'watch-command',args});
 for(const slug of ['fictional-garden','fictional-rain'])await run(['add',slug,'--title',slug,'--shape','comparison','--cadence','monthly','--better','A readable sensor','--authority','The actual vendor docs','--tell-me-when','The wet-state rule changes','--url','https://example.invalid/rain']);
 assert.equal(store.list('jobs').length,1);assert.equal(store.list('watch_topics').length,2);assert.match((await run(['due'])).result,/fictional-rain/);
 const checked=new Date(Date.now()-1000).toISOString(),expiry=new Date(Date.now()+86400000).toISOString(),data={facts:[{requirement:'Wet state',evidence:'Stop watering when wet',url:'https://example.invalid/rain'}],how_we_know:'their docs claim',checked,recheck_after:expiry,verdict:'Needs a real device test'};
 await run(['candidate','fictional-garden','--name','Fictional sensor','--json',JSON.stringify(data)]);
 await assert.rejects(run(['candidate','fictional-garden','--name','Bad grade','--json',JSON.stringify({...data,how_we_know:'guessed'})]),/grade/);
 for(const slug of ['fictional-garden','fictional-rain'])await run(['file',slug,'--score','70','--what','The fictional wet rule changed','--if-ignored','Watering may continue','--next','Review the test result','--link','https://example.invalid/rain','--expires',expiry]);
 await assert.rejects(run(['pull','--channel','brief','--limit','2']),/at most one/);
 assert.equal(JSON.parse((await run(['pull','--channel','brief','--dry-run'])).result).length,1);assert.equal(JSON.parse((await run(['queue'])).result).length,2);
 await run(['pull','--channel','brief']);assert.equal(JSON.parse((await run(['queue'])).result).length,1);
 await run(['log','fictional-garden','quiet: read the changelog, nothing touched a requirement']);assert.equal((await run(['due'])).result.includes('fictional-garden'),false);
 const original=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Fictional disconnected source');};
 const topic=store.list('watch_topics').find(t=>t.slug==='fictional-rain');
 try{for(let attempt=0;attempt<4;attempt++)await procedure({kind:'watch',topic_ids:[topic.id],force_sources:true},{store,query});assert.equal(store.get('watch_topics',topic.id).blind_runs,4);assert.equal(store.list('notifications').filter(n=>n.watch_topic_id===topic.id).length,1);
 globalThis.fetch=async()=>new Response('Stop watering when wet');await procedure({kind:'watch',topic_ids:[topic.id],force_sources:true},{store,query});assert.equal(store.get('watch_topics',topic.id).blind_runs,0);assert.equal(store.list('notifications').find(n=>n.watch_topic_id===topic.id).status,'resolved');}finally{globalThis.fetch=original;}
 const chat=await domains.invoke('conversation-chat',{conversation_id:'fictional-watch',request_id:'help',message:'/watch help'});assert.match(chat.reply,/mc-watch/);
});
