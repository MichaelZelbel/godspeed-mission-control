import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createService} from '../server/main.mjs';

// A PDF dropped into a note was uploaded, then "analyze-pdf" was called and
// the server answered that it was not ported; the note never learned the
// PDF's text (6 October 2026).
test('a PDF dropped into a note keeps its text, searchable, with or without a model that reads PDFs',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-pdf-')),service=await createService({root,port:0}),base='http://127.0.0.1:'+service.address.port;
  try{
    const note=service.store.save('notes',{title:'Fictional flat',content:'See the agreement.'});
    const form=new FormData();form.set('file',new Blob([Buffer.from('%PDF-1.4 fictional')],{type:'application/pdf'}),'agreement.pdf');form.set('path','owner/agreement.pdf');
    form.set('extracted_text','Page 1\nFictional rental agreement for Erika Musterfrau.\nPage 2\nNotice period three months.');
    const up=await fetch(base+'/api/media/upload',{method:'POST',body:form});assert.equal(up.status,200,await up.clone().text());
    const call=async provider=>{service.domains.provider=provider;const r=await fetch(base+'/api/functions/analyze-pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({note_id:note.id,storage_path:'owner/agreement.pdf',media_type:'pdf',original_filename:'agreement.pdf'})});return {status:r.status,body:await r.json()};};
    let answer=await call(null);assert.equal(answer.status,200,JSON.stringify(answer.body));
    let row=service.query.rows('media_analysis').find(r=>r.storage_path==='owner/agreement.pdf');
    assert.equal(row.analysis_status,'complete');assert.deepEqual(row.pages.map(p=>p.page_number),[1,2]);assert.match(row.pages[1].extracted_text,/three months/);
    assert.ok(service.index.search('Musterfrau').some(r=>r.type==='media_analysis'),'the PDF text is searchable');
    // A model that cannot read the PDF leaves the text in place instead of failing.
    answer=await call(async()=>{throw new Error('This model reads no PDFs');});assert.equal(answer.status,200,JSON.stringify(answer.body));
    row=service.query.rows('media_analysis').find(r=>r.storage_path==='owner/agreement.pdf');assert.match(row.extracted_text,/Musterfrau/);
  }finally{await service.close();}
});
