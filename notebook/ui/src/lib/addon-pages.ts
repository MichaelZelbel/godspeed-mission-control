import { useEffect, useState } from "react";
import { BookHeart, Briefcase, Camera, Heart, Puzzle, Sparkles, Star, Video, type LucideIcon } from "lucide-react";

// An installed add-on's pages in the notebook (core/addon-notebook.mjs, #1182). The server says
// which add-ons have a menu entry; this is the one place the screen reads that, and the one list of
// icons an add-on may name (anything else is the puzzle piece).
export type AddonMenu = { id: string; name: string; title: string; icon: string; pages: { id: string; title: string }[] };

const ICONS: Record<string, LucideIcon> = { "book-heart": BookHeart, briefcase: Briefcase, camera: Camera, heart: Heart, sparkles: Sparkles, star: Star, video: Video };
export const addonIcon = (name: string): LucideIcon => ICONS[name] ?? Puzzle;

export const addonPagePath = (id: string, page: string) => `/dashboard/addons/${id}/${page}`;

// Settings tells the menu when an add-on was added or removed.
export const ADDONS_CHANGED = "godspeed:addons-changed";

export function menusOf(addons: any[]): AddonMenu[] {
  return addons.filter((a) => a?.pages?.pages?.length).map((a) => ({ id: a.id, name: a.name, title: a.pages.title || a.name, icon: a.pages.icon || "", pages: a.pages.pages }));
}

export function useAddonMenus(): AddonMenu[] {
  const [menus, setMenus] = useState<AddonMenu[]>([]);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const r = await fetch("/api/addons");
        if (!r.ok) return;
        const data = await r.json();
        if (live) setMenus(menusOf(data.addons || []));
      } catch { /* the menu simply has no add-ons */ }
    };
    void load();
    window.addEventListener(ADDONS_CHANGED, load);
    return () => { live = false; window.removeEventListener(ADDONS_CHANGED, load); };
  }, []);
  return menus;
}
