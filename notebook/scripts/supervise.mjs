import {fileURLToPath} from 'node:url';
import {Supervisor} from '../core/supervisor.mjs';
import {machineDevice} from '../core/device-id.mjs';
// Separate from the notebook process: a stopped or unresponsive service cannot
// perform its own missing-run check (core/supervisor.mjs). It reads them for
// this machine's own name, the same one the notebook gives itself.
const root=process.env.GODSPEED_WORKSPACE;if(!root)throw Error('Choose the isolated workspace');
const supervisor=new Supervisor({root,server:fileURLToPath(new URL('../server/main.mjs',import.meta.url)),port:Number(process.env.GODSPEED_PORT||47831),device:machineDevice(root).id}).start();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void supervisor.stop();});
