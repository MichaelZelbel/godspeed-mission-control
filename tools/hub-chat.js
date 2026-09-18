#!/usr/bin/env node
'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process');
const home=os.homedir();
const root=path.join(home,'.hub','chat');
try {
  const bundle=JSON.parse(fs.readFileSync(path.join(root,'current.json'),'utf8'));
  const configPath=path.join(root,'runtime.json');
  const runtime=fs.existsSync(configPath)?JSON.parse(fs.readFileSync(configPath,'utf8')):{};
  const candidates=[runtime.python,process.env.HUB_CHAT_PYTHON,
    path.join(home,'.hermes','hermes-agent','venv',process.platform==='win32'?'Scripts/python.exe':'bin/python'),
    path.join(home,'.hermes','hermes-agent','.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python')].filter(Boolean);
  let python=candidates.find(p=>fs.existsSync(p)&&cp.spawnSync(p,['-c','import sys; assert sys.version_info >= (3,10)'],{stdio:'ignore'}).status===0);
  if(!python) throw new Error('Hermes Python was not found. Run setup on the machine hosting your Telegram gateway. Desktop tools remain available.');
  const env={...process.env,PYTHONPATH:path.join(bundle.path,'tools')};
  const result=cp.spawnSync(python,['-m','hub_chat.cli',...process.argv.slice(2)],{stdio:'inherit',env});
  if(result.error) throw result.error;
  process.exitCode=result.status===null?1:result.status;
} catch(e) {console.error(e.message);process.exitCode=1;}
