import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import net from 'node:net';
import {spawn} from 'node:child_process';
import {terminateOwnedTree} from './process-tree.mjs';
// An add-on's page through the notebook: .godspeed/addons/<id>/page.json is {"command":[...],"port":N,"title":"..."}.
// The notebook runs the command as itself in the mission control folder and, for a signed-in visit, passes
// /addons/<id>/... to 127.0.0.1:<port>. Sign-in is decided by the caller; nothing here sees an unsigned visit.
const HOP=new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade']);
const SESSION_COOKIE=/(?:^|;\s*)godspeed_session=[^;]*/g;
const error=(res,status,message)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:message}));};
// Linux and Windows stop the whole tree; macOS has no /proc to find a tree in, so only the command itself stops there.
const stop=child=>process.platform==='darwin'?(child.exitCode===null&&child.kill(),Promise.resolve()):terminateOwnedTree(child).catch(()=>{});
export class AddonPages{
 constructor({root,ownPorts,scan=15000,restartGap=60000,log=message=>console.error(message)}){
  Object.assign(this,{root:path.resolve(root),ownPorts,scan,restartGap,log});this.pages=new Map();this.refused=new Map();this.timer=null;this.closed=false;
 }
 start(){this.update();this.timer=setInterval(()=>this.update(),this.scan);this.timer.unref?.();}
 // Settings lists the page of every add-on whose file is valid, running or between restarts.
 list(){return Object.fromEntries([...this.pages].map(([id,p])=>[id,{title:p.spec.title,path:'/addons/'+id+'/'}]));}
 read(id,taken){
  let text;try{text=fs.readFileSync(path.join(this.root,'.godspeed','addons',id,'page.json'),'utf8');}catch{return null;}
  const refuse=reason=>{if(this.refused.get(id)!==text){this.refused.set(id,text);this.log('Godspeed Mission Control: add-on page '+id+' refused: '+reason);}return null;};
  if(!/^[a-z0-9-]+$/.test(id))return refuse('the id may only use a-z, 0-9 and -');
  let spec;try{spec=JSON.parse(text);}catch{return refuse('page.json is not valid JSON');}
  const command=spec?.command;
  if(!Array.isArray(command)||!command.length||command.some(part=>typeof part!=='string'||!part))return refuse('command must be a list of strings');
  if(!Number.isInteger(spec.port)||spec.port<1024||spec.port>65535)return refuse('port must be a whole number from 1024 to 65535');
  if(this.ownPorts().includes(spec.port))return refuse('port '+spec.port+' is the notebook\'s own');
  if(taken.has(spec.port))return refuse('port '+spec.port+' is already another add-on\'s page');
  if(spec.title!==undefined&&typeof spec.title!=='string')return refuse('title must be text');
  this.refused.delete(id);taken.add(spec.port);
  return {text,spec:{command,port:spec.port,title:spec.title||id}};
 }
 update(){
  if(this.closed)return;
  let ids=[];try{ids=fs.readdirSync(path.join(this.root,'.godspeed','addons'),{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name).sort();}catch{}
  const wanted=new Map(),taken=new Set();
  for(const id of ids){const page=this.read(id,taken);if(page)wanted.set(id,page);}
  for(const id of [...this.refused.keys()])if(!ids.includes(id))this.refused.delete(id);
  for(const [id,page] of [...this.pages]){
   const next=wanted.get(id);
   if(next&&next.text===page.text)continue;
   this.pages.delete(id);void this.end(page);
  }
  for(const [id,page] of wanted){
   const known=this.pages.get(id);
   if(!known)this.pages.set(id,{...page,child:null,startedAt:0});
  }
  for(const [id,page] of this.pages)if(!page.child&&(!page.startedAt||Date.now()-page.startedAt>=this.restartGap))this.run(id,page);
 }
 run(id,page){
  page.startedAt=Date.now();
  try{
   const [command,...args]=page.spec.command,child=spawn(command,args,{cwd:this.root,stdio:'ignore',windowsHide:true});
   page.child=child;
   child.once('error',e=>{if(page.child===child)page.child=null;this.log('Godspeed Mission Control: add-on page '+id+' could not start: '+e.message);});
   child.once('exit',()=>{if(page.child===child)page.child=null;});
  }catch(e){page.child=null;this.log('Godspeed Mission Control: add-on page '+id+' could not start: '+e.message);}
 }
 end(page){const child=page.child;page.child=null;return child?stop(child):Promise.resolve();}
 // Both take only a visit the caller found signed in.
 target(req,res){
  const url=new URL(req.url,'http://localhost'),match=/^\/addons\/([^/]+)(\/.*)?$/.exec(url.pathname),page=match&&this.pages.get(match[1]);
  if(!page){if(res)error(res,404,'No add-on page here.');return null;}
  return {id:match[1],page,rest:(match[2]||'/')+url.search,bare:!match[2],search:url.search};
 }
 headers(req,id,port){
  const headers={};
  for(const [name,value] of Object.entries(req.headers))if(!HOP.has(name)&&name!=='host')headers[name]=value;
  if(headers.cookie){headers.cookie=headers.cookie.replace(SESSION_COOKIE,'').replace(/^[;\s]+/,'');if(!headers.cookie)delete headers.cookie;}
  return {...headers,host:'127.0.0.1:'+port,'x-forwarded-prefix':'/addons/'+id,'x-forwarded-host':req.headers.host||'','x-forwarded-proto':req.headers['x-forwarded-proto']||(req.socket.encrypted?'https':'http')};
 }
 route(req,res){
  const to=this.target(req,res);if(!to)return;
  if(to.bare){res.writeHead(308,{Location:'/addons/'+to.id+'/'+to.search});return res.end();}
  const {port}=to.page.spec,up=http.request({host:'127.0.0.1',port,path:to.rest,method:req.method,headers:this.headers(req,to.id,port)},answer=>{
   const headers={};for(const [name,value] of Object.entries(answer.headers))if(!HOP.has(name))headers[name]=value;
   res.writeHead(answer.statusCode,answer.statusMessage,headers);answer.pipe(res);
   answer.once('error',()=>res.destroy());
  });
  up.once('error',()=>{if(!res.headersSent)error(res,502,'This add-on\'s page is not running right now.');else res.destroy();});
  res.once('close',()=>{if(!res.writableEnded)up.destroy();});
  req.pipe(up);
 }
 upgrade(req,socket,head){
  const to=this.target(req,null);if(!to||to.bare)return socket.destroy();
  const {port}=to.page.spec,upstream=net.connect(port,'127.0.0.1',()=>{
   const lines=[req.method+' '+to.rest+' HTTP/1.1'],headers={...this.headers(req,to.id,port),connection:'Upgrade',upgrade:req.headers.upgrade};
   for(const [name,value] of Object.entries(headers))for(const each of [].concat(value))lines.push(name+': '+each);
   upstream.write(lines.join('\r\n')+'\r\n\r\n');if(head?.length)upstream.write(head);
   upstream.pipe(socket);socket.pipe(upstream);
  });
  upstream.once('error',()=>socket.destroy());socket.once('error',()=>upstream.destroy());socket.once('close',()=>upstream.destroy());upstream.once('close',()=>socket.destroy());
 }
 async close(){
  this.closed=true;clearInterval(this.timer);
  const pages=[...this.pages.values()];this.pages.clear();
  await Promise.all(pages.map(page=>this.end(page)));
 }
}
