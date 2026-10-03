import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';import {backup,restore} from '../core/archives.mjs';
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-native-'));
test('native coach and journal commands share canonical notebook files and survive backup restore',async()=>{
 const store=new Store(temp()),query=new QueryService(store),domains=new Domains(query);
 const command=(addon,args)=>domains.invoke('personal-operation',{type:'addon-command',addon,args});
 const talk=await domains.invoke('personal-operation',{type:'coach-open',area:'relationships',question:'What matters in the fictional conversation?'});
 await command('coach',['talk','said','relationships','--words','I want to listen first.']);assert.ok(query.rows('coach_talks')[0].replies.some(r=>r.content.includes('listen first')));
 await command('journal',['start','Fictional conversation preparation','--done-means','Draft has a listening question']);assert.ok(query.rows('journal').some(j=>j.kind==='start'));
 await command('journal',['note','Fictional preparation started']);assert.ok(query.rows('journal').some(j=>j.content==='Fictional preparation started'));
 assert.throws(()=>query.execute({table:'coach_talks',operation:'insert',values:{title:'A parallel talk'}}),/read-only/);
 const media=temp(),archive=path.join(temp(),'backup');backup(store,media,archive);const fresh=new Store(temp()),newMedia=path.join(temp(),'media');restore(fresh,newMedia,archive);
 const rebuilt=new QueryService(fresh);assert.equal(rebuilt.rows('coach_talks')[0].id,talk.id);assert.ok(rebuilt.rows('journal').some(j=>j.content==='Fictional preparation started'));
 assert.equal(store.list('coach_talks').length,0);assert.equal(store.list('journal').length,0);
});
