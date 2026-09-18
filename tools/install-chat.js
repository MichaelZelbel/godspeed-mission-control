#!/usr/bin/env node
'use strict';
// Install one immutable bundle. The pointer changes only after every byte verifies.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
function entries(dir, prefix='') {
  return fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=> {
    if (e.name === '__pycache__' || e.name.startsWith('.')) return [];
    const rel=prefix+e.name, full=path.join(dir,e.name);
    if(e.isSymbolicLink()) throw new Error('Bundle cannot contain links');
    return e.isDirectory()?entries(full,rel+'/'):[[rel,fs.readFileSync(full)]];
  });
}
function install(kit, home=os.homedir()) {
  const files = entries(path.join(kit,'tools','hub_chat'),'tools/hub_chat/').concat(entries(path.join(kit,'integrations','hermes'),'integrations/hermes/'));
  for (const name of ['due.js','work.js','hub-cards.js']) files.push(['tools/'+name,fs.readFileSync(path.join(kit,'tools',name))]);
  const manifest=Object.fromEntries(files.map(([name,data])=>[name,hash(data)]));
  const id=hash(JSON.stringify(manifest));
  const root=path.join(home,'.hub','chat');
  fs.mkdirSync(path.join(root,'releases'),{recursive:true,mode:0o700});
  const target=path.join(root,'releases',id);
  if (!fs.existsSync(target)) {
    const stage=fs.mkdtempSync(path.join(root,'releases','.stage-'));
    for (const [name,data] of files) {
      const dest=path.join(stage,name);
      fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});
      fs.writeFileSync(dest,data,{mode:0o600});
      if(hash(fs.readFileSync(dest))!==manifest[name]) throw new Error('Bundle copy did not verify');
    }
    fs.writeFileSync(path.join(stage,'bundle.json'),JSON.stringify({schema:1,id,files:manifest},null,2));
    fs.renameSync(stage,target);
  }
  for (const [name,digest] of Object.entries(manifest)) {
    if(hash(fs.readFileSync(path.join(target,name)))!==digest) throw new Error('Installed bundle differs from its manifest');
  }
  const pointer=path.join(root,'current.json');
  const previous=fs.existsSync(pointer)?JSON.parse(fs.readFileSync(pointer,'utf8')):null;
  const next={schema:1,id,path:target,previous:previous&&previous.id!==id?previous.path:previous&&previous.previous};
  const temp=pointer+'.'+crypto.randomUUID()+'.tmp';
  fs.writeFileSync(temp,JSON.stringify(next,null,2),{mode:0o600});
  fs.renameSync(temp,pointer);
  return next;
}
module.exports={install};
if(require.main===module){
  try {const args=process.argv.slice(2); console.log(JSON.stringify(install(path.resolve(args[0]),args[1]||os.homedir())));}
  catch(e){console.error('Chat package installation failed: '+e.message);process.exitCode=1;}
}
