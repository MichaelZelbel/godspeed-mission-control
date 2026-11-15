import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';

// Installed entry-point acceptance uses a new fictional workspace. The caller's
// workspace, personal records and credentials are never inherited by the CLI.
const kit=process.argv[2],output=process.argv[3];
if(!kit||!output)throw Error('Supply the installed notebook directory and a new report path');
const cli=path.join(path.resolve(kit),'bin','godspeed.mjs');if(!fs.existsSync(cli))throw Error('Installed notebook CLI was not found');
if(fs.existsSync(output))throw Error('Preserve the existing report; choose a new report path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-fictional-window-comparison-')),env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,GODSPEED_WORKSPACE:root,GODSPEED_DEVICE:'fictional-comparison'};
const call=(...args)=>JSON.parse(execFileSync(process.execPath,[cli,...args],{env,encoding:'utf8',maxBuffer:2*1024*1024}));
const facts=['Rain sensor stops watering','Battery cabinet is blue','Workshop begins Thursday','Parcel code is autumn','Tea timer is seven minutes','Bicycle lock stays upstairs','Orchid needs filtered light','Draft review follows lunch','Backup disk lives downstairs','Robot turns left at gate'],sources=[];
for(let i=0;i<facts.length;i++){
 const record={title:'Fictional comparison source '+i,content:'Unrelated opening. '.repeat(500)+'\n\nUser: '+facts[i]+'\nAssistant: This is not a recorded user fact.'},input=path.join(root,'fictional-input-'+i+'.json');fs.writeFileSync(input,JSON.stringify(record),{flag:'wx'});
 sources.push(call('record','save','notes',input));
}
const comparisons=sources.map((source,i)=>{
 const question='What did I remember about '+facts[i].split(' ').slice(0,2).join(' ')+'?',result=call('memory','lookup',question),window=result.windows.find(w=>w.note_id===source.id),current=call('record','get','notes',source.id);
 return {question,expected_note_id:source.id,window:window||null,broad:result.broad,exact_source_passage:!!window&&window.content===current.content.slice(window.start,window.end),current_source_hash:!!window&&window.source_hash===current._hash,broad_fallback_retained:result.broad.some(r=>r.note_id===source.id)};
});
const report={fictional_software_acceptance:true,at:new Date().toISOString(),installed_cli:cli,retained_workspace:root,comparisons,passed:comparisons.every(r=>r.exact_source_passage&&r.current_source_hash&&r.broad_fallback_retained)};
fs.writeFileSync(path.resolve(output),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify({passed:report.passed,questions:comparisons.length,report:path.resolve(output),retained_workspace:root}));if(!report.passed)process.exitCode=1;
