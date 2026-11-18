import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

const requiredServerEvents=['main-door-listening','index-published','first-authenticated-query'];
const requiredBrowserEvents=['browser-document-request','browser-first-query-request','browser-first-query-response'];

export function verifyRestartTiming(server,browser,restartedAt){
 const boundary=new Date(restartedAt);assert.ok(Number.isFinite(boundary.valueOf()),'restart boundary must be an ISO timestamp');
 const lifecycleEvents=new Set();
 for(const match of server.matchAll(/(?:^|\n)(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) startup ([a-z-]+)(?=\n|$)/g)){
  if(new Date(match[1])>=boundary)lifecycleEvents.add(match[2]);
 }
 for(const event of requiredServerEvents)assert.ok(lifecycleEvents.has(event),`missing post-restart ${event}`);

 const records=browser.trim().split('\n').map(line=>JSON.parse(line));
 const events=new Map(records.map(record=>[record.event,record]));
 for(const event of requiredBrowserEvents){
  const record=events.get(event);assert.ok(record,`missing ${event}`);assert.equal(new Date(record.at).toISOString(),record.at);
 }
 assert.equal(events.get('browser-document-request').path,'/dashboard/settings/import');
 assert.ok(Number.isInteger(events.get('browser-first-query-response').status));
}

if(import.meta.url===pathToFileURL(process.argv[1]).href){
 const [,serverFile,browserFile,restartedAt]=process.argv.slice(1);
 verifyRestartTiming(fs.readFileSync(serverFile,'utf8'),fs.readFileSync(browserFile,'utf8'),restartedAt);
}
