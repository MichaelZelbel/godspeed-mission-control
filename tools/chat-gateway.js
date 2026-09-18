#!/usr/bin/env node
'use strict';
// Setup only on the machine that owns a Hermes Telegram profile. Never start a bot here.
const fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process');
function remoteConnections(home) {
  const directory=process.platform==='win32'?path.join(home,'AppData/Roaming/Hermes'):
    process.platform==='darwin'?path.join(home,'Library/Application Support/Hermes'):path.join(home,'.config/Hermes');
  try {
    const saved=JSON.parse(fs.readFileSync(path.join(directory,'connections.json'),'utf8'));
    if(![1,2].includes(saved.version)||!Array.isArray(saved.connections)) throw new Error('Unsupported desktop connection format');
    return saved.connections.filter(c=>c.kind!=='local'&&typeof c.host==='string').map(c=>({kind:c.kind,label:c.label||'Remote assistant'}));
  } catch(e) { if(e.code==='ENOENT')return []; throw e; }
}
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
  const connections=remoteConnections(home);
  function finish(result) {
    const directory=path.join(home,'.hub/chat'); fs.mkdirSync(directory,{recursive:true,mode:0o700});
    const destination=path.join(directory,'pending-server-update.json');
    if(connections.length) {
    const pending={...result,state:'remote_update_pending',connections,local_state:result.state||'configured',
      server_state:'not_checked',
      reason:'Desktop tools are installed. This setup has not checked or updated Telegram protection on your connected server.',
      update_url:'https://github.com/MichaelZelbel/teach-it-once-kit/blob/main/docs/telegram-conversations.md#updating-a-connected-server'};
    const temporary=destination+'.tmp';
    fs.writeFileSync(temporary,JSON.stringify(pending,null,2),{mode:0o600}); fs.renameSync(temporary,destination);
    result=pending;
    } else if(fs.existsSync(destination))fs.unlinkSync(destination);
    const status=path.join(directory,'setup-status.json'),temporary=status+'.tmp';
    fs.writeFileSync(temporary,JSON.stringify({schema:1,state:result.state||'configured',notice:human(result),updated_at:new Date().toISOString()}),{mode:0o600});
    fs.renameSync(temporary,status);
    return result;
  }
  const profile=process.env.HERMES_HOME||path.join(home,'.hermes');
  const envFile=path.join(profile,'.env');
  if(!fs.existsSync(envFile)) {
    return finish({state:'desktop_only',reason:'No local Telegram profile'});
  }
  const vars={};
  for(const line of fs.readFileSync(envFile,'utf8').split(/\r?\n/)){
    const m=line.match(/^\s*(?:export\s+)?(TELEGRAM_HOME_CHANNEL|TELEGRAM_ALLOWED_USERS)=(.*?)\s*$/);
    if(m)vars[m[1]]=m[2].replace(/^['"]|['"]$/g,'');
  }
  if(!vars.TELEGRAM_HOME_CHANNEL) return finish({state:'not_connected',reason:'Telegram has not been connected yet'});
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
  const configuration=JSON.parse(configured.stdout);
  if(configuration.state==='disabled_by_user')return finish(configuration);
  const preview=cp.spawnSync(python,['-m','hub_chat.cli','--profile',profile,'preview'],{encoding:'utf8',env:{...process.env,PYTHONPATH:path.join(bundle.path,'tools')}});
  if(preview.status!==0) throw new Error('Current reminder sources could not be previewed. Notifications remain paused.');
  const enabled=cp.spawnSync(python,['-m','hub_chat.cli','--profile',profile,'enable-proactive','--after-preview'],{encoding:'utf8',env:{...process.env,PYTHONPATH:path.join(bundle.path,'tools')}});
  if(enabled.status!==0) throw new Error('Conversation checks did not pass. Notifications remain paused.');
  fs.writeFileSync(path.join(chatRoot,'runtime.json'),JSON.stringify({python,runtime:root,profile}),{mode:0o600});
  return finish(configuration);
}
function human(result) {
  if(result.state==='remote_update_pending')return result.reason+'\nIf you have not already updated that server, run its installer. Verify protection there. Instructions: '+result.update_url;
  if(result.state==='disabled_by_user')return 'Telegram protection remains disabled, as you chose.';
  if(result.state==='desktop_only')return 'Desktop tools are installed. No Telegram gateway was started on this computer.';
  if(result.state==='not_connected')return 'Telegram is not connected here yet. Run setup again after connecting it.';
  return 'Telegram protection is installed. Restart the existing gateway, then verify that it loaded the update.';
}
module.exports={discover,setup,remoteConnections,human};
if(require.main===module){try{const result=setup(process.argv[2]); console.log(process.argv.includes('--human')?human(result):JSON.stringify(result));
  if(result.state==='remote_update_pending')process.exitCode=2;
}catch(e){console.error(e.message);process.exitCode=1;}}
