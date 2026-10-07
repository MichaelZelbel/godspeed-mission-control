import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { hydrateFileChats } from '@/local/file-chat';
import { hydrateFilePreferences } from '@/local/file-preferences';
import { toast } from 'sonner';
export type AppRole = 'free' | 'premium' | 'premium_gift' | 'admin';
const Context = createContext<any>(null);
export async function authRequest(route:string, body?:any) {
  let response:Response;
  try { response = await fetch(route, { method:body===undefined?'GET':'POST', headers:{'Content-Type':'application/json'}, body:body===undefined?undefined:JSON.stringify(body), signal:AbortSignal.timeout(15000) }); }
  catch { throw new Error('Cannot reach your server. Check your connection and try again.'); }
  let data:any;
  try { data=await response.json(); } catch { throw new Error('Your server did not answer correctly. Try again shortly.'); }
  if (!response.ok) throw Object.assign(new Error(response.status>=500?'Your server is unavailable. Try again shortly.':data.error||'The request did not finish.'),{status:response.status,code:data.code});
  return data;
}
export function AuthProvider({children}: {children:React.ReactNode}) {
  const [client] = useState(() => new QueryClient({defaultOptions:{queries:{retry:1,refetchOnWindowFocus:true}}}));
  const [state,setState] = useState<any>({loading:true,user:null,session:null,profile:null,role:'premium',roleLoading:false,authError:'',expired:false});
  const active=useRef(false), mounted=useRef(true), generation=useRef(0);
  const refreshSession=useCallback(async()=>{
    const started=generation.current;
    try {
      const status=await authRequest('/api/auth/status');
      if(!status.signed_in)throw Object.assign(new Error('Sign in to continue.'),{status:401,code:status.session_expired?'SESSION_EXPIRED':'SIGN_IN_REQUIRED'});
      const data=await authRequest('/api/session');
      if(!active.current) { await hydrateFileChats(); await hydrateFilePreferences(); }
      if(mounted.current&&started===generation.current) { active.current=true;setState({loading:false,user:data.user,session:{user:data.user,access_token:'local-session'},profile:data.profile,role:'premium',roleLoading:false,authError:'',expired:false}); }
    } catch(e:any) {
      if(!mounted.current||started!==generation.current)return;
      if(e.status===401) {
        const expired=active.current || e.code==='SESSION_EXPIRED';active.current=false;client.clear();
        setState((s:any)=>({...s,loading:false,user:null,session:null,profile:null,authError:'',expired}));
      } else setState((s:any)=>({...s,loading:false,authError:e.message}));
    }
  },[client]);
  useEffect(()=>{
    mounted.current=true;refreshSession();
    const original=window.fetch;
    const watched:typeof fetch=async(...args)=>{
      const response=await original(...args);
      const url=new URL(args[0] instanceof Request?args[0].url:String(args[0]),location.href);
      if(active.current && response.status===401 && url.origin===location.origin && url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/auth/') && !['/api/login','/api/session'].includes(url.pathname)) refreshSession();
      return response;
    };
    window.fetch=watched;
    const timer=setInterval(()=>{if(active.current){refreshSession();client.invalidateQueries();}},30000);
    const focus=()=>{if(active.current)refreshSession();};window.addEventListener('focus',focus);
    return ()=>{mounted.current=false;clearInterval(timer);window.removeEventListener('focus',focus);if(window.fetch===watched)window.fetch=original;};
  },[client,refreshSession]);
  const unsupported=async()=>{throw new Error('Manage your account on this server.');};
  const signIn=async(username:string,password:string,remember=false)=>{await authRequest('/api/login',{username,password,remember});await refreshSession();};
  const signOut=async()=>{
    try { await authRequest('/api/logout',{}); }
    catch(e:any){toast.error(e.message+' You are still signed in.');return false;}
    generation.current++;active.current=false;client.clear();setState((s:any)=>({...s,user:null,session:null,profile:null,expired:false,authError:''}));return true;
  };
  return <QueryClientProvider client={client}><Context.Provider value={{...state,signIn,signOut,refreshSession,signUp:unsupported,signInWithOAuth:unsupported,resetPassword:unsupported,updatePassword:unsupported,refreshProfile:()=>client.invalidateQueries()}}>{children}</Context.Provider></QueryClientProvider>;
}
export const useAuth=()=>useContext(Context);
