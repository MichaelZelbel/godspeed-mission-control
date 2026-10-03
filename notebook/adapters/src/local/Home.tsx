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
import {FileText,Users,MessageCircle} from 'lucide-react';
export default function Home(){
 const navigate=useNavigate(),notes=useNotes('all');
 const status=useQuery({queryKey:['candidate-status'],queryFn:async()=>{const r=await fetch('/api/status');if(!r.ok)throw new Error('Could not read connection status');return r.json();},refetchInterval:5000});
 const people=useQuery({queryKey:['home-people-count'],queryFn:async()=>{const r=await fetch('/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({table:'contacts'})});if(!r.ok)throw new Error('Could not load people');return r.json();}});
 return <div className="space-y-6 max-w-7xl mx-auto">
  <div><h1 className="text-2xl font-display font-bold">Your notebook</h1><p className="text-sm text-muted-foreground mt-1">Your notes, people and personal knowledge, together.</p></div>
  <div className="grid gap-4 sm:grid-cols-3">
   <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Notes</CardTitle><FileText className="h-4 w-4 text-muted-foreground"/></CardHeader><CardContent><p className="text-3xl font-bold">{notes.isLoading?'…':notes.isError?'Unavailable':notes.data?.length||0}</p><Link className="text-sm text-primary" to="/dashboard/notes">Open notes</Link></CardContent></Card>
   <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">People</CardTitle><Users className="h-4 w-4 text-muted-foreground"/></CardHeader><CardContent><p className="text-3xl font-bold">{people.isLoading?'…':people.isError?'Unavailable':people.data?.data?.length||0}</p><Link className="text-sm text-primary" to="/dashboard/people">Open people</Link></CardContent></Card>
   <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Godspeed</CardTitle><MessageCircle className="h-4 w-4 text-muted-foreground"/></CardHeader><CardContent><p className="text-lg font-semibold mb-1">{status.isError?'Connection unavailable':status.data?.runtimeConfigured?'Ready to chat':'Connecting…'}</p><a className="text-sm text-primary" href="/chat">Open Godspeed chat</a></CardContent></Card>
  </div>
  <div className="grid gap-6 lg:grid-cols-3"><div className="lg:col-span-2 space-y-6">
   {notes.isError?<Card><CardContent className="py-6"><p role="alert">Your notes could not be loaded.</p><Button variant="outline" onClick={()=>notes.refetch()}>Try again</Button></CardContent></Card>:notes.data?.length?<RecentNotesCard notes={notes.data}/>:<Card><CardContent className="py-8">{notes.isLoading?<p>Loading notes…</p>:<CaptureEmptyState onCreateNote={()=>navigate('/dashboard/notes?action=create')}/>}</CardContent></Card>}
   <ActivityFeed limit={5} showViewAll/>
  </div><div className="space-y-6"><ProfileWidget/><RecentPeopleCard/></div></div>
 </div>;
}
