#!/usr/bin/env node
'use strict';
// Setup only on the machine that owns a Hermes Telegram profile. Never start a bot here.
const fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process');
function discover(home, env=process.env) {
  const candidates=[env.HUB_CHAT_PYTHON];
  for(const launcher of [env.KB_HERMES_BIN,path.join(home,'.local/bin/hermes')].filter(Boolean)) {
    try { const real=fs.realpathSync(launcher), first=fs.readFileSync(real,'utf8').split(/\r?\n/)[0];
      const match=first.match(/^#!\s*(.+python[^\s]*)\s*$/); if(match)candidates.push(match[1]);
    } catch(e) {}
  }
  for(const directory of ['.hermes/hermes-agent','hermes-agent','.local/share/hermes/hermes-agent'])
    for(const venv of ['venv','.venv']) candidates.push(path.join(home,directory,venv,process.platform==='win32'?'Scripts/python.exe':'bin/python'));
  return candidates.find(p=>p&&fs.existsSync(p)&&cp.spawnSync(p,['-c','import telegram,yaml; import sys; assert sys.version_info >= (3,10)'],{stdio:'ignore'}).status===0);
}
function setup(hub, home=os.homedir()) {
  const profile=process.env.HERMES_HOME||path.join(home,'.hermes');
  const envFile=path.join(profile,'.env');
  if(!fs.existsSync(envFile)) return {state:'desktop_only',reason:'No local Telegram profile'};
  const vars={};
  for(const line of fs.readFileSync(envFile,'utf8').split(/\r?\n/)){
    const m=line.match(/^\s*(?:export\s+)?(TELEGRAM_HOME_CHANNEL|TELEGRAM_ALLOWED_USERS)=(.*?)\s*$/);
    if(m)vars[m[1]]=m[2].replace(/^['"]|['"]$/g,'');
  }
  if(!vars.TELEGRAM_HOME_CHANNEL) return {state:'not_connected',reason:'Telegram has not been connected yet'};
  const owners=(vars.TELEGRAM_ALLOWED_USERS||'').split(/[ ,]+/).filter(Boolean);
  if(owners.length!==1||!/^\d+$/.test(owners[0])||owners[0]!==vars.TELEGRAM_HOME_CHANNEL)
    throw new Error('Automatic setup requires one authorized private conversation. Configure other layouts explicitly.');
  const python=discover(home);
  if(!python) throw new Error('The Python environment used by Hermes could not be verified.');
  const probe=cp.spawnSync(python,['-c','import pathlib,hermes_constants; print(pathlib.Path(hermes_constants.__file__).resolve().parent)'],{encoding:'utf8'});
  if(probe.status!==0) throw new Error('The installed Hermes source could not be located.');
  const root=probe.stdout.trim();
  const chatRoot=path.join(home,'.hub/chat');
  const bundle=JSON.parse(fs.readFileSync(path.join(chatRoot,'current.json'),'utf8'));
  const args=['-m','hub_chat.cli','--profile',profile,'configure','--runtime',root,'--bundle',bundle.path,
    '--conversation',owners[0],'--actor',owners[0],'--hub',hub];
  const configured=cp.spawnSync(python,args,{encoding:'utf8',env:{...process.env,PYTHONPATH:path.join(bundle.path,'tools')}});
  if(configured.status!==0) throw new Error((configured.stderr||'Gateway setup failed').trim());
  fs.writeFileSync(path.join(chatRoot,'runtime.json'),JSON.stringify({python,runtime:root,profile}),{mode:0o600});
  return JSON.parse(configured.stdout);
}
module.exports={discover,setup};
if(require.main===module){try{console.log(JSON.stringify(setup(process.argv[2])));}catch(e){console.error(e.message);process.exitCode=1;}}
