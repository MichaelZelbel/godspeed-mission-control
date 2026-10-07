import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createService} from '../server/main.mjs';
import {transcribeRecording} from '../core/dictation.mjs';

test('dictation rejects unsupported, empty and oversized recordings before starting Hermes',async()=>{
  await assert.rejects(transcribeRecording(null,'',Buffer.from('x'),'text/plain'),/format/);
  await assert.rejects(transcribeRecording(null,'',Buffer.alloc(0),'audio/webm'),/one minute/);
  await assert.rejects(transcribeRecording(null,'',Buffer.alloc(8*1024*1024+1),'audio/webm'),/one minute/);
  await assert.rejects(transcribeRecording(null,'',Buffer.from('x'),'audio/webm;codecs=opus'),/Connect Hermes/);
});
test('dictation endpoint refuses cross-site audio and recovers after an invalid recording',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-dictation-test-'));
  const service=await createService({root,port:0,provider:async()=>''});
  const url='http://127.0.0.1:'+service.address.port+'/api/chat/transcribe';
  try{
    const denied=await fetch(url,{method:'POST',headers:{Origin:'https://other.example','Content-Type':'audio/webm'},body:'audio'});
    assert.equal(denied.status,403);
    for(let i=0;i<2;i++){
      const response=await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain'},body:'audio'});
      assert.equal(response.status,400);assert.match((await response.json()).error,/format/);
    }
  }finally{await service.close();}
});
