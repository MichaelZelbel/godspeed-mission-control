// The media analyze-media reads, one list for both sides: the server refuses any other type,
// and the Media Library lists only these as waiting for analysis.
const ANALYZABLE_IMAGE_TYPES=new Set(['image/png','image/jpeg','image/webp','image/gif']);

/** @param {string|null|undefined} type @returns {'image'|'pdf'|null} */
export function analyzableMediaType(type){
  if(type==='application/pdf')return 'pdf';
  return type&&ANALYZABLE_IMAGE_TYPES.has(type)?'image':null;
}
