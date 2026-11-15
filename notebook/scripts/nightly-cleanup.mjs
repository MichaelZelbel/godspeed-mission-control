#!/usr/bin/env node
// THE NIGHTLY CLEANUP, AS THE ROUTINE RUNS IT (#238; core/cleanup.mjs says what it removes). It prints
// what it freed per place and the disk before and after on the error stream, which is the routine's
// log, and nothing else.
//
//   GODSPEED_WORKSPACE=<mission control> HERMES_HOME=<assistant home> node notebook/scripts/nightly-cleanup.mjs
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {nightlyCleanup,cleanupLog} from '../core/cleanup.mjs';

if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 const root=process.env.GODSPEED_WORKSPACE||process.env.GODSPEED_ROOT,home=process.env.HERMES_HOME;
 if(!root||!home){console.error('The nightly cleanup does not know which mission control and assistant to look after.');process.exit(2);}
 try{
  console.error(cleanupLog(nightlyCleanup({root:path.resolve(root),home:path.resolve(home)})));
  process.exit(0);
 }catch{
  console.error('The nightly cleanup stopped before it finished.');
  process.exit(1);
 }
}
