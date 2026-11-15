import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UserCircle, ArrowRight, Heart } from "lucide-react";
import { personLabel, personNames } from "@/components/timeline/people";

type RecentPerson = { id: string; name: string; aliases: unknown; relationship: string | null; updated_at: string | null };

const SHOWN = 5;

export function RecentPeopleCard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: people = [] } = useQuery<RecentPerson[]>({
    queryKey: ["recent-people", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contacts")
        .select("id, name, aliases, relationship, updated_at")
        .eq("user_id", user!.id)
        .is("merged_into", null)
        .order("updated_at", { ascending: false })
        .limit(SHOWN * 4);
      if (error) throw error;
      // A person saved without any name is not listed, as on the People page (issue 266).
      return ((data || []) as RecentPerson[]).filter((p) => personNames(p).length > 0).slice(0, SHOWN);
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Recent People</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard/people")} className="gap-1 text-xs">
          View All <ArrowRight className="h-3 w-3" />
        </Button>
      </CardHeader>
      <CardContent>
        {people.length === 0 ? (
          <button
            onClick={() => navigate("/dashboard/people")}
            className="w-full rounded-md px-2 py-3 text-left text-sm text-muted-foreground transition-colors hover:bg-accent"
          >
            <Heart className="mb-1 inline h-4 w-4 text-primary" /> No one here yet - add your first
            person to start cherishing.
          </button>
        ) : (
          <div className="space-y-2">
            {people.map((person) => (
              <button
                key={person.id}
                onClick={() => navigate(`/dashboard/people/${person.id}`)}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
              >
                <UserCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">{personLabel(person)}</span>
                {person.relationship && (
                  <span className="truncate text-xs text-muted-foreground">{person.relationship}</span>
                )}
                {person.updated_at && (
                  <span className="ml-auto whitespace-nowrap text-[10px] text-muted-foreground">
                    {new Date(person.updated_at).toLocaleDateString()}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
