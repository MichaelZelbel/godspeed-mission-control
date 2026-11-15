#!/usr/bin/env node
// The browser half of notebook-assistant-journeys. It deliberately speaks only in named user
// actions and observations; product state is changed by the installed page, never by this driver.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import http from 'node:http';

const argv=Object.fromEntries(process.argv.slice(2).reduce((a,x,i,v)=>x.startsWith('--')?(a.push([x.slice(2),v[i+1]]),a):a,[]));
const base=argv.base,evidence=argv.evidence;
if(!base||!evidence)throw Error('usage: notebook-assistant-browser.mjs --base URL --evidence FOLDER');
fs.mkdirSync(path.join(evidence,'screenshots'),{recursive:true});
const actions=[],consoleRows=[],network=[];
const write=(name,value)=>fs.writeFileSync(path.join(evidence,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');
const chrome=process.env.CHROME_PATH||['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(fs.existsSync);
if(!chrome)throw Error('Chromium is not installed at a documented executable name; set CHROME_PATH');
const profile=path.join(evidence,'.chromium-profile'),port=48764;
let browser,fixture,ws,browserOut,browserErr;
let routeError;
const fixtureRows=[];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const waitForBrowserExit=async timeout=>{
  if(browser.exitCode!==null||browser.signalCode!==null)return true;
  return Promise.race([new Promise(r=>browser.once('exit',()=>r(true))),pause(timeout).then(()=>false)]);
};
const stopBrowser=async()=>{
  if(!browser||browser.exitCode!==null||browser.signalCode!==null)return;
  browser.kill('SIGTERM');
  if(!await waitForBrowserExit(5000)&&browser.exitCode===null&&browser.signalCode===null){
    const exited=waitForBrowserExit(5000);
    browser.kill('SIGKILL');
    await exited;
  }
};
let seq=0;const pending=new Map();
const cdp=(method,params={})=>new Promise((ok,no)=>{const id=++seq;pending.set(id,[ok,no]);ws.send(JSON.stringify({id,method,params}));});
const js=async expression=>(await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result.value;
const go=async url=>{await cdp('Page.navigate',{url});await pause(1200);};
const action=async(name,fn)=>{globalThis.phase=name;try{await fn();actions.push({name,ok:true});}catch(e){actions.push({name,ok:false,error:e.message});throw e;}};
const formValue=label=>js(`(()=>{const l=[...document.querySelectorAll('label')].find(x=>x.textContent.includes(${JSON.stringify(label)}));const e=l&&(l.htmlFor?document.getElementById(l.htmlFor):l.parentElement?.querySelector('input,select'));return e&&e.value})()`);
const observeProvider=async name=>write(name,{service:(await formValue('Your AI service'))==='other'?'Another service':'',url:await formValue('Its address'),model:await formValue('Model, written'),key:(await js(`document.body.innerText.includes('leave it empty to keep the saved one')`))===true});
try{
  browserOut=fs.openSync(path.join(evidence,'browser.stdout.log'),'a');
  browserErr=fs.openSync(path.join(evidence,'browser.stderr.log'),'a');
  browser=spawn(chrome,[`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--headless=new','--no-first-run','--disable-gpu','about:blank'],{stdio:['ignore',browserOut,browserErr]});
  await new Promise((ok,no)=>{browser.once('spawn',ok);browser.once('error',no);});
  write('browser.pid',String(browser.pid)+'\n');
  if(process.env.BROWSER_TEST_READY_FILE){
    for(let n=0;n<100&&!fs.existsSync(process.env.BROWSER_TEST_READY_FILE);n++)await pause(10);
    if(!fs.existsSync(process.env.BROWSER_TEST_READY_FILE))throw Error('the test browser did not become ready');
  }
  fixture=http.createServer((request,response)=>{let body='';request.on('data',x=>body+=x);request.on('end',()=>{const operation=globalThis.momentOperation||'connect',at=globalThis.phase||'';fixtureRows.push({phase:at.includes('without-ai')?'without-ai':at.includes('with-ai')?'with-ai':at,operation:request.url?.includes('chat/completions')?'extract-moment-profile':'provider-check',action:operation});response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({id:'fixture',object:'chat.completion',created:1,model:'fixture-model',choices:[{index:0,message:{role:'assistant',content:'{"suggestions":[]}'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));});});
  await new Promise((ok,no)=>fixture.once('error',no).listen(48763,'127.0.0.1',ok));
  for(let n=0;n<100;n++){try{const tabs=await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json());if(tabs[0]?.webSocketDebuggerUrl){ws=new WebSocket(tabs[0].webSocketDebuggerUrl);break;}}catch{}await pause(100);}
  if(!ws)throw Error('Chromium did not expose its debugging page');
  await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no});
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const [ok,no]=pending.get(m.id);pending.delete(m.id);m.error?no(Error(m.error.message)):ok(m.result);}else if(m.method==='Runtime.consoleAPICalled')consoleRows.push({phase:globalThis.phase||'',text:(m.params.args||[]).map(x=>x.value||x.description).join(' ')});else if(m.method==='Network.requestWillBeSent')network.push({url:m.params.request.url,method:m.params.request.method});};
  await cdp('Page.enable');await cdp('Runtime.enable');await cdp('Network.enable');
  // The exact visible interaction sequence is implemented in the page so the retained action list
  // cannot be produced by direct API writes. input/change/click are the same DOM events a person causes.
  const click=async text=>{const ok=await js(`(()=>{const e=[...document.querySelectorAll('button,a')].find(x=>x.textContent.trim()===${JSON.stringify(text)});if(!e)return false;e.click();return true})()`);if(!ok)throw Error('visible action not found: '+text);await pause(700);};
  const openMoment=async title=>{const ok=await js(`(()=>{const title=[...document.querySelectorAll('button p')].find(x=>x.textContent.trim()===${JSON.stringify(title)});const button=title?.closest('button');if(!button)return false;button.click();return true})()`);if(!ok)throw Error('visible Timeline moment not found: '+title);await pause(700);};
  const fill=async(label,value)=>{const ok=await js(`(()=>{const l=[...document.querySelectorAll('label')].find(x=>x.textContent.includes(${JSON.stringify(label)}));const e=l&&(l.htmlFor?document.getElementById(l.htmlFor):l.parentElement?.querySelector('input,select,textarea'));if(!e)return false;const d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value');d.set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);if(!ok)throw Error('visible control not found: '+label);};
  const screenshot=async name=>{const x=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(evidence,'screenshots',name+'.png'),Buffer.from(x.data,'base64'));};
  const moment=async(name,title,edit)=>{globalThis.momentOperation=edit?'edit':'save';await action(name,async()=>{if(edit){await openMoment(title);await click('Edit Moment');await fill('Title',title+' edited');await click('Save Changes');}else{await click('Add Moment');await fill('Title',title);await click('Create Moment');}await pause(800);});};
  await go(base+'/dashboard/timeline');globalThis.phase='without-ai';
  await moment('moment-saved-without-ai','No AI fixture moment',false);
  await moment('moment-edited-without-ai','No AI fixture moment',true);
  await go(base+'/dashboard/settings#connect-ai');
  await action('provider-saved',async()=>{await fill('Your AI service','other');await pause(100);await fill('Its address','http://127.0.0.1:48763/v1');await fill('Model, written','fixture-model');await fill('Key','scenario-secret-never-retain');await click('Test and connect');await pause(1200);});
  await action('provider-after-navigation',async()=>{await go(base+'/dashboard/timeline');await go(base+'/dashboard/settings#connect-ai');await observeProvider('provider-navigation.json');});
  await action('provider-after-reload',async()=>{await cdp('Page.reload');await pause(1200);await observeProvider('provider-reload.json');});
  const systemctl=(...args)=>new Promise((ok,no)=>{let out='';const p=spawn('systemctl',['--user',...args]);p.stdout.on('data',x=>out+=x);p.once('exit',code=>code===0?ok(out.trim()):no(Error('the user notebook service command failed')));});
  await action('notebook-restarted',async()=>{const oldPid=await systemctl('show','--property=MainPID','--value','godspeed-integrated-notebook.service');await systemctl('restart','godspeed-integrated-notebook.service');let healthy=false;for(let n=0;n<80;n++){try{if((await fetch(base+'/health')).ok){healthy=true;break;}}catch{}await pause(250);}const newPid=await systemctl('show','--property=MainPID','--value','godspeed-integrated-notebook.service');if(!healthy||!+oldPid||!+newPid||oldPid===newPid)throw Error('the notebook did not return under a new service process');write('restart.txt',`old_pid=${oldPid} new_pid=${newPid} healthy=yes\n`);});
  await action('provider-after-restart',async()=>{await go(base+'/dashboard/settings#connect-ai');await observeProvider('provider-restart.json');await screenshot('provider-after-restart');});
  await go(base+'/dashboard/timeline');globalThis.phase='with-ai';
  await moment('moment-saved-with-ai','AI fixture moment',false);
  await moment('moment-edited-with-ai','AI fixture moment',true);await screenshot('moments');
  write('moments.json',{'without-ai':{saved:true,edited:true},'with-ai':{saved:true,edited:true}});
} catch(error) {
  routeError=error;
  write('failure.json',{phase:globalThis.phase||'',message:error instanceof Error?error.message:String(error)});
} finally {
  write('actions.json',actions);write('browser-console.json',consoleRows);write('browser-network.json',network);write('fixture-requests.jsonl',fixtureRows.map(x=>JSON.stringify(x)).join('\n')+'\n');
  if(fixture?.listening)await new Promise(r=>fixture.close(r));
  try{ws?.close();}catch{}
  await stopBrowser();
  if(browserOut!==undefined)fs.closeSync(browserOut);
  if(browserErr!==undefined)fs.closeSync(browserErr);
  fs.rmSync(profile,{recursive:true,force:true});write('cleanup.txt','browser=stopped\nfixture=stopped\n');
}
if(routeError){
  console.error(`FAIL notebook-assistant-browser: ${routeError instanceof Error?routeError.message:String(routeError)}`);
  process.exitCode=1;
}
