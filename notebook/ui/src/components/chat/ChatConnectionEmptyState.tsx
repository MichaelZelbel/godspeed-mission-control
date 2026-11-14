import {useQuery} from '@tanstack/react-query';
import {Link} from 'react-router-dom';
import {routineAIStatus,type RoutineAI} from '@/local/ConnectAI';

type CandidateStatus={aiConfigured?:boolean;runtimeConfigured?:boolean;assistantProblem?:string|null};
export type ChatAIState='checking'|'none'|'unusable'|'ready';

export function chatAIState(status?:CandidateStatus,routine?:RoutineAI):ChatAIState{
  if(!status)return 'checking';
  if(status.aiConfigured===false)return 'none';
  if(status.runtimeConfigured){
    if(routine?.check&&!routine.check.ok)return 'unusable';
    if(routine?.key===false)return 'unusable';
    return 'ready';
  }
  if(status.assistantProblem||routine?.source&&routine.source!=='none')return 'unusable';
  return 'none';
}

async function candidateStatus(){
  const response=await fetch('/api/status');
  if(!response.ok)throw Error('Could not read AI connection status');
  return response.json() as Promise<CandidateStatus>;
}

/** The shared pre-composer state for floating, note, collection, and pop-out chat. */
export function ChatConnectionEmptyState({ready}:{ready:React.ReactNode}){
  const status=useQuery({queryKey:['candidate-status'],queryFn:candidateStatus,refetchInterval:5000});
  const routine=useQuery({queryKey:['routine-ai'],queryFn:routineAIStatus,refetchInterval:5000});
  const state=chatAIState(status.data,routine.data);
  if(state==='ready')return <>{ready}</>;
  if(state==='checking')return <div className="text-center text-muted-foreground text-sm py-8" role="status">Checking AI connection…</div>;
  return <div className="text-center text-muted-foreground text-sm py-8 space-y-2" data-chat-ai-state={state}>
    <p className="font-semibold text-foreground">{state==='none'?'No AI connected':'Your AI could not be used'}</p>
    <p>{state==='none'?'Connect an AI before you type.':'Check its sign-in, key, or connection before you type.'}</p>
    <Link className="underline text-primary" to="/dashboard/settings#connect-ai">Open Settings, Your AI</Link>
  </div>;
}
