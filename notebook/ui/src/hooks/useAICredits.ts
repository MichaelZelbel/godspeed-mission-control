// Model costs belong to the user's provider; the local product has no credit plan.
import {useQuery} from '@tanstack/react-query';
export interface AICredits { tokensGranted:number;tokensUsed:number;remainingTokens:number;creditsGranted:number;creditsUsed:number;remainingCredits:number;periodStart:string;periodEnd:string;rolloverTokens:number;baseTokens:number;tokensPerCredit:number; }
// Whether the AI can be used now (server/main.mjs /api/status): 'none' when no AI is connected.
export type AIAvailability='none'|'ready'|'refused'|'unreachable'|'stalled';
export function useAICredits(){const state=useQuery({queryKey:['provider-availability'],queryFn:async()=>{const response=await fetch('/api/status');if(!response.ok)throw new Error('Could not read assistant availability');return response.json();},refetchInterval:5000});return {credits:null as AICredits|null,providerConfigured:!!state.data?.runtimeConfigured,aiAvailability:state.data?.aiAvailability as AIAvailability|undefined,isLoading:state.isLoading,error:state.error,refetch:state.refetch};}
