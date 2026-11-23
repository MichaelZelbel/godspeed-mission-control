// Model costs belong to the user's provider; the local product has no credit plan.
import {useQuery} from '@tanstack/react-query';
import {CHAT_AVAILABILITIES} from '../../../core/chat-availability.mjs';
export interface AICredits { tokensGranted:number;tokensUsed:number;remainingTokens:number;creditsGranted:number;creditsUsed:number;remainingCredits:number;periodStart:string;periodEnd:string;rolloverTokens:number;baseTokens:number;tokensPerCredit:number; }
// Whether the AI can be used now (server/main.mjs /api/status). The vocabulary is owned by
// core/chat-availability.mjs and derived from it, so the two cannot drift.
export type AIAvailability=(typeof CHAT_AVAILABILITIES)[number];
export function useAICredits(){const state=useQuery({queryKey:['provider-availability'],queryFn:async()=>{const response=await fetch('/api/status');if(!response.ok)throw new Error('Could not read assistant availability');return response.json();},refetchInterval:5000});return {credits:null as AICredits|null,providerConfigured:!!state.data?.runtimeConfigured,aiAvailability:state.data?.aiAvailability as AIAvailability|undefined,isLoading:state.isLoading,error:state.error,refetch:state.refetch};}
