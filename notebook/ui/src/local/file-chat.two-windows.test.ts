// @vitest-environment jsdom
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';

const toastError=vi.hoisted(()=>vi.fn());
vi.mock('sonner',()=>({toast:{error:toastError}}));

type Chat=typeof import('./file-chat');
type Message={role:'user'|'assistant',content:string};
const key='note:fictional-two-windows';
const realFetch=globalThis.fetch;
let root='',base='',stop=async()=>{},failSaves=false;
const chat=(...messages:Message[])=>({messages,summary:'',summarizedUpTo:0});
const user=(content:string):Message=>({role:'user',content}),assistant=(content:string):Message=>({role:'assistant',content});
// Each browser window loads its own copy of the module, as the note's panel and its pop-out do.
async function openWindow():Promise<Chat>{
  vi.resetModules();
  const window=await import('./file-chat');
  await window.hydrateFileChats();
  return window;
}
async function stored(){
  const r=await realFetch(base+'/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({table:'note_conversations'})});
  return (await r.json()).data.find((row:any)=>row.context_key===key)?.state.messages;
}
// The notebook server in a process of its own, as the browser windows meet it.
function startServer(){
  return new Promise<void>((resolve,reject)=>{
    const script=`import('./server/main.mjs').then(async({createService})=>{const service=await createService({root:process.argv[1],port:0});console.log(service.address.port);process.on('SIGTERM',async()=>{await service.close();process.exit(0);});})`;
    const child=spawn(process.execPath,['--input-type=module','-e',script,root],{cwd:path.resolve(process.cwd(),'..'),stdio:['ignore','pipe','pipe']});
    let stderr='';child.stderr.on('data',data=>stderr+=data);child.once('error',reject);
    child.stdout.once('data',data=>{
      const port=Number(String(data).trim());if(!port)return reject(new Error(stderr||'server did not start'));
      base='http://127.0.0.1:'+port;
      stop=()=>new Promise<void>(done=>{child.once('exit',()=>done());child.kill('SIGTERM');});
      resolve();
    });
  });
}

beforeEach(async()=>{
  toastError.mockClear();failSaves=false;
  root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-two-windows-'));
  await startServer();
  vi.stubGlobal('fetch',(url:string,init?:RequestInit)=>failSaves&&url==='/api/chat-state'?Promise.resolve(new Response('{}',{status:500})):realFetch(base+url,init));
});
afterEach(async()=>{vi.unstubAllGlobals();await stop();fs.rmSync(root,{recursive:true,force:true});});

it('keeps every turn from a note panel and its pop-out, in send order, without a save error, and both windows show it',async()=>{
  const q1=user('Fictional first question'),a1=assistant('Fictional first answer');
  const panel=await openWindow();
  panel.saveFileChat(key,chat(q1,a1));
  await vi.waitFor(async()=>expect(await stored()).toHaveLength(2));
  const popout=await openWindow();
  const q2=user('Fictional panel question'),a2=assistant('Fictional panel answer');
  const q3=user('Fictional pop-out question'),a3=assistant('Fictional pop-out answer');
  panel.saveFileChat(key,chat(q1,a1,q2,a2));
  // Sent from the pop-out before it heard of the panel's turn.
  popout.saveFileChat(key,chat(q1,a1,q3));
  popout.saveFileChat(key,chat(q1,a1,q3,a3));
  const both=[q1,a1,q2,a2,q3,a3];
  await vi.waitFor(()=>{expect(popout.loadFileChat(key).messages).toEqual(both);expect(panel.loadFileChat(key).messages).toEqual(both);});
  const q4=user('Fictional second panel question'),a4=assistant('Fictional second panel answer');
  panel.saveFileChat(key,chat(...both,q4,a4));
  await vi.waitFor(()=>expect(popout.loadFileChat(key).messages).toEqual([...both,q4,a4]));
  expect(await stored()).toEqual([...both,q4,a4]);
  expect(toastError).not.toHaveBeenCalled();
});

it('shows a failed save once and not again for the save that works after it',async()=>{
  const panel=await openWindow(),q1=user('Fictional question'),a1=assistant('Fictional answer');
  failSaves=true;
  panel.saveFileChat(key,chat(q1));
  await vi.waitFor(()=>expect(toastError).toHaveBeenCalledTimes(1));
  failSaves=false;
  panel.saveFileChat(key,chat(q1,a1));
  await vi.waitFor(async()=>expect(await stored()).toEqual([q1,a1]));
  expect(toastError).toHaveBeenCalledTimes(1);
  expect(toastError).toHaveBeenCalledWith('Conversation history was not saved. Keep this window open and retry.');
});
