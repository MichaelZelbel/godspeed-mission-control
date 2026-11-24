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
import { useProcessingSweep } from "@/hooks/useProcessingSweep";
import { RouteErrorBoundary } from "@/components/ErrorBoundary";
import { PageLoader } from "@/components/LoadingStates";
import { BRAIN_PAGE } from "@/lib/brain-page";
import { isCollectionPage } from "./collection-route";


// A phone held sideways is under 500 px tall: the 9.5rem kept for the chat button would leave the person's
// details a short strip with an empty band below it (#1033), so the People pages take the whole height below
// the header there (the button floats over the page's corner, as it does over any scrolled page).
const SIDEWAYS_FULL=" [@media(max-height:500px)]:max-h-none [@media(max-height:500px)]:[--page-h:calc(100dvh-6.5rem)]";

export function DashboardLayout() {
  const pathname=useLocation().pathname;
  // Godspeed's brain docks its own chat beside its content, as Notes does: no floating button
  // over the rule being changed.
  const isChat=pathname==="/dashboard/chat",isNotes=pathname.startsWith("/dashboard/notes"),isImport=pathname==="/dashboard/settings/import",isHabit=pathname.startsWith("/trackers/habits/"),isBrain=pathname===BRAIN_PAGE.path;
  const isPeople=pathname.startsWith("/dashboard/people");
  // A collection page (not templates or schema) reaches the window's bottom at phone widths: the
  // button floats over it, and its own card leaves room (#1045). Other pages keep the reserve.
  const isCollection=isCollectionPage(pathname);
  const floatingChat=!isChat&&!isNotes&&!isImport&&!isHabit&&!isBrain;

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <DashboardSidebar />
        <div className="flex-1 min-w-0 flex flex-col">
          {/* On a narrow phone the top bar's controls leave the search box so little room that its
              own padding ate the rest (#868), so below sm the bar's edge padding is 12 px, not 16. Below sm the
              search results anchor to this bar, so they span the screen (#1017). */}
          <header className="relative h-14 flex items-center gap-2 sm:gap-4 border-b bg-background px-3 sm:px-4">
            <SidebarTrigger />
            <DashboardSearch />
            <GlobalCreateButton />
            <div className="ml-auto flex items-center gap-1">
              <NotificationCenter />
              <ThemeToggle />
            </div>
          </header>


          
          {/* Where the floating chat button shows, main holds the space above the button's zone
              (3.5rem header + 5rem button zone and a gap) and scrolls within it: the button is
              pinned to the viewport's corner, so room kept only at the end of the content (issue
              #530's pb-24) still left a card under it at every scroll before the end (#878).
              --page-h is main's content box (the cap minus main's own 3rem of vertical padding);
              pages that fill it use it, so their budget cannot drift from this cap. At phone widths
              the content reaches the window's bottom and the button floats over it (#1045). */}
          <main data-collection-page={isCollection||undefined} className={floatingChat?"flex-1 overflow-auto p-6 max-h-[calc(100dvh-9.5rem)] [--page-h:calc(100dvh-12.5rem)]"+(isCollection?" max-sm:max-h-[calc(100dvh-3.5rem)] max-sm:[--page-h:calc(100dvh-6.5rem)] max-lg:max-h-none max-lg:overflow-visible":"")+(isPeople?SIDEWAYS_FULL:""):"flex-1 overflow-auto p-6"}>
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
