import subprocess
import unittest
from helpers import ROOT


class ServerUpdate(unittest.TestCase):
    def test_restart_requires_a_new_healthy_gateway_in_the_same_profile(self):
        script=r'''
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {activate}=require(process.argv[1]);
const home=fs.mkdtempSync(path.join(os.tmpdir(),'chat-server-'));
const profile=path.join(home,'.hermes'); fs.mkdirSync(profile);
const config=path.join(profile,'hub-chat.json'),marker=path.join(profile,'chat-runtime.json');
const start=Date.parse('2026-09-18T12:00:00Z');
fs.writeFileSync(config,JSON.stringify({enabled:true}));
fs.writeFileSync(marker,JSON.stringify({loaded_at:'2026-09-18T11:59:59Z'}));
let calls=[],fresh=false,healthy=true,restart=true;
const run=(cmd,args)=>{
 calls.push([cmd,args]);
 if(cmd==='systemctl')return {status:restart?0:1};
 assert.equal(cmd,'runuser');
 assert(args.includes('example-user')); assert(args.includes(profile));
 if(fresh)fs.writeFileSync(marker,JSON.stringify({loaded_at:'2026-09-18T12:00:01Z'}));
 return {status:healthy?0:1};
};
const options={home,user:'example-user',attempts:2};
const check=()=>activate(options,run,()=>{},()=>start);
try {
 assert.throws(check,/not verified/); // A recent old marker cannot prove a restart.
 fresh=true; healthy=false; assert.throws(check,/not verified/);
 healthy=true; assert.equal(check().state,'active');
 restart=false; assert.throws(check,/restart/);
 calls=[]; fs.writeFileSync(config,JSON.stringify({enabled:false}));
 assert.equal(check().state,'disabled_by_user'); assert.equal(calls.length,0);
 fs.writeFileSync(config,'{}'); assert.throws(check,/incomplete/);
 fs.unlinkSync(config); fs.writeFileSync(path.join(profile,'.env'),'TELEGRAM_HOME_CHANNEL=123\n');
 assert.throws(check,/not installed/);
} finally {fs.rmSync(home,{recursive:true,force:true});}
'''
        subprocess.run(['node','-e',script,str(ROOT/'tools/chat-server.js')],check=True)
