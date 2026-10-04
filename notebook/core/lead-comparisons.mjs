import fs from 'node:fs';import path from 'node:path';import {randomInt} from 'node:crypto';import {spawnSync} from 'node:child_process';
import {hash} from './records/store.mjs';import {visibleRows} from './visibility.mjs';import {localPath} from './local-path.mjs';

export function comparisonConfiguration(query,input){
 if(!input||typeof input.enabled!=='boolean')throw Error('Choose whether the adopted weekly comparison is enabled');if(!input.enabled)return {enabled:false};
 const protocol=visibleRows(query,'notes').find(n=>n.id===input.protocol_note_id&&!n.is_trashed),goal=visibleRows(query,'goals').find(g=>g.id===input.goal_id&&['adopted','active'].includes(g.status)),collection=visibleRows(query,'collections').find(c=>c.id===input.collection_id&&!c.is_trashed&&!c.is_archived);
 if(input.adopted!==true||!goal||!protocol?.content?.trim()||protocol.content.length>64000)throw Error('Select the actual adopted goal and agreed comparison protocol note');
 if(!Number.isFinite(Date.parse(input.starts_at))||!Number.isInteger(input.cutoff_hours)||input.cutoff_hours<1||input.cutoff_hours>167)throw Error('Choose an exact first comparison date and a cutoff from one to one hundred sixty-seven hours');
 if(!collection)throw Error('Select the existing collection containing the actual comparison outputs');
 for(const field of ['side_field','period_field','text_field'])if(typeof input[field]!=='string'||!collection.field_schema?.some(f=>f.key===input[field]&&(field==='text_field'?['text','longtext']:['text','longtext','datetime','select']).includes(f.type)))throw Error('Map actual output side, period and verbatim text fields');
 if(new Set([input.side_field,input.period_field,input.text_field]).size!==3)throw Error('Comparison output fields must be distinct');
 if(!Array.isArray(input.sides)||input.sides.length!==2||new Set(input.sides).size!==2||input.sides.some(s=>typeof s!=='string'||!s.trim()||s.length>100))throw Error('Name the two actual output sides from the agreed protocol');
 return {enabled:true,adopted:true,goal_id:goal.id,protocol_note_id:protocol.id,collection_id:collection.id,side_field:input.side_field,period_field:input.period_field,text_field:input.text_field,sides:input.sides,starts_at:new Date(input.starts_at).toISOString(),cutoff_hours:input.cutoff_hours};
}

function committedBlindKey(store,id,key){
 const folder=localPath(store.root,'work/lead-comparisons/'+id),gitDir=localPath(store.root,'.godspeed/lead-comparison-git/'+id+'.git');fs.mkdirSync(folder,{recursive:true});fs.mkdirSync(path.dirname(gitDir),{recursive:true});
 const file=localPath(store.root,'work/lead-comparisons/'+id+'/blind-key.json'),text=JSON.stringify(key,null,2)+'\n';
 if(fs.existsSync(file)){if(fs.readFileSync(file,'utf8')!==text)throw Error('Retained comparison blind key changed; preserve it for review');}else fs.writeFileSync(file,text,{flag:'wx',mode:0o600});
 const env={...process.env};for(const name of Object.keys(env))if(name.startsWith('GIT_'))delete env[name];env.GIT_CONFIG_NOSYSTEM='1';env.GIT_CONFIG_GLOBAL=process.platform==='win32'?'NUL':'/dev/null';
 const git=args=>{const result=spawnSync('git',['-c','core.hooksPath='+path.join(folder,'empty-hooks'),...(args[0]==='init'?[]:['-c','core.bare=false','--git-dir='+gitDir,'--work-tree='+folder]),...args],{env,windowsHide:true,encoding:'utf8',timeout:10000,maxBuffer:1024*1024});if(result.error||result.status)throw Error('The private comparison blind key could not be committed; no comparison draft was filed');return result.stdout.trim();};
 if(!fs.existsSync(gitDir))git(['init','--bare','--template=',gitDir]);
 git(['add','--','blind-key.json']);if(git(['diff','--cached','--name-only']))git(['-c','user.name=Godspeed Mission Control','-c','user.email=local@invalid','commit','-m','Retain private blind comparison key']);
 const commit=git(['rev-parse','HEAD']);if(git(['show',commit+':blind-key.json'])!==text.trim())throw Error('The committed comparison blind key does not match its retained source');
 return {path:path.relative(store.root,file).replaceAll('\\','/'),commit,sha256:hash(text)};
}

