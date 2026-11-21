import {Link,useNavigate} from 'react-router-dom';
import {useQuery} from '@tanstack/react-query';
import {useNotes} from '@/hooks/useNotes';
import {Card,CardHeader,CardTitle,CardContent} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {RecentNotesCard} from '@/components/dashboard/widgets/RecentNotesCard';
import {RecentPeopleCard} from '@/components/dashboard/widgets/RecentPeopleCard';
import {ProfileWidget} from '@/components/dashboard/widgets/ProfileWidget';
import {ActivityFeed} from '@/components/activity/ActivityFeed';
import {CaptureEmptyState} from '@/components/notes/CaptureEmptyState';
import {FileText,Users,MessageCircle,Bot,UserRound} from 'lucide-react';
import {openFloatingChat} from '@/components/chat/GlobalAIChatFAB';
import {useChatEntry} from '@/components/chat/chat-entry';
import {peopleCountRequest} from './home-counts.mjs';
import {chatAIState,useChatOptions} from '@/components/chat/ChatConnectionEmptyState';
import {AI_STALLED_STATUS,NO_AI_STATUS,SETTINGS_ONLY_AI_HELP,SETTINGS_ONLY_AI_STATUS} from '../../../core/no-ai.mjs';
export default function Home(){
 const navigate=useNavigate(),notes=useNotes('all'),chatEntry=useChatEntry<HTMLButtonElement>();
 const status=useQuery({queryKey:['candidate-status'],queryFn:async()=>{const r=await fetch('/api/status');if(!r.ok)throw new Error('Could not read connection status');return r.json();},refetchInterval:5000});
 const chatAvailability=useChatOptions();
 const aiState=chatAvailability.isSuccess?chatAIState(chatAvailability.data):null;
 const people=useQuery({queryKey:['home-people-count'],queryFn:async()=>{const r=await fetch('/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(peopleCountRequest)});if(!r.ok)throw new Error('Could not load people');return {count:(await r.json()).data?.total};}});
 // The chat was a small link in the third card, so people did not see they could talk to
 // Godspeed here (16 October 2026). This opens the same floating chat as the round
 // button, or the chat page where there is none.
 const chat=()=>{if(!openFloatingChat())navigate('/dashboard/chat');};
 // The getting-to-know-you chat (core/context-setup.mjs), until it ended or was hidden. Its button
 // sends the word that starts it, in the same floating chat.
 const context=useQuery({queryKey:['context-setup'],queryFn:async()=>{const r=await fetch('/api/context-setup');if(!r.ok)throw new Error('Could not read the getting-to-know-you chat');return r.json();},refetchInterval:q=>q.state.data?.show?30000:false});
 const startContext=()=>{if(!openFloatingChat('context'))navigate('/dashboard/chat');};
 const hideContext=async()=>{await fetch('/api/context-setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'skip'})});context.refetch();};
 return <div className="space-y-6 max-w-7xl mx-auto">
  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
   <div><h1 className="text-2xl font-display font-bold">Your notebook</h1><p className="text-sm text-muted-foreground mt-1">Your notes, people and personal knowledge, together.</p></div>
   <Button ref={chatEntry} size="lg" className="h-14 w-full sm:w-auto px-8 text-base font-semibold gap-3 shadow-md" onClick={chat}><Bot className="h-5 w-5" aria-hidden="true"/>Chat with Godspeed</Button>
  </div>
  {context.data?.show&&<Card className="border-primary/40" aria-labelledby="context-card-title"><CardContent className="py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
   <div className="flex items-start gap-3"><UserRound className="h-5 w-5 mt-0.5 text-primary shrink-0" aria-hidden="true"/><div><p id="context-card-title" className="font-semibold">Tell Godspeed about you, about five minutes</p><p className="text-sm text-muted-foreground">Where you live, a little about you, and what you want help with first.</p></div></div>
   <div className="flex gap-2 shrink-0"><Button className="min-h-11 flex-1 sm:flex-none" onClick={startContext}>Start now</Button><Button variant="ghost" className="min-h-11" onClick={hideContext}>Hide</Button></div>
  </CardContent></Card>}
  <div className="grid gap-4 sm:grid-cols-3">
   <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Notes</CardTitle><FileText className="h-4 w-4 text-muted-foreground"/></CardHeader><CardContent><p className="text-3xl font-bold">{notes.isLoading?'…':notes.isError?'Unavailable':notes.data?.length||0}</p><Link className="text-sm text-primary" to="/dashboard/notes">Open notes</Link></CardContent></Card>
   <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">People</CardTitle><Users className="h-4 w-4 text-muted-foreground"/></CardHeader><CardContent><p className="text-3xl font-bold">{people.isLoading?'…':people.isError?'Unavailable':people.data?.count||0}</p><Link className="text-sm text-primary" to="/dashboard/people">Open people</Link></CardContent></Card>
   {/* The card reads the same shared AI state as every open chat (useChatOptions), so it cannot say
       Ready while a chat says the key was refused or the AI could not be reached (#590). No AI set up
       at all says so and links to Settings, Your AI; "Connecting…" is only the wait for the state (#552). */}
   <Card className="min-w-0"><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Godspeed</CardTitle><MessageCircle className="h-4 w-4 text-muted-foreground"/></CardHeader><CardContent>{aiState==='none'?<div data-testid="no-ai" className="mb-1"><p className="text-lg font-semibold">{NO_AI_STATUS}</p><Link className="text-sm underline" to="/dashboard/settings#connect-ai">Open Settings, Your AI</Link>{status.data?.assistantProblem&&<p data-testid="assistant-problem" className="text-sm font-medium mt-1 [overflow-wrap:anywhere]">{status.data.assistantProblem}</p>}</div>:<div className="mb-1" data-ai-state={aiState||undefined}><p className="text-lg font-semibold">{chatAvailability.isError?'AI unavailable':!aiState?(status.isError?'Connection unavailable':'Connecting…'):aiState==='ready'?'Ready to chat':aiState==='refused'?'Your AI key or sign-in was refused':aiState==='stalled'?AI_STALLED_STATUS:aiState==='settings-only'?SETTINGS_ONLY_AI_STATUS:'Your AI could not be reached'}</p>{aiState&&aiState!=='ready'&&<><p className="text-sm">{aiState==='refused'?'Check its key or sign-in in Settings, Your AI.':aiState==='stalled'?'It took a request and has not answered yet. Wait a moment, or check it in Settings, Your AI.':aiState==='settings-only'?SETTINGS_ONLY_AI_HELP:'Check its connection in Settings, Your AI.'}</p><Link className="text-sm underline" to="/dashboard/settings#connect-ai">Open Settings, Your AI</Link></>}</div>}<a className="text-sm text-primary" href="/chat">Open Godspeed chat</a></CardContent></Card>
  </div>
  <div className="grid gap-6 lg:grid-cols-3"><div className="lg:col-span-2 space-y-6">
   {notes.isError?<Card><CardContent className="py-6"><p role="alert">Your notes could not be loaded.</p><Button variant="outline" onClick={()=>notes.refetch()}>Try again</Button></CardContent></Card>:notes.data?.length?<RecentNotesCard notes={notes.data}/>:<Card><CardContent className="py-8">{notes.isLoading?<p>Loading notes…</p>:<CaptureEmptyState onCreateNote={()=>navigate('/dashboard/notes?action=create')}/>}</CardContent></Card>}
   <ActivityFeed limit={5} showViewAll/>
  </div><div className="space-y-6"><ProfileWidget/><RecentPeopleCard/></div></div>
 </div>;
}
