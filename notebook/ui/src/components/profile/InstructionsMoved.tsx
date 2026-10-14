import { Link } from "react-router-dom";
import { Fingerprint } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

// My Profile's "Agent Instructions" until 15 October 2026. The instructions are the same records
// as before and still reach every connected AI app with the profile; they are changed on the
// Identity page now, beside the rules, so there is one place for everything your assistants follow.
export function InstructionsMoved({ count }: { count: number }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden="true"><Fingerprint className="h-4 w-4" /></div>
          <div>
            <h3 className="text-lg font-semibold">Instructions moved to Identity</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Your instructions for AI apps now sit on the Identity page, next to your rules, so everything your assistants follow is in one place, with every earlier version.
              {count > 0 ? ` All ${count} of yours are there, unchanged, and connected apps still receive them.` : ""}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Button asChild className="min-h-11 sm:min-h-9"><Link to="/dashboard/identity#instructions">Open your instructions</Link></Button>
      </CardContent>
    </Card>
  );
}
