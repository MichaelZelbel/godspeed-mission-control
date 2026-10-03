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
   await page.getByRole('heading',{name:'Import from Menerio'}).waitFor();
   assert.equal((await context.request.get(origin+'/api/session')).status(),200);
   const logout=await context.request.post(origin+'/api/logout',{data:{}});assert.equal(logout.status(),200);
   assert.equal((await context.request.get(origin+'/api/session')).status(),401);
   fs.writeFileSync(path.join(evidence,'session.json'),JSON.stringify({cookies:[],origins:[]}));
   console.log('Fresh image: owner/session survive Docker restart; logout revokes access.');
   return;
  }
  await page.goto(origin+'/dashboard/settings/import');
  await page.getByRole('heading',{name:'Your first visit'}).waitFor();
  await page.getByLabel('Setup code',{exact:true}).fill(process.env.GODSPEED_VERIFY_SETUP_CODE);
  await page.getByRole('button',{name:'Start setup'}).click();
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
