import { lazy, Suspense, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, Outlet } from 'react-router-dom';
import { ThemeProvider } from 'next-themes';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { RouteErrorBoundary } from '@/components/ErrorBoundary';
import {GlobalAIChatFAB} from '@/components/chat/GlobalAIChatFAB';
import { AuthScreen, AuthShell } from '@/components/auth/AuthScreen';

import {DashboardLayout} from '@/components/layout/DashboardLayout';
const Notes=lazy(()=>import('./pages/Notes')),People=lazy(()=>import('./pages/People')),World=lazy(()=>import('./pages/World'));
const Profile=lazy(()=>import('./pages/Profile')),Collections=lazy(()=>import('./pages/Collections')),CollectionDetail=lazy(()=>import('./pages/CollectionDetail'));
const CollectionSchema=lazy(()=>import('./pages/CollectionSchema')),CollectionTemplates=lazy(()=>import('./pages/CollectionTemplates'));
const Timeline=lazy(()=>import('./pages/TimelinePage')),Media=lazy(()=>import('./pages/MediaLibrary')),Review=lazy(()=>import('./pages/ReviewQueue'));
const Groups=lazy(()=>import('./pages/Groups')),GroupDetail=lazy(()=>import('./pages/GroupDetail')),Actions=lazy(()=>import('./pages/Actions'));
const Activity=lazy(()=>import('./pages/ActivityPage')),WeeklyReview=lazy(()=>import('./pages/WeeklyReview'));
const Control=lazy(()=>import('./local/Control'));
const ImportMenerio=lazy(()=>import('./local/ImportMenerio'));
const Home=lazy(()=>import('./local/Home'));
const SharedNote=lazy(()=>import('./pages/SharedNote'));
function Layout(){
  const {user,loading,authError,refreshSession}=useAuth();
  if(loading)return <AuthShell><h2>Opening Godspeed Mission Control</h2><p role="status">Checking your sign-in…</p></AuthShell>;
  if(!user&&authError)return <AuthShell><h2>Let’s reconnect</h2><p className="auth-intro" role="alert">{authError}</p><button className="auth-primary" onClick={refreshSession}>Try again</button></AuthShell>;
  if(!user)return <AuthScreen/>;
  return <DashboardLayout/>;
}
export default function App(){return <ThemeProvider attribute="class" defaultTheme="dark"><TooltipProvider><Toaster/><Sonner/><BrowserRouter><AuthProvider><Routes><Route path="/setup" element={<AuthScreen/>}/><Route path="/shared/:token" element={<Suspense fallback={<p>Opening...</p>}><SharedNote/></Suspense>}/><Route element={<Layout/>}>
  <Route path="/" element={<Navigate to="/dashboard" replace/>}/><Route path="/dashboard" element={<Home/>}/>
  <Route path="/dashboard/chat" element={<GlobalAIChatFAB page/>}/><Route path="/chat" element={<Navigate to="/dashboard/chat" replace/>}/><Route path="/dashboard/control" element={<Navigate to="/dashboard" replace/>}/><Route path="/dashboard/notes/*" element={<Notes/>}/>
  <Route path="/dashboard/settings" element={<Control/>}/><Route path="/settings" element={<Control/>}/>
  <Route path="/dashboard/settings/import" element={<ImportMenerio/>}/>
  <Route path="/dashboard/people" element={<People/>}/><Route path="/dashboard/people/:id" element={<People/>}/>
  <Route path="/dashboard/world" element={<World/>}/><Route path="/dashboard/world/:id" element={<World/>}/>
  <Route path="/dashboard/profile" element={<Profile/>}/><Route path="/dashboard/timeline" element={<Timeline/>}/>
  <Route path="/dashboard/media" element={<Media/>}/><Route path="/dashboard/review-queue" element={<Review/>}/>
  <Route path="/dashboard/groups" element={<Groups/>}/><Route path="/dashboard/groups/:slug" element={<GroupDetail/>}/>
  <Route path="/dashboard/actions" element={<Actions/>}/><Route path="/dashboard/activity" element={<Activity/>}/><Route path="/dashboard/review" element={<WeeklyReview/>}/>
  <Route path="/collections" element={<Collections/>}/><Route path="/collections/templates" element={<CollectionTemplates/>}/>
  <Route path="/collections/:slug/schema" element={<CollectionSchema/>}/><Route path="/collections/:slug/:itemId" element={<CollectionDetail/>}/><Route path="/collections/:slug" element={<CollectionDetail/>}/>
  <Route path="/lexicon/*" element={<p>Lexicon is not available in this test installation yet.</p>}/><Route path="/dashboard/graph" element={<p>Note graph is not available in this test installation yet.</p>}/>
  <Route path="*" element={<p>This page is unavailable in this test installation.</p>}/>
</Route></Routes></AuthProvider></BrowserRouter></TooltipProvider></ThemeProvider>;}
