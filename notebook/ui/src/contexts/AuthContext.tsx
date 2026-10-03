import { createContext, useContext, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { hydrateFileChats } from '@/local/file-chat';
import {hydrateFilePreferences} from '@/local/file-preferences';
export type AppRole = 'free' | 'premium' | 'premium_gift' | 'admin';
const Context = createContext<any>(null);
export function AuthProvider({children}: {children:React.ReactNode}) {
  const [client] = useState(() => new QueryClient({defaultOptions:{queries:{retry:1,refetchOnWindowFocus:true}}}));
  const [state,setState] = useState<any>({loading:true,user:null,session:null,profile:null,role:'premium',roleLoading:false});
  useEffect(() => {
    let live=true;
    fetch('/api/session').then(r=>r.ok?r.json():Promise.reject(new Error('Authentication required'))).then(async data=>{
      await hydrateFileChats();
      await hydrateFilePreferences();
      if(live) setState({loading:false,user:data.user,session:{user:data.user,access_token:'local-session'},profile:data.profile,role:'premium',roleLoading:false});
    }).catch(()=>{if(live)setState((s:any)=>({...s,loading:false}));});
    const timer=setInterval(()=>client.invalidateQueries(),30000);
    return ()=>{live=false;clearInterval(timer);};
  },[client]);
  const unsupported=async()=>{throw new Error('Use your candidate access token to sign in');};
  const signIn=async(_email:string,token:string)=>{
    const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
    if(!r.ok)throw new Error('Access token was not accepted'); location.reload();
  };
  const signOut=async()=>{await fetch('/api/logout',{method:'POST'});location.reload();};
  return <QueryClientProvider client={client}><Context.Provider value={{...state,signIn,signOut,signUp:unsupported,signInWithOAuth:unsupported,resetPassword:unsupported,updatePassword:unsupported,refreshProfile:()=>client.invalidateQueries()}}>{children}</Context.Provider></QueryClientProvider>;
}
export const useAuth=()=>useContext(Context);
