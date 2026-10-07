// A moment draft as the Add Moment form reads it, whatever the model wrote.
export function momentDraft(draft){
  const day=value=>{const text=String(value||'').trim();const m=text.match(/^(\d{4}-\d{2}-\d{2})/);return m?m[1]:null;};
  const whole=(value,low,high,fallback,words={})=>{const n=Number(value);if(Number.isFinite(n))return Math.min(high,Math.max(low,Math.round(n)));const w=words[String(value||'').toLowerCase()];return w??fallback;};
  const status=String(draft.status||'').toLowerCase(),known=['past_fact','future_plan','ongoing','unknown'];
  return {...draft,
    happened_at:day(draft.happened_at),happened_end:day(draft.happened_end),
    status:known.includes(status)?status:/plan|schedul|upcoming|future|geplant/.test(status)?'future_plan':/ongoing|current|laufend/.test(status)?'ongoing':/done|past|happened|completed/.test(status)?'past_fact':'unknown',
    impact_level:whole(draft.impact_level,1,4,2,{minor:1,low:1,neutral:2,noticeable:2,medium:2,significant:3,high:3,major:4,'life-changing':4}),
    confidence_date:whole(draft.confidence_date,0,10,5,{low:3,medium:5,high:8,certain:10}),
    confidence_truth:whole(draft.confidence_truth,0,10,5,{low:3,medium:5,high:8,certain:10}),
    participants:[...new Set([...(Array.isArray(draft.participants)?draft.participants:[]),...(Array.isArray(draft.people)?draft.people:[])].filter(n=>typeof n==='string'&&n.trim()))]};
}
