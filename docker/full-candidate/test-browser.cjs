const {chromium}=require('playwright');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const [name,evidence,mode]=process.argv.slice(2);
const origin=process.env.GODSPEED_VERIFY_ORIGIN||'https://localhost:48443';
(async()=>{
 const browser=await chromium.launch({headless:true});
 const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000},...(mode==='resumed'?{storageState:path.join(evidence,'session.json')}:{})});
 const page=await context.newPage();page.setDefaultTimeout(60000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  if(mode==='resumed'){
   for(let n=0;n<60;n++){try{const r=await context.request.get(origin+'/health');if(r.ok())break;}catch{}await page.waitForTimeout(1000);}
   await page.goto(origin+'/dashboard/settings/import');
   // This wait failed now and then after the restart (6 October 2026); the log
   // then says what the page showed instead.
   try{await page.getByRole('heading',{name:'Import from Menerio'}).waitFor();}
   catch(error){console.log('After the restart the page at',page.url(),'showed:',(await page.locator('body').innerText().catch(()=>'')).slice(0,600));await page.screenshot({path:path.join(evidence,'resumed-failure.png'),fullPage:true}).catch(()=>{});throw error;}
   assert.equal((await context.request.get(origin+'/api/session')).status(),200);
   const telegram=await(await context.request.get(origin+'/api/telegram')).json();
   assert.equal(telegram.connected,!!process.env.GODSPEED_VERIFY_TELEGRAM_KEY,'a connected bot, or a skipped step, survives the restart');
   const logout=await context.request.post(origin+'/api/logout',{data:{}});assert.equal(logout.status(),200);
   assert.equal((await context.request.get(origin+'/api/session')).status(),401);
   fs.writeFileSync(path.join(evidence,'session.json'),JSON.stringify({cookies:[],origins:[]}));
   console.log('Fresh image: owner/session survive Docker restart; logout revokes access.');
   return;
  }
  if(process.env.GODSPEED_VERIFY_INVITATION_URL){
   const invitation=new URL(process.env.GODSPEED_VERIFY_INVITATION_URL);invitation.searchParams.set('next','/dashboard/settings/import');
   await page.goto(invitation.href);await page.getByRole('heading',{name:'Make it yours'}).waitFor();
   assert.equal(await page.getByLabel('Setup code',{exact:true}).count(),0);
  }else{
   await page.goto(origin+'/dashboard/settings/import');
   await page.getByRole('heading',{name:'Your first visit'}).waitFor();
   await page.getByLabel('Setup code',{exact:true}).fill(process.env.GODSPEED_VERIFY_SETUP_CODE);
   await page.getByRole('button',{name:'Start setup'}).click();
  }
  await page.getByLabel('Username',{exact:true}).fill('image-test-owner');
  await page.getByLabel('Password',{exact:true}).fill('short');
  await page.getByText('5 of 12 characters').waitFor();
  await page.getByLabel('Password',{exact:true}).fill('a complete image test password');
  await page.getByLabel('Confirm password',{exact:true}).fill('a complete image test password');
  await page.getByLabel('Keep me signed in for 30 days').check();
  await page.getByRole('button',{name:'Create account'}).click();
  await page.getByRole('heading',{name:'Keep your way back in'}).waitFor();
  await page.getByLabel('I have saved my recovery code.').check();
  await page.getByRole('button',{name:'Open Godspeed Mission Control'}).click();
  // A new account goes through Connect Telegram, and can skip it.
  await page.getByRole('heading',{name:'Connect Telegram'}).waitFor();
  await page.getByText('Telegram lets you talk to your mission control from any phone or computer.').waitFor();
  assert.equal(await page.getByRole('link',{name:'BotFather'}).getAttribute('href'),'https://t.me/BotFather');
  await page.getByLabel("Your bot's key").fill('123456789:AAHaKeyNobodyEverMadeForThisTest_012345');
  await page.getByRole('button',{name:'Check and connect'}).click();
  await page.getByText('Telegram does not know this key').waitFor();
  await page.screenshot({path:path.join(evidence,'telegram-wrong-key.png'),fullPage:true});
  const key=process.env.GODSPEED_VERIFY_TELEGRAM_KEY;
  if(key){
   // Against the stand-in Telegram running inside the container (test.sh): the real key, the
   // one-time link, a stranger's Start without it, the owner's Start with it.
   const act=a=>execFileSync('docker',['exec',name,'node','-e',`fetch('http://127.0.0.1:8081/__act',{method:'POST',body:${JSON.stringify(JSON.stringify(a))}}).then(r=>process.exit(r.ok?0:1))`]);
   await page.getByLabel("Your bot's key").fill(key);
   await page.getByRole('button',{name:'Check and connect'}).click();
   const open=page.getByRole('link',{name:/^Open @test_godspeed_bot in Telegram/});await open.waitFor();
   const link=new URL(await open.getAttribute('href')),code=link.searchParams.get('start');
   assert.equal(link.origin+link.pathname,'https://t.me/test_godspeed_bot');assert.match(code,/^[A-Za-z0-9_-]{32}$/);
   await page.getByRole('img',{name:'QR code that opens @test_godspeed_bot in Telegram'}).waitFor();
   assert.equal((await page.content()).includes(key),false,'the key never comes back to the page');
   await page.screenshot({path:path.join(evidence,'telegram-link-desktop.png'),fullPage:true});
   act({from:999,text:'/start'});act({from:111,text:'/start '+code});
   await page.getByText('Setup is running in your chat with').waitFor({timeout:90000});
   const record=JSON.parse(execFileSync('docker',['exec',name,'cat','/tmp/telegram-record.json'],{encoding:'utf8'}));
   const to=id=>record.sent.filter(m=>m.chat_id===id).map(m=>m.text);
   assert.ok(to(999).some(t=>t.includes('open me with the button on your Godspeed page')),'a Start without the code is told where the link is');
   assert.ok(to(111).some(t=>t.includes('Hi Anna')),'the code makes its sender the owner');
   assert.ok(to(111).some(t=>t.includes('Which AI should I think with')),'and the setup chat begins');
   const status=await(await context.request.get(origin+'/api/telegram')).json();
   assert.equal(status.phase,'setting-up');assert.equal(status.link,undefined);assert.equal(JSON.stringify(status).includes(key),false);
   await page.screenshot({path:path.join(evidence,'telegram-setting-up.png'),fullPage:true});
   await page.getByRole('button',{name:'Continue to your notebook'}).click();
  }else{
   await page.getByRole('button',{name:'Skip for now'}).click();
  }
  await page.getByRole('heading',{name:'Import from Menerio'}).waitFor();
  assert.equal(new URL(page.url()).pathname,'/dashboard/settings/import');
  const session=await(await context.request.get(origin+'/api/session')).json();
  assert.ok(session.expires_at>Date.now()+29*86400000);
  const imports=await(await context.request.get(origin+'/api/menerio/import')).json();
  assert.equal(imports.prepared,false);assert.equal(imports.connected,false);assert.equal(imports.job,null);
  await page.screenshot({path:path.join(evidence,'fresh-import-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(evidence,'fresh-import-phone.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await context.request.post(origin+'/api/query',{data:{table:'notes',operation:'insert',values:{id:'fresh-image-note',title:'Image verification note',content:'A small synthetic note.'}}});
  await page.goto(origin+'/dashboard/notes/fresh-image-note');
  await page.getByRole('button',{name:'Chat with Godspeed',exact:true}).waitFor();
  await page.getByRole('button',{name:'Chat with Godspeed',exact:true}).click();
  await page.getByRole('button',{name:'Close Godspeed chat'}).waitFor();
  await page.screenshot({path:path.join(evidence,'fresh-note-chat-phone.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  await context.storageState({path:path.join(evidence,'session.json')});
  console.log('Fresh image: setup, password progress, 30-day login, requested-page return, import UI and note chat verified.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
