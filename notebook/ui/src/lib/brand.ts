import { MENERIO } from '@/brands/menerio';
export const BRAND = {...MENERIO,id:'godspeed',name:'Godspeed Mission Control',domain:'localhost',url:location.origin,htmlTitle:'Godspeed Mission Control',titleSuffix:' | Godspeed Mission Control',personaName:'Godspeed',supportEmail:'',tagline:'Your life and work, in your own files.',pwa:{...MENERIO.pwa,name:'Godspeed Mission Control',shortName:'Godspeed'}};
// The documentation: the user guide on the product's website (there is no /docs page in this app).
export const GUIDE_URL='https://godspeedmissioncontrol.com/guide';
export function applyBrandTitle(title:string,suffix=BRAND.titleSuffix){return title.replace(/\s*[—–-]\s*Godspeed Mission Control\s*$/i,'')+suffix;}
