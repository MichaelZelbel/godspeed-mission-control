// #573: once the Dashboard card said "Your AI could not be used", only the health check brings it
// back to ready when the person fixes the AI outside a chat.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AIHealth} from '../core/ai-health.mjs';

const refused=Object.assign(Error('The AI refused its key'),{aiProblem:'refused'});
function clock(){const c={at:1_000_000,now:()=>c.at};return c;}
function health(c){return new AIHealth({okRecheckMs:30000,problemRecheckMs:10000,now:c.now});}

test('a problem is not checked again before its interval, and clears after it once the AI works',async()=>{
 const c=clock(),h=health(c);let answer=refused,checks=0;const check=async()=>{checks++;return answer;};
 await h.refresh(check);assert.equal(h.problem,refused.message);assert.equal(checks,1);
 answer=null;c.at+=9999;
 await h.refresh(check);assert.equal(checks,1);assert.equal(h.problem,refused.message);
 c.at+=1;
 await h.refresh(check);assert.equal(checks,2);assert.equal(h.problem,null);
});

test('a working AI is checked again only after the longer interval',async()=>{
 const c=clock(),h=health(c);let answer=null,checks=0;const check=async()=>{checks++;return answer;};
 await h.refresh(check);assert.equal(checks,1);
 answer=refused;c.at+=29999;
 await h.refresh(check);assert.equal(checks,1);assert.equal(h.problem,null);
 c.at+=1;
 await h.refresh(check);assert.equal(checks,2);assert.equal(h.problem,refused.message);
});

test('a check still under way when another AI is connected changes nothing',async()=>{
 const c=clock(),h=health(c);let finish;
 const pending=h.refresh(()=>new Promise(resolve=>{finish=resolve;}));
 await Promise.resolve();h.reset();h.answered();
 finish(refused);await pending;
 assert.equal(h.problem,null);
 const watched=h.watch(async()=>{throw refused;});
 h.reset();
 await assert.rejects(watched({}));assert.equal(h.problem,refused.message);
});

test('an answer from the old AI after a reset is not taken for the new one',async()=>{
 const c=clock(),h=health(c);let finish;
 const call=h.watch(()=>new Promise(resolve=>{finish=resolve;}))({});
 h.reset();h.failed(refused);
 finish('Fictional answer');await call;
 assert.equal(h.problem,refused.message);
});
