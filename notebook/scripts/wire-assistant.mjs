import fs from 'node:fs';
import path from 'node:path';
import {Store,atomic} from '../core/records/store.mjs';
import {ApiKeys} from '../core/api-keys.mjs';
const root=process.env.GODSPEED_WORKSPACE,home=process.argv[2];if(!root||!home)throw new Error('Choose the candidate workspace and isolated assistant home');
const store=new Store(root),port=Number(process.env.GODSPEED_PORT||47831),file=path.join(home,'config.yaml');fs.mkdirSync(home,{recursive:true});
let text=fs.existsSync(file)?fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''):`terminal:\n  cwd: ${JSON.stringify(root)}\nskills:\n  external_dirs: [${JSON.stringify(path.join(root,'skills'))}]\nmemory:\n  memory_enabled: false\n`;
if(!/^mcp_servers:/m.test(text)){
  let headers='';if(process.env.GODSPEED_DEVICE==='vps'){
    const keyFile=path.join(store.state,'assistant-mcp.json');let key;
    if(fs.existsSync(keyFile))key=JSON.parse(fs.readFileSync(keyFile)).key;else{key=new ApiKeys(store).invoke('mc-api-keys/generate',{name:'Candidate assistant',scopes:['notes','contacts','world','collections','media','profile','actions','stats']}).api_key;atomic(keyFile,JSON.stringify({key}));fs.chmodSync(keyFile,0o600);}
    headers=`    headers:\n      Authorization: ${JSON.stringify('Bearer '+key)}\n`;
  }
  text+=`\nmcp_servers:\n  godspeed:\n    url: http://127.0.0.1:${port}/mcp\n${headers}`;
  if(process.env.GODSPEED_COMPUTER==='on')text+=`  godspeed_computer:\n    command: ${JSON.stringify(process.execPath)}\n    args: ["/opt/godspeed/kit/computer/mcp.js"]\n    env:\n      GODSPEED_COMPUTER_DIR: "/opt/data/full-candidate/computer"\n`;
  atomic(file,text);fs.chmodSync(file,0o600);
}
console.log(JSON.stringify({wired:true,isolated:true,port}));
