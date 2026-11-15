import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2, MessageSquare, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useStickyPanelPreference } from "@/hooks/useStickyPanelPreference";
import { dbErrorMessage } from "@/lib/function-error";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Comments on a note (18 October 2026). The README lists comments among the notebook's features
// and the notebook stores them (the `comments` records, notebook/_system/comments/<id>.json, which
// sync like every other record), but no screen showed them. Each comment keeps the note it belongs
// to (note_id), its text (content), who wrote it (author: "owner" for you) and when (created_at).
// A deleted comment is kept as a removal, so a second computer removes it too.
export interface NoteComment {
  id: string;
  note_id: string;
  content: string;
  author?: string | null;
  created_at: string;
}

// "18 Oct 2026, 14:05" in the reader's own language and clock.
export function commentDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
// You wrote a comment made here; one your assistant or another app saved carries its own name.
export function commentAuthor(author?: string | null): string {
  if (author === "owner") return "You";
  return typeof author === "string" ? author.trim() : "";
}

interface NoteCommentsPanelProps {
  noteId: string;
  // A note in the bin shows its comments but takes no new ones.
  readOnly?: boolean;
}

export function NoteCommentsPanel({ noteId, readOnly = false }: NoteCommentsPanelProps) {
  const [expanded, setExpanded] = useStickyPanelPreference("note-comments");
  const queryClient = useQueryClient();
  const queryKey = ["note-comments", noteId];
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [removing, setRemoving] = useState<NoteComment | null>(null);

  // The list feeds the count in the header, so it loads while the panel is collapsed too.
  const { data: comments = [], isLoading, error } = useQuery<NoteComment[]>({
    queryKey,
    enabled: !!noteId,
    queryFn: async () => {
      const { data, error: loadError } = await supabase
        .from("comments")
        .select("*")
        .eq("note_id", noteId)
        .order("created_at", { ascending: true });
      if (loadError) throw loadError;
      return (data || []) as NoteComment[];
    },
  });

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const content = text.trim();
    if (!content || saving) return;
    setSaving(true);
    setProblem("");
    const { error: saveError } = await supabase.from("comments").insert({ note_id: noteId, content, author: "owner" });
    setSaving(false);
    if (saveError) {
      setProblem(dbErrorMessage(saveError, "Your comment could not be saved. Try again."));
      return;
    }
    setText("");
    await queryClient.invalidateQueries({ queryKey });
  };

  const remove = async (comment: NoteComment) => {
    setRemoving(null);
    setProblem("");
    const { error: removeError } = await supabase.from("comments").delete().eq("id", comment.id);
    if (removeError) {
      setProblem(dbErrorMessage(removeError, "The comment could not be deleted. Try again."));
      return;
    }
    await queryClient.invalidateQueries({ queryKey });
  };

  return (
    <div className="border-t border-border">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 px-4 py-2 w-full text-left text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <MessageSquare className="h-3 w-3" />
        {error || isLoading ? "Comments" : `Comments (${comments.length})`}
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {dbErrorMessage(error, "The comments on this note could not be loaded.")}
            </p>
          )}
          {!isLoading && !error && comments.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {readOnly ? "This note has no comments." : "No comments yet. A comment is a remark about this note that stays out of its text."}
            </p>
          )}
          {comments.length > 0 && (
            <ul className="space-y-1.5 max-h-60 overflow-y-auto" aria-label="Comments on this note">
              {comments.map((comment) => {
                const author = commentAuthor(comment.author);
                return (
                  <li key={comment.id} className="group flex items-start gap-2 rounded-md bg-muted/30 p-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground whitespace-pre-wrap break-words">{comment.content}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {[author, commentDate(comment.created_at)].filter(Boolean).join(", ")}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label="Delete this comment"
                      title="Delete this comment"
                      onClick={() => setRemoving(comment)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          {!readOnly && (
            <form onSubmit={add} className="space-y-2">
              <label htmlFor={`note-comment-${noteId}`} className="sr-only">
                Write a comment
              </label>
              <Textarea
                id={`note-comment-${noteId}`}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Write a comment"
                className="min-h-[60px] text-sm"
                maxLength={5000}
              />
              <div className="flex items-center justify-end gap-2">
                <Button type="submit" size="sm" disabled={saving || !text.trim()} className="gap-1.5">
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Add comment
                </Button>
              </div>
            </form>
          )}
          {problem && (
            <p role="alert" className="text-xs text-destructive">
              {problem}
            </p>
          )}
        </div>
      )}

      <AlertDialog open={!!removing} onOpenChange={(open) => { if (!open) setRemoving(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this comment?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.content && removing.content.length > 120 ? removing.content.slice(0, 120) + "…" : removing?.content}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => removing && void remove(removing)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
