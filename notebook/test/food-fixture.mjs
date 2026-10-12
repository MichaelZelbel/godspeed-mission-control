// The food table for the food tracker's tests: the fixture cut from the real BLS 4.0 download
// (fixtures/bls-4.0), installed into a test workspace as `godspeed food-table install` would.
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {installFoodTable} from '../core/food-table.mjs';
const ZIP=fs.readFileSync(new URL('./fixtures/bls-4.0/BLS_4_0_2025_DE.zip',import.meta.url)),SHA=createHash('sha256').update(ZIP).digest('hex');
export async function withTable(root){await installFoodTable(path.join(root,'.godspeed'),{fetcher:async()=>new Response(ZIP),sha256:SHA});}
