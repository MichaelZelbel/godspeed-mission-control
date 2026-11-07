// A bot token is part of every Telegram request path. The configured endpoint is normally
// Telegram's HTTPS origin; scenarios alone use the loopback stand-in over HTTP.
function loopbackHTTPHost(value){
 const authority=String(value).match(/^http:\/\/([^/?#]*)/i)?.[1];
 if(!authority||authority.includes('@'))return false;
 const host=(authority.startsWith('[')?authority.match(/^\[([^\]]+)\](?::\d*)?$/)?.[1]:authority.match(/^([^:]+)(?::\d*)?$/)?.[1])?.toLowerCase();
 if(host==='localhost'||host==='::1')return true;
 const parts=host?.split('.')||[];
 if(parts.length<2||parts.length>4||parts[0]!=='127'||parts.some(part=>!/^\d+$/.test(part)))return false;
 const numbers=parts.map(part=>BigInt(part));
 return numbers.slice(0,-1).every(part=>part<=255n)&&numbers.at(-1)<256n**BigInt(5-parts.length);
}
export function telegramAPI(value='https://api.telegram.org'){
 let url;try{url=new URL(value);}catch{throw new Error('Telegram API requires HTTPS or a loopback HTTP endpoint');}
 const loopback=loopbackHTTPHost(value);
 if((url.protocol!=='https:'&&!(url.protocol==='http:'&&loopback))||url.username||url.password||url.href.includes('?')||url.href.includes('#'))
  throw new Error('Telegram API requires HTTPS or a loopback HTTP endpoint');
 return `${url.origin}${url.pathname.replace(/\/+$/,'')}`;
}
