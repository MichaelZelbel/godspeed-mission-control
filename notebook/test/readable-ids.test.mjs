import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store,slug} from '../core/records/store.mjs';
// A note called "Orthopäde Termin" got the id orthopa-de-termin-... (6 October 2026).
test('new ids spell German letters out; the keys facts use stay as they were',()=>{
  const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-ids-')));
  assert.match(store.save('notes',{title:'Orthopäde Termin für Größe'}).id,/^orthopaede-termin-fuer-groesse-[0-9a-f]{8}$/);
  assert.match(store.save('notes',{title:'Café crème'}).id,/^cafe-creme-/);
  assert.equal(slug('Größe'),'gro-e','fact keys made before keep matching');
});