export async function weeklyComparison({store,query,settings,now=Date.now()}){
 const config=settings.comparison;if(!config?.enabled)return [];
 const starts=Date.parse(config.starts_at);if(now<starts)return [];
 const week=Math.floor((now-starts)/(7*86400000)),period=new Date(starts+week*7*86400000).toISOString(),cutoff_at=new Date(Date.parse(period)+config.cutoff_hours*3600000).toISOString(),id='lead-comparison-'+hash([period,hash(config)]),old=store.get('lead_comparisons',id);
 if(old&&['ready','missing_sides','needs_review'].includes(old.state))return [old];
 const protocol=visibleRows(query,'notes').find(n=>n.id===config.protocol_note_id&&!n.is_trashed),goal=visibleRows(query,'goals').find(g=>g.id===config.goal_id&&['adopted','active'].includes(g.status)),collection=visibleRows(query,'collections').find(c=>c.id===config.collection_id&&!c.is_trashed&&!c.is_archived);if(!goal)return [];
 if(!collection)throw Error('The actual comparison output collection is missing or hidden');
 if(!protocol?.content?.trim())throw Error('The adopted comparison protocol is missing or hidden');
 if(old&&old.protocol_hash!==protocol._hash)throw Error('The comparison protocol changed during its agreed window');
 const items=visibleRows(query,'collection_items').filter(item=>item.collection_id===config.collection_id&&!item.is_trashed&&item.data?.[config.period_field]===period&&Date.parse(item.updated_at||item.created_at)<=Date.parse(cutoff_at)),outputs=config.sides.map(side=>{
  const matching=items.filter(item=>item.data?.[config.side_field]===side);if(matching.length>1)throw Error('The comparison contains ambiguous duplicate outputs for one side');
  const item=matching[0];if(!item)return {side,missing:true};const text=item.data?.[config.text_field];if(typeof text!=='string'||!text.trim()||text.length>128000)throw Error('The actual comparison output must contain bounded verbatim text');return {side,source_id:item.id,source_hash:item._hash,content:text};
 });
 const expired=now>=Date.parse(cutoff_at),state=outputs.every(o=>!o.missing)?'ready':expired?'missing_sides':'waiting';
 if(old&&hash(old.outputs)===hash(outputs)&&old.state===state)return [old];
 return [await store.withLockAsync(()=>{
  const current=store.get('lead_comparisons',id);if(current&&current._hash!==old?._hash)throw Error('Another run retained this comparison; retry without replaying its key');
  if(hash(store.get('settings','lead')?.comparison||null)!==hash(config)||!visibleRows(query,'notes').some(n=>n.id===protocol.id&&n._hash===protocol._hash)||!visibleRows(query,'goals').some(g=>g.id===goal.id&&g._hash===goal._hash&&['adopted','active'].includes(g.status))||!visibleRows(query,'collections').some(c=>c.id===collection.id&&c._hash===collection._hash&&!c.is_trashed&&!c.is_archived))throw Error('The comparison goal, protocol, collection or configuration changed');
  for(const output of outputs)if(!output.missing&&!visibleRows(query,'collection_items').some(i=>i.id===output.source_id&&i._hash===output.source_hash))throw Error('An actual comparison output changed during its read');
  const retainedFile=localPath(store.root,'work/lead-comparisons/'+id+'/blind-key.json'),retained=fs.existsSync(retainedFile)?JSON.parse(fs.readFileSync(retainedFile,'utf8')):null;
  if(retained&&(retained.comparison_id!==id||retained.period!==period||retained.protocol_id!==protocol.id||retained.protocol_hash!==protocol._hash||!config.sides.includes(retained.mapping?.A)||!config.sides.includes(retained.mapping?.B)||retained.mapping.A===retained.mapping.B))throw Error('The retained private blind key requires review');
  const mapping=current?.blind_key?.mapping||retained?.mapping||(randomInt(2)?{A:config.sides[0],B:config.sides[1]}:{A:config.sides[1],B:config.sides[0]}),key={comparison_id:id,period,protocol_id:protocol.id,protocol_hash:protocol._hash,mapping},proof=committedBlindKey(store,id,key);
  const content=['A','B'].map(label=>label+'\n'+(outputs.find(o=>o.side===mapping[label]).content||'Missing actual output')).join('\n\n');
  const record=store.prepare('lead_comparisons',{id,period,cutoff_at,state,goal_id:goal.id,protocol_id:protocol.id,protocol_hash:protocol._hash,outputs,content,blind_key:{...proof,mapping},publication:'not-published',observed_at:new Date(now).toISOString()},current);
  store.commit([record]);return store.get('lead_comparisons',record.id);
 })];
}
