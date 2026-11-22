
import {
  LayoutDashboard,
  FileText,
  FolderOpen,
  Search,
  Bookmark,
  Users,
  Settings,
  Bell,
  Crown,
  ShieldCheck,
  Plug,
  UserCircle,
  User,
  
  Network,
  Image,
  BookOpen,
  ClipboardList,
  Calendar,
  Layers,
  LayoutGrid,
  LogOut,
  Globe,
  Target,
  ChevronDown,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { watchSidebarFit } from "@/lib/sidebar-fit";
import { NavLink } from "@/components/NavLink";
import { BRAIN_PAGE } from "@/lib/brain-page";
import { BRAND, GUIDE_URL } from "@/lib/brand";
import { brandLogo } from "@/lib/brand-assets";
import { localDateISO, localTimeHM, parseInstant } from "@/lib/local-date";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PremiumBadge } from "@/components/subscription/PremiumBadge";
import { CreditsDisplay } from "@/components/settings/CreditsDisplay";
import { useProfileSummary } from "@/hooks/useProfileSummary";
import { useReviewQueueCount } from "@/hooks/useReviewQueue";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";

// A link to another site (the user guide) opens in a new tab, so the notebook stays open.
const newTab = (url: string) => (/^https?:/.test(url) ? { target: "_blank", rel: "noopener" } : {});

// When the running build was made, in local time. A window still running an
// old cached build shows an older time than a fresh load does.
const BUILD_LABEL = (() => {
  const iso = typeof __BUILD_TIME__ === "string" ? __BUILD_TIME__ : "";
  const d = parseInstant(iso);
  if (!d) return "";
  return `${localDateISO(d)} ${localTimeHM(d)}`;
})();

export function DashboardSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { role, signOut } = useAuth();
  const navigate = useNavigate();
  const isPremium = role === "premium" || role === "premium_gift" || role === "admin";
  const { completeness } = useProfileSummary();
  const pendingCount = useReviewQueueCount();

  // The list ends at an entry's edge, never in the middle of one, and says when more is below (#747).
  const listRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (collapsed || !listRef.current || !moreRef.current) return;
    return watchSidebarFit(listRef.current, moreRef.current);
  }, [collapsed]);

  const profileDotColor =
    completeness < 30 ? "bg-destructive" : completeness < 70 ? "bg-yellow-500" : "bg-green-500";

  // Whole path segments: a bare prefix lit "Weekly Review" (/dashboard/review)
  // on the Review Queue (/dashboard/review-queue) as well.
  const isActive = (path: string) =>
    path === "/dashboard"
      ? location.pathname === "/dashboard"
      : location.pathname === path || location.pathname.startsWith(`${path}/`);

  // Nav groups are keyed so each brand can order them (BRAND.navGroupOrder)
  // without duplicating the item definitions.
  type NavItem = { title: string; url: string; icon: typeof LayoutDashboard };
  const groupsByKey: Record<string, { items: NavItem[] }> = {
    notes: {
      items: [
        { title: "Notes", url: "/dashboard/notes", icon: FileText },
        { title: "Note Graph", url: "/dashboard/graph", icon: Network },
      ],
    },
    people: {
      items: [
        { title: "People", url: "/dashboard/people", icon: UserCircle },
        { title: "World", url: "/dashboard/world", icon: Globe },
        { title: "Groups", url: "/dashboard/groups", icon: Layers },
        { title: "Timeline", url: "/dashboard/timeline", icon: Calendar },
      ],
    },
    collections: {
      items: [
        { title: "Collections", url: "/collections", icon: LayoutGrid },
        { title: "Media Library", url: "/dashboard/media", icon: Image },
      ],
    },
    review: {
      items: [
        { title: "Review Queue", url: "/dashboard/review-queue", icon: ClipboardList },
        { title: "Weekly Review", url: "/dashboard/review", icon: Calendar },
      ],
    },
  };
  const navGroups: { items: NavItem[] }[] = [
    { items: [{ title: "Dashboard", url: "/dashboard", icon: LayoutDashboard }, { title: "Goals", url: "/dashboard/goals", icon: Target }] },
    ...BRAND.navGroupOrder.map((key) => groupsByKey[key]),
  ];

  const systemItems = [
    { title: "My Profile", url: "/dashboard/profile", icon: User },
    { title: BRAIN_PAGE.label, url: BRAIN_PAGE.path, icon: BRAIN_PAGE.icon },
    { title: "Settings", url: "/dashboard/settings", icon: Settings },
    { title: "Godspeed chat", url: "/chat", icon: Plug },
    // The AI connection in Settings, opened where it is (Control.tsx); until 18 October 2026 this
    // went to ?tab=mcp, which the notebook's Settings does not have, so it opened the top.
    { title: "Connect AI", url: "/dashboard/settings#connect-ai", icon: Plug },
    ...(BRAND.showDocs ? [{ title: "Documentation", url: GUIDE_URL, icon: BookOpen }] : []),
  ];

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1">
          <img src={brandLogo} alt={BRAND.name} className="h-7 w-7 object-contain" />
          {!collapsed && (
            <span className="text-sm font-semibold font-display text-foreground">{BRAND.name}</span>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent ref={listRef}>
        {navGroups.map((group, idx) => (
          <div key={idx}>
            {idx > 0 && <SidebarSeparator />}
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                        <NavLink to={item.url} end={item.url === "/dashboard"}>
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                          {item.title === "Review Queue" && !collapsed && pendingCount > 0 && (
                            <Badge variant="default" className="ml-auto text-[10px] px-1.5 py-0 min-w-[1.25rem] justify-center">
                              {pendingCount}
                            </Badge>
                          )}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </div>
        ))}

        <SidebarSeparator />

        <SidebarGroup>
          <SidebarGroupLabel>System</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {systemItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                    <NavLink to={item.url} {...newTab(item.url)}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                      {item.title === "My Profile" && !collapsed && (
                        <span className={`ml-auto h-2 w-2 rounded-full ${profileDotColor}`} />
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {role === "admin" && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/dashboard/admin")} tooltip="Admin">
                    <NavLink to="/dashboard/admin">
                      <ShieldCheck className="h-4 w-4" />
                      <span>Admin</span>
                      {!collapsed && (
                        <Badge variant="outline" className="ml-auto text-[10px] px-1.5 py-0 border-warning/30 text-warning">
                          Admin
                        </Badge>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {!collapsed && (
        <div
          ref={moreRef}
          data-sidebar-more=""
          role="button"
          aria-label="Show more of the menu"
          aria-hidden="true"
          tabIndex={-1}
          style={{ display: "none", visibility: "hidden" }}
          className="flex min-h-7 flex-1 cursor-pointer items-start justify-center border-t border-sidebar-border px-2 pt-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <span className="flex items-center gap-1">
            More below <ChevronDown className="h-3.5 w-3.5" />
          </span>
        </div>
      )}

      <SidebarFooter>
        {!collapsed && <SidebarSeparator />}
        <Button
          variant="ghost"
          size={collapsed ? "icon" : "sm"}
          className="w-full justify-start text-muted-foreground hover:text-destructive"
          onClick={async () => { if(await signOut()) navigate("/"); }}
          title="Sign Out"
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && <span className="ml-2">Sign Out</span>}
        </Button>
        {!collapsed && (
          <p className="px-2 text-[10px] text-muted-foreground">
            © {new Date().getFullYear()} {BRAND.name}
            {BUILD_LABEL && <span title="When this version of the app was built"> · Version {BUILD_LABEL}</span>}
          </p>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
