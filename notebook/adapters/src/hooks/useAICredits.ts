// Model costs belong to the user's provider; the local product has no credit plan.
export interface AICredits { tokensGranted:number;tokensUsed:number;remainingTokens:number;creditsGranted:number;creditsUsed:number;remainingCredits:number;periodStart:string;periodEnd:string;rolloverTokens:number;baseTokens:number;tokensPerCredit:number; }
export function useAICredits(){return {credits:null as AICredits|null,isLoading:false,error:null,refetch:async()=>{}};}
