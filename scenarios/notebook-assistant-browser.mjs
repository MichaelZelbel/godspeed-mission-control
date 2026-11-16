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
const profile=path.join(evidence,'.chromium-profile'),port=48764;
let browser,fixture,ws,browserOut,browserErr;
let browserExited;
const browserGone=new Promise(resolve=>{browserExited=resolve;});
const observationPages=[];
let routeError;
const fixtureRows=[];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const deadline=Number(process.env.BROWSER_TEST_TIMEOUT_MS)||15000;
const within=(promise,what)=>Promise.race([promise,pause(deadline).then(()=>{throw Error(`${what} did not finish within ${deadline/1000} seconds`);})]);
const fetchWithin=async(url,options={},what='request')=>{
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),deadline);
  try{return await fetch(url,{...options,signal:controller.signal});}
  catch(error){if(error?.name==='AbortError')throw Error(`${what} did not finish within ${deadline/1000} seconds`);throw error;}
  finally{clearTimeout(timer);}
};
const fetchJsonWithin=async(url,options={},what='request')=>{
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),deadline);
  try{
    const response=await fetch(url,{...options,signal:controller.signal});
    return {response,body:await response.json()};
  } catch(error) {
    if(error?.name==='AbortError')throw Error(`${what} did not finish within ${deadline/1000} seconds`);
    throw error;
  } finally {clearTimeout(timer);}
};
const waitForBrowserExit=async timeout=>{
  if(browser.exitCode!==null||browser.signalCode!==null)return true;
  return Promise.race([new Promise(r=>browser.once('exit',()=>r(true))),pause(timeout).then(()=>false)]);
};
const command=(program,args)=>new Promise((ok,no)=>{let out='';const p=spawn(program,args);p.stdout.on('data',x=>out+=x);p.once('error',no);p.once('exit',code=>code===0?ok(out.trim()):no(Error(`${program} ${args.join(' ')} failed`)));});
const stopBrowser=async()=>{
  if(!browser)return true;
  if(!Number.isInteger(browser.pid))return true;
  const exists=()=>{try{process.kill(-browser.pid,0);return true;}catch(error){if(error?.code==='ESRCH')return false;throw error;}};
  const signal=kind=>{try{process.kill(-browser.pid,kind);}catch(error){if(error?.code!=='ESRCH')throw error;}};
  const goneWithin=async timeout=>{for(let elapsed=0;elapsed<timeout;elapsed+=50){if(!exists())return true;await pause(50);}return !exists();};
  if(!exists())return true;
  signal('SIGTERM');
  if(!await goneWithin(5000)){signal('SIGKILL');if(!await goneWithin(5000))return false;}
  await waitForBrowserExit(1000);
  return true;
};
let seq=0;const pending=new Map();
const cdp=(method,params={})=>within(Promise.race([new Promise((ok,no)=>{const id=++seq;pending.set(id,[ok,no]);ws.send(JSON.stringify({id,method,params}));}),browserGone.then(()=>{throw Error('Chromium exited during browser observation');})]),`Chromium ${method}`);
const js=async expression=>(await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result.value;
const go=async url=>{await cdp('Page.navigate',{url});await pause(1200);};
const action=async(name,fn)=>{globalThis.phase=name;try{await fn();actions.push({name,ok:true});}catch(e){actions.push({name,ok:false,error:e.message});throw e;}};
const formValue=label=>js(`(()=>{const l=[...document.querySelectorAll('label')].find(x=>x.textContent.includes(${JSON.stringify(label)}));const e=l&&(l.htmlFor?document.getElementById(l.htmlFor):l.parentElement?.querySelector('input,select'));return e&&e.value})()`);
const observeProvider=async name=>write(name,{service:(await formValue('Your AI service'))==='other'?'Another service':'',url:await formValue('Its address'),model:await formValue('Model, written'),key:(await js(`document.body.innerText.includes('leave it empty to keep the saved one')`))===true});
const snapshots=[];
const stateFrom=(text,model)=>/no ai connected/i.test(text+' '+model)?'none':/could not be used|could not be reached|unreachable/i.test(text)?'unreachable':/refused|check Settings, Your AI/i.test(text)?'refused':'connected';
const pageSocket=async url=>{
  const {response,body:target}=await fetchJsonWithin(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`,{method:'PUT'},'Chromium observation-tab request');
  if(!response.ok)throw Error('Chromium could not open an observation tab');
  const socket=new WebSocket(target.webSocketDebuggerUrl);
  try{await within(new Promise((ok,no)=>{socket.onopen=ok;socket.onerror=no}),'Chromium observation-tab connection');}
  catch(error){socket.close();throw error;}
  let number=0;const waiting=new Map();socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.id&&waiting.has(message.id)){const [ok,no]=waiting.get(message.id);waiting.delete(message.id);message.error?no(Error(message.error.message)):ok(message.result);}};
  socket.onclose=()=>{for(const [,no] of waiting.values())no(Error('Chromium closed an observation tab'));waiting.clear();};
  const call=(method,params={})=>within(Promise.race([new Promise((ok,no)=>{const id=++number;waiting.set(id,[ok,no]);socket.send(JSON.stringify({id,method,params}));}),browserGone.then(()=>{throw Error('Chromium exited during browser observation');})]),`observation tab ${method}`);
  const evaluate=async expression=>{const answer=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(answer.exceptionDetails)throw Error(answer.exceptionDetails.exception?.description||answer.exceptionDetails.text);return answer.result.value;};
  await call('Page.enable');await call('Runtime.enable');
  for(let n=0;n<80;n++){if(await evaluate('document.readyState').catch(()=>null)==='complete')break;await pause(100);}
  await pause(700);return {socket,call,evaluate};
};
const closePage=page=>{try{page.socket.close();}catch{}};
const setViewport=async(page,width)=>{await page.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});await pause(250);};
const prepareSurface=async(page,surface)=>{
  await page.evaluate(`(()=>{const surface=${JSON.stringify(surface)};if(surface==='note-chat'&&!location.pathname.match(/^\\/dashboard\\/notes\\/[^/]+$/)){document.querySelector('a[href^="/dashboard/notes/"]')?.click();return 'navigating';}if(surface==='collection-chat'&&location.pathname==='/collections'){document.querySelector('a[href^="/collections/"]:not([href="/collections/templates"])')?.click();return 'navigating';}return 'ready'})()`);
  await pause(600);
  const result=await page.evaluate(`(()=>{const exact=t=>[...document.querySelectorAll('button,a')].find(e=>e.textContent.trim()===t||e.getAttribute('aria-label')===t);if(${JSON.stringify(surface)}==='global-chat'||${JSON.stringify(surface)}==='popout-chat'){const b=document.querySelector('[aria-label="Chat with Godspeed"]');if(b)b.click();}if(${JSON.stringify(surface)}==='note-chat'){window.dispatchEvent(new Event('godspeed:toggle-note-chat'));}if(${JSON.stringify(surface)}==='collection-chat'){const b=exact('AI Chat');if(b)b.click();}return true})()`);
  await pause(500);return result;
};
const observeSurface=async(page,phase,surface,width,extra={})=>{
  await setViewport(page,width);await prepareSurface(page,surface);
  const value=await page.evaluate(`(()=>{const composer=document.querySelector('.chat-composer'),model=composer?.querySelector('[data-chat-model]'),effort=composer?.querySelector('[data-chat-effort]'),send=composer?.querySelector('[aria-label="Send message"], [aria-label="Stop reply"]');const nodes=[...(composer?.querySelectorAll('*')||[])],clipped=nodes.some(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&(r.left<0||r.right>innerWidth+1||r.top<0||r.bottom>innerHeight+1)});return {text:(composer?.parentElement?.parentElement?.innerText||document.body.innerText).trim(),model:model?.selectedOptions?.[0]?.textContent?.trim()||model?.value||'',effort:effort?.selectedOptions?.[0]?.textContent?.trim()||'Auto',clipped,sendEnabled:!!send&&!send.disabled,hasComposer:!!composer}})()`);
  if(surface!=='dashboard'&&!value.hasComposer)throw Error(`${surface} did not expose its chat composer`);
  const capture=await page.call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(evidence,'screenshots',`${phase}-${surface}-${width}.png`),Buffer.from(capture.data,'base64'));
  snapshots.push({phase,surface,width,state:stateFrom(value.text,value.model),text:value.text,model:value.model||'No AI connected',effort:value.effort,clipped:value.clipped,sendEnabled:value.sendEnabled,...extra});
  return snapshots.at(-1);
};
const sendFrom=async(page,message)=>{
  const before=fixtureRows.length,ok=await page.evaluate(`(()=>{const input=document.querySelector('.chat-composer textarea[aria-label="Message"]'),send=document.querySelector('.chat-composer [aria-label="Send message"]');if(!input||!send)return false;const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value').set;setter.call(input,${JSON.stringify(message)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));send.click();return true})()`);if(!ok)throw Error('chat composer could not send a message');
  for(let n=0;n<100;n++){await pause(100);const busy=await page.evaluate(`!!document.querySelector('.chat-composer [aria-label="Stop reply"]')`);if(!busy&&n>2)break;}
  const reply=await page.evaluate(`(()=>{const root=document.querySelector('.chat-composer')?.parentElement?.parentElement,text=(root?.innerText||'').trim(),refusal='No AI is connected yet. Connect your AI service in Settings, Your AI, then ask Godspeed again.';if(text.includes(refusal))return refusal;const error=root?.querySelector('.text-destructive span')?.textContent?.trim();return error||text})()`);return {reply,requestObserved:fixtureRows.length>before};
};
const saveProvider=async(url,key)=>{await go(base+'/dashboard/settings#connect-ai');await fill('Your AI service','other');await pause(100);await fill('Its address',url);await fill('Model, written','standin-model-1');await fill('Key',key);await click('Test and connect');await pause(1200);};
try{
  const chrome=process.env.CHROME_PATH||process.env.CHROME_BIN||process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||[
    '/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/opt/google/chrome/chrome',
    '/usr/bin/chromium','/usr/bin/chromium-browser'
  ].find(fs.existsSync);
  if(!chrome)throw Error('Chromium is not installed at a documented executable name; set CHROME_PATH');
  browserOut=fs.openSync(path.join(evidence,'browser.stdout.log'),'a');
  browserErr=fs.openSync(path.join(evidence,'browser.stderr.log'),'a');
  browser=spawn(chrome,[`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--headless=new','--no-sandbox','--no-first-run','--disable-gpu','about:blank'],{stdio:['ignore',browserOut,browserErr],detached:true});
  browser.once('exit',browserExited);
  await new Promise((ok,no)=>{browser.once('spawn',ok);browser.once('error',no);});
  write('browser.pid',String(browser.pid)+'\n');
  if(process.env.BROWSER_TEST_READY_FILE){
    for(let n=0;n<100&&!fs.existsSync(process.env.BROWSER_TEST_READY_FILE);n++)await pause(10);
    if(!fs.existsSync(process.env.BROWSER_TEST_READY_FILE))throw Error('the test browser did not become ready');
  }
  fixture=http.createServer((request,response)=>{let body='';request.on('data',x=>body+=x);request.on('end',()=>{const operation=globalThis.momentOperation||'connect',at=globalThis.phase||'';fixtureRows.push({phase:at.includes('without-ai')?'without-ai':at.includes('with-ai')?'with-ai':at,operation:request.url?.includes('chat/completions')?'extract-moment-profile':'provider-check',action:operation});if(globalThis.providerMode==='unreachable'){request.socket.destroy();return;}const refused=globalThis.providerMode==='refused',content=/suggestions/i.test(body)?'{"suggestions":[]}':'Stand-in answer from the maintained notebook journey.';response.writeHead(refused?401:200,{'content-type':'application/json'});response.end(JSON.stringify(refused?{error:{message:'scenario key refused'}}:{id:'fixture',object:'chat.completion',created:1,model:'standin-model-1',choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));});});
  await new Promise((ok,no)=>fixture.once('error',no).listen(48763,'127.0.0.1',ok));
  if(process.env.BROWSER_TEST_SERVICE_CONTROL)await command(process.env.BROWSER_TEST_SERVICE_CONTROL,[]);
  for(let n=0;n<100;n++){if(browser.exitCode!==null||browser.signalCode!==null)throw Error('Chromium exited before exposing its debugging page');try{const {body:tabs}=await fetchJsonWithin(`http://127.0.0.1:${port}/json`,{},'Chromium debugging-page request');if(tabs[0]?.webSocketDebuggerUrl){ws=new WebSocket(tabs[0].webSocketDebuggerUrl);break;}}catch(error){if(/did not finish/.test(error.message))throw error;}await pause(100);}
  if(!ws)throw Error('Chromium did not expose its debugging page');
  try{await within(new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no}),'Chromium debugging connection');}
  catch(error){ws.close();throw error;}
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const [ok,no]=pending.get(m.id);pending.delete(m.id);m.error?no(Error(m.error.message)):ok(m.result);}else if(m.method==='Runtime.consoleAPICalled')consoleRows.push({phase:globalThis.phase||'',text:(m.params.args||[]).map(x=>x.value||x.description).join(' ')});else if(m.method==='Network.requestWillBeSent')network.push({url:m.params.request.url,method:m.params.request.method});};
  ws.onclose=()=>{for(const [,no] of pending.values())no(Error('Chromium closed its debugging connection'));pending.clear();};
  await cdp('Page.enable');await cdp('Runtime.enable');await cdp('Network.enable');
  // The exact visible interaction sequence is implemented in the page so the retained action list
  // cannot be produced by direct API writes. input/change/click are the same DOM events a person causes.
  const visible=expression=>js(`(()=>{const e=${expression};if(!e)return false;const r=e.getBoundingClientRect();return !e.disabled&&r.width>0&&r.height>0})()`);
  const waitVisible=async(expression,description)=>{for(let n=0;n<100;n++){if(await visible(expression))return;await pause(100);}throw Error('visible control not found: '+description);};
  const click=async text=>{const expression=`[...document.querySelectorAll('button,a')].find(x=>x.textContent.trim()===${JSON.stringify(text)})`;await waitVisible(expression,text);await js(`(()=>{const e=${expression};e.click();return true})()`);await pause(700);};
  const openMoment=async title=>{const ok=await js(`(()=>{const title=[...document.querySelectorAll('button p')].find(x=>x.textContent.trim()===${JSON.stringify(title)});const button=title?.closest('button');if(!button)return false;button.click();return true})()`);if(!ok)throw Error('visible Timeline moment not found: '+title);await pause(700);};
  const controlFor=label=>`(()=>{const l=[...document.querySelectorAll('label')].find(x=>x.textContent.includes(${JSON.stringify(label)}));return l&&(l.htmlFor?document.getElementById(l.htmlFor):l.querySelector('input,select,textarea')||l.parentElement?.querySelector('input,select,textarea'))})()`;
  const fill=async(label,value)=>{const expression=controlFor(label);await waitVisible(expression,label);await js(`(()=>{const e=${expression};const d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value');d.set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);};
  const chooseNewPerson=async name=>{await action('person-chosen-'+name.toLowerCase().replaceAll(' ','-'),async()=>{const picker=`document.querySelector('button[role="combobox"][aria-label="People"]')`;await waitVisible(picker,'People');await js(`(()=>{const e=${picker};e.click();return true})()`);const input=`document.querySelector('input[placeholder^="Search or type a new name"]')`;await waitVisible(input,'People name');await js(`(()=>{const e=${input};const d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value');d.set.call(e,${JSON.stringify(name)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);const option=`[...document.querySelectorAll('[role="option"]')].find(x=>x.textContent.includes(${JSON.stringify('Add "'+name+'" as a new person')}))`;await waitVisible(option,'Add '+name+' as a new person');await js(`(()=>{const e=${option};e.click();return true})()`);});};
  const screenshot=async name=>{const x=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(evidence,'screenshots',name+'.png'),Buffer.from(x.data,'base64'));};
  const moment=async(name,title,edit,person)=>{globalThis.momentOperation=edit?'edit':'save';await action(name,async()=>{if(edit){await openMoment(title);await click('Edit Moment');await fill('Title',title+' edited');await click('Save Changes');}else{await click('Add Moment');await fill('Title',title);await fill('Start Date',new Date().toISOString().slice(0,10));if(person)await chooseNewPerson(person);await click('Create Moment');}await pause(800);});};
  await go(base+'/dashboard/timeline');globalThis.phase='without-ai';
  await moment('moment-saved-without-ai','No AI fixture moment',false,'No AI Fixture Person');
  await moment('moment-edited-without-ai','No AI fixture moment',true);
  await action('collection-ready',async()=>{await go(base+'/collections');const exists=await js(`!!document.querySelector('a[href^="/collections/"]:not([href="/collections/templates"])')`);if(!exists){await click('or create a blank collection');await fill('Name','Scenario observations');await click('Create');await pause(900);await go(base+'/collections');}if(!await js(`!!document.querySelector('a[href^="/collections/"]:not([href="/collections/templates"])')`))throw Error('the visible collection setup made no collection card');});
  const routes={dashboard:'/dashboard', 'global-chat':'/dashboard', 'full-chat':'/dashboard/chat', 'note-chat':'/dashboard/notes', 'collection-chat':'/collections', 'popout-chat':'/dashboard'};
  for(const [surface,route] of Object.entries(routes)){const page=await pageSocket(base+route);observationPages.push({surface,page});}
  globalThis.phase='none';
  for(const width of [1280,375])for(const {surface,page} of observationPages)await observeSurface(page,'none',surface,width);
  for(const {surface,page} of observationPages.filter(x=>['global-chat','note-chat','collection-chat','popout-chat'].includes(x.surface))){const sent=await sendFrom(page,'No AI route observation');await observeSurface(page,'none-sent',surface,1280,{reply:sent.reply});}
  const refusal='No AI is connected yet. Connect your AI service in Settings, Your AI, then ask Godspeed again.';
  const directNoAI=await fetch(base+'/api/functions/note-chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:'No AI HTTP observation',messages:[{role:'user',content:'No AI HTTP observation'}],request_id:crypto.randomUUID()})}).then(r=>r.json());
  snapshots.push({phase:'none-sent',surface:'http-chat',width:1280,state:'none',reply:directNoAI?.error?.message||directNoAI?.error||directNoAI?.data?.content||'',httpAgreement:(directNoAI?.error?.message||directNoAI?.error)===refusal});
  const noneStatus=await fetch(base+'/api/status').then(r=>r.json());snapshots.push({phase:'none-http',surface:'http-status',width:1280,state:'none',httpAgreement:noneStatus.runtimeConfigured===false});
  await go(base+'/dashboard/settings#connect-ai');
  await action('provider-saved',async()=>{await fill('Your AI service','other');await pause(100);await fill('Its address','http://127.0.0.1:48763/v1');await fill('Model, written','fixture-model');await fill('Key','scenario-secret-never-retain');await click('Test and connect');await pause(1200);});
  await action('provider-after-navigation',async()=>{await go(base+'/dashboard/timeline');await go(base+'/dashboard/settings#connect-ai');await observeProvider('provider-navigation.json');});
  await action('provider-after-reload',async()=>{await cdp('Page.reload');await pause(1200);await observeProvider('provider-reload.json');});
  const service='godspeed-integrated-notebook.service';
  const userService=await command('systemctl',['--user','cat',service]).then(()=>true,()=>false);
  const systemctl=(...args)=>command(userService?'systemctl':'sudo',userService?['--user',...args]:['systemctl',...args]);
  await action('notebook-restarted',async()=>{const oldPid=await systemctl('show','--property=MainPID','--value',service);await systemctl('restart',service);let healthy=false;for(let n=0;n<80;n++){try{if((await fetch(base+'/health')).ok){healthy=true;break;}}catch{}await pause(250);}const newPid=await systemctl('show','--property=MainPID','--value',service);if(!healthy||!+oldPid||!+newPid||oldPid===newPid)throw Error('the notebook did not return under a new service process');write('restart.txt',`old_pid=${oldPid} new_pid=${newPid} healthy=yes\n`);});
  await action('provider-after-restart',async()=>{await go(base+'/dashboard/settings#connect-ai');await observeProvider('provider-restart.json');await screenshot('provider-after-restart');});
  await go(base+'/dashboard/timeline');globalThis.phase='with-ai';
  await moment('moment-saved-with-ai','AI fixture moment',false,'AI Fixture Person');
  await moment('moment-edited-with-ai','AI fixture moment',true);await screenshot('moments');
  write('moments.json',{'without-ai':{saved:true,edited:true,person:true},'with-ai':{saved:true,edited:true,person:true}});
  const transition=async(phase,url,key)=>{globalThis.phase=phase;globalThis.providerMode='connected';await saveProvider(url,key);globalThis.providerMode=phase==='recovered'?'connected':phase;for(const {surface,page} of observationPages){const sent=surface==='dashboard'?{}:await sendFrom(page,`${phase} old-tab observation`);await observeSurface(page,phase,surface,1280,{withoutReload:true,...sent});}};
  await transition('connected','http://127.0.0.1:48763/v1','scenario-connected-key');
  const connectedStatus=await fetch(base+'/api/status').then(r=>r.json());snapshots.push({phase:'connected-http',surface:'http-status',width:1280,state:'connected',httpAgreement:connectedStatus.runtimeConfigured===true});
  for(const width of [1280,375])for(const {surface,page} of observationPages.filter(x=>['dashboard','global-chat','note-chat','popout-chat'].includes(x.surface)))await observeSurface(page,'connected-layout',surface,width);
  await transition('refused','http://127.0.0.1:48763/v1','browser-refused-'+'key');
  for(const width of [1280,375])for(const {surface,page} of observationPages.filter(x=>['dashboard','global-chat','note-chat','popout-chat'].includes(x.surface)))await observeSurface(page,'refused-layout',surface,width);
  await transition('recovered','http://127.0.0.1:48763/v1','scenario-recovered-key');
  await transition('unreachable','http://127.0.0.1:48763/v1','scenario-unreachable-key');
  write('ai-state-evidence.json',{noAIProviderRequests:fixtureRows.filter(x=>x.phase==='none').length,snapshots});
} catch(error) {
  routeError=error;
  write('failure.json',{phase:globalThis.phase||'',message:error instanceof Error?error.message:String(error)});
} finally {
  write('actions.json',actions);write('browser-console.json',consoleRows);write('browser-network.json',network);write('fixture-requests.jsonl',fixtureRows.map(x=>JSON.stringify(x)).join('\n')+'\n');
  for(const {page} of observationPages)closePage(page);
  if(fixture?.listening)await new Promise(r=>fixture.close(r));
  try{ws?.close();}catch{}
  const browserStopped=await stopBrowser();
  if(browserOut!==undefined)fs.closeSync(browserOut);
  if(browserErr!==undefined)fs.closeSync(browserErr);
  fs.rmSync(profile,{recursive:true,force:true});
  write('cleanup.txt',`browser=${browserStopped?'stopped':'timeout'}\nfixture=${fixture?.listening?'timeout':'stopped'}\n`);
  if(!browserStopped&&!routeError){routeError=Error('Chromium process tree did not stop within 10 seconds');write('failure.json',{phase:globalThis.phase||'',message:routeError.message});}
}
if(routeError){
  console.error(`FAIL notebook-assistant-browser: ${routeError instanceof Error?routeError.message:String(routeError)}`);
  process.exitCode=1;
}
