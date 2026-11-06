import test from 'node:test';
import assert from 'node:assert/strict';
import {unknownPhoneHealthLine} from '../core/brief-health-line.mjs';

test('an unknown phone day has a deterministic health read with its cutoff and no daily judgment',()=>{
 const health={days:[{date:'2026-11-04',data_until:'19:55:00',columns:{protein_g:{value:50,source:'phone',state:'may_be_incomplete'}}}]};
 const line=unknownPhoneHealthLine(health);
 assert.match(line,/so far.*19:55:00.*unknown/);
 assert.doesNotMatch(line,/50|short|missed|protein shake/i);
});

test('today stays unknown while a manual column can be reported as settled',()=>{
 const health={days:[{date:'2026-11-05',data_until:'07:40:00',columns:{steps:{value:4200,source:'phone',state:'not_judged'},protein_g:{value:80,source:'manual',state:'settled'}}}]};
 const line=unknownPhoneHealthLine(health);
 assert.match(line,/07:40:00.*unknown/);
 assert.match(line,/manual entry recorded protein 80 g/);
 assert.doesNotMatch(line,/4200|short|missed/i);
});
