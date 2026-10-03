import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, ShieldCheck, KeyRound, Download, Copy, Check } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { authRequest, useAuth } from '@/contexts/AuthContext';
import logo from '@/assets/godspeed-logo.png';
import './auth.css';

function safeNext(value:string|null) {
  if(!value || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value))return '/dashboard';
  const url=new URL(value,location.origin);
  if(url.origin!==location.origin || /^\/(setup|login|api)(\/|$)/.test(url.pathname))return '/dashboard';
  return url.pathname+url.search+url.hash;
}
export function AuthShell({children}:{children:React.ReactNode}) {
  return <main className="auth-page"><div className="auth-wrap"><header className="auth-brand"><img src={logo} width="56" height="56" alt=""/><h1>Godspeed<br/>Mission Control</h1></header><section className="auth-panel">{children}</section><footer className="auth-server"><ShieldCheck size={16} aria-hidden="true"/><span>Your server: {location.hostname}</span></footer></div></main>;
}
export function AuthScreen() {
  const auth=useAuth(), route=useLocation(), navigate=useNavigate();
  const [mode,setMode]=useState<'loading'|'login'|'invite'|'setup'|'recover'|'saved'>('loading');
  const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState('');
  const [setupCode,setSetupCode]=useState(''),[code,setCode]=useState(''),[recovery,setRecovery]=useState('');
  const [remember,setRemember]=useState(false),[visible,setVisible]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [saved,setSaved]=useState(false),[copied,setCopied]=useState(false);
  const invite=useRef(new URLSearchParams(location.hash.slice(1)).get('invite')||'');
  const next=useRef(route.pathname==='/setup'?safeNext(new URLSearchParams(route.search).get('next')):route.pathname+route.search+route.hash);
  const errorRef=useRef<HTMLParagraphElement>(null);
  async function inspect() {
    setError('');setMode('loading');
    try {
      const status=await authRequest('/api/auth/status');
      if(status.configured){setMode('login');return;}
      if(invite.current){await authRequest('/api/auth/invite',{invite:invite.current});setMode('setup');}
      else setMode('invite');
    } catch(e:any){setMode('invite');setError(e.message);}
  }
  useEffect(()=>{inspect();},[]);
  useEffect(()=>{if(error)errorRef.current?.focus();},[error]);
  const changeMode=(value:typeof mode)=>{setMode(value);setError('');setPassword('');setConfirmation('');setVisible(false);};
  const submit=async(e:React.FormEvent)=>{
    e.preventDefault();setError('');setBusy(true);
    try {
      if(mode==='invite') {
        const data=await authRequest('/api/auth/bootstrap',{token:setupCode.trim()});
        invite.current=new URLSearchParams(new URL(data.path,location.origin).hash.slice(1)).get('invite')||'';setSetupCode('');setMode('setup');
      } else if(mode==='login') {
        await auth.signIn(username,password,remember);setPassword('');navigate(safeNext(next.current),{replace:true});
      } else {
        if(password!==confirmation)throw new Error('The passwords do not match. Enter the same password twice.');
        const data=await authRequest(mode==='setup'?'/api/auth/setup':'/api/auth/recover',{username,password,remember,invite:invite.current,recovery_code:code});
        setPassword('');setConfirmation('');setCode('');invite.current='';setRecovery(data.recovery_code);setMode('saved');
        if(location.hash.startsWith('#invite='))history.replaceState(null,'',location.pathname+location.search);
      }
    }catch(e:any){setError(e.message);}finally{setBusy(false);}
  };
  const download=()=>{
    const blob=new Blob([`Godspeed Mission Control recovery code\nServer: ${location.origin}\nUsername: ${username.trim()}\n\n${recovery}\n\nKeep this code private. It lets you reset your username and password.\nAfter a reset, save the new code; this code will no longer work.\n`],{type:'text/plain'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='godspeed-recovery-code.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const title={loading:'Opening your server',login:'Welcome back',invite:'Your first visit',setup:'Make it yours',recover:'Recover your account',saved:'Keep your way back in'}[mode];
  const description={loading:'Checking your sign-in…',login:'Sign in to your Godspeed Mission Control.',invite:'Use your private setup link, or the setup code you saved during installation.',setup:'Choose a username and password for this server. No email address needed.',recover:'Your saved recovery code lets you choose a new username and password.',saved:'Save this recovery code somewhere private. You will need it if you forget your password.'}[mode];
  return <AuthShell><h2>{title}</h2><p className="auth-intro">{description}</p>
    {auth.expired && mode==='login' && <p className="auth-notice" role="status">Your sign-in has expired. Sign in again to return to your page.</p>}
    <p className="auth-error" role="alert" tabIndex={-1} ref={errorRef} hidden={!error}>{error}</p>
    {mode==='loading'?<div className="auth-loading" role="status">Connecting…</div>:mode==='saved'?<>
      <div className="auth-recovery"><KeyRound size={22} aria-hidden="true"/><output aria-label="Your recovery code">{recovery}</output></div>
      <div className="auth-code-actions"><button type="button" className="auth-secondary" onClick={async()=>{try{await navigator.clipboard.writeText(recovery);setCopied(true);}catch{setError('Copying is unavailable in this browser. Download the code instead.');}}}>{copied?<Check size={18}/>:<Copy size={18}/>} {copied?'Copied':'Copy code'}</button><button type="button" className="auth-secondary" onClick={download}><Download size={18}/> Download</button></div>
      <p className="auth-help">This replaces any previous recovery code. Godspeed cannot email you a password reset.</p>
      <label className="auth-check"><input type="checkbox" checked={saved} onChange={e=>setSaved(e.target.checked)}/><span>I have saved my recovery code.</span></label>
      <button type="button" className="auth-primary" disabled={!saved||busy} onClick={async()=>{setBusy(true);try{await auth.refreshSession();navigate(safeNext(next.current),{replace:true});}catch(e:any){setError(e.message);}finally{setBusy(false);}}}>{busy?'Opening…':'Open Godspeed Mission Control'}</button>
    </>:<form onSubmit={submit}>
      {mode==='invite'?<><label className="auth-label" htmlFor="setup-code">Setup code</label><input className="auth-input" id="setup-code" name="setup-code" type="password" autoComplete="off" required value={setupCode} onChange={e=>setSetupCode(e.target.value)} aria-describedby="setup-help"/><p className="auth-help" id="setup-help">For a Hostinger deployment, use the setup code you entered before deploying. It is only used to create your account.</p></>:<>
        {mode==='recover'&&<><label className="auth-label" htmlFor="recovery-code">Recovery code</label><input className="auth-input" id="recovery-code" name="recovery-code" autoComplete="off" required value={code} onChange={e=>setCode(e.target.value)} spellCheck={false}/></>}
        <label className="auth-label" htmlFor="username">{mode==='recover'?'New username':'Username'}</label><input className="auth-input" id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={3} maxLength={64} value={username} onChange={e=>setUsername(e.target.value)}/>
        <label className="auth-label" htmlFor="password">{mode==='recover'?'New password':'Password'}</label><div className="auth-password"><input className="auth-input" id="password" name="password" type={visible?'text':'password'} autoComplete={mode==='login'?'current-password':'new-password'} required minLength={mode==='login'?undefined:12} maxLength={256} value={password} onChange={e=>setPassword(e.target.value)} aria-describedby={mode==='login'?undefined:'password-help'}/><button type="button" className="auth-reveal" aria-label={visible?'Hide password':'Show password'} aria-pressed={visible} onClick={()=>setVisible(!visible)}>{visible?<EyeOff size={19}/>:<Eye size={19}/>}</button></div>
        {mode!=='login'&&<><p className="auth-help" id="password-help">At least 12 characters. A few unrelated words work well.</p><label className="auth-label" htmlFor="confirm-password">Confirm password</label><input className="auth-input" id="confirm-password" name="confirm-password" type={visible?'text':'password'} autoComplete="new-password" required minLength={12} maxLength={256} value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></>}
        <label className="auth-check"><input type="checkbox" name="remember" checked={remember} onChange={e=>setRemember(e.target.checked)}/><span>Keep me signed in for 7 days</span></label>
      </>}
      <button className="auth-primary" type="submit" disabled={busy}>{busy?'Please wait…':mode==='login'?'Sign in':mode==='invite'?'Start setup':mode==='setup'?'Create account':'Recover account'}</button>
      {mode==='login'&&<button type="button" className="auth-link" onClick={()=>changeMode('recover')}>Forgot your username or password?</button>}
      {mode==='recover'&&<><p className="auth-help">No recovery code? The server owner must restore access through their hosting account. Email recovery is unavailable.</p><button type="button" className="auth-link" onClick={()=>changeMode('login')}>Back to sign in</button></>}
      {mode==='invite'&&error&&<button type="button" className="auth-link" onClick={inspect}>Check connection again</button>}
    </form>}
  </AuthShell>;
}

