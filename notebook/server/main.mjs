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
import { modelProvider, jobExecutor } from '../core/runtime.mjs';

export async function createService({ root, mediaRoot, host = '127.0.0.1', port = 47831, token, uiRoot, provider, device = 'local' } = {}) {
  const store = new Store(root), index = new SearchIndex(store), query = new QueryService(store);
  provider ||= modelProvider({url:process.env.GODSPEED_MODEL_URL,key:process.env.GODSPEED_MODEL_KEY,model:process.env.GODSPEED_MODEL});
  const domains=new Domains(query,{provider}),scheduler=new Scheduler(store,{device,executor:jobExecutor(provider,query)});
  mediaRoot = path.resolve(mediaRoot || path.join(store.state, 'media')); fs.mkdirSync(mediaRoot, { recursive: true });
  const remote = !['127.0.0.1', '::1', 'localhost'].includes(host);
  if (remote && !token) throw new Error('Remote access requires a candidate token');
  const sessions = new Map();
  const authorized = req => !remote || (sessions.get((req.headers.cookie || '').match(/(?:^|; )godspeed_session=([^;]+)/)?.[1]) || 0) > Date.now();
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
      if (route === '/health') return send(res, 200, { ok: true, format: 1, version: '0.1.0-alpha.1' });
      if (route.startsWith('/api/') && !authorized(req)) return send(res, 401, { error: 'Authentication required' });
      if (route === '/api/session') return send(res, 200, { user: { id: 'owner' }, profile: query.rows('profiles')[0] || { id: 'owner', display_name: 'Owner' } });
      if (route === '/api/status') return send(res, 200, { configured:!!store.get('settings','installation'),owner:store.get('settings','installation')?.owner,runtimeConfigured:!!provider,problems: store.problems, lastScan: store.lastScan, lastIndex: index.lastRebuild, records: store.records.size, schedules: query.rows('jobs'), conflicts: fs.existsSync(path.join(store.root, 'conflicts')) ? fs.readdirSync(path.join(store.root, 'conflicts')).filter(n => n.endsWith('.json')) : [] });
      if(route==='/api/setup'&&req.method==='POST'){const input=JSON.parse(await body(req));return send(res,200,{...scheduler.configure({...input,owner:device}),results:await scheduler.tick()});}
      if(route==='/api/jobs/run'&&req.method==='POST')return send(res,200,{results:await scheduler.tick()});
      if(route==='/api/jobs/update'&&req.method==='POST'){const input=JSON.parse(await body(req));return send(res,200,{data:store.save('jobs',input)});}
      if(route==='/api/index/rebuild'&&req.method==='POST'){index.rebuild();return send(res,200,{ok:true});}
      if(route==='/api/backup'&&req.method==='POST'){const destination=path.join(store.state,'backups',Date.now().toString());return send(res,200,{path:store.backup(destination)});}
      if (route === '/api/search') return send(res, 200, { data: index.search(url.searchParams.get('q') || ''), error: null });
      if (route === '/api/query' && req.method === 'POST') { const result = query.execute(JSON.parse(await body(req))); index.rebuild(); return send(res, 200, result); }
      if (route === '/api/rpc' && req.method === 'POST') { const input = JSON.parse(await body(req)); const data = query.rpc(input.rpc, input.args); index.rebuild(); return send(res, 200, { data, error: null }); }
      if (route === '/api/structural' && req.method === 'POST') { const input = JSON.parse(await body(req)); return send(res, 200, { data: store.structural(input.type, input.id, input.action, input.options), error: null }); }
      if (route === '/api/media/upload' && req.method === 'POST') {
        const bytes = await body(req, 100 * 1024 * 1024), form = await new Request('http://localhost/', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body: bytes }).formData();
        const file = form.get('file'); if (!(file instanceof Blob)) throw new Error('Missing media file');
        const original = String(form.get('path') || file.name || 'media'), data = Buffer.from(await file.arrayBuffer()), digest = hash(data.toString('base64'));
        const target = digest + '-' + safe(path.basename(original).replace(/[^a-zA-Z0-9_.-]/g, '_') || 'media');
        atomic(path.join(mediaRoot, target), data);
        atomic(path.join(mediaRoot, hash(original) + '.mapping.json'), JSON.stringify({ path: original, file: target, sha256: hash(data.toString('base64')), size: data.length, contentType: file.type }));
        return send(res, 200, { data: { path: original, fullPath: original, id: digest }, error: null });
      }
      if (route.startsWith('/api/media/file/') && req.method === 'GET') {
        const original = decodeURIComponent(route.slice('/api/media/file/'.length));
        const mapping = JSON.parse(fs.readFileSync(path.join(mediaRoot, hash(original) + '.mapping.json'), 'utf8'));
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
  return { server, store, index, query, domains, scheduler, address: server.address(), close: async () => { clearInterval(interval);clearInterval(jobs); await new Promise(resolve => server.close(resolve)); index.close(); } };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.env.GODSPEED_WORKSPACE;
  if (!root) throw new Error('Set GODSPEED_WORKSPACE to a separate candidate folder');
  const service = await createService({ root, mediaRoot: process.env.GODSPEED_MEDIA_ROOT, host: process.env.GODSPEED_BIND || '127.0.0.1', port: Number(process.env.GODSPEED_PORT || 47831), token: process.env.GODSPEED_ACCESS_TOKEN });
  console.log('Godspeed Mission Control candidate listening on port ' + service.address.port);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await service.close(); process.exit(0); });
}
