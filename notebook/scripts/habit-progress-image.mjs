#!/usr/bin/env node
// stdin: {habit,locale?,directory}. stdout is a local picture descriptor, never a send.
import fs from 'node:fs';
import path from 'node:path';
import {saveHabitProgressImage} from '../core/habit-progress-image.mjs';
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const root=process.env.GODSPEED_WORKSPACE||process.env.GODSPEED_COACH_DIR;
if(!root)throw Error('Choose this installation before making a progress picture');
// The assistant cannot use this renderer to write anywhere outside its private cache.
const directory=path.join(root,'.godspeed','habit-progress');
console.log(JSON.stringify(await saveHabitProgressImage(input.habit,{directory,locale:input.locale||'en',requestId:input.requestId||null})));
