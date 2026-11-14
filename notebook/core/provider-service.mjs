export const SAVED_PROVIDER_SERVICES=/** @type {const} */(['openrouter','openai','other']);

export function isSavedProviderService(value){
 return SAVED_PROVIDER_SERVICES.includes(value);
}

export function providerService(url){
 let host;try{host=new URL(String(url||'').trim().replace(/\/chat\/completions\/?$/,'').replace(/\/+$/,'')).hostname.toLowerCase();}catch{return 'other';}
 if(host==='openrouter.ai'||host.endsWith('.openrouter.ai'))return 'openrouter';
 return host==='api.openai.com'?'openai':'other';
}
