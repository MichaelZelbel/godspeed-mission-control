import{bp as i}from"./index-Bruf8MSz.js";async function m(n,{maxPages:s=300,maxChars:r=1e6}={}){const o=await i(()=>import("./pdf-gh-BrLFn.js"),[]),_=await i(()=>import("./pdf.worker.min-ocdtAcA3.js"),[]);o.GlobalWorkerOptions.workerSrc=_.default;const e=await o.getDocument({data:await n.arrayBuffer()}).promise;try{let a="";for(let t=1;t<=Math.min(e.numPages,s)&&a.length<r;t++){const c=await e.getPage(t),p=await c.getTextContent();a+=`
Page `+t+`
`+p.items.map(f=>f.str||"").join(" ")}return a.slice(0,r).trim()}finally{await e.destroy()}}export{m as extractPdfText};
