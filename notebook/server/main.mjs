import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { Store, atomic, safe, hash } from '../core/records/store.mjs';
import { SearchIndex } from '../core/index/search.mjs';
import { QueryService } from '../core/query.mjs';
import { Domains } from '../core/domains.mjs';
import { Scheduler } from '../core/jobs/scheduler.mjs';
import {controlRoutine} from '../core/jobs/routine-control.mjs';
import { modelProvider, jobExecutor,hermesProvider } from '../core/runtime.mjs';
import {assistantEnvironment} from '../core/assistant-files.mjs';
import { FileSync } from '../core/sync/git.mjs';
import {conflictView,resolveSavedConflict} from '../core/conflicts.mjs';
import { SyncRunner } from '../core/sync/runner.mjs';
import { restore } from '../core/archives.mjs';
import {RecoveryRunner} from '../core/recovery-runner.mjs';
import {BackupRunner} from '../core/backup-runner.mjs';
import {saveConversationState,retainCompletedConversation} from '../core/conversation-state.mjs';
import { importExport } from '../core/import.mjs';
import { kinds } from '../core/jobs/scheduler.mjs';
import { MediaSync } from '../core/sync/media.mjs';
import { mcp } from './mcp.mjs';
import { spawn } from 'node:child_process';
import {ApiKeys,toolScope} from '../core/api-keys.mjs';
import {Telegram} from '../core/telegram.mjs';
import {browserChat} from './browser-chat.mjs';
import {transcribeRecording} from '../core/dictation.mjs';
import {durableRoots,durableFiles} from '../core/file-policy.mjs';
import { WebAuth, safeReturn } from './web-auth.mjs';
import { MenerioImport } from './menerio-import.mjs';
import {nativeAgent} from '../core/native-agent.mjs';
import {NativeScheduler} from '../core/native-scheduler.mjs';
import {visibleRows} from '../core/visibility.mjs';

