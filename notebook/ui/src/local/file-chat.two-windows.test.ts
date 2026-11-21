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
let root='',base='',stop=async()=>{},failSaves=false,unreachable=false;
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
  toastError.mockClear();failSaves=false;unreachable=false;
  root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-two-windows-'));
  await startServer();
  // The browser rejects a request to a server it cannot reach with a TypeError, "Failed to fetch".
  vi.stubGlobal('fetch',(url:string,init?:RequestInit)=>url!=='/api/chat-state'?realFetch(base+url,init):unreachable?Promise.reject(new TypeError('Failed to fetch')):failSaves?Promise.resolve(new Response('{}',{status:500})):realFetch(base+url,init));
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

it('names a save that cannot reach the server the same way, once',async()=>{
  const panel=await openWindow(),q1=user('Fictional question'),a1=assistant('Fictional answer');
  unreachable=true;
  panel.saveFileChat(key,chat(q1));
  await vi.waitFor(()=>expect(toastError).toHaveBeenCalledTimes(1));
  expect(toastError).toHaveBeenCalledWith('Conversation history was not saved. Keep this window open and retry.');
  unreachable=false;
  panel.saveFileChat(key,chat(q1,a1));
  await vi.waitFor(async()=>expect(await stored()).toEqual([q1,a1]));
  expect(toastError).toHaveBeenCalledTimes(1);
});

it('keeps each message once when both windows save a question before either hears of the other, then each saves its reply',async()=>{
  const q1=user('Fictional first question'),a1=assistant('Fictional first answer');
  const panel=await openWindow();
  panel.saveFileChat(key,chat(q1,a1));
  await vi.waitFor(async()=>expect(await stored()).toHaveLength(2));
  const popout=await openWindow();
  const q2=user('Fictional panel question'),a2=assistant('Fictional panel answer');
  const q3=user('Fictional pop-out question'),a3=assistant('Fictional pop-out answer');
  panel.saveFileChat(key,chat(q1,a1,q2));
  popout.saveFileChat(key,chat(q1,a1,q3));
  await vi.waitFor(()=>{expect(panel.loadFileChat(key).messages).toEqual([q1,a1,q2,q3]);expect(popout.loadFileChat(key).messages).toEqual([q1,a1,q2,q3]);});
  // Each chat panel adds its reply to the history it held when it sent.
  panel.saveFileChat(key,chat(q1,a1,q2,a2));
  await vi.waitFor(()=>expect(popout.loadFileChat(key).messages).toEqual([q1,a1,q2,q3,a2]));
  popout.saveFileChat(key,chat(q1,a1,q3,a3));
  const all=[q1,a1,q2,q3,a2,a3];
  await vi.waitFor(()=>{expect(panel.loadFileChat(key).messages).toEqual(all);expect(popout.loadFileChat(key).messages).toEqual(all);});
  expect(await stored()).toEqual(all);
  expect(toastError).not.toHaveBeenCalled();
});

it('keeps a turn whose save failed once the other window saves, and both windows show it',async()=>{
  const q1=user('Fictional question'),a1=assistant('Fictional answer');
  const panel=await openWindow();
  panel.saveFileChat(key,chat(q1,a1));
  await vi.waitFor(async()=>expect(await stored()).toHaveLength(2));
  const popout=await openWindow();
  const unsaved=user('Fictional panel question that failed to save'),later=user('Fictional pop-out question');
  failSaves=true;
  panel.saveFileChat(key,chat(q1,a1,unsaved));
  await vi.waitFor(()=>expect(toastError).toHaveBeenCalledTimes(1));
  failSaves=false;
  popout.saveFileChat(key,chat(q1,a1,later));
  const both=[q1,a1,later,unsaved];
  await vi.waitFor(()=>{expect(panel.loadFileChat(key).messages).toEqual(both);expect(popout.loadFileChat(key).messages).toEqual(both);});
  expect(await stored()).toEqual(both);
  expect(toastError).toHaveBeenCalledTimes(1);
});

it('clears the conversation in the other window too, which then saves its next turn',async()=>{
  const panel=await openWindow();
  panel.saveFileChat(key,chat(user('Fictional old question'),assistant('Fictional old answer')));
  await vi.waitFor(async()=>expect(await stored()).toHaveLength(2));
  const popout=await openWindow();
  const cleared=await panel.clearFileChat(key);
  await vi.waitFor(()=>expect(popout.loadFileChat(key)).toEqual(cleared));
  expect(cleared.messages).toEqual([]);
  const next=user('Fictional question after clearing');
  popout.saveFileChat(key,{...popout.loadFileChat(key),messages:[next]});
  await vi.waitFor(()=>expect(panel.loadFileChat(key).messages).toEqual([next]));
  expect(await stored()).toEqual([next]);
  expect(toastError).not.toHaveBeenCalled();
});
