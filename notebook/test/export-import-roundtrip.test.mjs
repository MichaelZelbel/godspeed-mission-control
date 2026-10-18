// Export and import, backup and restore, the way a reader runs them (beta fault list, 18 October
// 2026): importing a notebook's own export stopped at the first starter template with "An existing
// record has the imported ID", an export saved by Windows PowerShell 5.1 (UTF-16) failed with
// "SyntaxError: Unexpected token", and restore on a folder without backup.json printed a stack trace.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {seed} from '../core/seeds.mjs';
import {importExport,exportRecords,readExportFile} from '../core/import.mjs';

const cli=fileURLToPath(new URL('../bin/godspeed.mjs',import.meta.url));
const folder=name=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-roundtrip-'+name+'-'));
const run=(workspace,args,media=path.join(workspace,'.godspeed','media'))=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8',env:{...process.env,GODSPEED_WORKSPACE:workspace,GODSPEED_MEDIA_ROOT:media}});
// A notebook as a reader has it after a while: the starter templates, notes, a person, a link
// between two notes, a starter template they changed, and a key for another assistant.
function used(){
  const store=new Store(folder('used'));seed(store);
  const person=store.save('contacts',{name:'Alex Example'});
  const a=store.save('notes',{title:'Garden plan',content:'Tomatoes by the wall'}),b=store.save('notes',{title:'Seeds to buy',content:'Basil'});
  store.save('note_connections',{source_note_id:a.id,target_note_id:b.id,connection_type:'manual_link'});
  store.save('person_documents',{contact_id:person.id,note_id:a.id});
  const template=store.list('collection_templates')[0];store.save('collection_templates',{...template,description:'My own way'});
  store.save('mcp_api_tokens',{name:'Other assistant',token_hash:'0'.repeat(64)});
  return store;
}

test('a notebook imports its own export and changes nothing',()=>{
  const store=used(),query=new QueryService(store),before=store.scan().size;
  const outcome=importExport(query,exportRecords(store));
  assert.equal(outcome.imported,0);
  assert.ok(outcome.unchanged>0);
  assert.equal(outcome.kept_as_they_are,undefined);
  assert.equal(new Store(store.root).scan().size,before,'no record was added or changed');
});

test('an export moves into an empty folder and into a notebook that was set up, and never carries keys',()=>{
  const source=used(),exported=exportRecords(source);
  assert.ok(!exported.records.some(r=>r.type==='mcp_api_tokens'),'keys for other assistants are not exported');
  assert.ok(exported.records.some(r=>r.type==='note_connections'),'a link between notes is part of the notebook');
  // Into an empty folder.
  const empty=new Store(folder('empty')),first=importExport(new QueryService(empty),exported);
  assert.equal(first.imported,exported.records.length);
  assert.deepEqual(new Store(empty.root).problems,[]);
  assert.equal(importExport(new QueryService(new Store(empty.root)),exported).imported,0,'importing the same file again changes nothing');
  // Into a notebook that was set up: same starter templates, and a note of its own under an ID the file also has.
  const setUp=new Store(folder('setup'));seed(setUp);
  const own=setUp.save('notes',{id:source.list('notes')[0].id,title:'Garden plan',content:'Written here'});
  const outcome=importExport(new QueryService(setUp),exported);
  assert.deepEqual(outcome.kept_as_they_are,['notes/'+own.id],'the note written here stays as it is');
  const after=new Store(setUp.root);
  assert.equal(after.get('notes',own.id).content,'Written here');
  const changed=source.list('collection_templates').find(t=>t.description==='My own way');
  assert.equal(after.get('collection_templates',changed.id).description,'My own way','a starter template changed in the other notebook replaces the untouched one');
  assert.equal(after.list('notes').length,2);
  assert.deepEqual(after.problems,[]);
});

test('an imported record edited here since its import is still refused, and a wrong file gets a plain answer',()=>{
  const store=new Store(folder('edited')),query=new QueryService(store),exported={format:1,records:[{type:'notes',id:'imported-note',title:'Imported',content:'Original'}]};
  assert.equal(importExport(query,exported).imported,1);
  store.save('notes',{id:'imported-note',content:'Edited here'});
  const changed=structuredClone(exported);changed.records[0].content='Changed there';
  assert.throws(()=>importExport(query,changed),/edited locally/);
  assert.throws(()=>importExport(query,{records:[]}),/not a notebook export/);
  assert.throws(()=>importExport(query,[1,2]),/not a notebook export/);
  assert.throws(()=>importExport(query,{format:1,records:[{title:'no type'}]}),/no type or no ID/);
});

