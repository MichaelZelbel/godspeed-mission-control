import http from 'node:http';

const port=Number(process.argv[2]);
if(!Number.isInteger(port)||port<1)throw Error('usage: node brief-ai-fixture.mjs <port>');

const server=http.createServer((request,response)=>{
 let body='';
 request.setEncoding('utf8');
 request.on('data',chunk=>body+=chunk);
 request.on('end',()=>{
  let input={};
  try{input=JSON.parse(body);}catch{}
  const prompt=String(input.messages?.at(-1)?.content||'');
  let content='Connected.';
  if(prompt.includes('"kind":"morning-brief"'))content=prompt.includes('Atlas proposal')&&prompt.includes('River proposal')
   ?'Good morning. Atlas proposal and River proposal are waiting for your decision.\n\nNext: choose Atlas proposal or River proposal.'
   :'Good morning. Choose one useful step and finish it today.\n\nNext: Ask Godspeed to show one concrete result.';
  else if(prompt.includes('"kind":"brief-verification"'))content=JSON.stringify({passed:true,reason:'The fixture accepts the deterministic scenario briefing.',rejection_scope:'non-source',rejected_source_ids:[]});
  response.writeHead(200,{'content-type':'application/json'});
  response.end(JSON.stringify({choices:[{message:{role:'assistant',content}}]}));
 });
});
server.listen(port,'127.0.0.1');
