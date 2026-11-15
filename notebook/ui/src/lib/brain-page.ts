import { Brain } from "lucide-react";

// The page that shows who the assistant is, its extra instructions, its rules, what it knows and
// its skills. Its name, icon and address live here only: the menu, the command palette, the page's
// heading and browser title, the links to it and the chat docked on it all read them from here.
// "Identity" with a fingerprint until 16 October 2026, which its owner read as his own identity;
// he named it "Godspeed's brain". The old address still opens it (App.tsx).
export const BRAIN_PAGE = {
  label: "Godspeed's brain",
  icon: Brain,
  path: "/dashboard/brain",
  oldPath: "/dashboard/identity",
  description: "Who your assistant is, its rules, what it knows about you and its skills.",
} as const;
