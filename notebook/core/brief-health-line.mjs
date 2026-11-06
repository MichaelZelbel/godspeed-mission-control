// Form an unknown phone day's health read from checked day state, never from model prose.
// A partial number is not a daily result and is deliberately not printed here.
export function unknownPhoneHealthLine(health){
 const day=[...(health?.days||[])].reverse().find(row=>Object.values(row.columns||{}).some(column=>['may_be_incomplete','not_judged'].includes(column.state)));
 if(!day)return null;
 const time=/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(day.data_until||'')?day.data_until:null;
 const parts=['Phone health for '+day.date+' is recorded so far'+(time?'; data stopped at '+time:'')+'. Its daily totals are unknown.'];
 const settled=Object.entries(day.columns||{}).find(([metric,column])=>/^[a-z][a-z0-9_]{0,40}$/.test(metric)&&column.state==='settled'&&Number.isFinite(column.value));
 if(settled){
  const [metric,column]=settled,unit=/(?:_)(g|km|kcal|kg|cm|h|min)$/.exec(metric)?.[1],label=metric.replace(/_(g|km|kcal|kg|cm|h|min)$/,'').replaceAll('_',' ');
  parts.push((column.source==='manual'?'Your manual entry':'Your food tracker')+' recorded '+label+' '+column.value+(unit?' '+unit:'')+'.');
 }
 return parts.join(' ');
}
