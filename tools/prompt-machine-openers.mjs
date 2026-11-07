import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

const file=fileURLToPath(new URL('./prompt-machine-openers.json',import.meta.url));
export const MACHINE_BANNER=new RegExp(JSON.parse(fs.readFileSync(file,'utf8')).machine_banner);
