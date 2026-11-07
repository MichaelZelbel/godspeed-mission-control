// A bot token is part of every Telegram request path. The configured endpoint is normally
// Telegram's HTTPS origin; scenarios alone use the loopback stand-in over HTTP.
function configuredHost(value){
 const authority=String(value).match(/^https?:\/\/([^/?#]*)/i)?.[1];
 if(!authority||authority.includes('@'))return false;
 return (authority.startsWith('[')?authority.match(/^\[([^\]]+)\](?::\d*)?$/)?.[1]:authority.match(/^([^:]+)(?::\d*)?$/)?.[1])?.toLowerCase();
}
function loopbackIPv4Host(value){
 const host=configuredHost(value);
 if(host==='localhost'||host==='::1')return host;
 const parts=host?.split('.')||[];
 if(parts.length<2||parts.length>4||parts[0]!=='127'||parts.some(part=>!/^\d+$/.test(part)))return false;
 const numbers=parts.map(part=>BigInt(part));
 if(!numbers.slice(0,-1).every(part=>part<=255n)||numbers.at(-1)>=256n**BigInt(5-parts.length))return false;
 const tail=Number(numbers.at(-1)),expanded=[...numbers.slice(0,-1),...Array.from({length:5-parts.length},(_,index)=>BigInt(tail>>8*(4-parts.length-index)&255))];
 return expanded.map(String).join('.');
}
function decimalIPv4Host(host){
 const parts=host?.split('.')||[];
 if(parts.length!==4||parts.some(part=>!/^\d+$/.test(part)||BigInt(part)>255n||(/^0\d+/.test(part)&&!/^0*[0-7]?$/.test(part))))return false;
 return parts.map(part=>String(BigInt(part))).join('.');
}
function numericIPv4Host(host){
 const parts=host?.split('.')||[];
 return parts.length>0&&parts.length<=4&&parts.every(part=>/^(?:\d+|0x[0-9a-f]+)$/i.test(part));
}
export function telegramAPI(value='https://api.telegram.org'){
 let url;try{url=new URL(value);}catch{throw new Error('Telegram API requires HTTPS or a loopback HTTP endpoint');}
 const rawHost=configuredHost(value),loopback=loopbackIPv4Host(value),canonical=loopback||decimalIPv4Host(rawHost),hostname=url.hostname.replace(/^\[|\]$/g,'');
 if((numericIPv4Host(rawHost)&&(!canonical||hostname!==canonical))||(url.protocol!=='https:'&&!(url.protocol==='http:'&&loopback&&hostname===loopback))||url.username||url.password||url.href.includes('?')||url.href.includes('#'))
  throw new Error('Telegram API requires HTTPS or a loopback HTTP endpoint');
 return `${url.origin}${url.pathname.replace(/\/+$/,'')}`;
}