export async function createService({ root, mediaRoot, host = '127.0.0.1', port = 47831, token, uiRoot, provider, device = 'local', authNow } = {}) {
  const store = new Store(root,{device}), index = new SearchIndex(store), query = new QueryService(store), sync = new FileSync(store);
  const syncRunner=new SyncRunner(root,{onResult:result=>{sync.last=result;atomic(path.join(store.state,'sync-status.json'),JSON.stringify(result));}});
  const providerPath=path.join(store.state,'provider.json');
  if(!provider&&fs.existsSync(providerPath))provider=modelProvider(JSON.parse(fs.readFileSync(providerPath,'utf8')));
  provider ||= modelProvider({url:process.env.GODSPEED_MODEL_URL,key:process.env.GODSPEED_MODEL_KEY,model:process.env.GODSPEED_MODEL});
  const assistantPath=process.env.GODSPEED_ASSISTANT_CONFIG||path.join(store.state,'assistant.json');
  if(!provider&&fs.existsSync(assistantPath)){const descriptor=JSON.parse(fs.readFileSync(assistantPath,'utf8').replace(/^\uFEFF/,''));if(descriptor.verified)provider=hermesProvider({executable:descriptor.executable,home:descriptor.home,cwd:store.root,sourceRoot:descriptor.sourceRoot});}
  let schedulerHeartbeat=new Date().toISOString();
  if(provider){const connected=provider;provider=Object.assign(async input=>{schedulerHeartbeat=new Date().toISOString();try{return await connected(input);}finally{schedulerHeartbeat=new Date().toISOString();}},connected);}
  const originalRuntime=process.env.GODSPEED_ORIGINAL_RUNTIME==='on';
  const descriptor=originalRuntime&&fs.existsSync(assistantPath)?JSON.parse(fs.readFileSync(assistantPath,'utf8').replace(/^\uFEFF/,'')):null;
  if(originalRuntime&&!descriptor?.verified)throw Error('Connect the original Godspeed assistant before starting the integrated notebook');
  const domains=new Domains(query,{provider}),scheduler=originalRuntime?new NativeScheduler(store,{...descriptor,device}):new Scheduler(store,{device,executor:jobExecutor(provider,query)});scheduler.onProgress=()=>{schedulerHeartbeat=new Date().toISOString();};
  if(originalRuntime){domains.nativeAgent=nativeAgent({...descriptor,cwd:store.root,providerFile:providerPath});domains.nativeScheduler=scheduler;query.nativeHermesHome=descriptor.home;}
  domains.sync={reconcile:()=>syncRunner.run(),pendingConflicts:()=>sync.pendingConflicts()};
  mediaRoot = path.resolve(mediaRoot || path.join(store.state, 'media')); fs.mkdirSync(mediaRoot, { recursive: true });
  domains.mediaRoot=mediaRoot;
  const mediaSync=new MediaSync(store,mediaRoot),pairCodes=new Map(),pairKeysPath=path.join(store.state,'pair-clients.json');
  const pairKeys=fs.existsSync(pairKeysPath)?JSON.parse(fs.readFileSync(pairKeysPath,'utf8')):[];
  const instance=hash(store.root).slice(0,24);
  const remote = !['127.0.0.1', '::1', 'localhost'].includes(host);
  if (remote && !token) throw new Error('Remote access requires a candidate token');
  const auth = new WebAuth(store.state, { token, remote, now: authNow });
  const menerioImport=new MenerioImport(store,mediaRoot,()=>index.rebuild());
  const chatRequests=new Map(),recoveryRunner=new RecoveryRunner(store),backupRunner=new BackupRunner(store,mediaRoot);let dictationBusy=false;
  const loginLinks=new Map();
  const apiKeys=new ApiKeys(store);
  const authorized = req => auth.authorized(req) || pairKeys.includes(hash(String(req.headers['x-godspeed-pair-key']||req.headers.authorization?.replace(/^Bearer /,'')||'')));
  function send(res, status, body, headers = {}) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }); res.end(JSON.stringify(body)); }
  async function body(req, limit = 2 * 1024 * 1024) {
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error('Request is too large'); chunks.push(chunk); }
    return Buffer.concat(chunks);
  }
  uiRoot = path.resolve(uiRoot || fileURLToPath(new URL('../ui/dist', import.meta.url)));
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost'), route = url.pathname;
      const hostName = (req.headers.host || '').split(':')[0];
      if (!remote && !['localhost', '127.0.0.1', '[', '::1'].includes(hostName)) return send(res, 403, { error: 'Unrecognized local host' });
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(res, 403, { error: 'Cross-site requests are refused' });
      if(route.startsWith('/login/')){
        const code=route.slice(7),expiry=loginLinks.get(code);if(!expiry||expiry<Date.now())return send(res,401,{error:'This login link expired or was already used'});
        loginLinks.delete(code);
        if(!auth.configured()) { res.writeHead(303,{'Location':auth.invite().path,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});return res.end(); }
        const destination=safeReturn(url.searchParams.get('next')||'/dashboard');
        res.writeHead(303,{'Location':destination,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Set-Cookie':auth.startSession(auth.read())});return res.end();
      }
      if (route.startsWith('/api/auth/') || route === '/api/login' || route === '/api/logout') {
        const input = req.method === 'POST' ? JSON.parse(await body(req, 8192)) : {};
        const result = await auth.handle(route,req,input), cookie = result.cookie;delete result.cookie;
        return send(res,200,result,cookie?{'Set-Cookie':cookie}:{});
      }
      if(route==='/api/pair/claim'&&req.method==='POST'){
        const input=JSON.parse(await body(req)),expires=pairCodes.get(input.code);if(!expires||expires<Date.now())return send(res,401,{error:'Pairing code expired or was already used'});
        pairCodes.delete(input.code);const key=randomBytes(32).toString('hex');pairKeys.push(hash(key));atomic(pairKeysPath,JSON.stringify(pairKeys));fs.chmodSync(pairKeysPath,0o600);return send(res,200,{key});
      }
      if (route === '/health') return send(res, 200, { ok: true, format: 1, version: '2.0.0-alpha.1',instance,scheduler_heartbeat:schedulerHeartbeat });
      if(route==='/api/shared-note'&&req.method==='GET'){const share=query.rows('shared_notes').find(s=>s.share_token===url.searchParams.get('token')&&s.is_active),note=share&&store.get('notes',share.note_id);if(!note||note.removed_at)return send(res,404,{error:'This share is unavailable'});return send(res,200,{title:note.title,content:note.content,tags:note.tags,entity_type:note.entity_type,created_at:note.created_at,updated_at:note.updated_at});}
      if (route.startsWith('/api/') && !authorized(req)) return send(res, 401, { error: 'Sign in to continue.', code: auth.cookie(req)?'SESSION_EXPIRED':'SIGN_IN_REQUIRED' });
      if(route==='/api/menerio/import'){
        if(!auth.authorized(req))return send(res,403,{error:'Sign in as the server owner to import.'});
        if(req.method==='GET')return send(res,200,menerioImport.status());
        if(req.method==='POST')return send(res,202,{job:await menerioImport.start(JSON.parse(await body(req,16384)))});
        return send(res,405,{error:'Use GET or POST'});
      }
      if(menerioImport.mutating&&(route==='/mcp'||route.startsWith('/api/'))&&!['/api/session','/api/status','/api/chat/options'].includes(route))return send(res,423,{error:'Your Menerio content is being copied. Wait for the import to finish.'});
      if(req.method==='POST'&&route.startsWith('/api/')&&!['/api/chat/stop','/api/backup'].includes(route))await store.waitForWriter();
      if(route==='/api/latest-work'&&req.method==='GET'){
        const notes=visibleRows(query,'notes').filter(n=>!n.is_trashed),work=visibleRows(query,'work_items').filter(w=>w.state==='verified'&&w.verification&&notes.some(n=>n.id===w.result_id)).sort((a,b)=>b.updated_at.localeCompare(a.updated_at))[0],note=work&&notes.find(n=>n.id===work.result_id);
        return send(res,200,{data:note?[note]:[],verification_current:!!note&&work.verification.content_hash===note._hash,evidence:work?.verification.evidence||null,result_kind:work?.verification.kind||null,reported_passed:work?.verification.kind==='reported-observation'?work.verification.passed:null});
      }
      if(route==='/chat'&&req.method==='GET'){
        res.writeHead(303,{'Location':'/dashboard/chat'+url.search,'Cache-Control':'no-store'});return res.end();
      }
      if(route==='/api/browser-chat'){
        const input=req.method==='POST'?JSON.parse(await body(req)):{},talkId=input.talk_id||url.searchParams.get('talk'),talk=talkId?query.rows('coach_talks').find(t=>t.id===talkId):null;if(talkId&&!talk)throw Error('Coaching conversation missing');
        const conversation=talk?'browser-owner-'+talk.id:'browser-owner';
        if(req.method==='GET')return send(res,200,{talk,messages:query.rows('conversation_messages').filter(m=>m.conversation_id===conversation).sort((a,b)=>a.created_at.localeCompare(b.created_at))});
        if(req.method==='POST'){
          if(typeof input.message!=='string'||!input.message.trim()||input.message.length>20000)throw new Error('Write a message of at most 20000 characters');
          const receiptId=input.request_id?'browser-request-'+hash([conversation,input.request_id]):null,requestHash=hash({conversation,input}),previous=receiptId?store.get('command_receipts',receiptId):null;
          if(receiptId&&chatRequests.has(receiptId))throw Error('This chat request is already running');
          if(previous){if(previous.request_hash!==requestHash)throw Error('Chat retry differs from the retained request');if(previous.state==='verified')return send(res,200,previous.result);throw Error('This interrupted chat request needs review before replay');}
          const controller=new AbortController();if(receiptId)chatRequests.set(receiptId,controller);
          try{
            if(receiptId)await store.saveAsync('command_receipts',{id:receiptId,state:'attempted',request_hash:requestHash},undefined,{signal:controller.signal});
            const sourceId=input.request_id?'browser-message-'+hash([conversation,input.request_id]):undefined;if(!sourceId||!store.get('conversation_messages',sourceId))await store.saveAsync('conversation_messages',{id:sourceId,role:'user',content:input.message,conversation_id:conversation,source_app:'browser-chat'},undefined,{signal:controller.signal});
            const result=await domains.invoke('conversation-chat',{message:input.message,conversation_id:conversation,request_id:input.request_id,talk_id:talk?.id,signal:controller.signal}),saved={reply:result.reply};
            if(receiptId)await store.saveAsync('command_receipts',{id:receiptId,state:'verified',result:saved},undefined,{signal:controller.signal});index.rebuild();return send(res,200,saved);
          }catch(error){if(receiptId&&store.get('command_receipts',receiptId)?.state==='attempted')await store.saveAsync('command_receipts',{id:receiptId,state:'needs_review',error:error.message});throw error;}finally{if(receiptId)chatRequests.delete(receiptId);}
        }
        return send(res,405,{error:'Use GET or POST'});
      }
      if(route==='/api/login-link'&&req.method==='POST'){if(!auth.configured())return send(res,200,auth.invite());const code=randomBytes(32).toString('hex');loginLinks.set(code,Date.now()+300000);return send(res,200,{path:'/login/'+code,expires_minutes:5});}
      if(route==='/api/assistant/open'&&req.method==='POST'){
        if(remote||process.platform!=='win32')throw new Error('Open the assistant on your Windows computer');
        const descriptor=JSON.parse(fs.readFileSync(assistantPath,'utf8').replace(/^\uFEFF/,''));if(!descriptor.verified||path.basename(descriptor.desktop)!=='Hermes.exe'||!fs.existsSync(descriptor.desktop))throw new Error('The candidate Hermes desktop is not available');
        const child=spawn(descriptor.desktop,[],{cwd:store.root,detached:true,stdio:'ignore',windowsHide:false,env:{...assistantEnvironment({home:descriptor.home,workspace:store.root}),HERMES_DESKTOP_USER_DATA_DIR:path.join(path.dirname(assistantPath),'hermes-desktop-data'),HERMES_DESKTOP_APP_NAME:'Godspeed Mission Control Full Alpha Assistant',HERMES_DESKTOP_HERMES_ROOT:descriptor.sourceRoot,HERMES_DESKTOP_CWD:store.root,PLAYWRIGHT_BROWSERS_PATH:path.join(path.dirname(assistantPath),'hermes-runtime','browser-cache')}});child.unref();return send(res,200,{opened:true});
      }
      if(route==='/mcp'){
        const accessKey=apiKeys.authenticate(String(req.headers.authorization||'').replace(/^Bearer /,''));
        if(!authorized(req)&&!accessKey)return send(res,401,{error:'Authentication required'});
        if(req.method!=='POST'){res.writeHead(405,{'Allow':'POST'});return res.end();}
        const input=JSON.parse(await body(req));if(accessKey&&input.method==='tools/call'&&!accessKey.scopes.includes(toolScope(input.params.name,input.params.arguments||{})))return send(res,403,{error:'This API key does not grant that capability'});
        const response=await mcp(input,{store,query,index,domains,scopes:accessKey?.scopes});if(response===null){res.writeHead(202);return res.end();}index.rebuild();return send(res,200,response);
      }
      if(route==='/api/pair/create'&&req.method==='POST'){if(device!=='vps')throw new Error('Create a pairing code on the candidate VPS');const code=randomBytes(16).toString('hex');pairCodes.set(code,Date.now()+300000);return send(res,200,{code,expires_minutes:5});}
      if(route==='/api/pair/connect'&&req.method==='POST'){const input=JSON.parse(await body(req));const result=await mediaSync.pair(input.origin,input.code);if(store.get('settings','installation'))await scheduler.transfer('vps');return send(res,200,{...result,media:await mediaSync.reconcile()});}
      if(route==='/api/media/sync'&&req.method==='POST')return send(res,200,await mediaSync.reconcile());
      if(route==='/api/media/offline'&&req.method==='POST'){const input=JSON.parse(await body(req));if(!['all','selected'].includes(input.offline))throw new Error('Choose all or selected media');const config=mediaSync.config();if(!config)throw new Error('Pair this device first');atomic(mediaSync.configPath,JSON.stringify({...config,offline:input.offline,selected:input.selected||[]}));return send(res,200,{ok:true});}
      if(route==='/api/media/manifest')return send(res,200,{data:mediaSync.manifest()});
      if(route==='/api/media/tombstone'&&req.method==='POST'){const input=JSON.parse(await body(req)),old=mediaSync.manifest().find(m=>m.path===input.path);if(!old||old.sha256!==input.sha256||!input.removed_at||!Number.isFinite(Date.parse(input.removed_at)))throw new Error('This removal does not match the saved media version');atomic(path.join(mediaRoot,hash(old.path)+'.mapping.json'),JSON.stringify({...old,removed_at:input.removed_at}));return send(res,200,{ok:true});}
      if(route.startsWith('/api/media/blob/')&&req.method==='GET'){const filename=safe(decodeURIComponent(route.slice('/api/media/blob/'.length)));if(!mediaSync.manifest().some(m=>m.file===filename&&!m.removed_at))throw new Error('Unknown media object');res.writeHead(200,{'Content-Type':'application/octet-stream','X-Content-Type-Options':'nosniff'});fs.createReadStream(path.join(mediaRoot,filename)).pipe(res);return;}
      if(route==='/api/media/transfer'&&req.method==='POST'){
        const input=JSON.parse(await body(req,140*1024*1024)),mapping=input.mapping,data=Buffer.from(input.data,'base64');
        if(hash(data)!==mapping.sha256||data.length!==mapping.size)throw new Error('Transfer integrity mismatch');
        safe(mapping.file);if(!mapping.file.startsWith(mapping.sha256+'-'))throw new Error('Invalid media object name');
        const old=mediaSync.manifest().find(m=>m.path===mapping.path);if(old&&old.sha256!==mapping.sha256)throw new Error('A different media version exists. Resolve it before transfer');
        atomic(path.join(mediaRoot,mapping.file),data);atomic(path.join(mediaRoot,hash(mapping.path)+'.mapping.json'),JSON.stringify(mapping));return send(res,200,{ok:true});
      }
      if (route === '/api/session') return send(res, 200, { user: { id: 'owner' }, profile: query.rows('profiles')[0] || { id: 'owner', display_name: auth.read().owner?.username || 'Owner' }, expires_at:auth.session(req)?.expires || null });
      if (route === '/api/status') return query.withSnapshot(()=>{const installation=query.rows('settings').find(row=>row.id==='installation');return send(res, 200, { configured:!!installation,goalSetupComplete:query.rows('goals').some(g=>['active','adopted','paused','achieved','completed'].includes(g.status)),goals:query.rows('goals'),work:query.rows('work_items'),decisions:query.rows('decisions'),owner:installation?.owner,device,runtimeConfigured:!!domains.provider,sync:sync.last,mediaSync:mediaSync.last,kinds,problems: store.problems, lastScan: store.lastScan, lastIndex: index.lastRebuild, records: store.records.size, schedules: query.rows('jobs'), conflicts: sync.pendingConflicts().map(name=>{const c=JSON.parse(fs.readFileSync(path.join(store.root,'conflicts',name),'utf8'));return {id:c.id,kind:c.kind,path:c.path||c.type+'/'+c.record_id};}) });});
      if(route==='/api/personal')return query.withSnapshot(()=>send(res,200,{goals:query.rows('goals'),work:query.rows('work_items'),deadlines:query.rows('deadlines'),talks:query.rows('coach_talks'),habits:query.rows('habits'),journal:query.rows('journal'),health:query.rows('health_observations'),forecasts:query.rows('forecasts'),watch:query.rows('watch_topics'),jobs:query.rows('jobs')}));
      if(route==='/api/provider'&&req.method==='POST'){
        const input=JSON.parse(await body(req)),config={url:input.url,key:input.key,model:input.model};
        const chosen=modelProvider(config);if(!chosen)throw new Error('Provide a model endpoint, key and model name');
        await chosen({kind:'connection-test',contract:'Reply with Connected.'});
        atomic(providerPath,JSON.stringify(config));fs.chmodSync(providerPath,0o600);provider=chosen;domains.provider=chosen;scheduler.executor=jobExecutor(chosen,query);
        return send(res,200,{connected:true});
      }
      if(route==='/api/sync/configure'&&req.method==='POST'){
        const input=JSON.parse(await body(req));return send(res,200,{status:await syncRunner.configure(input.url)});
      }
      if(route==='/api/sync/run'&&req.method==='POST')return send(res,200,{status:await syncRunner.run()});
      if(route==='/api/owner'&&req.method==='POST'){const input=JSON.parse(await body(req));if(!['local','vps'].includes(input.owner))throw new Error('Choose local or VPS owner');await scheduler.transfer(input.owner);return send(res,200,{owner:input.owner});}
      if(route==='/api/delivery'&&req.method==='POST'){const input=JSON.parse(await body(req));if(!['notebook','telegram'].includes(input.delivery)||input.delivery==='telegram'&&!originalRuntime&&!scheduler.deliver)throw new Error('Configure Telegram before choosing chat delivery');const settings=store.get('settings','installation');if(!settings)throw new Error('Start with a goal first');await store.saveAsync('settings',{id:settings.id,delivery:input.delivery});return send(res,200,{delivery:input.delivery});}
      if(route==='/api/conflicts'&&req.method==='GET')return send(res,200,{data:sync.pendingConflicts().map(name=>conflictView(store,name.replace(/\.json$/,''),{assistantPath}))});
      if(route==='/api/conflicts/resolve'&&req.method==='POST'){
        const input=JSON.parse(await body(req));resolveSavedConflict(store,input,{assistantPath});
        return send(res,200,{ok:true});
      }
      if(route==='/api/setup'&&req.method==='POST'){const input=JSON.parse(await body(req));return send(res,200,{...await scheduler.configure({...input,owner:mediaSync.config()?'vps':device}),results:await scheduler.tick()});}
      if(route==='/api/jobs/run'&&req.method==='POST'){const input=JSON.parse(await body(req));return send(res,200,{results:originalRuntime?await scheduler.runNow(input.id):await scheduler.tick()});}
      if(route==='/api/connections/recheck'&&req.method==='POST'){await jobExecutor(provider,query)({kind:'connection-check',id:'manual-connection-check',manual:true},{store,settings:store.get('settings','installation')||{}});return send(res,200,{connections:query.rows('connector_status').map(({id,ok,status,checked_at})=>({id,ok,status,checked_at}))});}
      if(route==='/api/jobs/update'&&req.method==='POST'){const input=JSON.parse(await body(req));return send(res,200,{data:originalRuntime?await scheduler.control(input):await controlRoutine(store,input,{device})});}
      if(route==='/api/jobs/add'&&req.method==='POST'){const input=JSON.parse(await body(req));return send(res,200,{data:originalRuntime?await scheduler.control(input,{enable:true}):await controlRoutine(store,input,{enable:true,device})});}
      if(route==='/api/index/rebuild'&&req.method==='POST'){index.rebuild();return send(res,200,{ok:true});}
      if(route==='/api/backup'&&req.method==='POST')return send(res,200,await backupRunner.run());
      if(route==='/api/backups'&&req.method==='GET'){
        const folder=path.join(store.state,'backups'),data=fs.existsSync(folder)?fs.readdirSync(folder).filter(id=>/^\d+$/.test(id)).flatMap(id=>{try{const manifest=JSON.parse(fs.readFileSync(path.join(folder,id,'backup.json'),'utf8'));return Array.isArray(manifest.files)?[{id,at:manifest.at,records:manifest.records}]:[];}catch{return [];}}).sort((a,b)=>b.id.localeCompare(a.id)):[];return send(res,200,{data});
      }
      if(route==='/api/restore-copy'&&req.method==='POST'){
        const input=JSON.parse(await body(req));if(!/^\d+$/.test(input.backup_id||''))throw Error('Choose one saved backup');
        const result=await recoveryRunner.run(path.join(store.state,'backups',input.backup_id));return send(res,200,result);
      }
      if(route==='/api/import'&&req.method==='POST')return send(res,200,importExport(query,JSON.parse(await body(req,100*1024*1024))));
      if(route==='/api/export')return send(res,200,{format:1,records:[...store.scan().values()].map(r=>{const copy={...r};delete copy._hash;return copy;})});
      if (route === '/api/search') return send(res, 200, { data: index.search(url.searchParams.get('q') || ''), error: null });
      if (route === '/api/query' && req.method === 'POST') { const input=JSON.parse(await body(req)),result=query.execute(input); if(input.operation&&input.operation!=='select')index.rebuild(); return send(res, 200, result); }
      if(route==='/api/chat-state'&&req.method==='POST'){
        const input=JSON.parse(await body(req));
        return send(res,200,await saveConversationState(store,input,{asyncWriter:true}));
      }
      if (route === '/api/rpc' && req.method === 'POST') { const input = JSON.parse(await body(req)); const data = query.rpc(input.rpc, input.args); if(!['search_contacts_page','notes_mentioning_people','my_staff_access_log'].includes(input.rpc))index.rebuild(); return send(res, 200, { data, error: null }); }
      if (route === '/api/structural' && req.method === 'POST') { const input = JSON.parse(await body(req)); return send(res, 200, { data: store.structural(input.type, input.id, input.action, input.options), error: null }); }
      if (route === '/api/media/upload' && req.method === 'POST') {
        const bytes = await body(req, 100 * 1024 * 1024), form = await new Request('http://localhost/', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body: bytes }).formData();
        const file = form.get('file'); if (!(file instanceof Blob)) throw new Error('Missing media file');
        const original = String(form.get('path') || file.name || 'media'), data = Buffer.from(await file.arrayBuffer()), digest = hash(data);
        const extractedText=form.get('extracted_text');if(extractedText!=null&&(typeof extractedText!=='string'||extractedText.length>60000||file.type!=='application/pdf'))throw new Error('Invalid extracted PDF text');
        const target = digest + '-' + safe(path.basename(original).replace(/[^a-zA-Z0-9_.-]/g, '_') || 'media');
        atomic(path.join(mediaRoot, target), data);
        const previousFile=path.join(mediaRoot,hash(original)+'.mapping.json');
        if(fs.existsSync(previousFile)){const previous=JSON.parse(fs.readFileSync(previousFile,'utf8'));if(!previous.removed_at&&previous.sha256!==digest)throw new Error('This media path already has different content. Choose a new path; both binaries were retained.');}
        atomic(path.join(mediaRoot, hash(original) + '.mapping.json'), JSON.stringify({ path: original, file: target, sha256: digest, size: data.length, contentType: file.type,...(extractedText?{extractedText}:{}) }));
        return send(res, 200, { data: { path: original, fullPath: original, id: digest }, error: null });
      }
      if(route==='/api/media/remove'&&req.method==='POST'){
        const input=JSON.parse(await body(req));for(const original of input.paths||[]){const file=path.join(mediaRoot,hash(original)+'.mapping.json');if(fs.existsSync(file)){const mapping=JSON.parse(fs.readFileSync(file,'utf8'));mapping.removed_at=new Date().toISOString();atomic(file,JSON.stringify(mapping));}}return send(res,200,{data:[],error:null});
      }
      if (route.startsWith('/api/media/file/') && req.method === 'GET') {
        const original = decodeURIComponent(route.slice('/api/media/file/'.length));
        const mapping = JSON.parse(fs.readFileSync(path.join(mediaRoot, hash(original) + '.mapping.json'), 'utf8'));
        if(mapping.removed_at)return send(res,404,{error:'Media removed'});
        res.writeHead(200, { 'Content-Type': mapping.contentType || 'application/octet-stream', 'Content-Length': mapping.size, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" }); fs.createReadStream(path.join(mediaRoot, safe(mapping.file))).pipe(res); return;
      }
      if(route==='/api/chat/transcribe'&&req.method==='POST'){
        if(dictationBusy)return send(res,429,{error:'Another recording is being transcribed. Please try again shortly.'});
        dictationBusy=true;
        try{const descriptor=fs.existsSync(assistantPath)?JSON.parse(fs.readFileSync(assistantPath,'utf8').replace(/^\uFEFF/,'')):null;return send(res,200,await transcribeRecording(descriptor,store.root,await body(req,8*1024*1024),String(req.headers['content-type']||'')));}finally{dictationBusy=false;}
      }
      if(route==='/api/chat/options'&&req.method==='GET')return send(res,200,provider?.options?await provider.options():{current:'Connected model',models:[{id:'',efforts:[]}]});
      if(route==='/api/chat/stop'&&req.method==='POST'){const input=JSON.parse(await body(req));chatRequests.get(input.id)?.abort();return send(res,200,{ok:true});}
      if (route.startsWith('/api/functions/') && req.method === 'POST') {
        const name=route.slice('/api/functions/'.length),input=JSON.parse(await body(req));
        const isChat=['note-chat','collection-chat','conversation-chat'].includes(name),id=input.request_id;
        if(isChat&&id&&(!/^[a-f0-9-]{36}$/.test(id)||chatRequests.has(id)))throw new Error('Invalid chat request');
        const receiptId=isChat&&id?'chat-request-'+id:null,requestHash=hash({name,input}),previous=receiptId?store.get('command_receipts',receiptId):null;
        if(previous){if(previous.request_hash!==requestHash)throw Error('Chat retry differs from the retained request');if(previous.state==='verified')return send(res,200,{data:previous.result,error:null});throw Error('This interrupted chat request needs review before replay');}
        const controller=new AbortController();if(isChat&&id)chatRequests.set(id,controller);
        try{
          if(isChat){const person=input.contact_id||input.person_id||input.personId;if(person){input.contact_id=person;input.person_id=person;input.conversation_id='notebook:person:'+person;}input.message||=input.messages?.filter(m=>m.role==='user').at(-1)?.content||'';input.conversation_id||='notebook:'+(input.note_id?'note:'+input.note_id:input.collection_id?'collection:'+input.collection_id:'general');const sourceId=id?'chat-input-'+id:undefined;if(!sourceId||!store.get('conversation_messages',sourceId))await store.saveAsync('conversation_messages',{id:sourceId,role:'user',content:input.message,conversation_id:input.conversation_id,note_id:input.note_id||null,contact_id:input.person_id||null,source_app:'notebook-chat'},undefined,{signal:controller.signal});}
          if(receiptId)await store.saveAsync('command_receipts',{id:receiptId,state:'attempted',request_hash:requestHash},undefined,{signal:controller.signal});
          const data=name.startsWith('mc-api-keys')?apiKeys.invoke(name,input):await domains.invoke(name,{...input,...(isChat?{signal:controller.signal}:{})});
          if(isChat)await retainCompletedConversation(store,input,data,{asyncWriter:true,signal:controller.signal});
          if(receiptId)await store.saveAsync('command_receipts',{id:receiptId,state:'verified',result:data},undefined,{signal:controller.signal});
          index.rebuild();return send(res,200,name==='backfill-media-analysis'?data:{data,error:null});
        }catch(error){
          if(receiptId&&store.get('command_receipts',receiptId)?.state==='attempted')await store.saveAsync('command_receipts',{id:receiptId,state:'needs_review',error:error.message,...(error.code==='UNAUTHORIZED_OPERATION'?{rejected_operation_type:error.operation_type,source_quote_matches:error.source_quote_matches}:{})});
          throw error;
        }finally{if(isChat&&id)chatRequests.delete(id);}
      }
      if (route.startsWith('/api/')) return send(res, 404, { error: 'Unknown operation' });
      const requested = path.resolve(uiRoot, '.' + route); if (requested !== uiRoot && !requested.startsWith(uiRoot + path.sep)) return send(res, 403, { error: 'Invalid path' });
      const file = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(uiRoot, 'index.html');
      if (!fs.existsSync(file)) return send(res, 503, { error: 'Build the notebook frontend first' });
      const mime = { '.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2' }[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer' }); fs.createReadStream(file).pipe(res);
    } catch (e) { send(res, e.status || (e.code === 'CONFLICT' ? 409 : 400), { error: e.message, code: e.code }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const interval = setInterval(() => { if (!menerioImport.mutating) void index.rebuildBackground().catch(()=>{}); }, 30000);
  const jobs=setInterval(()=>{if(!menerioImport.mutating)scheduler.tick().catch(()=>{});},30000);
  const syncTimer=setInterval(()=>{if(!menerioImport.mutating&&fs.existsSync(path.join(store.state,'sync-config.json')))void syncRunner.run();},60000);
  const mediaTimer=setInterval(()=>{if(!menerioImport.mutating)mediaSync.reconcile();},60000);
  const telegram=!originalRuntime&&process.env.GODSPEED_TELEGRAM==='on'&&process.env.GODSPEED_CANDIDATE_BOT_TOKEN&&process.env.GODSPEED_CANDIDATE_BOT_OWNER?new Telegram({store,domains,token:process.env.GODSPEED_CANDIDATE_BOT_TOKEN,owner:process.env.GODSPEED_CANDIDATE_BOT_OWNER,loginLink:process.env.GODSPEED_BROWSER_ORIGIN?destination=>{const code=randomBytes(32).toString('hex');loginLinks.set(code,Date.now()+300000);return process.env.GODSPEED_BROWSER_ORIGIN+'/login/'+code+'?next='+encodeURIComponent(destination);}:undefined}):null;
  const telegramTimer=telegram?setInterval(()=>{if(!menerioImport.mutating)telegram.tick().catch(()=>{});},3000):null;
  scheduler.deliver=telegram?(id,result)=>telegram.deliver(id,result):null;
  let debounce,indexDebounce;const watchers=new Map();
  const changed=(event,name)=>{if(menerioImport.mutating||!name||name.replaceAll('\\','/').startsWith('.')||name.endsWith('.tmp'))return;clearTimeout(indexDebounce);indexDebounce=setTimeout(()=>{if(menerioImport.mutating)return;void index.rebuildBackground().catch(()=>{});},750);if(fs.existsSync(path.join(store.state,'sync-config.json'))){clearTimeout(debounce);debounce=setTimeout(()=>{if(!menerioImport.mutating)void syncRunner.run();},5000);}};
  // Private backups and Git merge workspaces are outside the watched knowledge.
  const watchRoot=name=>{const folder=path.join(store.root,name);if(!watchers.has(name)&&fs.existsSync(folder))watchers.set(name,fs.watch(folder,{recursive:true},changed));};
  for(const name of durableRoots)watchRoot(name);
  const rootWatcher=fs.watch(store.root,(event,name)=>{if(durableRoots.includes(name)){watchRoot(name);changed(event,name);}else if(durableFiles.includes(name))changed(event,name);});
  return { server, store, index, query, domains, scheduler, sync, mediaSync,address: server.address(), close: async () => { await syncRunner.close();await menerioImport.close();rootWatcher.close();for(const watcher of watchers.values())watcher.close();clearTimeout(debounce);clearTimeout(indexDebounce);clearInterval(telegramTimer);clearInterval(interval);clearInterval(jobs);clearInterval(syncTimer);clearInterval(mediaTimer); await new Promise(resolve => server.close(resolve)); index.close(); } };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.env.GODSPEED_WORKSPACE;
  if (!root) throw new Error('Set GODSPEED_WORKSPACE to a separate candidate folder');
  const service = await createService({ root, mediaRoot: process.env.GODSPEED_MEDIA_ROOT, host: process.env.GODSPEED_BIND || '127.0.0.1', port: Number(process.env.GODSPEED_PORT || 47831), token: process.env.GODSPEED_ACCESS_TOKEN,device:process.env.GODSPEED_DEVICE||'local' });
  console.log('Godspeed Mission Control candidate listening on port ' + service.address.port);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await service.close(); process.exit(0); });
}
