import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus, Search, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAddMembership } from "@/hooks/useGroupMemberships";
import { useCreatePerson } from "@/hooks/usePeople";
import { useAuth } from "@/contexts/AuthContext";
import { showToast } from "@/lib/toast";
import { initials } from "@/lib/group-utils";
import { fetchAllPages } from "@/lib/postgrest";
import { personLabel } from "@/components/timeline/people";

type ContactGroup = Database["public"]["Tables"]["contact_groups"]["Row"];
type Contact = Pick<Database["public"]["Tables"]["contacts"]["Row"], "id" | "name" | "company" | "role">;

export function AddMemberDialog({ group, existingPersonIds }: { group: ContactGroup; existingPersonIds: Set<string> }) {
  const { user } = useAuth();
  const addMembership = useAddMembership();
  const createPerson = useCreatePerson();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const { data: contacts = [], isLoading } = useQuery<Contact[]>({
    queryKey: ["contacts", user?.id, "group-picker"],
    enabled: !!user && open,
    // Read to the end: an unpaged select stops at 1,000 people, and anyone
    // past that could not be added from here.
    queryFn: () =>
      fetchAllPages<Contact>((from, to) =>
        supabase.from("contacts").select("id, name, company, role").eq("user_id", user!.id).is("merged_into", null).order("name").order("id").range(from, to),
      ),
  });
  const available = contacts.filter((contact) => !existingPersonIds.has(contact.id) && personLabel(contact).toLowerCase().includes(search.toLowerCase()));

  const submit = async () => {
    try {
      await Promise.all(selected.map((personId) => addMembership.mutateAsync({ groupId: group.id, personId })));
    } catch {
      // useAddMembership has already said what failed; keep the dialog open.
      return;
    }
    showToast.success("Members added");
    setSelected([]);
    setOpen(false);
  };

  // Creates the person and adds them to this group in one step. Nothing is
  // created until this is confirmed; cancelling leaves People and the group as they were.
  const submitNew = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const person = await createPerson.mutateAsync(name);
      await addMembership.mutateAsync({ groupId: group.id, personId: person.id });
    } catch {
      // The hooks have already said what failed; keep the dialog open.
      return;
    }
    showToast.success("Members added");
    closeNew();
    setOpen(false);
  };
  const closeNew = () => { setCreating(false); setNewName(""); };
  const busy = addMembership.isPending || createPerson.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) closeNew(); }}>
      <DialogTrigger asChild><Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" /> Add Member</Button></DialogTrigger>
      <DialogContent className="grid-cols-1">
        <DialogHeader><DialogTitle>Add Members</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Search people" className="pl-9" placeholder="Search people..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {creating ? (
            <form className="space-y-2 rounded-md border p-3" onSubmit={(e) => { e.preventDefault(); void submitNew(); }}>
              <Input aria-label="New person's name" placeholder="New person's name" autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={closeNew} disabled={busy}>Cancel</Button>
                <Button type="submit" size="sm" disabled={!newName.trim() || busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add person to group</Button>
              </div>
            </form>
          ) : (
            <Button type="button" variant="outline" size="sm" className="w-full gap-1.5" onClick={() => { setCreating(true); setNewName(search.trim()); }}><UserPlus className="h-4 w-4" /> Add a new person</Button>
          )}
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {isLoading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : available.map((contact) => (
              <label key={contact.id} className="flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-accent">
                <Checkbox checked={selected.includes(contact.id)} onCheckedChange={(checked) => setSelected((prev) => checked ? [...prev, contact.id] : prev.filter((id) => id !== contact.id))} />
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">{initials(personLabel(contact))}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium" title={personLabel(contact)}>{personLabel(contact)}</span><span className="block truncate text-xs text-muted-foreground">{[contact.role, contact.company].filter(Boolean).join(" · ")}</span></span>
              </label>
            ))}
            {!isLoading && available.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No available people found.</p>}
          </div>
        </div>
        <DialogFooter><Button onClick={submit} disabled={selected.length === 0 || busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add Selected</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
