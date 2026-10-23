import { lazy, Suspense, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, Outlet, useLocation } from 'react-router-dom';
import { BRAIN_PAGE } from '@/lib/brain-page';
import { ThemeProvider } from 'next-themes';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { RouteErrorBoundary } from '@/components/ErrorBoundary';
import {GlobalAIChatFAB} from '@/components/chat/GlobalAIChatFAB';
import { AuthScreen, AuthShell } from '@/components/auth/AuthScreen';

import {DashboardLayout} from '@/components/layout/DashboardLayout';
// Note text the notebook has not confirmed yet, sent again from the moment the page opens (#29).
import {KeepUnsavedNotes} from '@/hooks/useUnsavedNotes';
const Notes=lazy(()=>import('./pages/Notes')),People=lazy(()=>import('./pages/People')),World=lazy(()=>import('./pages/World'));
const Profile=lazy(()=>import('./pages/Profile')),Collections=lazy(()=>import('./pages/Collections')),CollectionDetail=lazy(()=>import('./pages/CollectionDetail'));
const CollectionSchema=lazy(()=>import('./pages/CollectionSchema')),CollectionTemplates=lazy(()=>import('./pages/CollectionTemplates'));
// A habit on the Trackers shelf (D-321, step 3).
const HabitTracker=lazy(()=>import('./pages/HabitTracker'));
const Timeline=lazy(()=>import('./pages/TimelinePage')),Media=lazy(()=>import('./pages/MediaLibrary')),Review=lazy(()=>import('./pages/ReviewQueue'));
const Groups=lazy(()=>import('./pages/Groups')),GroupDetail=lazy(()=>import('./pages/GroupDetail')),Actions=lazy(()=>import('./pages/Actions'));
const Activity=lazy(()=>import('./pages/ActivityPage')),WeeklyReview=lazy(()=>import('./pages/WeeklyReview'));
const KnowledgeGraph=lazy(()=>import('./pages/KnowledgeGraph'));
// Godspeed's brain (lib/brain-page.ts): who it is, its rules, what it knows about you, its skills.
const Identity=lazy(()=>import('./pages/Identity'));
// Its address until 16 October 2026 ("Identity"), with a section after # kept.
function ToBrainPage(){const {search,hash}=useLocation();return <Navigate to={BRAIN_PAGE.path+search+hash} replace/>;}
const Control=lazy(()=>import('./local/Control'));
// Each goal with its weekly number, decisions, work and research (local/Goals.tsx, 18 October 2026).
const Goals=lazy(()=>import('./local/Goals'));
const ImportMenerio=lazy(()=>import('./local/ImportMenerio'));
const ConnectTelegram=lazy(()=>import('./local/ConnectTelegram'));
const Home=lazy(()=>import('./local/Home'));
const SharedNote=lazy(()=>import('./pages/SharedNote'));
function Layout(){
  const {user,loading,authError,refreshSession}=useAuth();
  if(loading)return <AuthShell><h2>Opening Godspeed Mission Control</h2><p role="status">Checking your sign-in…</p></AuthShell>;
  if(!user&&authError)return <AuthShell><h2>Let’s reconnect</h2><p className="auth-intro" role="alert">{authError}</p><button className="auth-primary" onClick={refreshSession}>Try again</button></AuthShell>;
  if(!user)return <AuthScreen/>;
  return <><KeepUnsavedNotes/><DashboardLayout/></>;
}
export default function App(){return <ThemeProvider attribute="class" defaultTheme="dark"><TooltipProvider><Toaster/><Sonner/><BrowserRouter><AuthProvider><Routes><Route path="/setup" element={<AuthScreen/>}/><Route path="/shared/:token" element={<Suspense fallback={<p>Opening...</p>}><SharedNote/></Suspense>}/><Route element={<Layout/>}>
  <Route path="/" element={<Navigate to="/dashboard" replace/>}/><Route path="/dashboard" element={<Home/>}/>
  <Route path="/dashboard/chat" element={<GlobalAIChatFAB page/>}/><Route path="/chat" element={<Navigate to="/dashboard/chat" replace/>}/><Route path="/dashboard/control" element={<Navigate to="/dashboard" replace/>}/><Route path="/dashboard/notes/*" element={<Notes/>}/>
  <Route path="/dashboard/goals" element={<Goals/>}/><Route path="/goals" element={<Navigate to="/dashboard/goals" replace/>}/>
  <Route path="/dashboard/settings" element={<Control/>}/><Route path="/settings" element={<Control/>}/>
  <Route path="/dashboard/settings/import" element={<ImportMenerio/>}/>
  <Route path="/dashboard/telegram" element={<ConnectTelegram/>}/>
  <Route path="/dashboard/people" element={<People/>}/><Route path="/dashboard/people/:id" element={<People/>}/>
  <Route path="/dashboard/world" element={<World/>}/><Route path="/dashboard/world/:id" element={<World/>}/>
  <Route path="/dashboard/profile" element={<Profile/>}/><Route path={BRAIN_PAGE.path} element={<Identity/>}/><Route path={BRAIN_PAGE.oldPath} element={<ToBrainPage/>}/><Route path="/dashboard/timeline" element={<Timeline/>}/>
  <Route path="/dashboard/media" element={<Media/>}/><Route path="/dashboard/review-queue" element={<Review/>}/>
  <Route path="/dashboard/groups" element={<Groups/>}/><Route path="/dashboard/groups/:slug" element={<GroupDetail/>}/>
  <Route path="/dashboard/actions" element={<Actions/>}/><Route path="/dashboard/activity" element={<Activity/>}/><Route path="/dashboard/review" element={<WeeklyReview/>}/>
  <Route path="/collections" element={<Collections/>}/><Route path="/collections/templates" element={<CollectionTemplates/>}/>
  <Route path="/collections/:slug/schema" element={<CollectionSchema/>}/><Route path="/collections/:slug/:itemId" element={<CollectionDetail/>}/><Route path="/collections/:slug" element={<CollectionDetail/>}/><Route path="/trackers/habits/:id" element={<HabitTracker/>}/>
  <Route path="/dashboard/graph" element={<KnowledgeGraph/>}/>
  <Route path="*" element={<p>This page is unavailable.</p>}/>
</Route></Routes></AuthProvider></BrowserRouter></TooltipProvider></ThemeProvider>;}
