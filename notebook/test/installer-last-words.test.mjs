import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {spawnSync} from 'node:child_process';

// The last words of the Linux and Mac installer (14 October 2026): where the mission control is,
// how to start talking to it, and where its maker writes about it. They run here in bash on their
// own, with the installer's variables set the three ways a computer can end the install.
const script=fs.readFileSync(new URL('../scripts/install-native-notebook.sh',import.meta.url),'utf8').replaceAll('\r','');
const tail=script.slice(script.indexOf('# The last words a person reads after installing'));
const run=env=>spawnSync('bash',['-c','setup_path(){ [ -n "$SETUP" ] && echo "$SETUP"; }\n'+tail],{encoding:'utf8',env:{PATH:process.env.PATH,root:'/home/reader/godspeed-v2',GODSPEED_PORT:'47831',web_address:'',web_problem:'',SETUP:'',...env}});
const newsletter='I write about what it does and what broke, free: https://michaelzelbel.substack.com/subscribe';

test('a computer without a web address: the folder, the local notebook, the newsletter',()=>{
 const r=run({});assert.equal(r.status,0);
 assert.match(r.stdout,/^\nYour mission control is in \/home\/reader\/godspeed-v2\.\n/);
 assert.match(r.stdout,/To talk to it, open your notebook at http:\/\/127\.0\.0\.1:47831\/dashboard\. The first time, connect your own AI account in Settings\.\n/);
 assert.ok(r.stdout.trimEnd().endsWith(newsletter),'the newsletter line is the last line');
});

test('a server with its first private link: the link, then the newsletter',()=>{
 const r=run({web_address:'https://notebook.example',SETUP:'/setup#invite=fixture'});assert.equal(r.status,0);
 assert.match(r.stdout,/To talk to it, open this private link to make your account/);
 assert.match(r.stdout,/\nhttps:\/\/notebook\.example\/setup#invite=fixture\n/);
 assert.ok(r.stdout.trimEnd().endsWith(newsletter));
});

test('a server whose web address failed stops with the problem and no newsletter',()=>{
 const r=run({web_address:'https://notebook.example',web_problem:'The address does not answer.'});
 assert.equal(r.status,1);assert.match(r.stderr,/The address does not answer\./);
 assert.ok(!r.stdout.includes('substack'),'a failed install does not advertise');
});
