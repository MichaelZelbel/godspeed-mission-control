import fs from 'node:fs';
import path from 'node:path';
import {parentPort,workerData} from 'node:worker_threads';
import {copyAccount,verifyBundle,stageAccount} from '../core/migration.mjs';
import {MenerioSource} from '../core/migration-source.mjs';
import {Store,atomic,hash} from '../core/records/store.mjs';
import {planMerge,applyMerge} from '../core/migration-merge.mjs';
const {mode,root,device,mediaRoot,jobRoot,prepared,credentials}=workerData;
const progress=message=>parentPort.postMessage({progress:message});
try{
  if(mode==='preview'){
    let bundle=prepared;
    if(credentials){
      progress('Copying your Menerio account. This may take several minutes.');
      const source=new MenerioSource(credentials);await source.identify();bundle=path.join(jobRoot,'bundle');
      await copyAccount(source,bundle,{onProgress:row=>progress(`Copying your account: ${row.count.toLocaleString()} items in the current section.`)});
    }
    progress('Checking the copy and its attachments.');
    const manifest=verifyBundle(bundle),staged=path.join(jobRoot,'staged');
    progress('Preparing your notes, people and relationships.');stageAccount(bundle,staged,{disposable:true});
    progress('Comparing with your existing Godspeed content.');
    const plan=planMerge(new Store(root,{device}),staged,mediaRoot);
    const preview={bundle,staged,digest:plan.digest,bundleDigest:hash(fs.readFileSync(path.join(bundle,'migration.json'))),summary:plan.summary,copyDate:manifest.verifiedAt};
    atomic(path.join(jobRoot,'preview.json'),JSON.stringify(preview));
    parentPort.postMessage({ready:true,summary:plan.summary,copyDate:manifest.verifiedAt});
  }else{
    const preview=JSON.parse(fs.readFileSync(path.join(jobRoot,'preview.json'),'utf8'));
    if(hash(fs.readFileSync(path.join(preview.bundle,'migration.json')))!==preview.bundleDigest)throw new Error('The source copy changed. Preview again before importing.');
    progress('Saving a backup and copying your content.');
    const receipt=applyMerge({root,device,mediaRoot,jobRoot,...preview});
    parentPort.postMessage({complete:true,summary:receipt});
  }
}catch(error){
  // Never return local paths, provider responses or credentials to the browser.
  const safe=/^(Your content changed|The source copy changed|Some (stored|imported)|An imported|An attachment|The imported copy)/.test(error.message);
  parentPort.postMessage({failed:true,error:safe?error.message:'The copy could not be verified or imported. Check the source connection and try a new preview. Your existing content is preserved.'});
}
