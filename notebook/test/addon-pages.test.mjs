import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {createService} from '../server/main.mjs';
import {AddonPages} from '../core/addon-pages.mjs';

for(const key of Object.keys(process.env))if(/^(GODSPEED_|HERMES_)/.test(key))delete process.env[key];

const PAGE=`import http from 'node:http';import fs from 'node:fs';
fs.writeFileSync('page-wrote',String(process.pid));
const page=http.createServer((req,res)=>{res.setHeader('x-cookie',req.headers.cookie||'');res.end(JSON.stringify({url:req.url,prefix:req.headers['x-forwarded-prefix'],host:req.headers.host,cwd:process.cwd(),cookie:req.headers.cookie||'',pid:process.pid}));});
page.on('upgrade',(req,socket)=>{socket.end('HTTP/1.1 101 Switching Protocols\\r\\nConnection: Upgrade\\r\\nUpgrade: websocket\\r\\nx-url: '+req.url+'\\r\\nx-prefix: '+req.headers['x-forwarded-prefix']+'\\r\\n\\r\\n');});
page.listen(Number(process.argv[2]),'127.0.0.1');
`;
const freePort=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const {port}=s.address();s.close(()=>resolve(port));});});
const wait=async(check,ms=8000)=>{const end=Date.now()+ms;for(;;){const value=await check();if(value)return value;if(Date.now()>end)throw Error('timed out');await new Promise(r=>setTimeout(r,50));}};
function request(port,route,{method='GET',host,headers={},body}={}){
  return new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,path:route,method,headers:{...(host?{Host:host}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));});
    req.on('error',reject);if(body)req.write(JSON.stringify(body));req.end();
  });
}
function workspace(prefix){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),prefix));process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
  const script=path.join(root,'page.mjs');fs.writeFileSync(script,PAGE);
  const write=(id,spec)=>{const dir=path.join(root,'.godspeed','addons',id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'page.json'),typeof spec==='string'?spec:JSON.stringify(spec));};
  const spec=port=>({command:[process.execPath,script,String(port)],port,title:'Test page'});
  return {root,write,spec};
}
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};

test('a page answers only for a signed-in visit, with the prefix removed and the notebook\'s session kept from it',async t=>{
  const {root,write,spec}=workspace('godspeed-addon-page-'),port=await freePort();write('test',spec(port));
  const errors=[],logged=console.error;console.error=(...args)=>errors.push(args.join(' '));
  const service=await createService({root,port:0,webPort:0}).finally(()=>{console.error=logged;});
  t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});
  const local=service.address.port,web=service.webAddress.port,host='notebook.example';
  const setup=JSON.parse((await request(local,'/api/login-link',{method:'POST',body:{}})).text);
  const made=await request(web,'/api/auth/setup',{host,method:'POST',headers:{Origin:'https://'+host},body:{username:'owner-test',password:'correct horse battery staple',invite:setup.path.split('=')[1]}});
  assert.equal(made.status,200,made.text);
  const session=made.headers['set-cookie'][0].split(';')[0];

  await wait(async()=>(await request(web,'/addons/test/',{host,headers:{Cookie:session}})).status===200);
  const seen=JSON.parse((await request(web,'/addons/test/x?y=1',{host,headers:{Cookie:session+'; theme=dark'}})).text);
  assert.equal(seen.url,'/x?y=1');assert.equal(seen.prefix,'/addons/test');assert.equal(seen.host,'127.0.0.1:'+port);
  assert.equal(seen.cookie,'theme=dark');
  assert.equal(fs.realpathSync(seen.cwd),fs.realpathSync(root));
  assert.ok(fs.existsSync(path.join(root,'page-wrote')));

  const bare=await request(web,'/addons/test?z=2',{host,headers:{Cookie:session}});
  assert.equal(bare.status,308);assert.equal(bare.headers.location,'/addons/test/?z=2');
  assert.equal((await request(web,'/addons/nothing/',{host,headers:{Cookie:session}})).status,404);

  const unsigned=await request(web,'/addons/test/x?y=1',{host});
  assert.equal(unsigned.status,303);assert.equal(unsigned.headers.location,'/setup?next=%2Faddons%2Ftest%2Fx%3Fy%3D1');
  assert.equal((await request(web,'/addons/test/x',{host,method:'POST',headers:{Origin:'https://'+host},body:{}})).status,401);
  const unknown=await request(web,'/addons/nothing/',{host});
  assert.equal(unknown.status,303,'an unsigned visit cannot tell which pages exist');

  // An upgrade is admitted by the same sign-in, Host and Origin rules as a request, and dropped otherwise.
  const upgrade=(port,headers)=>new Promise(resolve=>{
    const socket=net.connect(port,'127.0.0.1');let text='';
    socket.write('GET /addons/test/ws?a=1 HTTP/1.1\r\n'+Object.entries({Connection:'Upgrade',Upgrade:'websocket',...headers}).map(([k,v])=>k+': '+v+'\r\n').join('')+'\r\n');
    socket.on('data',c=>text+=c);socket.on('close',()=>resolve(text));socket.on('error',()=>resolve(text));
  });
  assert.equal(await upgrade(web,{Host:host}),'');
  const admitted=await upgrade(web,{Host:host,Cookie:session,Origin:'https://'+host});
  assert.match(admitted,/^HTTP\/1\.1 101/);assert.match(admitted,/x-url: \/ws\?a=1/);assert.match(admitted,/x-prefix: \/addons\/test/);
  assert.equal(await upgrade(web,{Host:host,Cookie:session,Origin:'https://evil.example'}),'','a cross-site upgrade is refused');
  assert.equal(await upgrade(local,{Host:'rebind.example'}),'','a foreign Host on the local door is refused');
  assert.equal(await upgrade(local,{Host:'127.0.0.1:'+local,Origin:'https://evil.example'}),'','a cross-site upgrade on the local door is refused');
  assert.match(await upgrade(local,{Host:'127.0.0.1:'+local,Origin:'http://127.0.0.1:'+local}),/^HTTP\/1\.1 101/);
  assert.deepEqual(errors.filter(line=>/add-on page/.test(line)),[]);
});

