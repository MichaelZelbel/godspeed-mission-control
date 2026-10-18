import {existsSync} from 'node:fs';import {resolve} from 'node:path';
export function unstampedSource(file){
 const absolute=resolve(file);if(/\.raw\.(jpe?g|png|webp)$/i.test(absolute))return absolute;
 const original=absolute.replace(/\.stamped(?:-instagram)?(?=\.(jpe?g|png|webp)$)/i,'');
 if(original!==absolute){if(!existsSync(original))throw Error('The stamped final has no retained raw source; do not upload its brand mark to the model');return original;}
 const raw=absolute.replace(/\.(jpe?g|png|webp)$/i,'.raw.$1');return existsSync(raw)?raw:absolute;
}
