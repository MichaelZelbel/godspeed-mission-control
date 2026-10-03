import test from 'node:test';import assert from 'node:assert/strict';import {checkVoice} from '../core/voice-check.mjs';
test('portable writing check uses the chosen voice rules and preserves code and URLs',()=>{
 const profile='```voice-rules\nBANNED-CHAR: — em dash\nBANNED-PHRASE: in conclusion\nBANNED-WORD: realm\nBANNED-OPENER: great question\nMAX-SENTENCE-WORDS: 8\n```';
 assert.equal(checkVoice('No configured voice','(Your rules here)').configured,false);
 const rejected=checkVoice('Great question.\nIn conclusion, the realm grows — today.',profile);assert.equal(rejected.passed,false);assert.equal(rejected.hits.length,4);
 assert.equal(checkVoice('The rain sensor stops watering.\n```js\nconst realm="— in conclusion";\n```\n`realm —` https://example.test/realm',profile).passed,true);
 assert.equal(checkVoice('A very long sentence with several important details to preserve.',profile).passed,false);
 const book=checkVoice('A very long sentence with several important details to preserve.',profile,{longForm:true});assert.equal(book.passed,true);assert.equal(book.hits[0].advisory,true);
 assert.equal(checkVoice('Unrealms are fictional.',profile).passed,true);
});
