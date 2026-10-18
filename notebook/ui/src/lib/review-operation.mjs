// Every visible review control uses this payload and the same server receipt.
export async function runReviewOperation(client,action,ids) {
 const {data,error}=await client.functions.invoke('review-queue-bulk',{body:{action,scope:ids?{ids}:'all'}});
 if(error)throw error;
 if(!data?.job_id)throw Error('The review action did not return a saved result');
 if(ids&&data.errors?.length)throw Error(data.errors.map(e=>e.error).join('; '));
 return data;
}
export function reviewJobCounts(job) {
 const count=value=>Math.max(0,Number(value)||0);
 return {processed:count(job.processed),succeeded:count(job.succeeded),failed:count(job.failed),total:count(job.total)};
}
