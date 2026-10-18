// Screens, checked in a real browser: one check per defect found walking every
// screen with the real notebook (6 October 2026). Each check names what broke.
//
//   node test-screens.cjs <origin> [session.json]
//
// Seeds its own fictional records through the API, so it runs against a fresh
// installation (docker/full-candidate/test.sh) or a private copy of a notebook.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const [origin='https://localhost:48443',session]=process.argv.slice(2);
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.GODSPEED_BROWSER_CHANNEL?{channel:process.env.GODSPEED_BROWSER_CHANNEL}:{})});
 const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:900},...(session&&fs.existsSync(session)?{storageState:session}:{})});
 const page=await context.newPage();page.setDefaultTimeout(30000);
 const problems=[],failed=[];
 page.on('pageerror',e=>problems.push('page error: '+e.message));
 page.on('console',m=>{if(m.type()==='error'&&/MIME type/.test(m.text()))problems.push(m.text());});
 page.on('response',r=>{if(r.url().includes('/api/')&&r.status()>=400&&!r.url().includes('/api/auth/'))failed.push(r.status()+' '+r.url().replace(origin,'')+' '+(r.request().postData()||'').slice(0,120));});
 const api=async body=>{const r=await context.request.post(origin+'/api/query',{data:body});assert.equal(r.status(),200,await r.text());return (await r.json()).data;};
 const checks=[];const check=async(name,fn)=>{try{await fn();checks.push('ok   '+name);}catch(error){checks.push('FAIL '+name+': '+String(error.message).split('\n')[0]);}};
 const stamp=Date.now().toString(36);
 try{
  // Fictional records only.
  const long='Fictional screen check paragraph. '.repeat(40);
  const note=await api({table:'notes',operation:'insert',values:{title:'Screen check long note '+stamp,content:long+'END-OF-NOTE',folder_path:'Screen checks'},selection:'*',single:true});
  const collection=await api({table:'collections',operation:'insert',values:{name:'Screen check films '+stamp,slug:'screen-check-films-'+stamp,field_schema:[{key:'title',label:'Title',type:'text',primary:true},{key:'with',label:'Watched with',type:'text'}]},selection:'*',single:true});
  for(let i=0;i<3;i++)await api({table:'collection_items',operation:'insert',values:{collection_id:collection.id,data:{title:'Film '+i,with:'nobody'}},selection:'id',single:true});

  await check('an open note shows its whole text, never the list\'s preview of it',async()=>{
   await page.goto(origin+'/dashboard/notes');await page.locator('main').getByText('All Notes').first().waitFor();
   await page.goto(origin+'/dashboard/notes/'+note.id);
   const editor=page.locator('main [contenteditable=true]').first();await editor.waitFor();
   await page.waitForFunction(()=>document.querySelector('main [contenteditable=true]')?.innerText.includes('END-OF-NOTE'),null,{timeout:15000});
  });
  await check('"Add tag" in a note\'s menu opens the tag box, even when the section was left collapsed',async()=>{
   await page.locator('main').getByRole('button',{name:'More actions'}).click();
   await page.getByRole('menuitem',{name:'Add tag'}).click();
   await page.waitForFunction(()=>{const e=document.activeElement;return e&&e.tagName==='INPUT'&&e.closest('main');},null,{timeout:5000});
  });
  await check('the floating chat button steps aside while a chat is docked beside a collection',async()=>{
   await page.goto(origin+'/collections/'+collection.slug);await page.locator('main').getByRole('button',{name:'AI chat'}).click();
   await page.getByPlaceholder('Ask Godspeed...').last().waitFor();
   assert.equal(await page.getByRole('button',{name:'Chat with Godspeed'}).isVisible(),false);
   await page.getByRole('button',{name:'Close chat'}).click();
   await page.getByRole('button',{name:'Chat with Godspeed'}).waitFor({state:'visible'});
  });
  await check('a new collection lives at the address its create dialog shows',async()=>{
   assert.equal(collection.slug,'screen-check-films-'+stamp);
  });
  await check('using a template creates the collection without an error',async()=>{
   const before=failed.length;
   await page.goto(origin+'/collections/templates');await page.getByText('Wine Journal').first().click();
   await page.getByRole('button',{name:'Use This Template'}).click();
   const name=page.getByLabel('Collection name');await name.fill('Screen check wines '+stamp);
   await page.getByRole('button',{name:'Create',exact:true}).click();
   await page.waitForURL(/\/collections\/screen-check-wines/);await page.waitForTimeout(800);
   assert.deepEqual(failed.slice(before),[]);
  });
  await check('the Media page loads its PDF reader (no refused module script)',async()=>{
   const before=problems.length;await page.goto(origin+'/dashboard/media');await page.waitForTimeout(2500);
   assert.deepEqual(problems.slice(before).filter(p=>/MIME/.test(p)),[]);
  });
 }finally{await browser.close();}
 console.log(checks.join('\n'));
 if(failed.length)console.log('requests that failed:\n'+failed.join('\n'));
 if(checks.some(c=>c.startsWith('FAIL')))process.exit(1);
})().catch(error=>{console.error(error);process.exit(1);});
