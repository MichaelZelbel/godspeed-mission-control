// A bot token is part of every Telegram request path. The configured endpoint is normally
// Telegram's HTTPS origin; scenarios alone use the loopback stand-in over HTTP.
export function telegramAPI(value='https://api.telegram.org'){
 let url;try{url=new URL(value);}catch{throw new Error('Telegram API requires HTTPS or a loopback HTTP endpoint');}
 const parts=url.hostname.split('.'),loopback=url.hostname==='localhost'||url.hostname==='[::1]'||url.hostname==='::1'||parts.length===4&&parts[0]==='127'&&parts.every(part=>/^\d+$/.test(part)&&Number(part)<=255);
 if((url.protocol!=='https:'&&!(url.protocol==='http:'&&loopback))||url.username||url.password||url.href.includes('?')||url.href.includes('#'))
  throw new Error('Telegram API requires HTTPS or a loopback HTTP endpoint');
 return `${url.origin}${url.pathname.replace(/\/+$/,'')}`;
}
