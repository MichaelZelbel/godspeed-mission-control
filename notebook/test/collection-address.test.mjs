import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';

// The create dialog said the new collection would be at /collections/books;
// the server always added an id (/collections/books-3f1c2d3e).
test('a new collection gets the address the dialog showed, and an id only when that address is taken',()=>{
  const query=new QueryService(new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-address-'))));
  const first=query.execute({table:'collections',operation:'insert',values:{name:'Books',slug:'books',field_schema:[]},single:true}).data;
  const second=query.execute({table:'collections',operation:'insert',values:{name:'Books',slug:'books',field_schema:[]},single:true}).data;
  assert.equal(first.slug,'books');assert.match(second.slug,/^books-[0-9a-f]{8}$/);
  const group=query.execute({table:'contact_groups',operation:'insert',values:{name:'Climbing friends'},single:true}).data;
  assert.equal(group.slug,'climbing-friends');
});

// Using a template counted its use with {p_slug}; the server knew only ids
// and answered 400 every time.
test('using a template counts it, named by its slug as the templates page names it',()=>{
  const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-template-use-'))),query=new QueryService(store);
  store.save('collection_templates',{id:'template-wine-journal',slug:'wine-journal',name:'Wine Journal',usage_count:0,field_schema:[]});
  query.rpc('increment_collection_template_usage',{p_slug:'wine-journal'});
  assert.equal(store.get('collection_templates','template-wine-journal').usage_count,1);
  assert.throws(()=>query.rpc('increment_collection_template_usage',{p_slug:'no-such-template'}),/Template missing/);
});