test('an export file is read in the encodings Windows and editors save it in',()=>{
  const value={format:1,records:[{type:'notes',id:'n',title:'Grüße'}]},text=JSON.stringify(value,null,2);
  const utf16le=Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(text,'utf16le')]);
  const utf16be=Buffer.from(utf16le);utf16be.swap16();
  for(const bytes of [Buffer.from(text),Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(text)]),utf16le,utf16be,Buffer.from(text,'utf16le')])
    assert.deepEqual(readExportFile(bytes),value);
  assert.throws(()=>readExportFile(Buffer.from('ExperimentalWarning: SQLite')),/not readable JSON/);
});

test('the command exports to a file, imports a PowerShell 5.1 copy, and restores a backup',()=>{
  const store=used(),workspace=store.root,file=path.join(folder('files'),'notebook-export.json');
  const exported=run(workspace,['export',file]);
  assert.equal(exported.status,0,exported.stderr);
  assert.equal(JSON.parse(exported.stdout).file,file);
  const bytes=fs.readFileSync(file);assert.equal(bytes[0],'{'.charCodeAt(0),'written as UTF-8 without a mark');
  // What `export > file` in Windows PowerShell 5.1 saves: UTF-16 with a byte-order mark.
  const powershell=path.join(path.dirname(file),'powershell-export.json');
  fs.writeFileSync(powershell,Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(bytes.toString('utf8').replace(/\n/g,'\r\n'),'utf16le')]));
  const into=folder('into'),imported=run(into,['import',powershell]);
  assert.equal(imported.status,0,imported.stderr);
  assert.equal(JSON.parse(imported.stdout).imported,exportRecords(store).records.length);
  const again=run(workspace,['import',file]);
  assert.equal(again.status,0,again.stderr);
  assert.equal(JSON.parse(again.stdout).imported,0,'its own export imports nothing new');
  assert.equal(run(workspace,['export',file]).status,1,'an export never writes over a file');

  // Backup, then restore into empty folders.
  const backupDir=path.join(folder('backups'),'2026-10-18'),made=run(workspace,['backup',backupDir]);
  assert.equal(made.status,0,made.stderr);
  const target=folder('restored'),media=folder('restored-media'),restored=run(target,['restore',backupDir],media);
  assert.equal(restored.status,0,restored.stderr);
  assert.equal(Number(restored.stdout.trim()),new Store(workspace).scan().size);
  assert.deepEqual(new Store(target).problems,[]);

  // A folder that is not a backup: one plain sentence, no stack trace.
  const notBackup=folder('not-a-backup'),refused=run(folder('restore-empty'),['restore',notBackup],folder('media-empty'));
  assert.equal(refused.status,1);
  assert.match(refused.stderr,/^Error: The folder .* is not a backup: it has no backup\.json/m);
  assert.doesNotMatch(refused.stderr,/\n\s+at /,'no stack trace');
  const noFile=run(folder('import-empty'),['import',path.join(notBackup,'missing.json')]);
  assert.equal(noFile.status,1);assert.match(noFile.stderr,/^Error: There is no file at/m);
  const junk=path.join(notBackup,'junk.json');fs.writeFileSync(junk,'not json');
  const wrong=run(folder('import-junk'),['import',junk]);
  assert.equal(wrong.status,1);assert.match(wrong.stderr,/^Error: This file is not a notebook export/m);
});

test('the notebook\'s own export address leaves keys out as the command does, and its export imports',async t=>{
  for(const key of Object.keys(process.env))if(/^(GODSPEED_|HERMES_)/.test(key))delete process.env[key];
  const root=folder('service');process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'no-assistant.json');
  const {createService}=await import('../server/main.mjs');
  const service=await createService({root,port:0});t.after(()=>service.close());
  service.store.save('notes',{title:'Kept',content:'In the export'});service.store.save('mcp_api_tokens',{name:'Other assistant',token_hash:'1'.repeat(64)});
  const response=await fetch('http://127.0.0.1:'+service.address.port+'/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert.equal(response.status,200);
  const exported=await response.json();
  assert.ok(exported.records.some(r=>r.type==='notes'&&r.title==='Kept'));
  assert.ok(!exported.records.some(r=>r.type==='mcp_api_tokens'),'no key leaves through the export address');
  assert.equal(importExport(new QueryService(new Store(folder('service-into'))),exported).imported,exported.records.length);
});
