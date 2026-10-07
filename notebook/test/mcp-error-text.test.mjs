import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createService} from '../server/main.mjs';

// The HTTP API shows a person the plain reason for a refusal and keeps
// internals (server paths, a program's own error text) in its log. The MCP
// endpoint handed an assistant the raw text of any error, internal ones and
// those naming files on the server included (7 October 2026).
test('MCP tool errors are told as the HTTP API tells them',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-mcp-errors-'));
  const s=await createService({root,port:0});t.after(async()=>{await s.close();fs.rmSync(root,{recursive:true,force:true});});
  const call=async(name,args)=>{const response=await fetch('http://127.0.0.1:'+s.address.port+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});return (await response.json()).result;};
  const errors=[];const log=console.error;console.error=(...args)=>errors.push(args);t.after(()=>{console.error=log;});
  // An internal failure: a malformed call the tool did not expect.
  const internal=await call('save_record',{type:'notes'});
  assert.equal(internal.isError,true);
  assert.doesNotMatch(internal.content[0].text,/Cannot read properties|undefined/);
  assert.match(internal.content[0].text,/Something went wrong on the server/);
  // A refusal meant for the caller is still said plainly.
  const refusal=await call('get_note',{note_id:'missing'});
  assert.equal(refusal.isError,true);
  assert.equal(refusal.content[0].text,'Choose a visible existing note');
});
