import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Note } from "@/hooks/useNotes";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ExternalLink, Send } from "lucide-react";

interface ConnectedApp {
  id: string;
  app_name: string;
  display_name: string;
  webhook_url: string | null;
  is_active: boolean;
}

const ENTITY_TYPES = ["person", "event", "document", "note", "custom"];

interface ForwardToAppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  note: Note;
}

export function ForwardToAppDialog({ open, onOpenChange, note }: ForwardToAppDialogProps) {
  const { user } = useAuth();
  const [selectedApp, setSelectedApp] = useState<string>("");
  const [entityType, setEntityType] = useState<string>(note.entity_type || "note");

  const { data: apps = [] } = useQuery<ConnectedApp[]>({
    queryKey: ["connected_apps_active", user?.id],
    enabled: !!user && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("connected_apps" as any)
        .select("id, app_name, display_name, webhook_url, is_active")
        .eq("user_id", user!.id)
        .eq("is_active", true)
        .order("display_name");
      if (error) throw error;
      return (data as unknown as ConnectedApp[]) || [];
    },
  });

  const chosen = apps.find((a) => a.id === selectedApp);

  const handleOpen = () => {
    if (!chosen || !chosen.webhook_url) return;

    const baseUrl = chosen.webhook_url.replace(/\/+$/, "");
    const callbackUrl = `${import.meta.env.VITE_SUPABASE_URL || ""}/functions/v1/link-note`;

    const params = new URLSearchParams({
      title: note.title || "",
      body: note.content || "",
      entity_type: entityType,
      menerio_note_id: note.id,
      menerio_callback: callbackUrl,
    });

    const url = `${baseUrl}/create-from-menerio?${params.toString()}`;
    window.open(url, "_blank");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" /> Send to app
          </DialogTitle>
          <DialogDescription>
            Open this note in a connected app to create a new entry there.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Choose an app</Label>
            <Select value={selectedApp} onValueChange={setSelectedApp}>
              <SelectTrigger>
                <SelectValue placeholder="Choose an app…" />
              </SelectTrigger>
              <SelectContent>
                {apps.map((app) => (
                  <SelectItem key={app.id} value={app.id} disabled={!app.webhook_url}>
                    {app.display_name}
                    {!app.webhook_url && " (no web address set)"}
                  </SelectItem>
                ))}
                {apps.length === 0 && (
                  <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                    No apps are connected. Connect one in Settings, under Connect AI.
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Type of entry</Label>
            <Select value={entityType} onValueChange={setEntityType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENTITY_TYPES.map((t) => (
                  <SelectItem key={t} value={t} className="capitalize">
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {chosen && (
            <p className="text-xs text-muted-foreground">
              The note “{note.title || "Untitled"}” opens in <strong>{chosen.display_name}</strong>.
              After the entry is created, {chosen.display_name} links it back automatically.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            onClick={handleOpen}
            disabled={!chosen || !chosen.webhook_url}
            className="gap-2"
          >
            <ExternalLink className="h-4 w-4" />
            {chosen ? `Open in ${chosen.display_name}` : "Choose an app"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
