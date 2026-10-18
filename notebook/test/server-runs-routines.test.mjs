import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createService} from '../server/main.mjs';
import {atomic} from '../core/records/store.mjs';

// Settings' "The server runs the routines" (until 9 October 2026 "VPS owns schedules") names the
// server this computer is paired with. It sent the name 'vps', which only the one-click server
// has: with any other server, no machine ran the routines any more.
const root=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-server-routines-'));
const post=async(service,route,body={})=>{const r=await fetch('http://127.0.0.1:'+service.address.port+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
const installed=service=>service.store.save('settings',{id:'installation',owner:service.scheduler.device,timezone:'Europe/Berlin',delivery:'notebook'});

test('the server runs the routines: the paired server by its own name, on the server itself, and never a name nobody has',async t=>{
  const server=await createService({root:root(),device:'vps',port:0}),computer=await createService({root:root(),device:'desktop-3f9a1c2e',port:0});
  t.after(async()=>{await server.close();await computer.close();});
  installed(server);installed(computer);
  // Not paired yet: said, and nothing changes.
  const unpaired=await post(computer,'/api/owner',{owner:'server'});
  assert.equal(unpaired.status,400);assert.match(unpaired.data.error,/Pair this computer with your server first/);
  assert.equal(computer.store.get('settings','installation').owner,'desktop-3f9a1c2e');
  // Pairing tells the computer the server's name.
  const code=(await post(server,'/api/pair/create')).data.code;
  await computer.mediaSync.pair('http://127.0.0.1:'+server.address.port,code);
  assert.equal(computer.mediaSync.server(),'vps');
  assert.equal((await post(computer,'/api/owner',{owner:'server'})).data.owner,'vps');
  assert.equal(computer.store.get('settings','installation').owner,'vps');
  // A server called anything else is named as it is called.
  const pairing=path.join(computer.store.state,'pair.json'),config=JSON.parse(fs.readFileSync(pairing,'utf8'));
  atomic(pairing,JSON.stringify({...config,device:'production'}));
  assert.equal((await post(computer,'/api/owner',{owner:'server'})).data.owner,'production');
  // A pairing made before the server said its name was made with the one-click server, 'vps'.
  atomic(pairing,JSON.stringify({origin:config.origin,key:config.key,offline:'all'}));
  assert.equal((await post(computer,'/api/owner',{owner:'server'})).data.owner,'vps');
  assert.equal((await post(computer,'/api/owner',{owner:'this'})).data.owner,'desktop-3f9a1c2e');
  // On the server's own page the server is this machine.
  assert.equal((await post(server,'/api/owner',{owner:'server'})).data.owner,'vps');
});
