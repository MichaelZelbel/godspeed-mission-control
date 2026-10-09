import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';

// 9 October 2026, a live run: the assistant wrote a goal card by hand, with no FILED line, and the
// notebook showed it as filed on 1 January 1970. A card without that day shows the day its file
// was written instead, and a card with one keeps it.
test('a goal card written by hand shows the day its file was written, never 1970',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-card-dates-'));fs.mkdirSync(path.join(root,'goals'),{recursive:true});
 fs.writeFileSync(path.join(root,'goals','by-hand.md'),'goals/by-hand.md\nID: by-hand\nTITLE: Win two fictional clients\nSTATUS: adopted\nALLOWED: research and drafts\n');
 fs.writeFileSync(path.join(root,'goals','filed.md'),'ID: filed\nTITLE: A filed goal\nSTATUS: adopted\nFILED: 2026-09-30\n\n## Log\n- 2026-09-30 FILED adopted outcome, source: test\n');
 const query=new QueryService(new Store(root));query.nativeHermesHome=path.join(root,'assistant');
 const rows=query.rows('goals'),byHand=rows.find(g=>g.id==='by-hand'),filed=rows.find(g=>g.id==='filed');
 assert.ok(byHand&&filed,JSON.stringify(rows.map(r=>r.id)));
 assert.doesNotMatch(String(byHand.created_at),/^1970/);
 const day=new Date(byHand.created_at).toISOString().slice(0,10),written=fs.statSync(path.join(root,'goals','by-hand.md'));
 assert.ok([written.birthtime,written.mtime].some(d=>d.toISOString().slice(0,10)===day),'the file\'s own day: '+byHand.created_at);
 assert.equal(filed.created_at,'2026-09-30');
});
