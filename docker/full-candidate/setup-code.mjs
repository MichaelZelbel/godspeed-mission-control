import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// The setup code is the one thing between a new server's address and its owner account:
// whoever enters it first creates the owner. Until 6 October 2026 any non-empty text was
// taken, so a short code chosen in Hostinger's form could be guessed by a stranger who
// found the address first. A code must now carry at least 128 bits the way a random one
// would (32 hex digits, or 22 random letters and digits). Generated codes have 256.
export const MINIMUM_BITS=128;

// What the code would carry if it were random over the characters it uses. A code of
// only a few different characters is not random, however long.
export function setupCodeBits(code){
  if(typeof code!=='string'||new Set(code).size<8)return 0;
  let alphabet=0;
  if(/^[0-9]+$/.test(code))alphabet=10;
  else if(/^[0-9a-f]+$/i.test(code))alphabet=16;
  else for(const [kind,size] of [[/[a-z]/,26],[/[A-Z]/,26],[/[0-9]/,10],[/[^A-Za-z0-9]/,33]])if(kind.test(code))alphabet+=size;
  return code.length*Math.log2(alphabet);
}

// Once the owner exists the code can no longer sign in or create anyone, so a server
// that is already set up keeps starting whatever its code.
export function ownerExists(workspace){
  try{return !!JSON.parse(fs.readFileSync(path.join(workspace,'.godspeed','web-auth.json'),'utf8')).owner;}catch{return false;}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!ownerExists(process.env.GODSPEED_WORKSPACE||'')&&setupCodeBits(process.env.GODSPEED_ACCESS_TOKEN||'')<MINIMUM_BITS){
    console.error('The setup code is too easy to guess: whoever enters it first becomes the owner of this server. Use at least 32 random letters and digits (a password manager can make them), then deploy again.');
    process.exit(1);
  }
}