test('a page file with a bad id or the notebook\'s own port is refused with one line, and a failing command changes nothing else',async t=>{
  const {root,write,spec}=workspace('godspeed-addon-page-bad-'),errors=[],logged=console.error;console.error=(...args)=>errors.push(args.join(' '));
  write('Bad_Id',spec(await freePort()));write('broken',{command:['/no/such/command-here'],port:await freePort()});
  const service=await createService({root,port:0,webPort:0});
  t.after(async()=>{console.error=logged;await service.close();fs.rmSync(root,{recursive:true,force:true});});
  write('mine',spec(service.address.port));
  service.pages.update();
  await wait(()=>errors.some(line=>/broken could not start/.test(line)));
  assert.equal((await request(service.address.port,'/api/status')).status,200);
  assert.equal(errors.filter(line=>/Bad_Id/.test(line)).length,1,errors.join('\n'));
  assert.ok(errors.some(line=>/broken could not start/.test(line)),errors.join('\n'));
  assert.equal((await request(service.address.port,'/addons/Bad_Id/')).status,404);
});

test('the supervisor restarts a killed page no sooner than the gap, and follows the file when it changes or goes',async t=>{
  const {root,write,spec}=workspace('godspeed-addon-page-life-'),lines=[];
  const pages=new AddonPages({root,ownPorts:()=>[],scan:50,restartGap:600,log:line=>lines.push(line)});
  t.after(async()=>{await pages.close();fs.rmSync(root,{recursive:true,force:true});});
  const first=await freePort();write('test',spec(first));pages.start();
  const get=(port)=>new Promise(resolve=>http.get({host:'127.0.0.1',port,path:'/'},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve(JSON.parse(text)));}).on('error',()=>resolve(null)));
  const one=await wait(()=>get(first));
  const killedAt=Date.now();process.kill(one.pid);
  const two=await wait(async()=>{const seen=await get(first);return seen&&seen.pid!==one.pid&&seen;});
  assert.ok(Date.now()-killedAt>=400,'restarted after '+(Date.now()-killedAt)+' ms');
  const second=await freePort();write('test',spec(second));
  const moved=await wait(()=>get(second));
  await wait(async()=>!alive(two.pid));
  assert.equal(pages.list().test.path,'/addons/test/');
  fs.rmSync(path.join(root,'.godspeed','addons','test','page.json'));
  await wait(async()=>!alive(moved.pid));
  assert.deepEqual(pages.list(),{});
  assert.deepEqual(lines,[]);
});
