import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {FileSync} from '../core/sync/git.mjs';

// A save set aside instead of replayed (its files changed after it was prepared) is a
// problem the owner sees, never a reason to stop syncing every other note.
test('a set-aside save is listed as a problem but does not stop sync',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-set-aside-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new Store(root);store.save('notes',{title:'Kept',content:'whole'});
 fs.mkdirSync(path.join(store.state,'transactions-set-aside','00000000-0000-4000-8000-000000000001'),{recursive:true});
 store.scan(true);
 assert.ok(store.problems.some(p=>p.set_aside),'the set-aside save is reported');
 assert.doesNotThrow(()=>new FileSync(store).validate());
 // A page that does not read still stops sync, as the contract says.
 fs.writeFileSync(path.join(store.recordsRoot,'Broken.md'),'---\nid: broken\nuid: [unclosed\n---\nText');store.scan(true);
 assert.throws(()=>new FileSync(store).validate(),/Resolve record validation problems/);
});
