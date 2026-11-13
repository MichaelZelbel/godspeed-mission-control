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
import { BRAIN_PAGE } from "@/lib/brain-page";



export function DashboardLayout() {
  const pathname=useLocation().pathname;
  // Godspeed's brain docks its own chat beside its content, as Notes does: no floating button
  // over the rule being changed.
  const isChat=pathname==="/dashboard/chat",isNotes=pathname.startsWith("/dashboard/notes"),isImport=pathname==="/dashboard/settings/import",isHabit=pathname.startsWith("/trackers/habits/"),isBrain=pathname===BRAIN_PAGE.path;
  const floatingChat=!isChat&&!isNotes&&!isImport&&!isHabit&&!isBrain;

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <DashboardSidebar />
        <div className="flex-1 min-w-0 flex flex-col">
          <header className="h-14 flex items-center gap-2 sm:gap-4 border-b bg-background px-4">
            <SidebarTrigger />
            <DashboardSearch />
            <GlobalCreateButton />
            <div className="ml-auto flex items-center gap-1">
              <NotificationCenter />
              <ThemeToggle />
            </div>
          </header>


          
          {/* Where the floating chat button shows, the page keeps room below its content for it (6rem:
              the button's 3.5rem and its 1.5rem from the edge, and a gap), so scrolled to the end
              nothing on a narrow window lies under it (issue #530). */}
          <main className={floatingChat?"flex-1 overflow-auto p-6 pb-24":"flex-1 overflow-auto p-6"}>
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
        {floatingChat&&<GlobalAIChatFAB />}
        <CommandPalette />
      </div>
    </SidebarProvider>
  );
}
