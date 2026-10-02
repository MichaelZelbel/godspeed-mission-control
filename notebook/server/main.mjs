import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Store, atomic, safe, hash } from '../core/records/store.mjs';
import { SearchIndex } from '../core/index/search.mjs';
import { QueryService } from '../core/query.mjs';
import { Domains } from '../core/domains.mjs';
import { Scheduler } from '../core/jobs/scheduler.mjs';
import { modelProvider, jobExecutor,hermesProvider } from '../core/runtime.mjs';
import { FileSync } from '../core/sync/git.mjs';
import { backup, restore } from '../core/archives.mjs';
import { importExport } from '../core/import.mjs';
import { kinds } from '../core/jobs/scheduler.mjs';
import { MediaSync } from '../core/sync/media.mjs';
import { mcp } from './mcp.mjs';

export async function createService({ root, mediaRoot, host = '127.0.0.1', port = 47831, token, uiRoot, provider, device = 'local' } = {}) {
  const store = new Store(root,{device}), index = new SearchIndex(store), query = new QueryService(store), sync = new FileSync(store);
  const providerPath=path.join(store.state,'provider.json');
  if(!provider&&fs.existsSync(providerPath))provider=modelProvider(JSON.parse(fs.readFileSync(providerPath,'utf8')));
  provider ||= modelProvider({url:process.env.GODSPEED_MODEL_URL,key:process.env.GODSPEED_MODEL_KEY,model:process.env.GODSPEED_MODEL});
  const assistantPath=process.env.GODSPEED_ASSISTANT_CONFIG||path.join(store.state,'assistant.json');
  if(!provider&&fs.existsSync(assistantPath)){const descriptor=JSON.parse(fs.readFileSync(assistantPath,'utf8'));if(descriptor.verified)provider=hermesProvider({executable:descriptor.executable,home:descriptor.home,cwd:store.root});}
  const domains=new Domains(query,{provider}),scheduler=new Scheduler(store,{device,executor:jobExecutor(provider,query)});
  mediaRoot = path.resolve(mediaRoot || path.join(store.state, 'media')); fs.mkdirSync(mediaRoot, { recursive: true });
  domains.mediaRoot=mediaRoot;
  const mediaSync=new MediaSync(store,mediaRoot),pairCodes=new Map(),pairKeysPath=path.join(store.state,'pair-clients.json');
  const pairKeys=fs.existsSync(pairKeysPath)?JSON.parse(fs.readFileSync(pairKeysPath,'utf8')):[];
  const instance=hash(store.root).slice(0,24);
  const remote = !['127.0.0.1', '::1', 'localhost'].includes(host);
  if (remote && !token) throw new Error('Remote access requires a candidate token');
  const sessions = new Map();
  const authorized = req => !remote || pairKeys.includes(hash(String(req.headers['x-godspeed-pair-key']||''))) || (sessions.get((req.headers.cookie || '').match(/(?:^|; )godspeed_session=([^;]+)/)?.[1]) || 0) > Date.now();
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
      if (route === '/api/login' && req.method === 'POST') {
        const input = JSON.parse(await body(req)), a = Buffer.from(String(input.token || '')), b = Buffer.from(token || '');
        if (!token || a.length !== b.length || !timingSafeEqual(a, b)) return send(res, 401, { error: 'Access token was not accepted' });
        const session = randomBytes(32).toString('hex'); sessions.set(session, Date.now() + 8 * 3600_000);
        return send(res, 200, { ok: true }, { 'Set-Cookie': `godspeed_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${remote ? '; Secure' : ''}` });
      }
      if (route === '/api/logout') {
        const session = (req.headers.cookie || '').match(/godspeed_session=([^;]+)/)?.[1]; sessions.delete(session);
        return send(res, 200, { ok: true }, { 'Set-Cookie': 'godspeed_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
      }
      if(route==='/api/pair/claim'&&req.method==='POST'){
        const input=JSON.parse(await body(req)),expires=pairCodes.get(input.code);if(!expires||expires<Date.now())return send(res,401,{error:'Pairing code expired or was already used'});
        pairCodes.delete(input.code);const key=randomBytes(32).toString('hex');pairKeys.push(hash(key));atomic(pairKeysPath,JSON.stringify(pairKeys));fs.chmodSync(pairKeysPath,0o600);return send(res,200,{key});
      }
      if (route === '/health') return send(res, 200, { ok: true, format: 1, version: '0.1.0-alpha.1',instance });
      if (route.startsWith('/api/') && !authorized(req)) return send(res, 401, { error: 'Authentication required' });
      if(route==='/mcp'){
        if(!authorized(req))return send(res,401,{error:'Authentication required'});
        if(req.method!=='POST'){res.writeHead(405,{'Allow':'POST'});return res.end();}
        const response=await mcp(JSON.parse(await body(req)),{store,query,index,domains});if(response===null){res.writeHead(202);return res.end();}index.rebuild();return send(res,200,response);
      }
      if(route==='/api/pair/create'&&req.method==='POST'){if(device!=='vps')throw new Error('Create a pairing code on the candidate VPS');const code=randomBytes(16).toString('hex');pairCodes.set(code,Date.now()+300000);return send(res,200,{code,expires_minutes:5});}
      if(route==='/api/pair/connect'&&req.method==='POST'){const input=JSON.parse(await body(req));const result=await mediaSync.pair(input.origin,input.code);if(store.get('settings','installation'))scheduler.transfer('vps');return send(res,200,{...result,media:await mediaSync.reconcile()});}
      if(route==='/api/media/sync'&&req.method==='POST')return send(res,200,await mediaSync.reconcile());
      if(route==='/api/media/offline'&&req.method==='POST'){const input=JSON.parse(await body(req));if(!['all','selected'].includes(input.offline))throw new Error('Choose all or selected media');const config=mediaSync.config();if(!config)throw new Error('Pair this device first');atomic(mediaSync.configPath,JSON.stringify({...config,offline:input.offline,selected:input.selected||[]}));return send(res,200,{ok:true});}
      if(route==='/api/media/manifest')return send(res,200,{data:mediaSync.manifest()});
      if(route.startsWith('/api/media/blob/')&&req.method==='GET'){const filename=safe(decodeURIComponent(route.slice('/api/media/blob/'.length)));if(!mediaSync.manifest().some(m=>m.file===filename&&!m.removed_at))throw new Error('Unknown media object');res.writeHead(200,{'Content-Type':'application/octet-stream','X-Content-Type-Options':'nosniff'});fs.createReadStream(path.join(mediaRoot,filename)).pipe(res);return;}
      if(route==='/api/media/transfer'&&req.method==='POST'){
        const input=JSON.parse(await body(req,140*1024*1024)),mapping=input.mapping,data=Buffer.from(input.data,'base64');
        if(hash(data)!==mapping.sha256||data.length!==mapping.size)throw new Error('Transfer integrity mismatch');
        safe(mapping.file);if(!mapping.file.startsWith(mapping.sha256+'-'))throw new Error('Invalid media object name');
        const old=mediaSync.manifest().find(m=>m.path===mapping.path);if(old&&old.sha256!==mapping.sha256)throw new Error('A different media version exists. Resolve it before transfer');
        atomic(path.join(mediaRoot,mapping.file),data);atomic(path.join(mediaRoot,hash(mapping.path)+'.mapping.json'),JSON.stringify(mapping));return send(res,200,{ok:true});
      }
      if (route === '/api/session') return send(res, 200, { user: { id: 'owner' }, profile: query.rows('profiles')[0] || { id: 'owner', display_name: 'Owner' } });
      if (route === '/api/status') return send(res, 200, { configured:!!store.get('settings','installation'),owner:store.get('settings','installation')?.owner,device,runtimeConfigured:!!domains.provider,sync:sync.last,mediaSync:mediaSync.last,kinds,problems: store.problems, lastScan: store.lastScan, lastIndex: index.lastRebuild, records: store.records.size, schedules: query.rows('jobs'), conflicts: sync.pendingConflicts().map(name=>{const c=JSON.parse(fs.readFileSync(path.join(store.root,'conflicts',name),'utf8'));return {id:c.id,kind:c.kind,path:c.path||c.type+'/'+c.record_id};}) });
      if(route==='/api/provider'&&req.method==='POST'){
        const input=JSON.parse(await body(req)),config={url:input.url,key:input.key,model:input.model};
        const chosen=modelProvider(config);if(!chosen)throw new Error('Provide a model endpoint, key and model name');
        await chosen({kind:'connection-test',contract:'Reply with Connected.'});
        atomic(providerPath,JSON.stringify(config));fs.chmodSync(providerPath,0o600);provider=chosen;domains.provider=chosen;scheduler.executor=jobExecutor(chosen,query);
        return send(res,200,{connected:true});
      }
      if(route==='/api/sync/configure'&&req.method==='POST'){
        const input=JSON.parse(await body(req));sync.initialize(input.url);atomic(path.join(store.state,'sync-config.json'),JSON.stringify({enabled:true}));return send(res,200,{status:sync.reconcile()});
      }
      if(route==='/api/sync/run'&&req.method==='POST')return send(res,200,{status:sync.reconcile()});
      if(route==='/api/owner'&&req.method==='POST'){const input=JSON.parse(await body(req));if(!['local','vps'].includes(input.owner))throw new Error('Choose local or VPS owner');scheduler.transfer(input.owner);return send(res,200,{owner:input.owner});}
      if(route==='/api/conflicts'&&req.method==='GET')return send(res,200,{data:sync.pendingConflicts().map(name=>JSON.parse(fs.readFileSync(path.join(store.root,'conflicts',name),'utf8')))});
      if(route==='/api/conflicts/resolve'&&req.method==='POST'){
        const input=JSON.parse(await body(req));safe(input.id);const file=path.join(store.root,'conflicts',input.id+'.json'),conflict=JSON.parse(fs.readFileSync(file,'utf8'));
        if(conflict.kind==='git')sync.resolve(input.id,input.choice,input.text);
        else {if(!['local','remote','merged'].includes(input.choice))throw new Error('Choose a retained version');const value=input.choice==='merged'?JSON.parse(input.text):conflict[input.choice];store.save(conflict.type,value,store.get(conflict.type,conflict.record_id)?._hash);conflict.resolved_at=new Date().toISOString();conflict.choice=input.choice;atomic(file,JSON.stringify(conflict,null,2));}
        return send(res,200,{ok:true});
      }
      if(route==='/api/setup'&&req.method==='POST'){const input=JSON.parse(await body(req));return send(res,200,{...scheduler.configure({...input,owner:device}),results:await scheduler.tick()});}
      if(route==='/api/jobs/run'&&req.method==='POST')return send(res,200,{results:await scheduler.tick()});
      if(route==='/api/jobs/update'&&req.method==='POST'){const input=JSON.parse(await body(req));return send(res,200,{data:store.save('jobs',input)});}
      if(route==='/api/jobs/add'&&req.method==='POST'){const input=JSON.parse(await body(req));if(!kinds.includes(input.kind)||!Number.isFinite(input.interval_ms)||input.interval_ms<60000)throw new Error('Choose a supported routine and interval of at least a minute');return send(res,200,{data:store.save('jobs',{kind:input.kind,title:input.title||input.kind,owner:store.get('settings','installation')?.owner||device,next_run:new Date().toISOString(),interval_ms:input.interval_ms,state:'pending',paused:false})});}
      if(route==='/api/index/rebuild'&&req.method==='POST'){index.rebuild();return send(res,200,{ok:true});}
      if(route==='/api/backup'&&req.method==='POST'){const destination=path.join(store.state,'backups',Date.now().toString());return send(res,200,{path:backup(store,mediaRoot,destination)});}
      if(route==='/api/import'&&req.method==='POST')return send(res,200,importExport(query,JSON.parse(await body(req,100*1024*1024))));
      if(route==='/api/export')return send(res,200,{format:1,records:[...store.scan().values()].map(r=>{const copy={...r};delete copy._hash;return copy;})});
      if (route === '/api/search') return send(res, 200, { data: index.search(url.searchParams.get('q') || ''), error: null });
      if (route === '/api/query' && req.method === 'POST') { const result = query.execute(JSON.parse(await body(req))); index.rebuild(); return send(res, 200, result); }
      if(route==='/api/chat-state'&&req.method==='POST'){
        const input=JSON.parse(await body(req));if(typeof input.context_key!=='string'||!Array.isArray(input.state?.messages))throw new Error('Invalid conversation state');
        const id='chat-'+hash(input.context_key).slice(0,24),old=store.get('note_conversations',id);
        store.withLock(()=>store.commit([store.prepare('note_conversations',{id,context_key:input.context_key,state:input.state},old),store.prepare('conversation_messages',{context_key:input.context_key,state_snapshot:input.state})]));
        return send(res,200,{ok:true});
      }
      if (route === '/api/rpc' && req.method === 'POST') { const input = JSON.parse(await body(req)); const data = query.rpc(input.rpc, input.args); index.rebuild(); return send(res, 200, { data, error: null }); }
      if (route === '/api/structural' && req.method === 'POST') { const input = JSON.parse(await body(req)); return send(res, 200, { data: store.structural(input.type, input.id, input.action, input.options), error: null }); }
      if (route === '/api/media/upload' && req.method === 'POST') {
        const bytes = await body(req, 100 * 1024 * 1024), form = await new Request('http://localhost/', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body: bytes }).formData();
        const file = form.get('file'); if (!(file instanceof Blob)) throw new Error('Missing media file');
        const original = String(form.get('path') || file.name || 'media'), data = Buffer.from(await file.arrayBuffer()), digest = hash(data);
        const target = digest + '-' + safe(path.basename(original).replace(/[^a-zA-Z0-9_.-]/g, '_') || 'media');
        atomic(path.join(mediaRoot, target), data);
        const previousFile=path.join(mediaRoot,hash(original)+'.mapping.json');
        if(fs.existsSync(previousFile)){const previous=JSON.parse(fs.readFileSync(previousFile,'utf8'));if(!previous.removed_at&&previous.sha256!==digest)throw new Error('This media path already has different content. Choose a new path; both binaries were retained.');}
        atomic(path.join(mediaRoot, hash(original) + '.mapping.json'), JSON.stringify({ path: original, file: target, sha256: digest, size: data.length, contentType: file.type }));
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
      if (route.startsWith('/api/functions/') && req.method === 'POST') { const data=await domains.invoke(route.slice('/api/functions/'.length),JSON.parse(await body(req)));index.rebuild();return send(res,200,{data,error:null}); }
      if (route.startsWith('/api/')) return send(res, 404, { error: 'Unknown operation' });
      const requested = path.resolve(uiRoot, '.' + route); if (requested !== uiRoot && !requested.startsWith(uiRoot + path.sep)) return send(res, 403, { error: 'Invalid path' });
      const file = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(uiRoot, 'index.html');
      if (!fs.existsSync(file)) return send(res, 503, { error: 'Build the notebook frontend first' });
      const mime = { '.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2' }[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer' }); fs.createReadStream(file).pipe(res);
    } catch (e) { send(res, e.code === 'CONFLICT' ? 409 : 400, { error: e.message, code: e.code }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  let busy = false;
  const interval = setInterval(() => { if (!busy) { busy = true; try { index.rebuild(); } catch {} finally { busy = false; } } }, 2000);
  const jobs=setInterval(()=>scheduler.tick().catch(()=>{}),30000);
  const syncTimer=setInterval(()=>{if(fs.existsSync(path.join(store.state,'sync-config.json')))sync.reconcile();},60000);
  const mediaTimer=setInterval(()=>mediaSync.reconcile(),60000);
  return { server, store, index, query, domains, scheduler, sync, mediaSync,address: server.address(), close: async () => { clearInterval(interval);clearInterval(jobs);clearInterval(syncTimer);clearInterval(mediaTimer); await new Promise(resolve => server.close(resolve)); index.close(); } };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.env.GODSPEED_WORKSPACE;
  if (!root) throw new Error('Set GODSPEED_WORKSPACE to a separate candidate folder');
  const service = await createService({ root, mediaRoot: process.env.GODSPEED_MEDIA_ROOT, host: process.env.GODSPEED_BIND || '127.0.0.1', port: Number(process.env.GODSPEED_PORT || 47831), token: process.env.GODSPEED_ACCESS_TOKEN,device:process.env.GODSPEED_DEVICE||'local' });
  console.log('Godspeed Mission Control candidate listening on port ' + service.address.port);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await service.close(); process.exit(0); });
}
