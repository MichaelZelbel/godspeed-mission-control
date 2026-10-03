import {test} from 'node:test';
import assert from 'node:assert/strict';
import {QueryService} from '../core/query.mjs';
test('joined queries use one consistent snapshot for every source note and person',()=>{
 let scans=0;
 const note={type:'notes',id:'note',uid:'note-uid',aliases:['old-note'],content:'Complete current text'};
 const person={type:'contacts',id:'person',uid:'person-uid',aliases:[],name:'Person'};
 const items=Array.from({length:100},(_,i)=>({type:'person_documents',id:'link-'+i,uid:'link-'+i,note_id:'old-note',contact_id:'person',aliases:[]}));
 const records=new Map([note,person,...items].map(r=>[r.type+'/'+r.id,r]));
 const store={records,scan:()=>{scans++;return records;},get:()=>{throw new Error('A join must not rescan storage');}};
 const query=new QueryService(store),result=query.execute({table:'person_documents',selection:'*,notes(*),contacts(*)'});
 assert.equal(result.data.length,100);assert.equal(scans,1);
 for(const row of result.data){assert.equal(row.notes.content,note.content);assert.equal(row.contacts.name,person.name);}
});
