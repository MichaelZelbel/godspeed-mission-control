import {useEffect} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Link} from 'react-router-dom';
import {CHAT_AVAILABILITIES} from '../../../../core/chat-availability.mjs';
import {NO_AI_STATUS,SETTINGS_ONLY_AI_HELP,SETTINGS_ONLY_AI_STATUS} from '../../../../core/no-ai.mjs';
import {listenForChatOptions} from '@/local/chat-options.mjs';
export type ChatAvailability=(typeof CHAT_AVAILABILITIES)[number];
type ChatOptions={connected?:boolean;usable?:boolean;availability?:ChatAvailability};
export type ChatAIState='checking'|ChatAvailability;

export function chatAIState(options?:ChatOptions):ChatAIState{
  if(!options)return 'checking';
  if(options.connected===false)return 'none';
  if(options.usable!==false)return 'ready';
  return options.availability==='refused'?'refused':options.availability==='settings-only'?'settings-only':'unreachable';
}

// Open pickers read their own model list; they refresh as soon as the shared state changes, so a
// notice and its picker never disagree for long (#590).
export const CHAT_AVAILABILITY_CHANGED='godspeed:chat-availability-changed';
let lastAvailability:string|undefined;
async function chatOptions(){
  const response=await fetch('/api/chat/options');
  if(!response.ok)throw Error('Could not read AI connection status');
  const options=await response.json() as ChatOptions,known=chatAIState(options);
  if(lastAvailability!==undefined&&lastAvailability!==known&&typeof window!=='undefined')window.dispatchEvent(new Event(CHAT_AVAILABILITY_CHANGED));
  lastAvailability=known;
  return options;
}

export function useChatOptions(){
  const queryClient=useQueryClient();
  // All chat surfaces and the Dashboard in this window share this query, so one poll publishes one
  // settled state to them. The server checks the AI at most every five seconds and otherwise answers
  // from that check, so reading each second costs no AI request and keeps a change inside about five
  // seconds of that check (#590).
  const options=useQuery<ChatOptions>({queryKey:['chat-options'],queryFn:chatOptions,refetchInterval:1000,refetchIntervalInBackground:true});
  useEffect(()=>listenForChatOptions((next:ChatOptions)=>queryClient.setQueryData(['chat-options'],next)),[queryClient]);
  // A picker that just read a newer state asks the shared query to read it too (#667).
  useEffect(()=>{const refresh=()=>{void options.refetch();};window.addEventListener('chat-ai-options-changed',refresh);return()=>window.removeEventListener('chat-ai-options-changed',refresh);},[options.refetch]);
  return options;
}

/** The shared pre-composer state for floating, note, collection, and pop-out chat. */
export function ChatConnectionEmptyState({ready}:{ready:React.ReactNode}){
  const options=useChatOptions();
  const state=chatAIState(options.data);
  if(state==='ready')return <>{ready}</>;
  // Under an open conversation (ready null) the first read stays quiet; only a known state shows.
  if(state==='checking')return ready===null?null:<div className="text-center text-muted-foreground text-sm py-8" role="status">Checking AI connection…</div>;
  return <div className="text-center text-muted-foreground text-sm py-8 space-y-2" data-chat-ai-state={state}>
    <p className="font-semibold text-foreground">{state==='none'?NO_AI_STATUS:state==='refused'?'Your AI key or sign-in was refused':state==='settings-only'?SETTINGS_ONLY_AI_STATUS:'Your AI could not be reached'}</p>
    <p>{state==='none'?'Connect an AI before you type.':state==='refused'?'Check its key or sign-in before you type.':state==='settings-only'?SETTINGS_ONLY_AI_HELP:'Check its connection before you type.'}</p>
    <Link className="underline text-primary" to="/dashboard/settings#connect-ai">Open Settings, Your AI</Link>
  </div>;
}
