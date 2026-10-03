import { Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { DashboardSidebar } from "./DashboardSidebar";
import { DashboardSearch } from "./DashboardSearch";
import { GlobalCreateButton } from "./GlobalCreateButton";
import { GlobalAIChatFAB } from "@/components/chat/GlobalAIChatFAB";
import { CommandPalette } from "./CommandPalette";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LowBalanceBanner } from "./LowBalanceBanner";
import { useProcessingSweep } from "@/hooks/useProcessingSweep";
import { RouteErrorBoundary } from "@/components/ErrorBoundary";
import { PageLoader } from "@/components/LoadingStates";



export function DashboardLayout() {
  const pathname=useLocation().pathname;
  const isChat=pathname==="/dashboard/chat",isNotes=pathname.startsWith("/dashboard/notes");

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <DashboardSidebar />
        <div className="flex-1 min-w-0 flex flex-col">
          <header className="h-14 flex items-center gap-4 border-b bg-background px-4">
            <SidebarTrigger />
            <DashboardSearch />
            <GlobalCreateButton />
            <div className="ml-auto flex items-center gap-1">
              <NotificationCenter />
              <ThemeToggle />
            </div>
          </header>


          
          <main className="flex-1 overflow-auto p-6">
            {/* A crashing page no longer takes the sidebar with it, and the
                boundary clears on the next navigation. Loading a page's code
                keeps the sidebar and header on screen. */}
            <RouteErrorBoundary>
              <Suspense fallback={<PageLoader />}>
                <Outlet />
              </Suspense>
            </RouteErrorBoundary>
          </main>
        </div>
        {!isChat&&!isNotes&&<GlobalAIChatFAB />}
        <CommandPalette />
      </div>
    </SidebarProvider>
  );
}
