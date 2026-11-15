import {useQuery} from '@tanstack/react-query';
import {Link} from 'react-router-dom';
import {CHAT_AVAILABILITIES} from '../../../../core/chat-availability.mjs';
export type ChatAvailability=(typeof CHAT_AVAILABILITIES)[number];
type ChatOptions={connected?:boolean;usable?:boolean;availability?:ChatAvailability};
export type ChatAIState='checking'|ChatAvailability;

export function chatAIState(options?:ChatOptions):ChatAIState{
  if(!options)return 'checking';
  if(options.connected===false)return 'none';
  if(options.usable!==false)return 'ready';
  return options.availability==='refused'?'refused':'unreachable';
}

async function chatOptions(){
  const response=await fetch('/api/chat/options');
  if(!response.ok)throw Error('Could not read AI connection status');
  return response.json() as Promise<ChatOptions>;
}

/** The shared pre-composer state for floating, note, collection, and pop-out chat. */
export function ChatConnectionEmptyState({ready}:{ready:React.ReactNode}){
  const options=useQuery({queryKey:['chat-options'],queryFn:chatOptions,refetchInterval:5000,refetchIntervalInBackground:true});
  const state=chatAIState(options.data);
  if(state==='ready')return <>{ready}</>;
  if(state==='checking')return <div className="text-center text-muted-foreground text-sm py-8" role="status">Checking AI connection…</div>;
  return <div className="text-center text-muted-foreground text-sm py-8 space-y-2" data-chat-ai-state={state}>
    <p className="font-semibold text-foreground">{state==='none'?'No AI connected':state==='refused'?'Your AI key or sign-in was refused':'Your AI could not be reached'}</p>
    <p>{state==='none'?'Connect an AI before you type.':state==='refused'?'Check its key or sign-in before you type.':'Check its connection before you type.'}</p>
    <Link className="underline text-primary" to="/dashboard/settings#connect-ai">Open Settings, Your AI</Link>
  </div>;
}
