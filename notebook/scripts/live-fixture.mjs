import fs from 'node:fs';
import path from 'node:path';
import {modelProvider} from '../core/runtime.mjs';
import {createService} from '../server/main.mjs';
const root=path.resolve(process.argv[2]),image=path.resolve(process.argv[3]);
if(!process.env.OPENROUTER_API_KEY)throw new Error('Test provider key unavailable');
const provider=modelProvider({url:'https://openrouter.ai/api/v1/chat/completions',key:process.env.OPENROUTER_API_KEY,model:process.env.GODSPEED_FIXTURE_MODEL||'qwen/qwen3.8-27b:free',maxTokens:4096});
const service=await createService({root,port:0,provider});
try{
  const base='http://127.0.0.1:'+service.address.port;
  // The notebook's own goal work was removed on 18 October 2026; the goal loop's live acceptance is
  // notebook/test/acceptance/goal-loop-wsl.sh. This fixture keeps the live media check.
  const note=service.store.save('notes',{title:'Synthetic receipt',content:'A test document, containing no personal data.'});
  const form=new FormData();form.append('file',new Blob([fs.readFileSync(image)],{type:'image/png'}),'receipt.png');form.append('path','synthetic/receipt.png');
  if(!(await fetch(base+'/api/media/upload',{method:'POST',body:form})).ok)throw new Error('Upload failed');
  const analysis=await service.domains.invoke('analyze-media',{note_id:note.id,storage_path:'synthetic/receipt.png',media_type:'image',original_filename:'receipt.png'});
  if(!JSON.stringify(analysis).includes('12.00'))throw new Error('OCR did not retain the printed total');
  const evidence={provider:'OpenRouter',model:process.env.GODSPEED_FIXTURE_MODEL||'qwen/qwen3.8-27b:free',at:new Date().toISOString(),syntheticOnly:true,media:'Printed receipt total extracted from actual image',records:service.store.records.size};
  fs.writeFileSync(path.join(root,'live-evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{await service.close();}
