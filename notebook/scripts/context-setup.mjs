#!/usr/bin/env node
// The getting-to-know-you chat's one scheduled step (core/context-setup.mjs): `invite` prints the
// invitation once, while nobody began that chat, and marks it sent; it prints nothing otherwise, and
// Hermes then delivers nothing. Run by the script the notebook writes into Hermes' scripts folder.
import {Store} from '../core/records/store.mjs';
import {machineDevice} from '../core/device-id.mjs';
import {inviteNow,readContext} from '../core/context-setup.mjs';

const root=process.env.GODSPEED_WORKSPACE;if(!root)throw Error('Set GODSPEED_WORKSPACE to the notebook folder');
const store=new Store(root,{device:machineDevice(root).id});
if(process.argv[2]==='invite')process.stdout.write(inviteNow(store));
else if(process.argv[2]==='status')console.log(JSON.stringify(readContext(store)));
else{console.error('Use invite or status');process.exit(2);}
