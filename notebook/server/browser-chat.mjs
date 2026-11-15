export const browserChat = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Godspeed Mission Control chat</title>
<style>body{font:18px system-ui;background:#101827;color:#edf3fa;margin:0 auto;max-width:800px;padding:24px}a{color:#9ccfff}textarea,input,button{font:inherit;padding:12px;border-radius:8px}textarea{width:95%;background:#fff;color:#111}button{cursor:pointer}article{white-space:pre-wrap;padding:16px;background:#1d293c;border-radius:10px;margin:12px 0}article[data-role=user]{background:#244365}label{display:block;margin:12px 0}#error{color:#ffb6ad}</style>
<header><a href="/">Notebook</a><h1>Godspeed Mission Control chat</h1></header>
<form id="login" hidden><label>Access token <input id="token" type="password" autocomplete="off" required></label><button>Sign in</button></form>
<p id="error" role="alert"></p><section id="talk"></section><section id="messages" aria-live="polite"></section>
<form id="chat" hidden><label for="message">Your message</label><textarea id="message" rows="3" maxlength="20000" required></textarea><button id="send">Send</button></form>
<script>
const login=document.querySelector('#login'),chat=document.querySelector('#chat'),error=document.querySelector('#error'),messages=document.querySelector('#messages');
const talkId=new URLSearchParams(location.search).get('talk');let requestId=crypto.randomUUID();document.querySelector('#message').addEventListener('input',()=>requestId=crypto.randomUUID());
async function api(route,value){const r=await fetch(route,value===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});if(r.status===401){login.hidden=false;chat.hidden=true;throw Error('Sign in to open this chat.')}const data=await r.json();if(!r.ok)throw Error(data.error||'The request did not finish.');return data;}
async function load(){try{const data=await api('/api/browser-chat'+(talkId?'?talk='+encodeURIComponent(talkId):''));document.querySelector('#talk').textContent=data.talk?data.talk.question+'\\n'+data.talk.replies.map(r=>r.content).join('\\n'):'';messages.replaceChildren();for(const m of data.messages){const article=document.createElement('article');article.dataset.role=m.role;article.textContent=(m.role==='user'?'You: ':'Godspeed: ')+m.content;messages.append(article);}login.hidden=true;chat.hidden=false;error.textContent='';}catch(e){error.textContent=e.message;}}
login.onsubmit=async e=>{e.preventDefault();try{await api('/api/login',{token:document.querySelector('#token').value});document.querySelector('#token').value='';await load();}catch(e){error.textContent=e.message;}};
chat.onsubmit=async e=>{e.preventDefault();const button=document.querySelector('#send');button.disabled=true;error.textContent='';try{await api('/api/browser-chat',{message:document.querySelector('#message').value,request_id:requestId,talk_id:talkId});document.querySelector('#message').value='';requestId=crypto.randomUUID();await load();}catch(e){error.textContent=e.message;}finally{button.disabled=false;}};load();
</script></html>`;
